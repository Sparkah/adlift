# AdLift - Autonomous Ad-Creative CTR Optimiser

**Cursor AdTech London Hackathon, 28 May 2026.** Built solo in one evening.

Point AdLift at an underperforming ad. An agent **researches** the product,
**generates** creative variants, runs each through a **brand-safety gate**,
**predicts** their CTR, then **measures** real lift in a live A/B race and
**iterates** on the winner - toward a target, and with **human approval**
required before anything publishes.

> Demoed on a **real ad with real numbers**: my CrazyGames game cover - 128,000
> impressions at **0.5% CTR**. AdLift lifts it to **~4%** autonomously, with a
> human gate, in ~90 seconds.

## Live
- **Demo (dashboard):** https://sparkah.github.io/adlift/ - the full visual loop in replay mode (game-cover + AI-chat presets, switcher top-left).
- **MCP server (Alpic):** https://adlift-mcp-961141fd.alpic.live/mcp - agent-callable tools (`optimise_creative`, `check_brand_safety`, `predict_ctr`); playground at `/try`.
- **Source:** https://github.com/Sparkah/adlift

---

## The problem

In AI-native advertising the bottleneck isn't targeting or bidding anymore - it's
**creative**. The ad that gets generated, and whether it earns the click, is the
highest-leverage and least-automated lever in the funnel. My CrazyGames cover
proves it: the *game* scores 9.0/10 with 7m23s average playtime, but the *cover*
converts at 0.5%, so 127K of 128K impressions are wasted. A human redesign took
days. An agent should do this continuously, safely, and explainably.

## Why this is credible, not a toy

This loop already runs in production. My autonomous game factory
(game-factory.tech) generates game covers, measures their CTR on
CrazyGames/Yandex, and regenerates to lift it. AdLift generalises that proven
loop into ad-creative infrastructure any AI product can use. The before/after
covers from the real redesign ship in `data/baseline/`.

## How it works

```
research -> generate -> brand-safety gate -> predict CTR -> measure (A/B) -> iterate on winner -> report
```

1. **Research** - Tavily if a key is present, else the LLM expands the brief into selling points, audience, tone, and angles.
2. **Generate** - the LLM writes N variants (headline, subcopy, CTA, visual concept); an image model renders each visual; the ad card is composited on a `<canvas>`.
3. **Brand-safety gate** - an LLM reviewer plus a deterministic rule check flag false claims, unverifiable superlatives ("#1", "best"), off-brand tone, and deceptive patterns. Blocked variants cannot be served or published.
4. **Predict CTR** - the LLM estimates each variant's CTR with an explainable factor breakdown. (An estimate, clamped to a realistic band - not a promise.)
5. **Measure** - a Thompson-sampling allocator races the safe variants over simulated impressions and discovers the real winner. Prediction proposes; measurement disposes.
6. **Iterate** - the agent mutates the measured winner, re-gates and re-scores the children, and races them against the incumbent. It stops at the target CTR or the round cap.
7. **Report** - baseline vs best, CTR lift, and projected extra clicks over the real impression volume.

**Human-in-the-loop:** the agent runs the whole loop autonomously, but **publish
is gated on human approval**. Every generate / safety / score / serve / iterate
decision is logged with its reasoning; approved creative publishes with an
"Ad - selected by AdLift" disclosure.

## Honest labels

- The A/B is a **simulation harness**: each variant gets a hidden "true CTR"
  anchored to a realistic band relative to the baseline, then Thompson sampling
  finds it. It is wired exactly the way it would attach to a live ad server -
  swap the Bernoulli draw for real impression/click callbacks and the loop is
  live. Nothing here pretends to be live ad traffic.
- The CTR prediction is an **LLM estimate**, clamped to a realistic range.
- The brand-safety gate is **LLM + deterministic rules** (defense in depth), not
  a single model call.

## Sponsor tools

- **Cloudflare Workers AI** - default LLM (Llama 3.3 70B) + image gen (Flux schnell), one token, runs with zero new keys.
- **Tavily** - the product-research step that grounds creative in live product facts (drop `TAVILY_API_KEY` in `.env`; the grounding shows in the agent log).
- **Alpic** - AdLift is also exposed as an **MCP server** (`mcp/`) with three agent-callable tools (`optimise_creative`, `check_brand_safety`, `predict_ctr`) over Streamable HTTP, one-click deployable on Alpic to a live `/mcp` endpoint. See `mcp/README.md`.
- **OpenAI / Anthropic** - drop a key to override the default LLM.
- **Cursor** - built with it.

The provider layer (`lib/providers.js`) auto-detects which keys are present and
labels the active stack in the UI.

## Two demo presets (campaign switcher, top of the page)
- **Game cover (real data)** - my real CrazyGames cover, 128K impressions at 0.5% CTR. The credible, real-numbers case.
- **AI chat ad (LLM-native)** - the creative is a **sponsored answer card inside an AI chat reply** (ChatGPT-style placement). The on-theme, conversational case. AdLift generates / rotates / safety-gates / A/B-tests that card.

## Deploy (live demo URL for judges)
`render.yaml` is included - on Render: New > Blueprint > connect the GitHub repo.
Replay mode needs no keys; for Live runs set `CF_ACCOUNT_ID` + `CF_AI_TOKEN` in the
Render dashboard. The agent-callable MCP server deploys separately on Alpic
(`mcp/README.md`).

## Run it

```bash
# zero dependencies, Node >= 20
npm run dev
# open http://localhost:5050
```

- No keys? It falls back to the shared workspace Cloudflare token and Pollinations
  for images, so it still runs.
- **Replay demo** (default): instant, deterministic, offline-proof - plays the
  pre-baked run in `data/fixtures/`. Use this on stage.
- **Live run**: real provider calls, streamed over SSE - use it to prove it's real.
- Re-bake the replay fixture any time: `node bake_fixture.js`.

## Demo script (~2.5 min)

1. "Real ad, real platform: my CrazyGames cover. 128K impressions, **0.5% CTR**."
2. Click **Optimise**. The agent researches, then generates 4 ad cards live.
3. One variant ("#1 / Most Played...") trips the **brand-safety gate** - blocked, with the reason. *(governance)*
4. Predicted CTR per card, then the **A/B race** animates - the measured winner emerges and CTR climbs past baseline.
5. The agent **iterates** on the winner (round 2) and lifts it again, hitting the target.
6. I **approve** the winner; it publishes with the ad disclosure.
7. Report: **0.5% -> ~4% measured (~8x)**, +~4.8K projected clicks on 128K impressions. Autonomous, with a human gate.

## Judging-axis fit

- **Technical execution** - real generate/score/measure/iterate loop, dependency-free, SSE streaming.
- **Product thinking** - creative is the highest-leverage, least-automated lever; CTR is money.
- **Agent autonomy** - the loop mutates winners, reallocates traffic, and decides when to stop.
- **UX clarity** - you watch ad creatives get generated, gated, scored, and raced live.
- **Real-world applicability** - real ad, real numbers, a loop already in production.
- **Safety & oversight** - brand-safety gate, mandatory human approval, full audit log, ad disclosure.

## Layout

```
server.js            Node built-in http: static + /api/{status,campaign,replay,optimise(SSE),approve}
lib/providers.js     LLM + image + research abstraction (CF default; OpenAI/Anthropic/Tavily override)
lib/prompts.js       copy-gen, brand-safety, CTR-prediction, mutate-winner, brief-expand
lib/agent.js         the loop
lib/bandit.js        Thompson-sampling A/B (the measure step)
public/              vanilla dashboard (no build step), ad cards composited on canvas
data/baseline/       real Battle Merge before/after covers + campaign.json
data/fixtures/       pre-baked replay run
bake_fixture.js      regenerate the replay fixture from a live run
```
