#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function findLatestDiff(dir) {
  const files = fs.readdirSync(dir).filter(f => f.indexOf('microprof_diff_') === 0 && f.endsWith('.json'));
  if (!files.length) return null;
  const sorted = files.map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a,b)=>b.t-a.t);
  return sorted[0].f;
}

const outDir = path.join(process.cwd(), 'bench_results');
if (!fs.existsSync(outDir)) {
  console.log('# Microbench: no bench_results directory');
  process.exit(0);
}
const diffFile = findLatestDiff(outDir);
if (!diffFile) {
  console.log('# Microbench: no diff file found');
  process.exit(0);
}
const diff = JSON.parse(fs.readFileSync(path.join(outDir, diffFile), 'utf8'));
const diffs = diff.diffs || {};
const keys = Object.keys(diffs).sort((a,b)=>Math.abs(diffs[b].delta) - Math.abs(diffs[a].delta));
const top = keys.slice(0, 12);

function fmt(n) { return (typeof n === 'number') ? n.toFixed(3) : String(n); }

console.log('# Microbench diff summary');
console.log();
console.log(`- Diff file: \\`${diffFile}\\``);
console.log(`- Baseline files: ${diff.baseline_count_files || 0}`);
console.log(`- Post files: ${diff.post_count_files || 0}`);
console.log();
console.log('| Metric | baseline_total | post_total | delta | pct |');
console.log('|---|---:|---:|---:|---:|');
for (const k of top) {
  const v = diffs[k];
  const a = v.baseline_total || 0;
  const b = v.post_total || 0;
  const d = v.delta || 0;
  const pct = (v.pct === null || v.pct === undefined) ? 'N/A' : (v.pct.toFixed(1) + '%');
  console.log(`| ${k} | ${fmt(a)} | ${fmt(b)} | ${fmt(d)} | ${pct} |`);
}

console.log();
console.log('Artifacts: bench_results uploaded to workflow run artifacts.');
console.log();
console.log('Full diff JSON is attached as an artifact; download from the Actions run if needed.');
