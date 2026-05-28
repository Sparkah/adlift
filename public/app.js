// AdLift dashboard. One event pipeline drives both live (SSE) and replay.
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const pct = (x) => (x * 100).toFixed(2) + "%";
const fmtN = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K" : String(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const S = { campaigns: [], campaign: null, mode: "replay", cards: new Map(), run: null, running: false };

// ---------- boot ----------
(async function boot() {
  let status = {};
  try { status = await (await fetch("/api/status")).json(); } catch {}
  setProvider(status.provider);
  S.mode = status.hasFixture ? "replay" : "live";
  syncModeButtons();
  if (!status.hasFixture) toast("No replay fixture yet - running in Live mode.");

  try {
    S.campaigns = await (await fetch("/api/campaigns")).json();
    renderSwitch();
    selectCampaign(S.campaigns[0].id);
    $("#optimiseBtn").disabled = false;
  } catch { toast("Could not load campaigns."); }
})();

function renderSwitch() {
  const box = $("#campaignSwitch"); if (!box) return;
  box.innerHTML = "";
  for (const c of S.campaigns) {
    const b = el("button", null, esc(c.label || c.product));
    b.dataset.id = c.id;
    b.onclick = () => selectCampaign(c.id);
    box.appendChild(b);
  }
}
function selectCampaign(id) {
  S.campaign = S.campaigns.find((c) => c.id === id) || S.campaigns[0];
  for (const b of document.querySelectorAll("#campaignSwitch button")) b.classList.toggle("active", b.dataset.id === S.campaign.id);
  reset();
  renderCampaign(S.campaign);
}

function setProvider(p) {
  const c = $("#provider");
  if (!p) { c.textContent = "provider: unknown"; return; }
  c.textContent = `llm:${p.llm} · img:${p.image} · research:${p.research}`;
  if (!p.cfConfigured && p.llm === "cf") { c.textContent += " · NO KEY"; c.style.color = "var(--block)"; }
}

function renderCampaign(c) {
  $("#prodName").textContent = c.product;
  $("#prodDesc").textContent = c.description;
  $("#baseCtr").textContent = pct(c.baseline.ctr);
  $("#baseImpr").textContent = fmtN(c.baseline.impressions);
  $("#basePlays").textContent = "~" + fmtN(Math.round(c.baseline.ctr * c.baseline.impressions));
  $("#baseNote").textContent = c.baseline.note || "";
  $("#targetCtr").textContent = pct(c.target || 0.04);
  $("#baseEyebrow").textContent = c.placementKind === "chat" ? "The weak sponsored answer" : "The underperforming ad";

  const cover = $("#baseCover");
  if (c.placementKind === "chat") {
    cover.classList.add("is-chat");
    cover.innerHTML = `<div class="chatmock">
        <div class="cm-user">${esc(c.query)}</div>
        <div class="cm-bot">${esc(c.assistantAnswer)}</div>
        <div class="cm-spon">Sponsored: ${esc(c.baseline.headline || c.product)} <span class="cm-arrow">&rsaquo;</span></div>
      </div>`;
  } else {
    cover.classList.remove("is-chat");
    cover.innerHTML = `<img id="baselineImg" alt="baseline ad" />`;
    if (c.baseline.image) $("#baselineImg").src = c.baseline.image;
  }

  const list = $("#briefList"); list.innerHTML = "";
  const rows = c.placementKind === "chat"
    ? [["Channel", "AI chat assistant reply"], ["User prompt", `"${c.query}"`], ["Audience", c.audience]]
    : [["Audience", c.audience], ["Tone", c.tone], ["Placement", c.placement]];
  for (const [k, v] of rows) if (v) list.appendChild(el("li", null, `<b>${esc(k)}:</b> ${esc(v)}`));
}

// ---------- mode + run ----------
$("#mode").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  S.mode = b.dataset.mode; syncModeButtons();
});
function syncModeButtons() {
  for (const b of document.querySelectorAll("#mode button")) b.classList.toggle("active", b.dataset.mode === S.mode);
}
$("#optimiseBtn").addEventListener("click", () => { S.mode === "live" ? runLive() : runReplay(); });

function setRunning(on) {
  S.running = on;
  const b = $("#optimiseBtn");
  b.disabled = on; b.classList.toggle("running", on);
  b.textContent = on ? "Optimising..." : "Optimise creative";
}
function reset() {
  S.cards.clear(); S.run = null;
  $("#variants").innerHTML = ""; $("#log").innerHTML = "";
  $("#abBars").innerHTML = ""; $("#abSection").classList.add("hidden");
  $("#report").classList.add("hidden"); $("#report").innerHTML = "";
  $("#roundLabel").textContent = "";
}

async function runLive() {
  reset(); setRunning(true);
  addLog("init", "starting live run...", "hi");
  const body = { campaign: S.campaign, opts: { variantsPerRound: 4, maxRounds: 2, impressionsPerRound: 6000, targetCtr: S.campaign.target || 0.03 } };
  let resp;
  try { resp = await fetch("/api/optimise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch (e) { toast("Live run failed: " + e.message); setRunning(false); return; }
  const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim(); if (!raw) continue;
      let ev; try { ev = JSON.parse(raw); } catch { continue; }
      await handleEvent(ev);
    }
  }
  setRunning(false);
}

async function runReplay() {
  let run;
  try {
    const r = await fetch("/api/replay?id=" + encodeURIComponent(S.campaign.id));
    if (!r.ok) { toast("No replay fixture for this campaign - switch to Live run."); return; }
    run = await r.json();
  } catch { toast("Replay unavailable."); return; }
  reset(); setRunning(true);
  await replayRun(run);
  setRunning(false);
}

// Synthesize the live event sequence from a finished run, with demo pacing.
async function replayRun(run) {
  await handleEvent({ type: "status", provider: run.provider });
  addLog("init", `provider: ${run.provider?.llm} / ${run.provider?.image}`);
  await handleEvent({ type: "research", found: !!run.research, source: run.provider?.research, notes: run.research });
  await sleep(250);
  for (const rd of run.rounds) {
    await handleEvent({ type: "round_start", round: rd.round, of: run.rounds.length });
    for (const v of rd.variants) { await handleEvent({ type: "variant_pending", variant: v }); await sleep(120); }
    for (const v of rd.variants) { await handleEvent({ type: "variant_ready", variant: v }); await sleep(260); }
    await sleep(300);
    await handleEvent({ type: "ab", round: rd.round, history: rd.ab.history, arms: rd.ab.arms, winnerId: rd.ab.winnerId });
    const wa = rd.ab.arms.find((a) => a.id === rd.ab.winnerId);
    await handleEvent({ type: "round_done", winnerId: rd.ab.winnerId, winnerHeadline: rd.winnerHeadline || "", measuredCtr: wa.measuredCtr });
    await sleep(300);
  }
  await handleEvent({ type: "report", ...run.report });
}

// ---------- event pipeline ----------
async function handleEvent(ev) {
  switch (ev.type) {
    case "status": setProvider(ev.provider); break;
    case "log": addLog(ev.stage, ev.msg, ev.stage === "stop" ? "hi" : ""); break;
    case "research":
      addLog("research", ev.source === "tavily" ? "Tavily grounding: live product data" : ev.found ? "LLM-expanded brief (add TAVILY_API_KEY to ground via Tavily)" : "no research");
      if (ev.found && ev.notes) addLog("research", "→ " + ev.notes.split("\n").find((l) => l.trim())?.slice(0, 76));
      break;
    case "round_start": {
      $("#roundLabel").textContent = `Round ${ev.round} / ${ev.of}`;
      addLog("round", `-- round ${ev.round} --`, "hi");
      const d = el("div", "round-div", ev.round === 1 ? "Round 1 &middot; exploring angles" : `Round ${ev.round} &middot; iterating on the winner`);
      $("#variants").appendChild(d);
      break;
    }
    case "variant_pending": addCard(ev.variant); break;
    case "variant_ready": await fillCard(ev.variant); break;
    case "blocked": addLog("safety", `blocked: ${ev.headline}`, "bad"); break;
    case "ab": await animateAB(ev); break;
    case "round_done": addLog("measure", `winner "${ev.winnerHeadline}" @ ${pct(ev.measuredCtr)}`, "hi"); break;
    case "report": showReport(ev); break;
    case "run": S.run = ev.run; break;
    case "error": toast("Error: " + ev.message); break;
  }
}

// ---------- variant cards ----------
function addCard(v) {
  if (S.cards.has(v.id)) return S.cards.get(v.id);
  const card = el("div", "vcard");
  card.dataset.id = v.id;
  card.innerHTML = `
    <div class="creative">
      <canvas></canvas>
      <div class="skeleton"></div>
      <div class="disclosure" style="display:none">Ad &mdash; selected by AdLift</div>
      <div class="ribbon" style="display:none">Blocked</div>
    </div>
    <div class="vmeta">
      <div class="vrow"><span class="angle">${v.angle || ""}</span><span class="badge" style="visibility:hidden">-</span></div>
      <div class="ctrline"><span class="pred">scoring...</span><span class="meas">-</span></div>
      <div class="why"></div>
      <div class="vactions">
        <button class="reject" disabled>Reject</button>
        <button class="approve" disabled>Approve</button>
      </div>
    </div>`;
  $("#variants").appendChild(card);
  const rec = { el: card, data: v, canvas: card.querySelector("canvas") };
  S.cards.set(v.id, rec);
  return rec;
}

async function fillCard(v) {
  const rec = addCard(v); rec.data = v;
  const card = rec.el;
  const draw = { imageDataUrl: v.image?.dataUrl, headline: v.headline, subcopy: v.subcopy, cta: v.cta };
  if (S.campaign?.placementKind === "chat") await drawChatAd(rec.canvas, draw, S.campaign);
  else await drawAdCard(rec.canvas, draw);
  card.querySelector(".skeleton").style.display = "none";

  const sev = v.safety?.severity ?? 0;
  const blocked = v.eligible === false || sev >= 2;
  const badge = card.querySelector(".badge");
  badge.style.visibility = "visible";
  if (blocked) { badge.className = "badge block"; badge.textContent = "Blocked"; }
  else if (sev === 1 || v.safety?.disclosure_needed) { badge.className = "badge warn"; badge.textContent = "Disclose"; }
  else { badge.className = "badge safe"; badge.textContent = "Safe"; }
  const reason = (v.safety?.flags || []).map((f) => f.type + (f.detail ? ` (${f.detail})` : "")).join("; ") || v.safety?.reasoning || "";
  badge.title = reason;

  card.querySelector(".pred").textContent = "pred " + pct(v.ctr?.predicted_ctr ?? 0);
  card.querySelector(".why").textContent = blocked ? (v.safety?.reasoning || "blocked by brand-safety") : (v.ctr?.why || "");

  if (blocked) {
    card.classList.add("blocked");
    card.querySelector(".ribbon").style.display = "block";
    addLog("safety", `blocked "${v.headline}": ${v.safety?.flags?.[0]?.type || "policy"}`, "bad");
  } else {
    const ap = card.querySelector(".approve"), rj = card.querySelector(".reject");
    ap.disabled = false; rj.disabled = false;
    ap.onclick = () => approve(v.id, "approve");
    rj.onclick = () => approve(v.id, "reject");
  }
}

// composite an ad creative onto the canvas
const W = 560, H = 420;
function loadImg(src) { return new Promise((r) => { if (!src) return r(null); const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; }); }
async function drawAdCard(canvas, o) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const img = await loadImg(o.imageDataUrl);
  if (img) {
    const ir = img.width / img.height, cr = W / H;
    let dw, dh, dx, dy;
    if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
    else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#1b2030"); g.addColorStop(1, "#0f1320");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // bottom scrim
  const sc = ctx.createLinearGradient(0, H * 0.32, 0, H);
  sc.addColorStop(0, "rgba(0,0,0,0)"); sc.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = sc; ctx.fillRect(0, 0, W, H);

  // headline
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.font = "800 46px system-ui, 'Arial Black', sans-serif";
  const lines = wrap(ctx, (o.headline || "").toUpperCase(), W - 150);
  let y = H - 34 - (lines.length - 1) * 46;
  for (const ln of lines) { ctx.fillText(ln, 26, y); y += 46; }
  // subcopy
  if (o.subcopy) {
    ctx.fillStyle = "rgba(255,255,255,.82)";
    ctx.font = "600 20px system-ui, sans-serif";
    ctx.fillText(o.subcopy, 27, H - 36 + 22);
  }
  // CTA pill
  if (o.cta) {
    ctx.font = "800 22px system-ui, sans-serif";
    const tw = ctx.measureText(o.cta.toUpperCase()).width;
    const pw = tw + 40, ph = 46, px = W - pw - 22, py = H - ph - 22;
    roundRect(ctx, px, py, pw, ph, 12); ctx.fillStyle = "#b8f135"; ctx.fill();
    ctx.fillStyle = "#0a0c11"; ctx.fillText(o.cta.toUpperCase(), px + 20, py + 31);
  }
}

// render the creative as a SPONSORED ANSWER CARD inside a chat mock
async function drawChatAd(canvas, o, campaign) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#0d1016"; ctx.fillRect(0, 0, W, H);

  // user bubble (right)
  ctx.font = "600 18px system-ui, sans-serif";
  const ulines = wrap(ctx, campaign?.query || "", 360);
  const ubw = Math.min(384, Math.max(...ulines.map((l) => ctx.measureText(l).width)) + 36);
  const ubh = ulines.length * 25 + 22;
  roundRect(ctx, W - ubw - 20, 18, ubw, ubh, 14); ctx.fillStyle = "#26350f"; ctx.fill();
  ctx.fillStyle = "#dfeec2";
  ulines.forEach((l, i) => ctx.fillText(l, W - ubw - 20 + 18, 18 + 28 + i * 25));

  // assistant bubble (left)
  ctx.font = "500 15px system-ui, sans-serif";
  const alines = wrap(ctx, campaign?.assistantAnswer || "A strong option:", 320);
  const aby = 18 + ubh + 14;
  const abw = Math.min(360, Math.max(...alines.map((l) => ctx.measureText(l).width)) + 30);
  const abh = alines.length * 21 + 18;
  roundRect(ctx, 20, aby, abw, abh, 14); ctx.fillStyle = "#1a1f2b"; ctx.fill();
  ctx.fillStyle = "#c2c9d6";
  alines.forEach((l, i) => ctx.fillText(l, 36, aby + 25 + i * 21));

  // sponsored card = the creative
  const cardX = 20, cardY = aby + abh + 14, cardW = W - 40, cardH = H - cardY - 16;
  roundRect(ctx, cardX, cardY, cardW, cardH, 16); ctx.fillStyle = "#161b26"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "rgba(184,241,53,.55)"; ctx.stroke();

  const pad = 14, thumb = Math.max(40, cardH - pad * 2);
  const img = await loadImg(o.imageDataUrl);
  ctx.save();
  roundRect(ctx, cardX + pad, cardY + pad, thumb, thumb, 10); ctx.clip();
  if (img) {
    const ir = img.width / img.height; let dw, dh, dx, dy;
    if (ir > 1) { dh = thumb; dw = thumb * ir; dx = cardX + pad - (dw - thumb) / 2; dy = cardY + pad; }
    else { dw = thumb; dh = thumb / ir; dx = cardX + pad; dy = cardY + pad - (dh - thumb) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);
  } else { ctx.fillStyle = "#222838"; ctx.fillRect(cardX + pad, cardY + pad, thumb, thumb); }
  ctx.restore();

  const tx = cardX + pad + thumb + 16;
  ctx.font = "700 11px ui-monospace, monospace"; ctx.fillStyle = "#8a93a8";
  ctx.fillText("SPONSORED", tx, cardY + pad + 12);
  ctx.font = "800 23px system-ui, sans-serif"; ctx.fillStyle = "#fff";
  let hy = cardY + pad + 38;
  wrap(ctx, o.headline || "", cardW - (tx - cardX) - 18).slice(0, 2).forEach((l) => { ctx.fillText(l, tx, hy); hy += 25; });
  if (o.subcopy) { ctx.font = "500 14px system-ui, sans-serif"; ctx.fillStyle = "rgba(255,255,255,.68)"; ctx.fillText(o.subcopy.slice(0, 48), tx, hy + 2); }
  if (o.cta) {
    ctx.font = "800 15px system-ui, sans-serif";
    const cw = ctx.measureText(o.cta.toUpperCase()).width + 26, ch = 32;
    const cx = cardX + cardW - cw - 14, cy = cardY + cardH - ch - 12;
    roundRect(ctx, cx, cy, cw, ch, 9); ctx.fillStyle = "#b8f135"; ctx.fill();
    ctx.fillStyle = "#0a0c11"; ctx.fillText(o.cta.toUpperCase(), cx + 13, cy + 21);
  }
}

function wrap(ctx, text, max) {
  const words = text.split(" "); const out = []; let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out.slice(0, 3);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------- A/B animation ----------
async function animateAB(ev) {
  const sec = $("#abSection"); sec.classList.remove("hidden");
  const wrap = $("#abBars"); wrap.innerHTML = "";
  const base = S.campaign.baseline.ctr;
  const maxMeas = Math.max(...ev.arms.map((a) => a.measuredCtr), base, 0.04);
  const scaleMax = maxMeas * 1.12;
  const rows = new Map();
  for (const a of ev.arms) {
    const name = S.cards.get(a.id)?.data?.headline || a.id;
    const row = el("div", "abrow");
    row.innerHTML = `<span class="name">${name}</span>
      <div class="track"><div class="fill"></div><div class="basemark" style="left:${(base / scaleMax) * 100}%"></div></div>
      <span class="val">0.00%<span class="imp">0 imp</span></span>`;
    wrap.appendChild(row);
    rows.set(a.id, row);
  }
  const frames = ev.history || [];
  for (let f = 0; f < frames.length; f++) {
    const fr = frames[f];
    let lead = null, leadCtr = -1;
    for (const arm of fr.arms) {
      const row = rows.get(arm.id); if (!row) continue;
      row.querySelector(".fill").style.width = Math.min(100, (arm.ctr / scaleMax) * 100) + "%";
      row.querySelector(".val").innerHTML = pct(arm.ctr) + `<span class="imp">${fmtN(arm.impressions)} imp</span>`;
      if (arm.ctr > leadCtr) { leadCtr = arm.ctr; lead = arm.id; }
    }
    for (const [id, row] of rows) row.classList.toggle("lead", id === lead);
    await sleep(28);
  }
  // settle to measured + mark winner card
  for (const a of ev.arms) {
    const rec = S.cards.get(a.id); if (!rec) continue;
    const m = rec.el.querySelector(".meas");
    m.textContent = pct(a.measuredCtr); m.classList.add("show");
    rec.el.classList.toggle("winner", a.id === ev.winnerId);
  }
}

// ---------- report ----------
function showReport(r) {
  const box = $("#report"); box.classList.remove("hidden");
  const lift = r.liftMultiple || (r.baselineCtr ? r.bestCtr / r.baselineCtr : 0);
  box.innerHTML = `
    <h2>Result</h2>
    <div class="rstats">
      <div class="rstat"><div class="num" style="color:var(--block)">${pct(r.baselineCtr)}</div><span class="cap">baseline CTR</span></div>
      <div class="arrow">&rarr;</div>
      <div class="rstat"><div class="num lift">${pct(r.bestCtr)}</div><span class="cap">measured winner</span></div>
      <div class="rstat"><div class="num lift">${lift.toFixed(1)}x</div><span class="cap">CTR lift</span></div>
      <div class="rstat"><div class="num lift">+${fmtN(r.projectedExtraClicks)}</div><span class="cap">projected extra clicks on ${fmtN(r.impressionVolume)} impressions</span></div>
    </div>
    <p class="note" style="margin-top:16px">Approve the highlighted winner to publish it with an ad disclosure. The A/B is a simulation harness seeded from the model's CTR estimate; wire it to a live ad server and the same loop runs on real traffic.</p>`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------- approval ----------
async function approve(id, decision) {
  const rec = S.cards.get(id); if (!rec) return;
  try {
    const r = await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: id, decision, headline: rec.data.headline }) });
    const j = await r.json();
    const actions = rec.el.querySelector(".vactions");
    if (decision === "approve") {
      actions.innerHTML = `<div class="published">PUBLISHED &#10003;</div>`;
      rec.el.querySelector(".disclosure").style.display = "block";
      addLog("human", `approved + published "${rec.data.headline}"`, "hi");
    } else {
      rec.el.classList.add("blocked");
      actions.innerHTML = `<div class="published" style="color:var(--block);border-color:var(--block)">REJECTED</div>`;
      addLog("human", `rejected "${rec.data.headline}"`, "bad");
    }
  } catch { toast("Approval failed."); }
}

// ---------- log + toast ----------
function addLog(stage, msg, cls = "") {
  const line = el("div", "l " + cls, `<span class="stage">${stage}</span><span>${msg}</span>`);
  const log = $("#log"); log.appendChild(line); log.scrollTop = log.scrollHeight;
}
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), 3500);
}
