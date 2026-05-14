#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const REC_DIR = path.resolve(__dirname, '..', 'recordings');
if (!fs.existsSync(REC_DIR)) {
  console.error('recordings directory not found:', REC_DIR);
  process.exit(1);
}
const files = fs.readdirSync(REC_DIR).filter(f => f.startsWith('worker_profiles') && f.endsWith('.json'));
if (!files.length) {
  console.error('No worker_profiles files found in', REC_DIR);
  process.exit(1);
}
const perFile = {};
const totals = { filesProcessed: 0, events: 0, planStarts: 0, workerCreated: 0, postMessageSent: 0, earlyFallbacks: 0, workerResults: 0, payloadSizeSum: 0, payloadSizeCount: 0, profilesWithStats: 0, totalTimeMsSum: 0, placementGeneratedSum: 0, placementHitsSum: 0, placementMissesSum: 0 };
for (const f of files) {
  try {
    const p = path.join(REC_DIR, f);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.events || []);
    const stats = { events: 0, planStarts: 0, workerCreated: 0, postMessageSent: 0, earlyFallbacks: 0, workerResults: 0, payloadSizeSum: 0, payloadSizeCount: 0, profilesWithStats: 0, totalTimeMsSum: 0, placementGeneratedSum: 0, placementHitsSum: 0, placementMissesSum: 0 };
    for (const ev of arr) {
      if (!ev || !ev.event) continue;
      stats.events++;
      totals.events++;
      if (ev.event === 'plan-start') { stats.planStarts++; totals.planStarts++; }
      if (ev.event === 'worker-created') { stats.workerCreated++; totals.workerCreated++; }
      if (ev.event === 'postMessage-sent') { stats.postMessageSent++; totals.postMessageSent++; if (typeof ev.payloadSize === 'number') { stats.payloadSizeSum += ev.payloadSize; stats.payloadSizeCount++; totals.payloadSizeSum += ev.payloadSize; totals.payloadSizeCount++; } }
      if (ev.event === 'early-fallback-applied') { stats.earlyFallbacks++; totals.earlyFallbacks++; }
      if (ev.event === 'worker-result') {
        stats.workerResults++; totals.workerResults++;
        const pof = ev.profile;
        if (pof) {
          if (typeof pof.totalTimeMs === 'number') { stats.totalTimeMsSum += pof.totalTimeMs; totals.totalTimeMsSum += pof.totalTimeMs; }
          if (typeof pof.placementGeneratedCount === 'number') { stats.placementGeneratedSum += pof.placementGeneratedCount; totals.placementGeneratedSum += pof.placementGeneratedCount; }
          if (typeof pof.placementCacheHits === 'number') { stats.placementHitsSum += pof.placementCacheHits; totals.placementHitsSum += pof.placementCacheHits; }
          if (typeof pof.placementCacheMisses === 'number') { stats.placementMissesSum += pof.placementCacheMisses; totals.placementMissesSum += pof.placementCacheMisses; }
          stats.profilesWithStats++; totals.profilesWithStats++;
        }
      }
    }
    stats.avgTotalTimeMs = stats.profilesWithStats ? (stats.totalTimeMsSum / stats.profilesWithStats) : null;
    stats.hitRate = (stats.placementHitsSum + stats.placementMissesSum) ? (stats.placementHitsSum / (stats.placementHitsSum + stats.placementMissesSum)) : null;
    const bwMatch = f.match(/bw(\d+)/);
    const pnlMatch = f.match(/pnl(\d+)/);
    const topkMatch = f.match(/topk(\d+)/);
    stats.params = { beamWidth: bwMatch ? Number(bwMatch[1]) : null, perNodeLimit: pnlMatch ? Number(pnlMatch[1]) : null, topK: topkMatch ? Number(topkMatch[1]) : null };
    perFile[f] = stats;
    totals.filesProcessed++;
  } catch (e) {
    perFile[f] = { error: String(e) };
  }
}
// group by params
const groups = {};
for (const [fn, s] of Object.entries(perFile)) {
  if (s && s.params) {
    const key = `bw${s.params.beamWidth === null ? 'N' : s.params.beamWidth}_pnl${s.params.perNodeLimit === null ? 'N' : s.params.perNodeLimit}_topk${s.params.topK === null ? 'N' : s.params.topK}`;
    if (!groups[key]) groups[key] = { key, files: [], runs: 0, events: 0, profilesWithStats: 0, totalTimeMsSum: 0, placementGeneratedSum: 0, placementHitsSum: 0, placementMissesSum: 0 };
    const g = groups[key];
    g.files.push(fn);
    g.runs++;
    g.events += s.events || 0;
    g.profilesWithStats += s.profilesWithStats || 0;
    g.totalTimeMsSum += s.totalTimeMsSum || 0;
    g.placementGeneratedSum += s.placementGeneratedSum || 0;
    g.placementHitsSum += s.placementHitsSum || 0;
    g.placementMissesSum += s.placementMissesSum || 0;
  } else {
    const key = 'unknown';
    if (!groups[key]) groups[key] = { key, files: [], runs: 0, events: 0, profilesWithStats: 0, totalTimeMsSum: 0, placementGeneratedSum: 0, placementHitsSum: 0, placementMissesSum: 0 };
    const g = groups[key];
    g.files.push(fn);
    g.runs++;
    g.events += (s && s.events) || 0;
  }
}
const groupList = Object.values(groups).map(g => {
  const avgTotalTimeMs = g.profilesWithStats ? (g.totalTimeMsSum / g.profilesWithStats) : null;
  const overallHitRate = (g.placementHitsSum + g.placementMissesSum) ? (g.placementHitsSum / (g.placementHitsSum + g.placementMissesSum)) : null;
  const avgPlacementGenerated = g.profilesWithStats ? (g.placementGeneratedSum / g.profilesWithStats) : null;
  return Object.assign({}, g, { avgTotalTimeMs, overallHitRate, avgPlacementGenerated });
});
groupList.sort((a, b) => {
  const aHR = a.overallHitRate === null ? -1 : a.overallHitRate;
  const bHR = b.overallHitRate === null ? -1 : b.overallHitRate;
  if (aHR !== bHR) return bHR - aHR;
  const aT = a.avgTotalTimeMs === null ? Number.POSITIVE_INFINITY : a.avgTotalTimeMs;
  const bT = b.avgTotalTimeMs === null ? Number.POSITIVE_INFINITY : b.avgTotalTimeMs;
  return aT - bT;
});
const out = { generatedAt: Date.now(), totals, groups: groupList, perFile };
const outPath = path.join(REC_DIR, `profile_summary_by_params_${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('WROTE', outPath);
console.log('Top groups (up to 5):');
for (let i = 0; i < Math.min(5, groupList.length); i++) {
  const g = groupList[i];
  console.log(`${i + 1}. ${g.key}  hitRate=${g.overallHitRate !== null ? g.overallHitRate.toFixed(4) : 'n/a'} avgTotalTimeMs=${g.avgTotalTimeMs !== null ? g.avgTotalTimeMs.toFixed(2) : 'n/a'} runs=${g.runs} files=${g.files.length}`);
}
process.exit(0);
