const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'recordings');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f.indexOf('auto_test_early_fallback') !== -1);
const out = [];
for (const f of files) {
  const p = path.join(dir, f);
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { continue; }
  const obj = Array.isArray(raw) ? raw[0] : raw;
  const sample = obj.sample || [];
  const reqMap = {};
  for (const line of sample) {
    if (typeof line !== 'string') continue;
    const m = line.match(/^req:([0-9\-]+)\s+(.*)$/);
    if (!m) continue;
    const id = m[1];
    const ev = m[2];
    reqMap[id] = reqMap[id] || { events: [], fallbackSig: null, fallbackScore: null, rawMsgs: [], workerIntermediates: [], workerResults: [] };
    reqMap[id].events.push(ev);
    if (ev.indexOf('fallback-applied') !== -1) {
      const mm = ev.match(/fallback-applied sig:(\{.*\}) score:([-0-9]+)/);
      if (mm) { reqMap[id].fallbackSig = mm[1]; reqMap[id].fallbackScore = Number(mm[2]); }
    }
    if (ev.indexOf('worker-intermediate') !== -1 || ev.indexOf('worker-intermediate sig:') !== -1) {
      reqMap[id].workerIntermediates.push(ev);
    }
    if (ev.indexOf('worker-result') !== -1) {
      reqMap[id].workerResults.push(ev);
    }
    if (ev.indexOf('raw-msg:') !== -1) {
      reqMap[id].rawMsgs.push(ev);
    }
  }
  for (const id of Object.keys(reqMap)) {
    const r = reqMap[id];
    out.push({ file: f, reqId: id, hadFallback: !!r.fallbackSig, fallbackScore: r.fallbackScore, rawMsgsCount: r.rawMsgs.length, workerIntermediates: r.workerIntermediates.length, workerResults: r.workerResults.length, events: r.events });
  }
}
fs.writeFileSync(path.join(dir, 'diag_applied_worker.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('WROTE', path.join(dir, 'diag_applied_worker.json'));
