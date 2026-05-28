// Run the agent loop once per campaign and save each as a deterministic replay
// fixture (data/fixtures/replay_<id>.json) used for the on-stage demo.
//   node bake_fixture.js            # bake all campaigns
//   node bake_fixture.js acme_buds  # bake one by id
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOptimise } from "./lib/agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.join(__dirname, "data/baseline");
const onlyId = process.argv[2] || null;

const campaigns = fs.readdirSync(baseDir)
  .filter((f) => /^campaign.*\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(baseDir, f), "utf8")))
  .filter((c) => !onlyId || c.id === onlyId)
  .sort((a, b) => (a.order || 0) - (b.order || 0));

for (const campaign of campaigns) {
  const seed = 40 + (campaign.order || 1);
  const opts = { variantsPerRound: 4, maxRounds: 2, childrenPerIterate: 3, impressionsPerRound: 6000, targetCtr: campaign.target || 0.04, seed };
  console.log(`\nBaking "${campaign.id}" (${campaign.product}) ...`);
  const run = await runOptimise(campaign, opts, (type, ev) => {
    if (type === "round_done") console.log(`  round ${ev.round} winner "${ev.winnerHeadline}" @ ${(ev.measuredCtr * 100).toFixed(2)}%`);
    if (type === "blocked") console.log(`  blocked "${ev.headline}"`);
    if (type === "variant_ready") console.log(`  variant "${ev.variant.headline}" safe=${ev.variant.eligible} img=${ev.variant.image?.provider || "none"}`);
  });
  const out = path.join(__dirname, "data/fixtures", `replay_${campaign.id}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(run, null, 2));
  console.log(`  -> ${campaign.id}: baseline ${(run.report.baselineCtr*100).toFixed(2)}% -> best ${(run.report.bestCtr*100).toFixed(2)}% (${run.report.liftMultiple.toFixed(1)}x), ${(fs.statSync(out).size/1024/1024).toFixed(1)} MB`);
}
console.log("\nDone.");
