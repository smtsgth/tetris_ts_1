const fs = require('fs');
const path = require('path');

function listFiles(dir) {
  const res = [];
  if (!fs.existsSync(dir)) return res;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) res.push(...listFiles(full));
    else res.push(full);
  }
  return res;
}

function parseKeyValueObject(inner) {
  const out = {};
  const parts = inner.split(/,\s*/);
  for (const p of parts) {
    const m = p.match(/([^:]+):\s*(.*)/);
    if (!m) continue;
    let k = m[1].trim();
    let v = m[2].trim();
    if (/^\d+$/.test(v)) v = Number(v);
    else if (/^[\d.]+$/.test(v)) v = Number(v);
    else v = v.replace(/^"|"$/g, '');
    out[k] = v;
  }
  return out;
}

function stats(arr) {
  if (!arr || arr.length === 0) return null;
  const a = arr.slice().sort((x,y)=>x-y);
  const n = a.length;
  const sum = a.reduce((s,v)=>s+v,0);
  const mean = sum / n;
  const median = (n%2===1) ? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2;
  const p95Index = Math.max(0, Math.ceil(0.95*n)-1);
  const p95 = a[p95Index];
  return {count:n, min:a[0], max:a[n-1], mean, median, p95};
}

function processLogs(lines, file, ctx) {
  const reStartToFirst = /start-to-first-progress-ms[:=]?\s*(\d+)/i;
  const reWorkerRoundtrip = /worker-roundtrip-ms[:=]?\s*(\d+)/i;
  const reProfileTotal = /profile totalMs[:=]?\s*(\d+)/i;
  const reReqStart = /req:[^\s]+\s+start\b|start lookahead=/i;
  const reEarlyFallback = /early-fallback(?:\s*\(ms=(\d+)\))?/i;
  const reFallbackApplied = /fallback-applied/i;
  const reSyncFallback = /sync-fallback/i;
  const reLockAnomaly = /Lock anomaly detected\s*{([^}]*)}/i;

  lines.forEach((ln, idx) => {
    if (typeof ln !== 'string') ln = String(ln);
    let m;
    if ((m = ln.match(reStartToFirst))) ctx.startToFirst.push(Number(m[1]));
    if ((m = ln.match(reWorkerRoundtrip))) ctx.workerRoundtrip.push(Number(m[1]));
    if ((m = ln.match(reProfileTotal))) ctx.profileTotal.push(Number(m[1]));
    if (ln.match(reReqStart)) ctx.reqStarts += 1;
    if (ln.match(reEarlyFallback)) ctx.earlyFallbackCount += 1;
    if (ln.match(reFallbackApplied)) ctx.fallbackAppliedCount += 1;
    if (ln.match(reSyncFallback)) ctx.syncFallbackCount += 1;
    if ((m = ln.match(reLockAnomaly))) {
      const obj = parseKeyValueObject(m[1]);
      obj._source = file;
      obj._line = idx+1;
      ctx.lockAnomalies.push(obj);
    }
  });
}

function writeCSV(filePath, header, rows) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(r.map(v=>typeof v==='string'? '"'+String(v).replace(/"/g,'""')+'"' : String(v)).join(','));
  fs.writeFileSync(filePath, lines.join('\n'));
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const recordingsDir = path.join(repoRoot, 'recordings');
  const outDir = path.join(__dirname, 'analysis_results');
  if (!fs.existsSync(recordingsDir)) {
    console.error('recordings/ not found');
    process.exit(1);
  }
  const allFiles = listFiles(recordingsDir).filter(f=>/\.json$|\.txt$|\.log$/i.test(f));

  const ctx = {
    startToFirst: [],
    workerRoundtrip: [],
    profileTotal: [],
    reqStarts: 0,
    earlyFallbackCount: 0,
    fallbackAppliedCount: 0,
    syncFallbackCount: 0,
    lockAnomalies: []
  };

  for (const f of allFiles) {
    try {
      const raw = fs.readFileSync(f, 'utf8');
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch(e) { parsed = null; }
      if (parsed && Array.isArray(parsed.logs)) {
        processLogs(parsed.logs, f, ctx);
        continue;
      }
      if (parsed && Array.isArray(parsed)) {
        processLogs(parsed.map(String), f, ctx);
        continue;
      }
      // fallback: treat as plain text lines
      const lines = raw.split(/\r?\n/).filter(Boolean);
      processLogs(lines, f, ctx);
    } catch(err) {
      console.error('err reading', f, err && err.message);
    }
  }

  // compute stats
  const summary = {
    startToFirst_stats: stats(ctx.startToFirst),
    workerRoundtrip_stats: stats(ctx.workerRoundtrip),
    profileTotal_stats: stats(ctx.profileTotal),
    counts: {
      reqStarts: ctx.reqStarts,
      earlyFallbackCount: ctx.earlyFallbackCount,
      fallbackAppliedCount: ctx.fallbackAppliedCount,
      syncFallbackCount: ctx.syncFallbackCount,
      lockAnomalies: ctx.lockAnomalies.length
    }
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'analysis_summary.json'), JSON.stringify({summary, samples:{startToFirst:ctx.startToFirst.length, workerRoundtrip:ctx.workerRoundtrip.length, profileTotal:ctx.profileTotal.length}}, null, 2));

  writeCSV(path.join(outDir, 'start_to_first.csv'), ['ms'], ctx.startToFirst.map(v=>[v]));
  writeCSV(path.join(outDir, 'worker_roundtrip.csv'), ['ms'], ctx.workerRoundtrip.map(v=>[v]));
  writeCSV(path.join(outDir, 'profile_total.csv'), ['ms'], ctx.profileTotal.map(v=>[v]));

  // lock anomalies CSV
  const lockRows = ctx.lockAnomalies.map(a=>[
    a.ts || a.timestamp || '',
    a.type || '',
    a.piece || a.piece || '',
    a.beforeFilled || '',
    a.afterFilled || '',
    a._source || '',
    a._line || ''
  ]);
  writeCSV(path.join(outDir, 'lock_anomalies.csv'), ['ts','type','piece','beforeFilled','afterFilled','sourceFile','line'], lockRows);

  // fallback summary CSV
  writeCSV(path.join(outDir, 'fallback_summary.csv'), ['metric','value'], [
    ['reqStarts', ctx.reqStarts],
    ['earlyFallbackCount', ctx.earlyFallbackCount],
    ['fallbackAppliedCount', ctx.fallbackAppliedCount],
    ['syncFallbackCount', ctx.syncFallbackCount]
  ]);

  console.log('Analysis written to', outDir);
  console.log('Summary:', JSON.stringify(summary, null, 2));
}

main();
