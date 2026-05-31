#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outDir = path.join(process.cwd(), 'bench_results');
if (!fs.existsSync(outDir)) {
  console.error('bench_results not found');
  process.exit(2);
}

function latestDiffFile() {
  const files = fs.readdirSync(outDir).filter(f => f.indexOf('microprof_diff_') === 0 && f.endsWith('.json'));
  if (!files.length) return null;
  const sorted = files.map(f => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs })).sort((a,b)=>b.t-a.t);
  return sorted[0].f;
}

const diffFile = latestDiffFile();
if (!diffFile) {
  console.error('no diff file found');
  process.exit(2);
}

const diff = JSON.parse(fs.readFileSync(path.join(outDir, diffFile), 'utf8'));
const diffs = diff.diffs || {};

const rows = [];
for (const k of Object.keys(diffs)) {
  const v = diffs[k];
  rows.push({
    metric: k,
    baseline_total: v.baseline_total || 0,
    baseline_count: v.baseline_count || 0,
    post_total: v.post_total || 0,
    post_count: v.post_count || 0,
    delta: v.delta || 0,
    pct: (v.pct === null || v.pct === undefined) ? '' : v.pct.toFixed(3)
  });
}

const outDirReports = path.join(process.cwd(), 'bench_reports');
if (!fs.existsSync(outDirReports)) fs.mkdirSync(outDirReports, { recursive: true });
const csvPath = path.join(outDirReports, `microprof_diff_summary_${Date.now()}.csv`);
const header = ['metric','baseline_total','baseline_count','post_total','post_count','delta','pct'].join(',') + '\n';
const lines = rows.map(r => [r.metric, r.baseline_total, r.baseline_count, r.post_total, r.post_count, r.delta, r.pct].join(','));
fs.writeFileSync(csvPath, header + lines.join('\n'), 'utf8');
console.log('Wrote', csvPath);
