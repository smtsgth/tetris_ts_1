const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'recordings');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f.indexOf('auto_test_early_fallback') !== -1);
const stats = { files: {}, total: { earlyFallback:0, fallbackApplied:0, workerResult:0, workerOverwrite:0, workerIgnored:0, timeout:0, maxWorkersDeferring:0, oldestTerminated:0 } };
for (const f of files) {
  const p = path.join(dir, f);
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){ console.error('parse fail',f,e); continue; }
  const obj = Array.isArray(raw) ? raw[0] : raw;
  const sample = obj.sample || [];
  const fileStat = { earlyFallback:0, fallbackApplied:0, workerResult:0, workerOverwrite:0, workerIgnored:0, timeout:0, maxWorkersDeferring:0, oldestTerminated:0, lines: sample.length };
  // map reqId -> events
  const reqs = {};
  for (const line of sample) {
    if (typeof line !== 'string') continue;
    if (line.includes('early-fallback')) { fileStat.earlyFallback++; }
    if (line.includes('fallback-applied')) { fileStat.fallbackApplied++; }
    if (line.includes('worker-result sig:')) { fileStat.workerResult++; }
    if (line.includes('worker-overwrite applied')) { fileStat.workerOverwrite++; }
    if (line.includes('worker-result ignored')) { fileStat.workerIgnored++; }
    if (line.includes('timeout, performing sync fallback')) { fileStat.timeout++; }
    if (line.includes('max workers busy')) { fileStat.maxWorkersDeferring++; }
    if (line.includes('oldest-worker-terminated')) { fileStat.oldestTerminated++; }

    // track per-request
    const m = line.match(/^req:([0-9\-]+)\s+(.*)$/);
    if (m) {
      const id = m[1];
      const ev = m[2];
      reqs[id] = reqs[id] || [];
      reqs[id].push(ev);
    }
  }
  // check for cases where fallback-applied and later worker-result or overwrite
  let fallbackThenWorker = 0;
  let fallbackThenIgnored = 0;
  for (const id of Object.keys(reqs)) {
    const evs = reqs[id];
    const hasFallback = evs.some(e => e.includes('fallback-applied'));
    const hasWorkerResult = evs.some(e => e.includes('worker-result'));
    const hasOverwrite = evs.some(e => e.includes('worker-overwrite applied'));
    const hasIgnored = evs.some(e => e.includes('worker-result ignored'));
    if (hasFallback && hasWorkerResult) fallbackThenWorker++;
    if (hasFallback && hasIgnored) fallbackThenIgnored++;
    // aggregate workerResult/overwrite/ignored counts may be duplicated above
  }
  fileStat.fallbackThenWorker = fallbackThenWorker;
  fileStat.fallbackThenIgnored = fallbackThenIgnored;

  stats.files[f] = fileStat;
  // add to totals
  for (const k of Object.keys(fileStat)) {
    if (k in stats.total) stats.total[k] += fileStat[k];
  }
}
console.log(JSON.stringify({ summary: stats }, null, 2));
