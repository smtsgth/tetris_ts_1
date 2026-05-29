const fs = require("fs");
const path = require("path");

const analysisPath =
  process.argv[2] ||
  path.join("recordings", "profile_analysis_1778760022797.json");
const combos = process.argv.slice(3);
if (combos.length === 0)
  combos.push("bw3_pnl2_topk1", "bw3_pnl1_topk2", "bw3_pnl1_topk1");

function safe(n) {
  return typeof n === "number" ? n : 0;
}

const raw = fs.readFileSync(analysisPath, "utf8");
const data = JSON.parse(raw);
const files = data.files || {};

const statsByCombo = {};
for (const c of combos)
  statsByCombo[c] = {
    profilesWithStats: 0,
    totalTimeMsSum: 0,
    placementGeneratedSum: 0,
    placementHitsSum: 0,
    placementMissesSum: 0,
    payloadSizeSum: 0,
    payloadSizeCount: 0,
  };

for (const [fname, f] of Object.entries(files)) {
  for (const combo of combos) {
    if (fname.includes(combo)) {
      const s = statsByCombo[combo];
      s.profilesWithStats += safe(f.profilesWithStats);
      s.totalTimeMsSum += safe(f.totalTimeMsSum);
      s.placementGeneratedSum += safe(f.placementGeneratedSum);
      s.placementHitsSum += safe(f.placementHitsSum);
      s.placementMissesSum += safe(f.placementMissesSum);
      s.payloadSizeSum += safe(f.payloadSizeSum);
      s.payloadSizeCount += safe(f.payloadSizeCount);
    }
  }
}

const summaries = [];
for (const [combo, s] of Object.entries(statsByCombo)) {
  const avgTime = s.profilesWithStats
    ? s.totalTimeMsSum / s.profilesWithStats
    : Infinity;
  const hitRate = s.placementGeneratedSum
    ? s.placementHitsSum / s.placementGeneratedSum
    : 0;
  const avgPlacementGen = s.profilesWithStats
    ? s.placementGeneratedSum / s.profilesWithStats
    : 0;
  summaries.push({
    combo,
    profilesWithStats: s.profilesWithStats,
    avgTime,
    hitRate,
    avgPlacementGen,
    ...s,
  });
}

summaries.sort((a, b) => {
  if (a.avgTime !== b.avgTime) return a.avgTime - b.avgTime;
  return b.hitRate - a.hitRate;
});

for (const s of summaries) {
  console.log(
    `${s.combo}\tprofiles=${s.profilesWithStats}\tavgTimeMs=${isFinite(s.avgTime) ? s.avgTime.toFixed(2) : "N/A"}\thitRate=${(s.hitRate * 100).toFixed(2)}%\tavgPlacGen=${s.avgPlacementGen.toFixed(2)}`,
  );
}

const best = summaries[0];
console.log("\nBEST:", best.combo);
console.log("DETAILS:", best);

process.exit(0);
