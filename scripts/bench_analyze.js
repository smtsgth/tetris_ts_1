#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

// allow overriding input file via first CLI arg
const infile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(
      process.cwd(),
      "bench_results",
      "combo_bench_full_2026-05-24.json",
    );
const baseName = path.basename(infile, path.extname(infile));
const outJson = path.join(path.dirname(infile), baseName + "-report.json");
const outMd = path.join(path.dirname(infile), baseName + "-report.md");

if (!fs.existsSync(infile)) {
  console.error("Input file not found:", infile);
  process.exit(2);
}

let raw;
try {
  raw = fs.readFileSync(infile, "utf8");
} catch (e) {
  console.error("Read error", e.message);
  process.exit(2);
}

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  // 試しにトランケーションのプレースホルダが残っている場合に切り取って復元を試みる
  const marker = "{...truncated...}";
  if (raw.includes(marker)) {
    const idx = raw.indexOf(marker);
    // 切り取った末尾の余分なカンマを取り、配列とオブジェクトを閉じる
    let prefix = raw.slice(0, idx);
    prefix = prefix.replace(/,\s*$/m, "");
    const reconstructed = prefix + "]}";
    try {
      data = JSON.parse(reconstructed);
      console.warn("JSON parsed after truncation salvage");
    } catch (e2) {
      console.error("JSON parse failed after salvage:", e2.message);
      process.exit(2);
    }
  } else {
    console.error("JSON parse error", e.message);
    process.exit(2);
  }
}

const results = Array.isArray(data.results)
  ? data.results
  : Array.isArray(data)
    ? data
    : [];

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.ceil(p * s.length) - 1));
  return s[idx];
}

// Normalize: if mean/median/p90 not present, compute from sampleTimes or timesSample
results.forEach((r) => {
  const samples = Array.isArray(r.sampleTimes)
    ? r.sampleTimes
    : Array.isArray(r.timesSample)
      ? r.timesSample
      : Array.isArray(r.times)
        ? r.times
        : [];
  if (samples && samples.length) {
    r.meanMs = Number(
      (samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3),
    );
    const sorted = samples.slice().sort((a, b) => a - b);
    r.medianMs =
      sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const p90Idx = Math.max(
      0,
      Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1),
    );
    r.p90Ms = sorted[p90Idx];
  }
});

const totalExperiments = results.length;
const trialsArr = results.map((r) => Number(r.trials || 0));
const avgTrials = avg(trialsArr);

const means = results.map((r) => Number(r.meanMs || 0));
const meanOfMeans = avg(means);
const medianOfMeans = (function () {
  if (!means.length) return 0;
  const s = means.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
})();
const p90OfMeans = percentile(means, 0.9);

const experimentsWithTimeouts = results.filter(
  (r) => Number(r.timeoutCount || 0) > 0,
).length;
const anyErrors = results.filter((r) => Number(r.errorCount || 0) > 0).length;
const gt1 = results.filter((r) => Number(r.meanMs || 0) > 1).length;
const le1 = results.filter((r) => Number(r.meanMs || 0) <= 1).length;

const byPool = {};
results.forEach((r) => {
  const pool = String(r.pool === undefined ? "unknown" : r.pool);
  if (!byPool[pool]) byPool[pool] = { count: 0, sumMean: 0 };
  byPool[pool].count++;
  byPool[pool].sumMean += Number(r.meanMs || 0);
});
const poolSummary = {};
Object.keys(byPool).forEach((k) => {
  poolSummary[k] = {
    count: byPool[k].count,
    avgMeanMs: byPool[k].sumMean / byPool[k].count,
  };
});

const report = {
  inputFile: infile,
  totalExperiments,
  avgTrials,
  meanOfMeans,
  medianOfMeans,
  p90OfMeans,
  experimentsWithTimeouts,
  anyErrors,
  experiments_mean_gt_1ms: gt1,
  experiments_mean_le_1ms: le1,
  poolSummary,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

const md = [
  `# Combo Bench Report`,
  ``,
  `- 入力ファイル: ${infile}`,
  `- 実験数: ${totalExperiments}`,
  `- 平均 trials: ${avgTrials.toFixed(2)}`,
  `- mean of means: ${meanOfMeans.toFixed(3)} ms`,
  `- median of means: ${medianOfMeans.toFixed(3)} ms`,
  `- p90 of means: ${p90OfMeans.toFixed(3)} ms`,
  `- タイムアウトを含む実験数: ${experimentsWithTimeouts}`,
  `- エラーを含む実験数: ${anyErrors}`,
  `- mean > 1ms の実験数: ${gt1}`,
  `- mean <= 1ms の実験数: ${le1}`,
  ``,
  `## Pool ごとの平均 meanMs`,
  ``,
  ...Object.keys(poolSummary).map(
    (k) =>
      `- pool ${k}: ${poolSummary[k].count} 件, 平均 meanMs = ${poolSummary[k].avgMeanMs.toFixed(3)} ms`,
  ),
  ``,
  `---`,
  `生成日時: ${report.generatedAt}`,
].join("\n");

fs.writeFileSync(outMd, md);
console.log("Report written:", outJson, outMd);
