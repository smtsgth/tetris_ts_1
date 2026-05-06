const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const candidates = [
  { DEBOUNCE_MS: 300, DEBOUNCE_HOLD_MS: 800, MAX_INTERMEDIATE_APPLIES_PER_REQ: 3 },
  { DEBOUNCE_MS: 200, DEBOUNCE_HOLD_MS: 800, MAX_INTERMEDIATE_APPLIES_PER_REQ: 1 },
];

const duration = parseInt(process.argv[2] || '10000', 10);
const repeats = parseInt(process.argv[3] || '10', 10);

const recordingsDir = path.join(__dirname, '..', 'recordings');
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

(async () => {
  const summary = { timestamp: Date.now(), duration, repeats, candidates: [] };

  for (const params of candidates) {
    const runs = [];
    for (let i = 0; i < repeats; i++) {
      const cmd = `node scripts/capture_one_run.js ${duration} '${JSON.stringify(params)}'`;
      console.log('Running:', cmd);
      try {
        const out = cp.execSync(cmd, { stdio: 'pipe' }).toString();
        console.log(out.trim().split('\n').slice(-3).join('\n'));
        const m = out.match(/Saved capture to (.+\.json)/);
        if (!m) {
          console.warn('No capture file detected in output for', params);
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
      } catch (e) {
        console.error('Error running capture for', params, e && e.message);
        runs.push({ error: e && e.message });
      }
    }
    const totals = runs.reduce((acc, r) => {
      if (r && r.applyCount != null) {
        acc.apply += r.applyCount;
        acc.hold += r.holdCount;
        acc.skipped += r.skipDup;
        acc.success += 1;
      } else {
        acc.fail += 1;
      }
      return acc;
    }, { apply: 0, hold: 0, skipped: 0, success: 0, fail: 0 });

    summary.candidates.push({ params, runs, totals });
  }

  const outPath = path.join(recordingsDir, `long_verify_summary_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('Long verify complete. Summary saved to', outPath);
})();
