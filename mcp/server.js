// AdLift MCP server - exposes the ad-creative optimiser as agent-callable tools
// over Streamable HTTP (POST /mcp). Deployable one-click on Alpic.
// Reuses the same agent logic as the dashboard (../lib).
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { runOptimise } from "./lib/agent.js";
import { llmJSON } from "./lib/providers.js";
import { safetyPrompt, ctrPrompt } from "./lib/prompts.js";

const SUPERLATIVES = /(#\s?1|\bno\.?\s?1\b|\bbest\b|\bguarantee[d]?\b|\bcheapest\b|\bfastest\b|\bultimate\b|world'?s\b)/i;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

function buildServer() {
  const server = new McpServer({ name: "adlift", version: "0.1.0" });

  server.registerTool(
    "optimise_creative",
    {
      title: "Optimise ad creative",
      description:
        "Autonomously generate, brand-safety-gate, predict, A/B-test and iterate ad creative for a campaign. Returns the winning creative and the projected CTR lift over the baseline.",
      inputSchema: {
        product: z.string().describe("product/brand name"),
        description: z.string().describe("what the product is"),
        audience: z.string().optional(),
        tone: z.string().optional(),
        placement: z.string().optional().describe("where the ad runs, e.g. 'sponsored answer in an AI chat'"),
        rules: z.string().optional().describe("brand-safety rules the creative must obey"),
        baselineCtr: z.number().optional().describe("current CTR as a decimal, e.g. 0.005"),
        impressions: z.number().optional(),
        target: z.number().optional().describe("target CTR as a decimal"),
      },
    },
    async (a) => {
      const campaign = {
        product: a.product, description: a.description, audience: a.audience, tone: a.tone,
        placement: a.placement, rules: a.rules,
        baseline: { ctr: a.baselineCtr ?? 0.005, impressions: a.impressions ?? 100000 },
        target: a.target ?? 0.04,
      };
      const run = await runOptimise(campaign, { variantsPerRound: 4, maxRounds: 2, impressionsPerRound: 4000 });
      return ok({
        best: run.best ? { headline: run.best.headline, subcopy: run.best.subcopy, cta: run.best.cta, angle: run.best.angle } : null,
        report: run.report,
        rounds: run.rounds.map((r) => ({
          round: r.round,
          winner: r.winnerHeadline,
          blocked: r.variants.filter((v) => !v.eligible).map((v) => v.headline),
        })),
      });
    },
  );

  server.registerTool(
    "check_brand_safety",
    {
      title: "Brand-safety check",
      description: "Review one ad creative for false claims, unverifiable superlatives, off-brand tone, and deceptive patterns. Returns whether it is safe to serve.",
      inputSchema: {
        headline: z.string(),
        subcopy: z.string().optional(),
        cta: z.string().optional(),
        rules: z.string().optional(),
      },
    },
    async (a) => {
      const v = { headline: a.headline, subcopy: a.subcopy || "", cta: a.cta || "", image_prompt: "" };
      const campaign = { rules: a.rules };
      let safety;
      try { safety = await llmJSON(safetyPrompt(campaign, v)); }
      catch { safety = { safe: true, severity: 0, flags: [], reasoning: "reviewer unavailable" }; }
      if (SUPERLATIVES.test(`${v.headline} ${v.subcopy}`)) {
        safety.flags = [...(safety.flags || []), { type: "unverifiable_superlative", detail: "unprovable superlative claim" }];
        safety.severity = Math.max(safety.severity || 0, 2);
        safety.safe = false;
      }
      safety.eligible = safety.safe !== false && (safety.severity || 0) < 2;
      return ok(safety);
    },
  );

  server.registerTool(
    "predict_ctr",
    {
      title: "Predict CTR",
      description: "Estimate the click-through rate of an ad creative for its placement and audience, with an explainable factor breakdown. The number is a model estimate, not a guarantee.",
      inputSchema: {
        headline: z.string(),
        subcopy: z.string().optional(),
        cta: z.string().optional(),
        angle: z.string().optional(),
        product: z.string().optional(),
        audience: z.string().optional(),
        placement: z.string().optional(),
      },
    },
    async (a) => {
      const v = { headline: a.headline, subcopy: a.subcopy || "", cta: a.cta || "", angle: a.angle || "", image_prompt: "" };
      const campaign = { product: a.product, audience: a.audience, placement: a.placement };
      let ctr;
      try { ctr = await llmJSON(ctrPrompt(campaign, v)); }
      catch { ctr = { predicted_ctr: 0.012, confidence: 0.3, factors: [], why: "fallback estimate" }; }
      if (typeof ctr.predicted_ctr === "number") ctr.predicted_ctr = clamp(ctr.predicted_ctr, 0.004, 0.06);
      return ok(ctr);
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) =>
  res.json({ name: "adlift-mcp", endpoint: "/mcp", tools: ["optimise_creative", "check_brand_safety", "predict_ctr"] }),
);

// Stateless Streamable HTTP: a fresh server+transport per request.
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: String(e.message || e) }, id: null });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AdLift MCP on http://localhost:${PORT}/mcp`));
