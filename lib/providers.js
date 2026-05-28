// Provider abstraction: LLM (JSON), image gen, and web research.
// Default stack = Cloudflare Workers AI (one token, text + image), so the
// demo runs with zero new keys. Sponsor keys override when present.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---- env loading (no dotenv dependency) -------------------------------------
function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

// local .env wins; shared workspace env fills CF keys if missing locally.
const sharedCandidates = [
  path.join(ROOT, "..", "..", "Shared", "tools", "telegram-digest", ".env"),
  "/Users/timmarkin/Agents/Shared/tools/telegram-digest/.env",
];
const local = parseEnv(path.join(ROOT, ".env"));
let shared = {};
for (const c of sharedCandidates) {
  if (fs.existsSync(c)) { shared = parseEnv(c); break; }
}

export const env = { ...shared, ...local, ...process.env };

const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || "";
const CF_AI_TOKEN = env.CF_AI_TOKEN || "";
const OPENAI_API_KEY = env.OPENAI_API_KEY || "";
const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || "";
const TAVILY_API_KEY = env.TAVILY_API_KEY || "";

const CF_TEXT_MODEL = env.CF_TEXT_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const CF_TEXT_FALLBACK = "@cf/meta/llama-3.1-8b-instruct";
const CF_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const OPENAI_MODEL = env.OPENAI_MODEL || "gpt-4o-mini";
const ANTHROPIC_MODEL = env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const LLM_PROVIDER =
  env.LLM_PROVIDER ||
  (OPENAI_API_KEY ? "openai" : ANTHROPIC_API_KEY ? "anthropic" : "cf");

export function providerStatus() {
  return {
    llm: LLM_PROVIDER,
    llmModel: LLM_PROVIDER === "openai" ? OPENAI_MODEL
      : LLM_PROVIDER === "anthropic" ? ANTHROPIC_MODEL : CF_TEXT_MODEL,
    image: CF_AI_TOKEN ? "cloudflare-flux" : "pollinations",
    research: TAVILY_API_KEY ? "tavily" : "llm-expand",
    cfConfigured: Boolean(CF_ACCOUNT_ID && CF_AI_TOKEN),
  };
}

// ---- small fetch helper with timeout ----------------------------------------
async function fetchJSON(url, opts = {}, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { _raw: text }; }
    if (!r.ok) {
      const msg = json?.errors?.[0]?.message || json?.error?.message || text.slice(0, 300);
      throw new Error(`HTTP ${r.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

// ---- JSON extraction (LLMs wrap JSON in prose / fences) ----------------------
export function extractJSON(s) {
  if (typeof s !== "string") return s;
  let t = s.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

// ---- LLM: returns parsed JSON object ----------------------------------------
export async function llmJSON({ system, user, maxTokens = 1200, temperature = 0.8 }) {
  if (LLM_PROVIDER === "openai") {
    const j = await fetchJSON("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        temperature,
        max_tokens: maxTokens,
      }),
    });
    return extractJSON(j.choices[0].message.content);
  }

  if (LLM_PROVIDER === "anthropic") {
    const j = await fetchJSON("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature,
        system: system + "\nRespond with a single JSON object and nothing else.",
        messages: [{ role: "user", content: user }],
      }),
    });
    return extractJSON(j.content[0].text);
  }

  // default: Cloudflare Workers AI
  if (!CF_ACCOUNT_ID || !CF_AI_TOKEN) {
    throw new Error("No LLM provider configured (set CF_AI_TOKEN or OPENAI_API_KEY/ANTHROPIC_API_KEY).");
  }
  const body = JSON.stringify({
    messages: [
      { role: "system", content: system + "\nReturn ONLY a single valid JSON object. No prose, no markdown fences." },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  });
  const run = async (model) =>
    fetchJSON(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`,
      { method: "POST", headers: { Authorization: `Bearer ${CF_AI_TOKEN}`, "Content-Type": "application/json" }, body },
    );
  let j;
  try { j = await run(CF_TEXT_MODEL); }
  catch { j = await run(CF_TEXT_FALLBACK); }
  return extractJSON(j.result.response);
}

// ---- image generation: returns a data URL -----------------------------------
export async function genImage(prompt, { width = 1024, height = 768 } = {}) {
  // 1) Cloudflare Flux schnell
  if (CF_ACCOUNT_ID && CF_AI_TOKEN) {
    try {
      const j = await fetchJSON(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_IMAGE_MODEL}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${CF_AI_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, steps: 6 }),
        },
        35000,
      );
      if (j?.result?.image) {
        return { dataUrl: `data:image/png;base64,${j.result.image}`, provider: "cloudflare-flux" };
      }
    } catch (e) {
      // fall through to Pollinations on quota/error
    }
  }
  // 2) Pollinations (free, unauthenticated)
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&model=flux&seed=${Math.floor(Math.random() * 1e6)}&nologo=true&private=true`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 35000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Pollinations HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`, provider: "pollinations" };
  } finally {
    clearTimeout(t);
  }
}

// ---- research (Tavily) ------------------------------------------------------
export async function research(query) {
  if (!TAVILY_API_KEY) return null;
  try {
    const j = await fetchJSON("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        max_results: 5,
        include_answer: true,
        search_depth: "basic",
      }),
    }, 20000);
    const bits = [];
    if (j.answer) bits.push(j.answer);
    for (const r of j.results || []) bits.push(`- ${r.title}: ${(r.content || "").slice(0, 200)}`);
    return bits.join("\n").slice(0, 1500) || null;
  } catch {
    return null;
  }
}
