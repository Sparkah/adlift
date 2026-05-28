# AdLift - demo video script (~90-110s)

A captioned screen-recording of the live dashboard (replay mode). Subtitles carry
the explanation, so it works with no voiceover. The **VO** lines are optional -
record them over the same cut if you want narration. Produced by `record_demo.cjs`
-> `adlift_demo.mp4`. Honest by design: the baseline is real, the A/B is labelled
as a simulation.

Live links to put in the YouTube description:
- Demo: https://sparkah.github.io/adlift/
- MCP (Alpic): https://adlift-mcp-961141fd.alpic.live/mcp
- Code: https://github.com/Sparkah/adlift

---

### 0. Title card (4s)
- **On screen:** "AdLift - Autonomous Ad-Creative CTR Optimiser" / "Cursor x Thrad AdTech - Track 01, Buy-Side Agents"
- **VO:** "AdLift - an autonomous agent for the buy side of AI-native advertising."

### 1. The problem (9s) - campaign card, real Battle Merge cover
- **Caption:** "A real ad on a real platform: my CrazyGames game cover."
- **Caption:** "128,000 impressions. 0.5% CTR. Almost nobody clicks."
- **Caption:** "In performance ads, the creative is the bottleneck - and it's manual."
- **VO:** "This is a real game of mine. Great game, but the cover converts at half a percent, so 127,000 impressions are wasted. Creative is the lever, and today it's slow and manual."

### 2. Generate (6s) - click Optimise, cards appear
- **Caption:** "One click. The agent researches the product, then generates ad creatives."
- **Caption:** "Each variant: a Llama-written headline + a Flux-generated image."
- **VO:** "AdLift researches the product and generates a batch of creatives - copy and image together."

### 3. Brand-safety gate (5s) - the blocked card
- **Caption:** "A brand-safety gate blocks unsafe creative before it can ever serve."
- **Caption:** "Here: an unprovable '#1 / Top-Rated' claim - auto-blocked."
- **VO:** "Every creative passes a brand-safety gate. This one made an unverifiable claim, so it's blocked before it can run."

### 4. Measure - A/B (8s) - scroll to the race
- **Caption:** "Survivors race in an A/B test; traffic shifts to the winner."
- **Caption:** "(A/B is a simulation harness. The baseline is real CrazyGames data.)"
- **VO:** "The safe variants are A/B tested and the agent moves traffic to the winner. The A/B here is a simulation harness - the baseline is real, the measurement is stubbed, the way you'd wire it to a real ad server."

### 5. Iterate (6s) - round 2
- **Caption:** "Then it iterates on the winner - a better generation."
- **Caption:** "CTR climbs from 0.5% toward ~4%."
- **VO:** "It doesn't stop at one round - it mutates the winner and tries to beat it."

### 6. Human approval (6s) - approve a card
- **Caption:** "Nothing publishes without human approval."
- **Caption:** "Approved -> published with an 'Ad' disclosure."
- **VO:** "The agent runs autonomously, but a human signs off before anything serves - and the published ad carries a disclosure."

### 7. Result (6s) - report banner
- **Caption:** "0.5% -> ~4% in simulation. ~8x. Autonomous, with a human in the loop."
- **VO:** "Half a percent to four, with a human gate, in about ninety seconds."

### 8. LLM-native channel (12s) - switch to AI chat preset, Optimise
- **Caption:** "Same agent, LLM-native channel:"
- **Caption:** "a sponsored answer inside an AI chat reply."
- **Caption:** "It generates, safety-gates and optimises the sponsored card."
- **VO:** "The same loop runs where advertising is going - a sponsored answer card inside an AI chat, generated and optimised by the agent."

### 8.5 Intent auction (12s) - switch to the "Intent auction" view (answers a judge's question)
- **Caption:** "When advertisers compete for that chat slot - who wins?"
- **Caption:** "The auction ranks by bid x predicted CTR, not bid alone."
- **Caption:** "You win at the lowest bid - because AdLift gave you the best creative."
- **Caption:** (raise a rival's bid) "A rival outbids you and takes the impression."
- **Caption:** (click Improve creative) "Improve the creative - pCTR jumps - you win it back, cheaper."
- **Caption:** "Better creative is a discount on your bid."
- **VO:** "And when several advertisers compete for that slot, the auction ranks by bid times predicted CTR. So a rival can outbid you - but improve the creative and your pCTR wins the impression back at a lower bid. AdLift's creative layer plugs straight into the bidding layer: better creative is a discount on your cost-per-click."

### 8.7 Overmind supervision (7s) - back to the optimiser view, agent-activity log
- **Caption:** "Every agent decision - research, generate, safety, score - is traced to Overmind."
- **Caption:** "Supervision for the agent: observe every call, then auto-optimise its prompts."
- **VO:** "Every decision the agent makes is traced to Overmind, so you can supervise the agent and let Overmind optimise its prompts. AdLift optimises ad creative; Overmind optimises AdLift."

### 9. Infrastructure / agent-callable (7s)
- **Caption:** "AdLift is also a live MCP server on Alpic..."
- **Caption:** "...so other agents call it for creative on demand."
- **VO:** "And it's not just a dashboard - AdLift is a live MCP server, so an autonomous media-buying agent can call it for creative directly."

### 10. Close (6s) - closing card
- **Caption:** "This loop already runs in production in my game factory."
- **Caption:** "AdLift - creative is the lever. The agent pulls it. The human signs off."
- **VO:** "This isn't a mock - the same optimisation loop already runs daily in my game factory. AdLift. Thanks."
