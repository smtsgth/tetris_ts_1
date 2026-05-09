#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const REC_DIR = path.resolve(__dirname, '..', 'recordings');
function listFiles() { try { return fs.readdirSync(REC_DIR); } catch (e) { console.error('recordings directory not found:', REC_DIR); process.exit(2); } }
function tsFrom(name) { const m = name.match(/_(\d{10,})/); return m ? Number(m[1]) : null; }
function readJson(name) { try { return JSON.parse(fs.readFileSync(path.join(REC_DIR, name), 'utf8')); } catch (e) { return null; } }
function readText(name) { try { return fs.readFileSync(path.join(REC_DIR, name), 'utf8'); } catch (e) { return null; } }

// parse simple CLI options:
// --no-csv | --csv | --excerpt=N | --window=ms | --prefix=STR
const rawArgs = process.argv.slice(2);
const opts = { csv: true, excerptLines: 50, windowMs: 5 * 60 * 1000, outPrefix: 'diff_report' };
for (const a of rawArgs) {
  if (a === '--no-csv') opts.csv = false;
  else if (a === '--csv') opts.csv = true;
  else if (a.startsWith('--excerpt=')) opts.excerptLines = Number(a.split('=')[1]) || opts.excerptLines;
  else if (a.startsWith('--window=')) opts.windowMs = Number(a.split('=')[1]) || opts.windowMs;
  else if (a.startsWith('--prefix=')) opts.outPrefix = a.split('=')[1] || opts.outPrefix;
}

const files = listFiles();
const summaryFiles = files.filter(f => /^auto_test_summary_\d+\.json$/.test(f));
const runEventsFiles = files.filter(f => /^auto_test_run_events_\d+\.json$/.test(f));
const fatalFiles = files.filter(f => /^run_fatal_\d+\.log$/.test(f));
const uncaughtFiles = files.filter(f => /^run_uncaught_exception_\d+\.log$/.test(f));
const serverFiles = files.filter(f => /^server_\d+_\d+\.(err|log)$/.test(f));

function findNearest(list, ts) {
  if (!list || !list.length) return null;
  let best = null; let bestDiff = Infinity;
  for (const f of list) {
    const t = tsFrom(f) || 0; const d = Math.abs(t - ts);
    if (d < bestDiff) { bestDiff = d; best = f; }
  }
  return best;
}

const runs = summaryFiles.map(summary => {
  const summaryTs = tsFrom(summary) || 0;
  const eventsFile = findNearest(runEventsFiles, summaryTs);
  const events = eventsFile ? (readJson(eventsFile) || []) : [];
  const hasFatalEvent = Array.isArray(events) && events.some(e => ['fatal','uncaughtException','unhandledRejection','test-run-error','server-proc-error','server-start-failed'].includes(e.type));
  const fatalNearby = fatalFiles.filter(f => Math.abs((tsFrom(f)||0) - summaryTs) < opts.windowMs);
  const uncaughtNearby = uncaughtFiles.filter(f => Math.abs((tsFrom(f)||0) - summaryTs) < opts.windowMs);
  const serverNearby = serverFiles.filter(f => Math.abs((tsFrom(f)||0) - summaryTs) < opts.windowMs);
  const early = readJson(summary) || [];
  const countsMap = {};
  if (Array.isArray(early)) {
    for (const r of early) {
      const key = String(r.earlyFallbackMs);
      countsMap[key] = r.counts || {};
    }
  }
  return {
    summaryFile: summary,
    summaryTs,
    eventsFile,
    eventsCount: Array.isArray(events) ? events.length : 0,
    hasFatal: hasFatalEvent || fatalNearby.length > 0 || uncaughtNearby.length > 0,
    fatalFiles: fatalNearby,
    uncaughtFiles: uncaughtNearby,
    serverFiles: serverNearby,
    earlyResults: early,
    countsMap
  };
});

runs.sort((a,b)=> a.summaryTs - b.summaryTs);

function diffCountsMap(A,B) {
  const out = {};
  const keys = new Set([...(Object.keys(A||{})), ...(Object.keys(B||{}))]);
  for (const k of keys) {
    const a = A[k] || {};
    const b = B[k] || {};
    const metrics = new Set([...(Object.keys(a)), ...(Object.keys(b))]);
    const m = {};
    for (const metric of metrics) {
      const an = (typeof a[metric] === 'number') ? a[metric] : Number(a[metric] || 0);
      const bn = (typeof b[metric] === 'number') ? b[metric] : Number(b[metric] || 0);
      m[metric] = an - bn;
    }
    out[k] = m;
  }
  return out;
}

const failedRuns = runs.filter(r => r.hasFatal);
let failed = failedRuns.length ? failedRuns[failedRuns.length - 1] : null;
let prevOk = null;
if (failed) {
  const prevs = runs.filter(r => !r.hasFatal && r.summaryTs < failed.summaryTs);
  if (prevs.length) prevOk = prevs[prevs.length -1];
}

const report = { generated: Date.now(), runCount: runs.length, runs: runs.map(r => ({ summaryFile: r.summaryFile, summaryTs: r.summaryTs, hasFatal: r.hasFatal, eventsFile: r.eventsFile, serverFiles: r.serverFiles, fatalFiles: r.fatalFiles })) };

if (failed && prevOk) {
  report.comparison = {
    failed: { summaryFile: failed.summaryFile, summaryTs: failed.summaryTs },
    previousOk: { summaryFile: prevOk.summaryFile, summaryTs: prevOk.summaryTs },
    diffs: diffCountsMap(failed.countsMap, prevOk.countsMap),
    failedFatalFiles: failed.fatalFiles,
    failedUncaughtFiles: failed.uncaughtFiles,
    failedServerFiles: failed.serverFiles
  };
} else if (failed) {
  report.note = 'failed run(s) present but no previous successful run found to compare against.';
}

const outJsonPath = path.join(REC_DIR, `${opts.outPrefix}_${Date.now()}.json`);
const outTxtPath = path.join(REC_DIR, `${opts.outPrefix}_${Date.now()}.txt`);
const outCsvPath = path.join(REC_DIR, `${opts.outPrefix}_${Date.now()}.csv`);
const outFatalExcerptsPath = path.join(REC_DIR, `${opts.outPrefix}_${Date.now()}_fatal_excerpts.txt`);
fs.writeFileSync(outJsonPath, JSON.stringify(report, null, 2), 'utf8');

let txt = '';
txt += `Diff report: ${outJsonPath}\n`;
txt += `Runs found: ${runs.length}\n`;
runs.forEach(r => {
  txt += `- ${r.summaryFile}  ts=${r.summaryTs}  status=${r.hasFatal? 'FAILED':'OK'}  events=${r.eventsCount}\n`;
});
if (report.comparison) {
  txt += `\nComparison: failed=${report.comparison.failed.summaryFile} vs ok=${report.comparison.previousOk.summaryFile}\n`;
  txt += `Diffs by earlyFallbackMs:\n`;
  for (const ms of Object.keys(report.comparison.diffs)) {
    txt += `  ms=${ms} -> ${JSON.stringify(report.comparison.diffs[ms])}\n`;
  }
  if (report.comparison.failedFatalFiles && report.comparison.failedFatalFiles.length) {
    txt += `\nFailed fatal logs:\n`;
    for (const f of report.comparison.failedFatalFiles) {
      txt += `-- ${f} --\n`;
      const s = readText(f);
      txt += (s? s.slice(0,1000) : '(unreadable)') + '\n\n';
    }
  }
}
fs.writeFileSync(outTxtPath, txt, 'utf8');

// CSV output: aggregate simple totals per run
function aggregateCounts(countsMap) {
  const totals = { earlyFallback:0, fallbackApplied:0, workerOverwrite:0, workerIgnored:0, timeout:0 };
  for (const k of Object.keys(countsMap||{})) {
    const v = countsMap[k] || {};
    totals.earlyFallback += Number(v.earlyFallback || 0);
    totals.fallbackApplied += Number(v.fallbackApplied || 0);
    totals.workerOverwrite += Number(v.workerOverwrite || 0);
    totals.workerIgnored += Number(v.workerIgnored || 0);
    totals.timeout += Number(v.timeout || 0);
  }
  return totals;
}

if (opts.csv) {
  const header = ['summaryFile','summaryTs','status','eventsCount','hasFatal','totalEarlyFallback','totalFallbackApplied','totalWorkerOverwrite','totalWorkerIgnored','totalTimeout','fatalFiles','uncaughtFiles','serverFiles','eventsFile'];
  const rows = [header.join(',')];
  for (const r of runs) {
    const agg = aggregateCounts(r.countsMap);
    const row = [r.summaryFile, r.summaryTs, r.hasFatal? 'FAILED':'OK', r.eventsCount, r.hasFatal? '1':'0', agg.earlyFallback, agg.fallbackApplied, agg.workerOverwrite, agg.workerIgnored, agg.timeout, (r.fatalFiles||[]).join('|'), (r.uncaughtFiles||[]).join('|'), (r.serverFiles||[]).join('|'), r.eventsFile || ''].map(v => String(v).replace(/\r?\n/g,' '));
    rows.push(row.join(','));
  }
  fs.writeFileSync(outCsvPath, rows.join('\n'), 'utf8');
}

// write fatal excerpts if requested
if (report.comparison && report.comparison.failedFatalFiles && report.comparison.failedFatalFiles.length) {
  let ex = '';
  for (const f of report.comparison.failedFatalFiles) {
    ex += `-- ${f} --\n`;
    const s = readText(f) || '';
    const lines = s.split(/\r?\n/).slice(0, opts.excerptLines);
    ex += lines.join('\n') + '\n\n';
  }
  fs.writeFileSync(outFatalExcerptsPath, ex, 'utf8');
}

console.log('Wrote:', outJsonPath, outTxtPath, opts.csv ? outCsvPath : '', (fs.existsSync(outFatalExcerptsPath) ? outFatalExcerptsPath : ''));
process.exit(0);
