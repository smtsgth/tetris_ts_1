const fs = require("fs");
const path = require("path");
const dir = "bench_results";
const prefix = "stability_p4_t2_b1_long500_run";
const reportSuffix = "-report.json";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith(prefix) && f.endsWith(reportSuffix))
  .sort((a, b) => {
    const ai = parseInt(
      a.slice(prefix.length, a.length - reportSuffix.length),
      10,
    );
    const bi = parseInt(
      b.slice(prefix.length, b.length - reportSuffix.length),
      10,
    );
    return ai - bi;
  });
if (files.length === 0) {
  console.error("No report files found.");
  process.exit(2);
}
const vals = files.map((f) => {
  const content = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (typeof content.meanOfMeans !== "number") {
    console.error("missing meanOfMeans in", f);
    process.exit(3);
  }
  return content.meanOfMeans;
});
const n = vals.length;
const mean = vals.reduce((a, b) => a + b, 0) / n;
const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
const std = Math.sqrt(variance);
const min = Math.min(...vals);
const max = Math.max(...vals);
const sorted = vals.slice().sort((a, b) => a - b);
const median =
  n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
const summary = { files, vals, n, mean, std, min, max, median };
fs.writeFileSync(
  path.join(dir, "stability_p4_t2_b1_long500_summary.json"),
  JSON.stringify(summary, null, 2),
);
let md = `# stability_p4_t2_b1_long500 summary\n\nRuns: ${n}\nMean: ${mean}\nStd: ${std}\nMin: ${min}\nMax: ${max}\nMedian: ${median}\n\nFiles:\n`;
md += files.map((f) => `- ${f}`).join("\n");
fs.writeFileSync(path.join(dir, "stability_p4_t2_b1_long500_summary.md"), md);
let csv =
  "filename,meanOfMeans\n" + files.map((f, i) => `${f},${vals[i]}`).join("\n");
fs.writeFileSync(path.join(dir, "stability_p4_t2_b1_long500_summary.csv"), csv);
console.log("wrote summary with", n, "files");
