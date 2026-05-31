#!/usr/bin/env node
const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const aiPath = path.resolve(__dirname, '../src/ai_worker.ts');
const backupPath = aiPath + '.bak-sweep';
const orig = fs.readFileSync(aiPath, 'utf8');
fs.writeFileSync(backupPath, orig);

const minHits = [1, 2, 4];
const limits = [1024, 4096];
const trials = 100;
const pieces = process.argv[2] || 'L';
const topKs = process.argv[3] || 2;

function replaceConst(content, name, value) {
  const re = new RegExp(`(const\\s+${name}\\s*=\\s*)\\d+;`);
  if (!re.test(content)) throw new Error('Const ' + name + ' not found');
  return content.replace(re, `$1${value};`);
}

const combos = [];
for (const mh of minHits) for (const lim of limits) combos.push({ mh, lim });

(async () => {
  try {
    for (const { mh, lim } of combos) {
      const comboLabel = `mh${mh}_lim${lim}`;
      console.log('\n=== Combo:', comboLabel, 'trials=', trials, 'pieces=', pieces, 'topKs=', topKs);

      let newContent = replaceConst(orig, 'GLOBAL_COLADDS_RUNTIME_CACHE_MIN_HITS_TO_PROMOTE', mh);
      newContent = replaceConst(newContent, 'GLOBAL_COLADDS_RUNTIME_CACHE_LIMIT', lim);
      fs.writeFileSync(aiPath, newContent, 'utf8');
      console.log('Patched', aiPath);

      // build
      console.log('Building...');
      cp.execSync('npm run build', { stdio: 'inherit' });

      const outBase = path.resolve(__dirname, '..', 'bench_results', `sweep_${comboLabel}_t${trials}`);

      // precomp enabled
      console.log('Running microbench (precomp enabled)...');
      cp.execSync(`node scripts/run_microbench_sweep.js --pieces ${pieces} --topKs ${topKs} --trials ${trials} --outDir ${outBase} --mprof`, { stdio: 'inherit' });
      console.log('Aggregating...');
      cp.execSync(`node scripts/aggregate_mprof_fields_dir.js --dir ${outBase} --out ${outBase}/mprof_agg`, { stdio: 'inherit' });

      // precomp disabled
      console.log('Running microbench (precomp DISABLED)...');
      const outBaseNo = outBase + '_noprecomp';
      cp.execSync(`node scripts/run_microbench_sweep.js --pieces ${pieces} --topKs ${topKs} --trials ${trials} --outDir ${outBaseNo} --mprof`, { env: Object.assign({}, process.env, { FORCE_DISABLE_PRECOMP: 'true' }), stdio: 'inherit' });
      console.log('Aggregating (noprecomp)...');
      cp.execSync(`node scripts/aggregate_mprof_fields_dir.js --dir ${outBaseNo} --out ${outBaseNo}/mprof_agg`, { stdio: 'inherit' });

      console.log('Combo complete:', comboLabel);
    }
  } catch (err) {
    console.error('Error during sweep:', err && err.stack ? err.stack : err);
  } finally {
    // restore original file
    try {
      fs.writeFileSync(aiPath, orig, 'utf8');
      console.log('Restored original', aiPath);
      cp.execSync('npm run build', { stdio: 'inherit' });
      console.log('Rebuilt original code. Sweep finished.');
    } catch (e) {
      console.error('Failed to restore original file:', e && e.stack ? e.stack : e);
    }
  }
})();
