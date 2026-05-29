const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "recordings");
const files = fs
  .readdirSync(dir)
  .filter(
    (f) => f && f.indexOf("worker_profiles") !== -1 && f.endsWith(".json"),
  );
const out = {
  generatedAt: Date.now(),
  files: {},
  totals: {
    filesProcessed: 0,
    events: 0,
    planStarts: 0,
    workerCreated: 0,
    postMessageSent: 0,
    earlyFallbacks: 0,
    workerResults: 0,
    payloadSizeSum: 0,
    payloadSizeCount: 0,
    profilesWithStats: 0,
    totalTimeMsSum: 0,
    placementGeneratedSum: 0,
    placementHitsSum: 0,
    placementMissesSum: 0,
  },
};
for (const f of files) {
  try {
    const p = path.join(dir, f);
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.events || [];
    const stats = {
      events: arr.length,
      planStarts: 0,
      workerCreated: 0,
      postMessageSent: 0,
      earlyFallbacks: 0,
      workerResults: 0,
      payloadSizeSum: 0,
      payloadSizeCount: 0,
      profilesWithStats: 0,
      totalTimeMsSum: 0,
      placementGeneratedSum: 0,
      placementHitsSum: 0,
      placementMissesSum: 0,
    };
    for (const ev of arr) {
      if (!ev || !ev.event) continue;
      stats.events++;
      out.totals.events++;
      if (ev.event === "plan-start") {
        stats.planStarts++;
        out.totals.planStarts++;
      }
      if (ev.event === "worker-created") {
        stats.workerCreated++;
        out.totals.workerCreated++;
      }
      if (ev.event === "postMessage-sent") {
        stats.postMessageSent++;
        out.totals.postMessageSent++;
        if (typeof ev.payloadSize === "number") {
          stats.payloadSizeSum += ev.payloadSize;
          stats.payloadSizeCount++;
          out.totals.payloadSizeSum += ev.payloadSize;
          out.totals.payloadSizeCount++;
        }
      }
      if (ev.event === "early-fallback-applied") {
        stats.earlyFallbacks++;
        out.totals.earlyFallbacks++;
      }
      if (ev.event === "worker-result") {
        stats.workerResults++;
        out.totals.workerResults++;
        const pof = ev.profile;
        if (pof) {
          if (typeof pof.totalTimeMs === "number") {
            stats.totalTimeMsSum += pof.totalTimeMs;
            out.totals.totalTimeMsSum += pof.totalTimeMs;
          }
          if (typeof pof.placementGeneratedCount === "number") {
            stats.placementGeneratedSum += pof.placementGeneratedCount;
            out.totals.placementGeneratedSum += pof.placementGeneratedCount;
          }
          if (typeof pof.placementCacheHits === "number") {
            stats.placementHitsSum += pof.placementCacheHits;
            out.totals.placementHitsSum += pof.placementCacheHits;
          }
          if (typeof pof.placementCacheMisses === "number") {
            stats.placementMissesSum += pof.placementCacheMisses;
            out.totals.placementMissesSum += pof.placementCacheMisses;
          }
          stats.profilesWithStats++;
          out.totals.profilesWithStats++;
        }
      }
    }
    out.files[f] = stats;
    out.totals.filesProcessed++;
  } catch (e) {
    out.files[f] = { error: String(e) };
  }
}
// compute derived metrics
out.totals.avgPayloadSize = out.totals.payloadSizeCount
  ? out.totals.payloadSizeSum / out.totals.payloadSizeCount
  : null;
out.totals.avgTotalTimeMs = out.totals.profilesWithStats
  ? out.totals.totalTimeMsSum / out.totals.profilesWithStats
  : null;
out.totals.avgPlacementGenerated = out.totals.profilesWithStats
  ? out.totals.placementGeneratedSum / out.totals.profilesWithStats
  : null;
out.totals.overallHitRate =
  out.totals.placementHitsSum + out.totals.placementMissesSum
    ? out.totals.placementHitsSum /
      (out.totals.placementHitsSum + out.totals.placementMissesSum)
    : null;
const outPath = path.join(dir, `profile_analysis_${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log("WROTE", outPath);
