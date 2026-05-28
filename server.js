// AdLift server - Node built-in http, zero dependencies.
//   GET  /                 dashboard
//   GET  /api/status       provider + fixture availability
//   GET  /api/campaign     the seeded Battle Merge campaign
//   GET  /api/replay       pre-baked run (instant, offline-proof demo)
//   POST /api/optimise     SSE stream of a live agent run
//   POST /api/approve      human approval gate (records decision)
//   POST /api/save-fixture dev helper: save a live run as the replay fixture

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOptimise } from "./lib/agent.js";
import { providerStatus, env } from "./lib/providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(env.PORT || 5050);
const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data");
const FIXTURES_DIR = path.join(DATA, "fixtures");
const CAMPAIGN_DIR = path.join(DATA, "baseline");
const safeId = (s) => String(s || "").replace(/[^a-z0-9_]/gi, "");
function listCampaigns() {
  if (!fs.existsSync(CAMPAIGN_DIR)) return [];
  return fs.readdirSync(CAMPAIGN_DIR)
    .filter((f) => /^campaign.*\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(CAMPAIGN_DIR, f), "utf8")))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}
function fixturePath(id) { return path.join(FIXTURES_DIR, `replay_${safeId(id) || "battle_merge"}.json`); }

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function serveStatic(req, res) {
  // map URL -> file under PUBLIC (app) or DATA (read-only baseline assets)
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const root = rel.startsWith("/data/") ? DATA : PUBLIC;
  const resolved = rel.startsWith("/data/")
    ? path.resolve(__dirname, "." + rel)   // __dirname + /data/...
    : path.resolve(PUBLIC, "." + rel);
  if (!resolved.startsWith(root)) return send(res, 403, { error: "forbidden" });
  fs.readFile(resolved, (err, buf) => {
    if (err) return send(res, 404, { error: "not found", path: rel });
    res.writeHead(200, { "Content-Type": MIME[path.extname(resolved)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 8e6) req.destroy(); // 8MB cap
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/favicon.ico") { res.writeHead(204); return res.end(); }

  // ---- API ----
  if (url === "/api/status") {
    const hasFixture = fs.existsSync(FIXTURES_DIR) && fs.readdirSync(FIXTURES_DIR).some((f) => f.startsWith("replay_"));
    return send(res, 200, {
      provider: providerStatus(),
      hasFixture,
      campaigns: listCampaigns().length,
    });
  }

  if (url === "/api/campaigns") {
    return send(res, 200, listCampaigns());
  }

  if (url === "/api/replay") {
    const id = safeId((req.url.split("?")[1] || "").match(/id=([^&]+)/)?.[1]) || "battle_merge";
    const fx = fixturePath(id);
    if (!fs.existsSync(fx)) return send(res, 404, { error: `no replay fixture for ${id}` });
    return send(res, 200, fs.readFileSync(fx, "utf8"));
  }

  if (url === "/api/approve" && req.method === "POST") {
    const body = await readBody(req);
    const decision = body.decision === "reject" ? "reject" : "approve";
    const rec = { ...body, decision, at: new Date().toISOString() };
    try {
      fs.mkdirSync(path.join(DATA, "runs"), { recursive: true });
      fs.appendFileSync(path.join(DATA, "runs", "approvals.log"), JSON.stringify(rec) + "\n");
    } catch {}
    return send(res, 200, {
      ok: true,
      variantId: body.variantId,
      decision,
      disclosure: decision === "approve" ? "Ad - creative selected by AdLift" : null,
    });
  }

  if (url === "/api/save-fixture" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.run) return send(res, 400, { error: "missing run" });
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(body.run, null, 2));
    return send(res, 200, { ok: true, saved: FIXTURE });
  }

  if (url === "/api/optimise" && req.method === "POST") {
    const body = await readBody(req);
    const campaign = body.campaign || {};
    const opts = body.opts || {};
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    let closed = false;
    req.on("close", () => { closed = true; });
    const onEvent = (type, ev) => {
      if (closed) return;
      try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
    };
    try {
      const run = await runOptimise(campaign, opts, onEvent);
      if (!closed) res.write(`data: ${JSON.stringify({ type: "run", run })}\n\n`);
    } catch (e) {
      if (!closed) res.write(`data: ${JSON.stringify({ type: "error", message: String(e.message || e) })}\n\n`);
    }
    if (!closed) res.end();
    return;
  }

  // ---- static ----
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  const s = providerStatus();
  console.log(`AdLift on http://localhost:${PORT}  [llm:${s.llm} img:${s.image} research:${s.research} cf:${s.cfConfigured}]`);
});
