const fs = require("fs");
const path = require("path");
function usage() {
  console.error(
    "Usage: node analyze_profiles.js <path/to/ai_profiles_full.json>",
  );
  process.exit(2);
}
if (!process.argv[2]) usage();
const p = process.argv[2];
if (!fs.existsSync(p)) {
  console.error("File not found:", p);
  process.exit(3);
}
let raw = null;
try {
  raw = JSON.parse(fs.readFileSync(p, "utf8"));
} catch (e) {
  console.error("JSON parse error", String(e));
  process.exit(4);
}
if (!Array.isArray(raw)) {
  console.error("Expected an array of profile events");
  process.exit(5);
}
const arr = raw;
const total = arr.length;
const eventCounts = {};
const numericBuckets = {};
for (const it of arr) {
  const ev = (it && it.event) || "unknown";
  eventCounts[ev] = (eventCounts[ev] || 0) + 1;
  if (it && typeof it === "object") {
    for (const k of Object.keys(it)) {
      const v = it[k];
      if (typeof v === "number" && isFinite(v)) {
        if (!numericBuckets[k]) numericBuckets[k] = [];
        numericBuckets[k].push(v);
      }
    }
  }
}
function statify(a) {
  if (!a || a.length === 0) return null;
  a.sort((x, y) => x - y);
  const n = a.length;
  const sum = a.reduce((s, x) => s + x, 0);
  const mean = sum / n;
  const median = n % 2 === 1 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  const p = (pctl) => {
    const idx = Math.floor((pctl / 100) * n);
    return a[Math.min(Math.max(0, idx), n - 1)];
  };
  const sq = a.reduce((s, x) => s + (x - mean) * (x - mean), 0);
  const std = Math.sqrt(sq / n);
  return {
    count: n,
    min: a[0],
    max: a[n - 1],
    mean,
    median,
    p50: median,
    p90: p(90),
    p95: p(95),
    p99: p(99),
    std,
  };
}
const numericStats = {};
for (const k of Object.keys(numericBuckets)) {
  numericStats[k] = statify(numericBuckets[k]);
}
// Simple tuning suggestions
const suggestions = [];
if (numericStats.totalTimeMs) {
  const m = numericStats.totalTimeMs;
  suggestions.push({
    key: "maxConcurrentWorkers",
    reason: "based on median totalTimeMs",
    recommended: Math.min(
      8,
      Math.max(1, Math.floor(100 / Math.max(1, m.median))),
    ),
  });
  suggestions.push({
    key: "APPLY_DEDUP_MS",
    reason: "prevent duplicate applies",
    recommended: Math.max(10, Math.round(m.median * 1.5)),
  });
  suggestions.push({
    key: "EARLY_FALLBACK_MS",
    reason: "fallback threshold (90th pct * 2)",
    recommended: Math.max(50, Math.round((m.p90 || m.median) * 2)),
  });
} else {
  suggestions.push({
    key: "maxConcurrentWorkers",
    reason: "no totalTimeMs sample; conservative default",
    recommended: 2,
  });
  suggestions.push({ key: "APPLY_DEDUP_MS", recommended: 50 });
  suggestions.push({ key: "EARLY_FALLBACK_MS", recommended: 200 });
}
if (numericStats.placementGeneratedCount) {
  const pg = numericStats.placementGeneratedCount;
  if (pg.mean > 200)
    suggestions.push({
      key: "placementCacheSize",
      reason: "many generated placements; increase cache",
      recommended: Math.min(1000, Math.round(pg.mean * 2)),
    });
}
const out = {
  file: p,
  totalProfiles: total,
  eventCounts,
  numericStats,
  suggestions,
};
const outDir = path.join(process.cwd(), "recordings");
try {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
} catch (e) {}
const outPath = path.join(outDir, `ai_profiles_analysis_${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("WROTE_ANALYSIS", outPath);
console.log(
  JSON.stringify(
    {
      total: out.totalProfiles,
      topEvents: Object.entries(out.eventCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
    },
    null,
    2,
  ),
);
