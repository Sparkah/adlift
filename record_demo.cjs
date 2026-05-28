// Records the AdLift demo: drives the live dashboard (replay mode) with timed
// subtitle overlays + scrolls, screencasts to webm. Run with puppeteer on NODE_PATH.
//   NODE_PATH=<puppeteer> node record_demo.cjs [baseURL] [outWebm]
const puppeteer = require("puppeteer");
const base = process.argv[2] || "http://localhost:5050/";
const out = process.argv[3] || "/tmp/adlift_demo.webm";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: "networkidle2", timeout: 20000 });
  await page.waitForSelector("#optimiseBtn:not([disabled])", { timeout: 10000 });

  // inject caption + title-card overlays
  await page.evaluate(() => {
    const s = document.createElement("style");
    s.textContent = `
      #vcap{position:fixed;left:0;right:0;bottom:0;z-index:99998;padding:26px 60px 34px;
        background:linear-gradient(0deg,rgba(5,7,11,.97),rgba(5,7,11,.72) 65%,transparent);
        font:600 30px/1.4 system-ui,-apple-system,sans-serif;color:#fff;text-align:center;letter-spacing:-.01em;opacity:0;transition:opacity .3s}
      #vcap.show{opacity:1}
      #vcap b{color:#b8f135}
      #vcard{position:fixed;inset:0;z-index:99999;background:#0a0c11;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;opacity:0;transition:opacity .45s}
      #vcard.show{opacity:1}
      #vcard .t{font:800 70px/1.05 system-ui;letter-spacing:-.03em;color:#fff;text-align:center;max-width:1040px}
      #vcard .t .lift{color:#b8f135}
      #vcard .s{font:500 27px/1.45 system-ui;color:#8a93a8;text-align:center;max-width:860px}`;
    document.head.appendChild(s);
    const cap = document.createElement("div"); cap.id = "vcap"; document.body.appendChild(cap);
    const card = document.createElement("div"); card.id = "vcard"; card.innerHTML = '<div class="t"></div><div class="s"></div>'; document.body.appendChild(card);
    window.__cap = (h) => { const c = document.getElementById("vcap"); c.innerHTML = h || ""; c.classList.toggle("show", !!h); };
    window.__card = (t, sub) => { const c = document.getElementById("vcard"); c.querySelector(".t").innerHTML = t; c.querySelector(".s").innerHTML = sub || ""; c.classList.add("show"); };
    window.__hideCard = () => document.getElementById("vcard").classList.remove("show");
  });

  const cap = (h) => page.evaluate((x) => window.__cap(x), h);
  const card = (t, s) => page.evaluate((t, s) => window.__card(t, s), t, s);
  const hideCard = () => page.evaluate(() => window.__hideCard());
  const top = () => page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  const to = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ behavior: "smooth", block: "center" }); }, sel);
  const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); }, sel);
  const waitReport = () => page.waitForFunction(() => { const r = document.querySelector("#report"); return r && !r.classList.contains("hidden"); }, { timeout: 20000 }).catch(() => {});

  const recorder = await page.screencast({ path: out });
  try {
    // 0 title
    await card('Ad<span class="lift">Lift</span>', "Autonomous ad-creative CTR optimiser &middot; Cursor x Thrad &middot; Track 01");
    await sleep(3600); await hideCard(); await sleep(700);

    // 1 problem
    await top(); await sleep(300);
    await cap("A real ad on a real platform: my CrazyGames game cover."); await sleep(3200);
    await cap("128,000 impressions. <b>0.5% CTR.</b> Almost nobody clicks."); await sleep(3200);
    await cap("In performance ads, the <b>creative is the bottleneck</b> - and it's manual."); await sleep(2800);

    // 2 generate
    await cap("One click: the agent generates ad creatives - copy and image.");
    await click("#optimiseBtn"); await sleep(3400);
    await to("#variants");
    await cap("Each variant: a <b>Llama-written headline</b> + a <b>Flux-generated image</b>."); await sleep(3600);
    // 3 safety
    await to(".vcard.blocked");
    await cap('A <b>brand-safety gate</b> blocks an unprovable "#1" claim before it can serve.'); await sleep(3900);
    // 4 A/B
    await to("#abSection");
    await cap("Survivors race in an A/B test; traffic shifts to the winner."); await sleep(3000);
    await cap("<b>A/B is a simulation harness - the baseline is real CrazyGames data.</b>"); await sleep(3300);
    // 5+ result
    await waitReport(); await to("#report");
    await cap("It iterates on the winner, then reports: <b>0.5% to ~4%, about 8x</b>."); await sleep(3800);
    // 6 approve
    await to(".vcard.winner");
    await cap("Nothing publishes without <b>human approval</b>."); await sleep(2600);
    await click(".vcard.winner .approve");
    await cap('Approved - published with an <b>"Ad" disclosure</b>.'); await sleep(3000);

    // 8 chat preset
    await top(); await sleep(300);
    await click('#campaignSwitch button[data-id="acme_buds"]'); await sleep(800);
    await cap("Same agent, <b>LLM-native channel</b>: a sponsored answer inside an AI chat."); await sleep(3600);
    await click("#optimiseBtn"); await sleep(3400);
    await to("#variants");
    await cap("It generates, safety-gates and optimises the <b>sponsored card</b>."); await sleep(4200);
    await waitReport(); await to("#report");
    await cap("A weak sponsored line becomes a high-CTR card."); await sleep(3000);

    // 8.5 auction (answers the judge)
    await click('#viewnav button[data-view="auction"]'); await sleep(700); await top(); await sleep(300);
    await cap("When advertisers compete for that chat slot - who wins?"); await sleep(2800);
    await cap("The auction ranks by <b>bid x predicted CTR</b>, not bid alone."); await sleep(3300);
    await cap("You win at the <b>lowest bid</b> - because AdLift gave you the best creative."); await sleep(3600);
    await page.evaluate(() => { const s = document.querySelectorAll(".arow")[1].querySelector("input[type=range]"); s.value = "5.5"; s.dispatchEvent(new Event("input", { bubbles: true })); });
    await sleep(900);
    await cap("A rival outbids you and takes the impression."); await sleep(3000);
    await click("#auctionImprove"); await sleep(900);
    await cap("Improve the creative - pCTR jumps - you win it back, <b>cheaper</b>."); await sleep(3600);
    await cap("<b>Better creative is a discount on your bid.</b>"); await sleep(3000);

    // 8.7 overmind supervision
    await click('#viewnav button[data-view="optimiser"]'); await sleep(600); await to("#log");
    await cap("Every agent decision - research, generate, safety, score - is <b>traced to Overmind</b>."); await sleep(3600);
    await cap("Supervision for the agent: observe every call, then auto-optimise its prompts."); await sleep(3500);

    // 9 infra + 10 close
    await cap("AdLift is also a <b>live MCP server</b> - other agents call it for creative."); await sleep(3600);
    await card("This loop already runs in production.", "AdLift - creative is the lever. The agent pulls it. The human signs off.");
    await sleep(4200);
  } finally {
    await recorder.stop();
    await browser.close();
  }
  console.log("recorded", out);
})().catch((e) => { console.error("RECORD FAILED:", e.message); process.exit(1); });
