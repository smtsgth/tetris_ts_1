const fs = require("fs");
const path = require("path");
const REC = path.resolve(__dirname, "..", "recordings");
const files = fs
  .readdirSync(REC)
  .filter((f) => f.startsWith("profile_aggregate_") && f.endsWith(".json"));
if (!files.length) {
  console.error("no profile_aggregate files found");
  process.exit(1);
}
files.sort();
const file = path.join(REC, files[files.length - 1]);
console.log("Analyzing", file);
const j = JSON.parse(fs.readFileSync(file, "utf8"));
const perReq = j.perReq || [];
let totalMatches = 0;
const totalMsList = [];
const genList = [];
const hitsList = [];
const missesList = [];
const depthTimes = {};
for (const r of perReq) {
  const evs = r.events || [];
  for (const ev of evs) {
    const m = String(ev).match(
      /profile totalMs:(\d+)\s+gen:(\d+)\s+hits:(\d+)\s+misses:(\d+)/,
    );
    if (m) {
      totalMatches++;
      const totalMs = Number(m[1]);
      const gen = Number(m[2]);
      const hits = Number(m[3]);
      const misses = Number(m[4]);
      totalMsList.push(totalMs);
      genList.push(gen);
      hitsList.push(hits);
      missesList.push(misses);
    }
  }
  const prog = r.progress || [];
  for (const p of prog) {
    const d = p && p.depth != null ? String(p.depth) : "na";
    const t = Number(p.timeMs) || 0;
    depthTimes[d] = (depthTimes[d] || 0) + t;
  }
}
function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
function sum(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) : 0;
}
function median(a) {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const mid = Math.floor(b.length / 2);
  return b.length % 2 ? b[mid] : (b[mid - 1] + b[mid]) / 2;
}
function percentile(a, p) {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const idx = Math.floor(((b.length - 1) * p) / 100);
  return b[Math.max(0, Math.min(b.length - 1, idx))];
}
const stats = {
  file,
  filesProcessed: j.summary && j.summary.filesProcessed,
  reqCount: j.summary && j.summary.reqCount,
  matchedProfiles: totalMatches,
  avgTotalMs: mean(totalMsList),
  medianTotalMs: median(totalMsList),
  p90TotalMs: percentile(totalMsList, 90),
  avgGen: mean(genList),
  avgHits: mean(hitsList),
  avgMisses: mean(missesList),
  sumHits: sum(hitsList),
  sumMisses: sum(missesList),
  overallHitRate: sum(hitsList) / (sum(hitsList) + sum(missesList) || 1),
  depthTimes: depthTimes,
};
console.log(JSON.stringify(stats, null, 2));
