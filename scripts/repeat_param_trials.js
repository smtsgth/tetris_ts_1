#!/usr/bin/env node
const cp = require("child_process");
const path = require("path");

// Top candidate combos from previous summary
const combos = [
  { bw: 3, pnl: 2, tk: 1 }, // bw3_pnl2_topk1
  { bw: 3, pnl: 1, tk: 2 }, // bw3_pnl1_topk2
  { bw: 3, pnl: 1, tk: 1 }, // bw3_pnl1_topk1
];

const TRIALS = process.env.TRIALS ? Number(process.env.TRIALS) : 5;
const DURATION_MS = process.env.DURATION_MS
  ? Number(process.env.DURATION_MS)
  : 20000;
const disableFallbacks = process.env.DISABLE_FALLBACKS ? "1" : "1";

console.log(
  `Running repeat param trials: ${combos.length} combos x ${TRIALS} trials, DURATION_MS=${DURATION_MS}`,
);
for (const c of combos) {
  for (let t = 0; t < TRIALS; t++) {
    console.log(
      `\n=== Run: bw=${c.bw} perNode=${c.pnl} topK=${c.tk} trial=${t + 1}/${TRIALS} ===`,
    );
    const env = Object.assign({}, process.env, {
      DURATION_MS: String(DURATION_MS),
      DISABLE_FALLBACKS: disableFallbacks,
      BEAM_WIDTH: String(c.bw),
      PER_NODE_LIMIT: String(c.pnl),
      TOP_K: String(c.tk),
    });
    const res = cp.spawnSync(
      "node",
      [path.join("scripts", "capture_profiles_once.js")],
      {
        env,
        stdio: "inherit",
        cwd: process.cwd(),
        timeout: 180000 + DURATION_MS,
      },
    );
    if (res.error) {
      console.error("capture failed for", c, res.error);
    }
  }
}

console.log("\nAll captures done. Running analysis...");
const ar = cp.spawnSync(
  "node",
  [path.join("scripts", "analyze_worker_profiles.js")],
  { stdio: "inherit", cwd: process.cwd() },
);
if (ar.error) console.error("analysis failed", ar.error);
else
  console.log("Analysis complete. See recordings/ for profile_analysis_*.json");
