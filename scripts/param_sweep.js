const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const debounceMsList = [200, 300, 400];
const holdMsList = [500, 800];
const maxIntermediateList = [1, 3];
const duration = parseInt(process.argv[2] || '4000', 10);

const recordingsDir = path.join(__dirname, '..', 'recordings');
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

const results = [];
(async () => {
  for (const dm of debounceMsList) {
    for (const hm of holdMsList) {
      for (const mi of maxIntermediateList) {
        const params = { DEBOUNCE_MS: dm, DEBOUNCE_HOLD_MS: hm, MAX_INTERMEDIATE_APPLIES_PER_REQ: mi };
        const cmd = `node scripts/capture_one_run.js ${duration} '${JSON.stringify(params)}'`;
        console.log('Running:', cmd);
        try {
          const out = cp.execSync(cmd, { stdio: 'pipe' }).toString();
          console.log(out.trim().split('\n').slice(-3).join('\n'));
          // find saved path
          const m = out.match(/Saved capture to (.+\.json)/);
          if (!m) {
            console.warn('No capture file detected in output for', params);
            continue;
          }
          const saved = m[1].trim();
          const raw = fs.readFileSync(saved, 'utf8');
          const json = JSON.parse(raw);
          const logs = Array.isArray(json.logs) ? json.logs : [];
          const applyCount = logs.filter(l => typeof l === 'string' && l.indexOf('apply plan sig') !== -1).length;
          const holdCount = logs.filter(l => typeof l === 'string' && l.indexOf('action:hold') !== -1).length;
          const skipDup = logs.filter(l => typeof l === 'string' && l.indexOf('skipping duplicate') !== -1).length;
          results.push({ params, saved, applyCount, holdCount, skipDup });
        } catch (e) {
          console.error('Error running capture for', params, e && e.message);
        }
      }
    }
  }
  const outPath = path.join(recordingsDir, `param_sweep_summary_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: Date.now(), duration, results }, null, 2), 'utf8');
  console.log('Sweep complete. Summary saved to', outPath);
  console.table(results.map(r => ({ dm: r.params.DEBOUNCE_MS, hm: r.params.DEBOUNCE_HOLD_MS, mi: r.params.MAX_INTERMEDIATE_APPLIES_PER_REQ, apply: r.applyCount, hold: r.holdCount, skipped: r.skipDup })));
})();
