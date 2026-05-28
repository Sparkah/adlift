# AdLift - Autonomous CTR Optimiser

> Cursor AdTech London Hackathon, 28 May 2026. One-night build. See BRIEF.md.

## One-liner
Point it at an underperforming ad. An agent generates creative variants,
scores predicted CTR with reasons, runs a live A/B to **measure** real lift,
and iterates toward a target - with a **brand-safety gate** and **human
approval** before anything publishes.

## Why this wins (maps to the 6 judging axes)
- **Technical execution** - a real generate -> score -> measure -> iterate loop, not a wrapper.
- **Product thinking** - ad creative is the highest-leverage, least-automated lever in performance marketing. CTR is money.
- **Agent autonomy** - the loop runs itself: it mutates winners, reallocates traffic, decides when to stop. (This loop already runs in production in my game factory - `game-factory-iterate`.)
- **UX clarity** - you watch ad cards get generated, scored, and A/B-raced live.
- **Real-world applicability** - demoed on a REAL ad with REAL numbers: my CrazyGames cover, 128K impressions at 0.5% CTR (~440 plays from 128K views = ~$ wasted). 
- **Safety & oversight** - brand-safety classifier blocks unsafe/off-brand/false-claim creative; nothing goes live without human approval; every agent action is logged with its reasoning; published ads carry a disclosure label.

## The unfair advantage
My autonomous game factory (game-factory.tech) is already an ad-creative engine
- it generates game covers, measures their CTR on CrazyGames/Yandex, and
regenerates to lift it. Battle Merge launched with a wordless cover at **0.5%
CTR over 128K impressions**; a manual redesign took days. AdLift does that loop
autonomously in ~90s and keeps going. The before/after covers ship in the demo.

## Architecture (dependency-free Node + vanilla dashboard)
```
public/        vanilla dashboard (no build step). Ad cards composited on <canvas>.
server.js      Node built-in http. Serves public/, exposes /api/*.
lib/providers  LLM + image + research abstraction.
               default: Cloudflare Workers AI (Llama text + Flux image, one token).
               override: OPENAI_API_KEY / ANTHROPIC_API_KEY / TAVILY_API_KEY.
lib/prompts    the IP: copy-gen, brand-safety, CTR-prediction, mutate-winner.
lib/agent      the loop: research -> generate -> safety -> predict -> A/B -> iterate -> report.
lib/bandit     Thompson-sampling allocator = the "measure" step (serves impressions, finds the real winner).
data/baseline  real Battle Merge before/after covers + campaign.json.
data/fixtures  pre-baked replay run (instant, offline-proof stage demo).
```

## The loop (one round)
1. **Research** the product (Tavily if key; else LLM-expand the brief): selling points, audience, tone.
2. **Generate** N variants: LLM writes {headline, subcopy, visual_concept, rationale}; image model renders the visual; the card is composited client-side.
3. **Brand-safety gate**: each variant -> {safe, severity, flags[], reasoning, disclosure_needed}. Unsafe = ineligible to serve or publish.
4. **Predict CTR**: each safe variant -> {predicted_ctr, confidence, factors[+/-], why}. Labeled honestly as a model estimate.
5. **Measure (A/B)**: Thompson sampling serves impressions across safe variants; hidden true-CTR seeded from prediction + noise, so measurement can overturn the prediction ("prediction proposes, measurement disposes").
6. **Iterate**: mutate the measured leader (keep what worked, push the lever); re-gate + re-score; add to the race. Stop at target CTR or max rounds.
7. **Report**: baseline vs best, projected extra clicks over the impression volume, decision trail.

## Human-in-the-loop (the governance story)
- Variants enter `pending_review`. The agent can run the full loop, but **publish is gated on human approval**.
- Approve / reject per variant; rejects feed back as negative signal.
- Full audit log: every generate/score/safety/serve/iterate decision, timestamped, with the model's reasoning, exportable.
- Published creative gets an injected "Ad - chosen by AdLift" disclosure.

## Scope tiers (ship in order)
- **T1 (must work):** server + CF provider + one round (generate -> safety -> predict) + dashboard with composited ad cards, safety badges, predicted CTR + why, approve/reject, before/after report. Real baseline images.
- **T2 (the wow):** Thompson-sampling A/B that animates a live CTR climb; iterate rounds.
- **T3 (bonus):** Tavily research step; OpenAI/Anthropic provider; publish + disclosure injection; audit-log export.

## Demo script (~2.5 min)
1. "This is a real ad on a real platform: my CrazyGames cover. 128K impressions, **0.5% CTR**. 127K wasted." (show the real losing cover)
2. Click **Optimise**. Agent researches the product, generates 4 ad-card variants live.
3. **Safety**: one variant trips the brand-safety gate (e.g. a false "#1" claim) - blocked, with the reason. (Governance beat for the 10 Downing St judge.)
4. **Predict + measure**: predicted CTR per card, then the A/B race animates - the measured winner isn't the top-predicted one. CTR climbs 0.5% -> ~2-3%.
5. **Iterate**: agent mutates the winner, lifts it again.
6. **Human approval**: I approve the winner; it publishes with the disclosure label.
7. **Report**: "0.5% -> 2.8% measured = ~5.6x. On 128K impressions that's ~2,900 extra clicks. Autonomous, in 90 seconds, with a human gate. This loop already runs in my production factory."

## Honest labels (per hackathons/CLAUDE.md)
- The A/B is a **simulation harness** (seeded true-CTR), wired the same way it would attach to a real ad server. Say so.
- CTR prediction is an **LLM estimate**, not a guarantee. Say so.
- Provenance: the production loop optimises *game covers*; AdLift generalises it to *any* ad creative.
