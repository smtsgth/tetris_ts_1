const fs = require("fs");
const path = "bench_results";
const re = /^tuned_250ms_pool(\d+)_early(\d+)_run(\d+)-report\.json$/;
const files = fs.readdirSync(path).filter((f) => re.test(f));
const groups = {};
for (const f of files) {
  const m = f.match(re);
  if (!m) continue;
  const pool = m[1];
  const early = m[2];
  const run = Number(m[3]);
  const key = `pool${pool}_early${early}`;
  if (!groups[key]) groups[key] = { pool, early, files: [] };
  groups[key].files.push({ f, run });
}
const combined = {};
for (const key of Object.keys(groups).sort()) {
  const fns = groups[key].files.sort((a, b) => a.run - b.run).map((x) => x.f);
  const means = fns
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path + "/" + f, "utf8"));
        return Number(j.meanOfMeans || j.mean || 0);
      } catch (e) {
        return null;
      }
    })
    .filter((v) => v != null);
  const sum = means.reduce((a, b) => a + b, 0);
  const mean = means.length ? sum / means.length : 0;
  const sorted = means.slice().sort((a, b) => a - b);
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : 0;
  const idx90 = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1),
  );
  const p90 = sorted.length ? sorted[idx90] : 0;
  const out = {
    pool: Number(groups[key].pool),
    early: Number(groups[key].early),
    files: fns,
    count: means.length,
    meanOfMeans: mean,
    medianOfMeans: median,
    p90OfMeans: p90,
    means,
  };
  fs.writeFileSync(
    path + `/tuned_250ms_${key}-all-report.json`,
    JSON.stringify(out, null, 2),
  );
  console.log("wrote", path + `/tuned_250ms_${key}-all-report.json`);
  combined[key] = out;
}
fs.writeFileSync(
  path + "/tuned_250ms_pool_early_grid-all-report.json",
  JSON.stringify(combined, null, 2),
);
console.log("wrote", path + "/tuned_250ms_pool_early_grid-all-report.json");
