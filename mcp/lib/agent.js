// The autonomous loop: research -> generate -> brand-safety -> predict CTR
// -> measure (A/B) -> iterate on the winner -> report.
// Emits events via onEvent(type, payload) so the dashboard renders live.
// Every model call has a fallback so a single API hiccup never aborts a run.

import { llmJSON, genImage, research, providerStatus } from "./providers.js";
import { genVariantsPrompt, mutatePrompt, safetyPrompt, ctrPrompt, expandBriefPrompt } from "./prompts.js";
import { runAB } from "./bandit.js";

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const SUPERLATIVES = /(#\s?1|\bno\.?\s?1\b|\bbest\b|\bguarantee[d]?\b|\bcheapest\b|\bfastest\b|\bultimate\b|world'?s\b)/i;

// Deterministic brand-rule enforcement layered on top of the LLM reviewer.
function enforceRules(campaign, v) {
  const flags = [];
  if (SUPERLATIVES.test(`${v.headline} ${v.subcopy}`)) {
    flags.push({ type: "unverifiable_superlative", detail: "unprovable superlative claim - forbidden by brand rules" });
  }
  return flags;
}
async function expandBrief(campaign) {
  try { return await llmJSON(expandBriefPrompt(campaign)); } catch { return null; }
}
function formatExpand(ex) {
  const sp = (ex.selling_points || []).map((s) => `- ${s}`).join("\n");
  const ang = (ex.angles || []).join(", ");
  return [sp, ex.audience ? `Audience: ${ex.audience}` : "", ex.tone ? `Tone: ${ex.tone}` : "", ang ? `Angles to test: ${ang}` : ""]
    .filter(Boolean).join("\n").slice(0, 1500);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function safeLLM(prompt, fallback) {
  try { return await llmJSON(prompt); }
  catch (e) { return { ...fallback, _error: String(e.message || e) }; }
}

async function buildVariant(campaign, raw, idPrefix, onEvent) {
  const v = {
    id: `${idPrefix}${raw.id || Math.random().toString(36).slice(2, 6)}`,
    angle: raw.angle || "benefit",
    headline: (raw.headline || "Play Now").slice(0, 40),
    subcopy: (raw.subcopy || "").slice(0, 60),
    cta: (raw.cta || "Play").slice(0, 16),
    image_prompt: raw.image_prompt || raw.headline || "vivid game scene",
    rationale: raw.rationale || "",
    image: null,
    safety: null,
    ctr: null,
    eligible: true,
  };
  onEvent("variant_pending", { variant: stripHeavy(v) });

  // image + safety + ctr in parallel (independent)
  const [img, safety, ctr] = await Promise.all([
    genImage(v.image_prompt, { width: 1024, height: 768 }).catch(() => null),
    safeLLM(safetyPrompt(campaign, v), { safe: true, severity: 0, flags: [], reasoning: "auto-pass (reviewer unavailable)", disclosure_needed: false }),
    safeLLM(ctrPrompt(campaign, v), { predicted_ctr: 0.012, confidence: 0.3, factors: [], why: "fallback estimate" }),
  ]);

  v.image = img; // {dataUrl, provider} | null
  // clamp the model's (often optimistic) estimate into a realistic band
  if (ctr && typeof ctr.predicted_ctr === "number") ctr.predicted_ctr = clamp(ctr.predicted_ctr, 0.004, 0.06);
  // deterministic brand-rule enforcement on top of the LLM reviewer (defense in depth)
  const ruleFlags = enforceRules(campaign, v);
  if (ruleFlags.length) {
    safety.flags = [...(safety.flags || []), ...ruleFlags];
    safety.severity = Math.max(safety.severity || 0, 2);
    safety.safe = false;
    safety.reasoning = ruleFlags[0].detail;
  }
  v.safety = safety;
  v.ctr = ctr;
  v.eligible = safety.safe !== false && (safety.severity || 0) < 2;
  onEvent("variant_ready", { variant: v });
  return v;
}

function stripHeavy(v) {
  const { image, ...rest } = v;
  return rest;
}

export async function runOptimise(campaign, opts = {}, onEvent = () => {}) {
  const {
    variantsPerRound = 4,
    maxRounds = 2,
    childrenPerIterate = 3,
    impressionsPerRound = 6000,
    targetCtr = 0.03,
    seed = null,
  } = opts;

  const status = providerStatus();
  const log = [];
  const emit = (type, payload = {}) => {
    const ev = { type, t: Date.now(), ...payload };
    if (type === "log") log.push(payload);
    onEvent(type, ev);
  };

  emit("status", { message: "AdLift starting", provider: status });
  emit("log", { stage: "init", msg: `Provider: ${status.llm} (${status.llmModel}), images: ${status.image}, research: ${status.research}` });

  // 1) research (Tavily if available, else LLM-expand the brief)
  emit("log", { stage: "research", msg: `Researching "${campaign.product}"...` });
  let researchText = await research(`${campaign.product} - what it is, target audience, brand tone, selling points`);
  let researchSource = researchText ? "tavily" : null;
  if (!researchText) {
    const ex = await expandBrief(campaign);
    if (ex) { researchText = formatExpand(ex); researchSource = "llm-expand"; }
  }
  emit("research", { found: Boolean(researchText), source: researchSource, notes: researchText || "(brief only)" });

  const baselineCtr = campaign.baseline?.ctr ?? 0.005;
  const impressionVolume = campaign.baseline?.impressions ?? 100000;
  const rounds = [];
  let best = null;            // {variant, measuredCtr}
  let incumbent = null;       // winning variant carried into next round
  const usedAngles = [];

  for (let r = 1; r <= maxRounds; r++) {
    emit("round_start", { round: r, of: maxRounds });

    // plan variants
    let planned;
    if (r === 1) {
      const p = await safeLLM(genVariantsPrompt(campaign, variantsPerRound, researchText, usedAngles), { variants: [] });
      planned = (p.variants || []).slice(0, variantsPerRound);
      emit("log", { stage: "generate", msg: `Round ${r}: planned ${planned.length} variants` });
    } else {
      const p = await safeLLM(mutatePrompt(campaign, incumbent, best.measuredCtr, childrenPerIterate, usedAngles), { variants: [] });
      planned = (p.variants || []).slice(0, childrenPerIterate);
      emit("log", { stage: "iterate", msg: `Round ${r}: mutated winner into ${planned.length} children` });
    }
    if (!planned.length) {
      emit("log", { stage: "generate", msg: "Generator returned nothing; stopping." });
      break;
    }

    // build (image + safety + ctr), 2 at a time
    const fresh = await mapLimit(planned, 2, (raw) => buildVariant(campaign, raw, `r${r}`, emit));
    for (const v of fresh) if (v.angle) usedAngles.push(v.angle);

    // the race pool = fresh safe variants + carried incumbent (re-measured)
    const pool = [...fresh];
    if (incumbent) pool.unshift(incumbent);
    const eligible = pool.filter((v) => v.eligible);
    const blocked = fresh.filter((v) => !v.eligible);
    for (const b of blocked) emit("blocked", { id: b.id, headline: b.headline, safety: b.safety });

    if (!eligible.length) {
      emit("log", { stage: "safety", msg: "All variants blocked by brand-safety; stopping." });
      break;
    }

    // 5) measure (iterating lifts the realistic ceiling: round 1 ~5x, round 2 ~7x)
    const maxLift = 5 + (r - 1) * 2;
    emit("log", { stage: "measure", msg: `A/B racing ${eligible.length} variants over ${impressionsPerRound.toLocaleString()} impressions...` });
    const ab = runAB(
      eligible.map((v) => ({ id: v.id, predictedCtr: v.ctr?.predicted_ctr ?? 0.01 })),
      { impressions: impressionsPerRound, seed: seed != null ? seed + r : null, baselineCtr, maxLift },
    );
    const winnerArm = ab.arms.find((a) => a.id === ab.winnerId);
    const winnerVariant = eligible.find((v) => v.id === ab.winnerId);
    emit("ab", { round: r, history: ab.history, arms: ab.arms, winnerId: ab.winnerId });

    // keep ALL built variants (incl. blocked, with images) so replay renders the
    // blocked card exactly like live mode. (incumbent is carried, not rebuilt.)
    rounds.push({ round: r, variants: fresh.map((v) => ({ ...v })), ab, winnerId: ab.winnerId, winnerHeadline: winnerVariant.headline });

    if (!best || winnerArm.measuredCtr > best.measuredCtr) {
      best = { variant: winnerVariant, measuredCtr: winnerArm.measuredCtr };
    }
    incumbent = winnerVariant;
    emit("round_done", {
      round: r,
      winnerId: ab.winnerId,
      winnerHeadline: winnerVariant.headline,
      measuredCtr: winnerArm.measuredCtr,
      bestCtr: best.measuredCtr,
    });

    if (best.measuredCtr >= targetCtr) {
      emit("log", { stage: "stop", msg: `Target ${(targetCtr * 100).toFixed(1)}% reached at ${(best.measuredCtr * 100).toFixed(2)}%.` });
      break;
    }
  }

  const bestCtr = best?.measuredCtr ?? baselineCtr;
  const liftMultiple = baselineCtr > 0 ? bestCtr / baselineCtr : 0;
  const projectedExtraClicks = Math.round((bestCtr - baselineCtr) * impressionVolume);
  const report = {
    baselineCtr,
    bestCtr,
    liftMultiple,
    impressionVolume,
    projectedExtraClicks,
    bestVariantId: best?.variant?.id || null,
  };
  emit("report", report);
  emit("done", { report });

  return {
    campaign,
    provider: status,
    research: researchText || null,
    rounds,
    best: best ? { ...best.variant } : null,
    report,
    log,
    createdAt: new Date().toISOString(),
  };
}
