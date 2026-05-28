// The "measure" step. A Thompson-sampling allocator races the creative variants
// against simulated traffic and discovers the real winner. This is a SIMULATION
// HARNESS (each variant gets a hidden "true CTR" seeded from its predicted CTR
// plus noise) wired exactly the way it would attach to a real ad server: swap
// the Bernoulli draw for live impression/click callbacks and the loop is real.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Beta sampler via two Gammas (Marsaglia-Tsang).
function gamma(k, rnd) {
  if (k < 1) {
    const u = rnd();
    return gamma(1 + k, rnd) * Math.pow(u, 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      // Box-Muller normal
      const u1 = Math.max(rnd(), 1e-12), u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function betaSample(a, b, rnd) {
  const x = gamma(a, rnd), y = gamma(b, rnd);
  return x / (x + y);
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// arms: [{ id, predictedCtr }]
// The hidden "true CTR" of each arm is anchored to a REALISTIC band relative to
// the baseline (baselineCtr*1.3 .. baselineCtr*maxLift), with the predicted CTR
// only setting the arm's RANK inside that band, plus noise so measurement can
// overturn the prediction. This keeps the demo's lift credible (a redesign moves
// a 0.5% card to ~3%, not ~9%) instead of trusting the LLM's optimistic guess.
// returns { arms:[{id, trueCtr, impressions, clicks, measuredCtr}], history:[frame], winnerId }
export function runAB(arms, { impressions = 6000, seed = null, frames = 60, baselineCtr = 0.005, maxLift = 6 } = {}) {
  const rnd = seed != null ? mulberry32(seed) : Math.random;
  const preds = arms.map((a) => a.predictedCtr || 0.01);
  const pmin = Math.min(...preds), pmax = Math.max(...preds);
  const range = pmax - pmin || 1;
  const lo = baselineCtr * 1.3, hi = baselineCtr * maxLift;
  const state = arms.map((a) => {
    const rel = ((a.predictedCtr || 0.01) - pmin) / range; // 0..1, best-predicted = 1
    const base = lo + rel * (hi - lo);
    const jitter = 0.8 + 0.45 * rnd(); // 0.8x .. 1.25x -> occasional reshuffle
    const trueCtr = clamp(base * jitter, baselineCtr * 1.05, hi * 1.18);
    return { id: a.id, trueCtr, alpha: 1, beta: 1, impressions: 0, clicks: 0 };
  });

  const history = [];
  const snapEvery = Math.max(1, Math.floor(impressions / frames));

  for (let t = 1; t <= impressions; t++) {
    // Thompson: sample a CTR from each arm's posterior, serve the best.
    let best = 0, bestTheta = -1;
    for (let i = 0; i < state.length; i++) {
      const theta = betaSample(state[i].alpha, state[i].beta, rnd);
      if (theta > bestTheta) { bestTheta = theta; best = i; }
    }
    const arm = state[best];
    arm.impressions++;
    const click = rnd() < arm.trueCtr ? 1 : 0;
    arm.clicks += click;
    if (click) arm.alpha++; else arm.beta++;

    if (t % snapEvery === 0 || t === impressions) {
      history.push({
        t,
        arms: state.map((s) => ({
          id: s.id,
          impressions: s.impressions,
          clicks: s.clicks,
          ctr: s.impressions ? s.clicks / s.impressions : 0,
          share: s.impressions / t,
        })),
      });
    }
  }

  const out = state.map((s) => ({
    id: s.id,
    trueCtr: s.trueCtr,
    impressions: s.impressions,
    clicks: s.clicks,
    measuredCtr: s.impressions ? s.clicks / s.impressions : 0,
  }));
  // winner = highest measured CTR among arms with enough exposure
  const eligible = out.filter((o) => o.impressions >= 30);
  const pool = eligible.length ? eligible : out;
  const winner = pool.reduce((a, b) => (b.measuredCtr > a.measuredCtr ? b : a));
  return { arms: out, history, winnerId: winner.id };
}
