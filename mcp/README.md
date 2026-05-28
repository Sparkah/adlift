# AdLift MCP server

Exposes AdLift's ad-creative optimiser as **agent-callable MCP tools** over
Streamable HTTP (`POST /mcp`). Same agent logic as the dashboard (`../lib`), so
any agent - Claude, Cursor, an autonomous media-buyer - can call AdLift as
infrastructure.

## Tools
- `optimise_creative(product, description, baselineCtr, ...)` - run the full generate -> safety -> predict -> A/B -> iterate loop; returns the winning creative + projected CTR lift.
- `check_brand_safety(headline, subcopy, cta, rules)` - returns whether a creative is safe to serve (LLM reviewer + deterministic superlative/claim rules).
- `predict_ctr(headline, subcopy, cta, ...)` - explainable CTR estimate.

## Run locally
```bash
npm install
npm run dev               # http://localhost:3000/mcp
node test_client.mjs http://localhost:3000/mcp   # smoke test (lists tools, calls two)
```
Needs `CF_AI_TOKEN` + `CF_ACCOUNT_ID` in the environment (or the shared workspace
`.env`) for the LLM calls.

## Deploy on Alpic (the "Best use of Alpic" bonus)
Alpic is an MCP-native cloud ("Vercel for MCP"). It builds from a GitHub repo and
gives a live HTTPS `/mcp` endpoint judges can connect any MCP client to.

1. Push this repo to GitHub (the whole AdLift repo; this folder is `mcp/`).
2. Sign in at https://app.alpic.ai with GitHub and install the Alpic GitHub app.
3. Import the repo. Set the **root directory** to `mcp/`. Build is `npm run build`
   (esbuild bundles `../lib` into `dist/index.js`); start is `npm start`.
4. Add env vars `CF_ACCOUNT_ID`, `CF_AI_TOKEN` (and optionally `TAVILY_API_KEY`).
5. Deploy. You get `https://<deployment>/mcp`.

Free tier: 10k req/month, no custom domain needed for judging. Node 22+.

## Connect from an agent
Point any Streamable-HTTP MCP client at the URL, e.g. in an MCP config:
```json
{ "mcpServers": { "adlift": { "url": "https://<deployment>/mcp" } } }
```
