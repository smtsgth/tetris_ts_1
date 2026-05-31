const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "recordings", "diag_applied_worker.json");
let raw = null;
try {
  raw = JSON.parse(fs.readFileSync(p, "utf8"));
} catch (e) {
  console.error("ERR_READ", String(e));
  process.exit(2);
}
const total = raw.length;
let hadFallback = 0;
let rawMsgs = 0;
let workerIntermediates = 0;
let workerResults = 0;
const byFile = {};
const examplesNoWorker = [];
for (const r of raw) {
  if (r.hadFallback) hadFallback++;
  rawMsgs += r.rawMsgsCount || 0;
  workerIntermediates += r.workerIntermediates || 0;
  workerResults += r.workerResults || 0;
  byFile[r.file] = byFile[r.file] || {
    count: 0,
    hadFallback: 0,
    rawMsgs: 0,
    workerIntermediates: 0,
    workerResults: 0,
  };
  const bf = byFile[r.file];
  bf.count++;
  if (r.hadFallback) bf.hadFallback++;
  bf.rawMsgs += r.rawMsgsCount || 0;
  bf.workerIntermediates += r.workerIntermediates || 0;
  bf.workerResults += r.workerResults || 0;
  if (r.hadFallback && (r.workerIntermediates || r.workerResults)) {
    // nothing
  }
  if (r.hadFallback && !(r.workerIntermediates || r.workerResults)) {
    if (examplesNoWorker.length < 10)
      examplesNoWorker.push({
        file: r.file,
        reqId: r.reqId,
        fallbackScore: r.fallbackScore,
        events: r.events.slice(0, 6),
      });
  }
}
const summary = {
  totalRequests: total,
  hadFallbackCount: hadFallback,
  rawMsgsTotal: rawMsgs,
  workerIntermediatesTotal: workerIntermediates,
  workerResultsTotal: workerResults,
  byFile: byFile,
  examplesNoWorker: examplesNoWorker,
};
fs.writeFileSync(
  path.join(__dirname, "..", "recordings", "diag_applied_worker_analysis.json"),
  JSON.stringify(summary, null, 2),
  "utf8",
);
console.log(
  "WROTE",
  path.join("recordings", "diag_applied_worker_analysis.json"),
);
console.log(
  JSON.stringify(
    {
      totalRequests: total,
      hadFallbackCount: hadFallback,
      rawMsgsTotal: rawMsgs,
      workerIntermediatesTotal: workerIntermediates,
      workerResultsTotal: workerResults,
    },
    null,
    2,
  ),
);
