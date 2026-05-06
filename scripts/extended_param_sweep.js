const cp = require('child_process');
const fs = require('fs');
const path = require('path');

// Extended parameter sweep
const debounceMsList = [200, 300, 400];
const debounceHoldMsList = [600, 800];
const maxInterList = [1, 2, 3];

const duration = parseInt(process.argv[2] || '5000', 10);
const repeats = parseInt(process.argv[3] || '5', 10);

const recordingsDir = path.join(__dirname, '..', 'recordings');
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

(async function(){
  const summary = { timestamp: Date.now(), duration, repeats, candidates: [] };

  for (const DEBOUNCE_MS of debounceMsList) {
    for (const DEBOUNCE_HOLD_MS of debounceHoldMsList) {
      for (const MAX_INTERMEDIATE_APPLIES_PER_REQ of maxInterList) {
        const params = { DEBOUNCE_MS, DEBOUNCE_HOLD_MS, MAX_INTERMEDIATE_APPLIES_PER_REQ };
        console.log('Running candidate:', params);
        const runs = [];

        for (let i = 0; i < repeats; i++) {
          const cmd = `node scripts/capture_one_run.js ${duration} '${JSON.stringify(params)}'`;
          try {
            const out = cp.execSync(cmd, { stdio: 'pipe' }).toString();
            console.log(out.trim().split('\n').slice(-2).join('\n'));
            const m = out.match(/Saved capture to (.+\.json)/);
            if (!m) {
              runs.push({ error: 'no_capture', out });
              continue;
            }
            const saved = m[1].trim();
            const raw = fs.readFileSync(saved, 'utf8');
            const json = JSON.parse(raw);
            const logs = Array.isArray(json.logs) ? json.logs : (Array.isArray(json.log) ? json.log : []);
            const applyCount = logs.filter(l => typeof l === 'string' && l.indexOf('apply plan sig') !== -1).length;
            const holdCount = logs.filter(l => typeof l === 'string' && l.indexOf('action:hold') !== -1).length;
            const skipDup = logs.filter(l => typeof l === 'string' && l.indexOf('skipping duplicate') !== -1).length;
            runs.push({ saved, applyCount, holdCount, skipDup });
          } catch (err) {
            console.error('capture failed:', err && err.message);
            runs.push({ error: err && String(err) });
          }
        }

        const totals = runs.reduce((acc, r) => {
          if (r && r.applyCount != null) { acc.apply += r.applyCount; acc.hold += r.holdCount; acc.skipped += r.skipDup; acc.success += 1; }
          else acc.fail += 1;
          return acc;
        }, { apply: 0, hold: 0, skipped: 0, success: 0, fail: 0 });

        summary.candidates.push({ params, runs, totals });
      }
    }
  }

  const outPath = path.join(recordingsDir, `extended_param_sweep_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('Extended sweep complete. Summary saved to', outPath);
})();
