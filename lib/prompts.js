// The agent's prompts. Each returns {system, user} and asks for strict JSON.
// Keep schemas explicit - the default model is Llama on Workers AI.

const STRATEGIST = `You are AdLift, an expert performance-marketing creative strategist.
You design high-CTR ad creative for crowded feeds and game-portal cards.
You know the levers that move click-through: a single clear focal subject, high
contrast, curiosity gap, a benefit or stakes in 3-5 words, faces/characters,
and motion implied in a still. You write tight, punchy ad copy. You never invent
facts about the product beyond the brief.`;

const REVIEWER = `You are AdLift's ad-policy and brand-safety reviewer. You protect the
advertiser and the platform. You flag: unverifiable superlatives ("#1", "best",
"guaranteed"), false or unprovable claims, medical/financial promises, sensitive
or shocking content, deceptive patterns (fake buttons, fake system UI, fake
"you won"), and anything off the brand's stated tone. You are strict but fair:
ordinary persuasive copy is fine; only flag real risk.`;

const ANALYST = `You are AdLift's CTR analyst. You estimate the click-through rate of an
ad creative for its placement and audience, and you explain the drivers. You are
calibrated and conservative: most feed/portal game-card ads sit between 0.4% and
3% CTR; a strong redesign of a weak card typically reaches 2-3.5% and rarely
above 4%. Give each creative a DISTINCT estimate - never repeat the same number;
spread them to reflect real differences. Your number is an estimate, not a promise.`;

function campaignContext(c) {
  return `PRODUCT: ${c.product}
WHAT IT IS: ${c.description}
AUDIENCE: ${c.audience || "broad casual web audience"}
BRAND TONE: ${c.tone || "playful, friendly, clear"}
PLACEMENT: ${c.placement || "game-portal cover card in a crowded grid"}
BASELINE AD: headline "${c.baseline?.headline || "(none / wordless)"}", currently ${c.baseline?.ctr != null ? (c.baseline.ctr * 100).toFixed(2) + "% CTR" : "underperforming"}${c.baseline?.impressions ? ` over ${c.baseline.impressions.toLocaleString()} impressions` : ""}.
HARD RULES: ${c.rules || "no false claims; no unverifiable superlatives; stay on brand tone; family-safe."}`;
}

export function genVariantsPrompt(c, n, researchText, avoid = []) {
  const system = STRATEGIST;
  const user = `${campaignContext(c)}
${researchText ? `\nRESEARCH NOTES:\n${researchText}\n` : ""}
Design ${n} DISTINCT ad-creative variants to beat the baseline CTR. Use a
different persuasion angle for each (e.g. curiosity, stakes/urgency, social proof,
clear-benefit, character-led, pattern-interrupt).
Make exactly ONE variant an aggressive "bold-claim" angle whose headline uses a
strong social-proof superlative (e.g. "#1", "Best"). This stress-tests the
brand-safety gate - the other variants must stay clean and on-brand.
${avoid.length ? `Avoid repeating these angles/headlines: ${avoid.join(" | ")}.` : ""}

For the image_prompt: describe ONLY the visual SCENE for an image model (no text,
no letters, no logos in the image - the headline is overlaid separately). One
clear focal subject, bold color, high contrast, portal-card energy.

Return JSON exactly:
{"variants":[{"id":"v1","angle":"curiosity","headline":"<=5 words","subcopy":"<=8 words","cta":"<=2 words","image_prompt":"vivid text-free scene","rationale":"why this should lift CTR"}]}`;
  return { system, user, label: "creative_gen" };
}

export function mutatePrompt(c, winner, measuredCtr, k, avoid = []) {
  const system = STRATEGIST;
  const user = `${campaignContext(c)}

The current MEASURED winner (CTR ${(measuredCtr * 100).toFixed(2)}%):
headline "${winner.headline}", subcopy "${winner.subcopy}", angle "${winner.angle}",
visual: ${winner.image_prompt}
Why it worked: ${winner.rationale}

Generate ${k} CHILD variants that keep what made the winner work but push one
lever further (sharper hook, stronger focal subject, more contrast, tighter copy).
Do not drift off-brand. ${avoid.length ? `Avoid: ${avoid.join(" | ")}.` : ""}
image_prompt = text-free scene only.

Return JSON exactly:
{"variants":[{"id":"m1","angle":"...","headline":"<=5 words","subcopy":"<=8 words","cta":"<=2 words","image_prompt":"vivid text-free scene","rationale":"what lever we pushed"}]}`;
  return { system, user, label: "iterate" };
}

export function safetyPrompt(c, v) {
  const system = REVIEWER;
  const user = `BRAND TONE: ${c.tone || "playful, friendly, clear"}
HARD RULES: ${c.rules || "no false claims; no unverifiable superlatives; stay on brand tone; family-safe."}

REVIEW THIS AD:
headline: "${v.headline}"
subcopy: "${v.subcopy}"
cta: "${v.cta}"
visual: ${v.image_prompt}

Return JSON exactly:
{"safe": true|false, "severity": 0|1|2|3, "flags":[{"type":"false_claim|unverifiable_superlative|sensitive_content|off_brand|misleading|deceptive_pattern","detail":"short"}], "reasoning":"one sentence", "disclosure_needed": true|false}
severity 0 = clean, 1 = minor/disclose, 2 = block-unless-fixed, 3 = hard block. safe=false when severity>=2.`;
  return { system, user, label: "brand_safety" };
}

export function ctrPrompt(c, v) {
  const system = ANALYST;
  const user = `${campaignContext(c)}

ESTIMATE CTR for this creative:
headline: "${v.headline}"
subcopy: "${v.subcopy}"
cta: "${v.cta}"
angle: "${v.angle}"
visual: ${v.image_prompt}

Return JSON exactly:
{"predicted_ctr": 0.000, "confidence": 0.0, "factors":[{"label":"short","effect":"+"|"-","weight":1|2|3}], "why":"one sentence"}
predicted_ctr is a decimal fraction (e.g. 0.024 = 2.4%).`;
  return { system, user, label: "ctr_predict" };
}

export function expandBriefPrompt(c) {
  const system = STRATEGIST;
  const user = `${campaignContext(c)}

No external research is available. From your own knowledge, expand this into a
tight creative brief: the strongest selling points, who clicks and why, the
on-brand tone, and the best creative angles to test.

Return JSON exactly:
{"selling_points":["..."],"audience":"...","tone":"...","angles":["curiosity","stakes","social-proof"]}`;
  return { system, user, label: "research" };
}
