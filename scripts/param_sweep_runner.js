#!/usr/bin/env node
const cp = require('child_process');
const path = require('path');

const combos = [];
// define grid: beamWidthBase x perNodeLimit x topK
const beamWidths = [3, 6];
const perNodeLimits = [1, 2, 4];
const topKs = [1, 2];
for(const bw of beamWidths) for(const pnl of perNodeLimits) for(const tk of topKs) combos.push({ bw, pnl, tk });

const DURATION_MS = process.env.DURATION_MS ? Number(process.env.DURATION_MS) : 20000;
const disableFallbacks = process.env.DISABLE_FALLBACKS ? '1' : '1';

console.log(`Running param sweep ${combos.length} runs, DURATION_MS=${DURATION_MS}`);
for(const c of combos){
  console.log(`\n=== Run: bw=${c.bw} perNode=${c.pnl} topK=${c.tk} ===`);
  const env = Object.assign({}, process.env, { DURATION_MS: String(DURATION_MS), DISABLE_FALLBACKS: disableFallbacks, BEAM_WIDTH: String(c.bw), PER_NODE_LIMIT: String(c.pnl), TOP_K: String(c.tk) });
  const res = cp.spawnSync('node', [path.join('scripts','capture_profiles_once.js')], { env, stdio: 'inherit', cwd: process.cwd(), timeout: 120000 + DURATION_MS });
  if(res.error){ console.error('capture failed for', c, res.error); }
}

console.log('\nAll captures done. Running analysis...');
const ar = cp.spawnSync('node', [path.join('scripts','analyze_worker_profiles.js')], { stdio: 'inherit', cwd: process.cwd() });
if(ar.error) console.error('analysis failed', ar.error);
else console.log('Analysis complete. See recordings/ for profile_analysis_*.json');
