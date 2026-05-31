#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");
const combos = [];
const per = [1, 2, 4];
const top = [1, 2];
const beam = [1, 4];
for (const p of per)
  for (const t of top) for (const b of beam) combos.push({ p, t, b });
for (const c of combos) {
  const out = path.join(
    process.cwd(),
    `bench_results/param_p${c.p}_t${c.t}_b${c.b}.json`,
  );
  console.log(`Running p=${c.p} t=${c.t} b=${c.b} -> ${out}`);
  const args = [
    "scripts/run_tuned_250ms_bench.js",
    "--trials",
    "50",
    "--budget",
    "250",
    "--pool",
    "2",
    "--perNodeLimit",
    String(c.p),
    "--topK",
    String(c.t),
    "--beamWidthBase",
    String(c.b),
    "--warmMode",
    "probe",
    "--probeRounds",
    "5",
    "--warmBudget",
    "10",
    "--warmDelay",
    "10",
    "--earlyFallbackMs",
    "40",
    "--out",
    out,
  ];
  const r = spawnSync("node", args, { stdio: "inherit" });
  if (r.error) {
    console.error("Error running bench:", r.error);
    process.exit(2);
  }
  // analyze
  const ra = spawnSync("node", ["scripts/bench_analyze.js", out], {
    stdio: "inherit",
  });
  if (ra.error) {
    console.error("Error running analyze:", ra.error);
    process.exit(3);
  }
}
console.log("Sweep complete");
