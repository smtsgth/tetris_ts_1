#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const REC_DIR = path.resolve(__dirname, '..', 'recordings');
if (!fs.existsSync(REC_DIR)) {
  console.error('recordings directory not found:', REC_DIR);
  process.exit(1);
}

function mergeArray(dst, src) { if (!src || !src.length) return; for (const v of src) dst.push(v); }

const files = fs.readdirSync(REC_DIR).filter(f => f.endsWith('.json') || f.endsWith('.log') || f.endsWith('.txt'));
const aggregates = Object.create(null);
let totalLines = 0;

function ensure(id) {
  if (!aggregates[id]) {
    aggregates[id] = {
      reqId: id,
      starts: 0,
      earlyFallbacks: 0,
      fallbackApplied: [],
      firstProgressMs: [],
      roundtripMs: [],
      profileTotals: [],
      profileGen: [],
      cacheHits: [],
      cacheMisses: [],
      progress: [],
      events: []
    };
  }
  return aggregates[id];
}

function parseLine(line) {
  line = String(line).trim();
  if (!line) return;
  totalLines++;

  // raw patterns
  const mStart = line.match(/^req:(\S+) start lookahead=(\d+)/);
  if (mStart) { const a = ensure(mStart[1]); a.starts++; a.events.push(line); return; }

  const mEarly = line.match(/^req:(\S+) early-fallback \(ms=(\d+)\)/);
  if (mEarly) { const a = ensure(mEarly[1]); a.earlyFallbacks++; a.events.push(line); return; }

  const mFallbackApplied = line.match(/^req:(\S+) fallback-applied sig:(\{[\s\S]*\}) score:([-\d\.]+)/);
  if (mFallbackApplied) {
    const id = mFallbackApplied[1]; const sig = mFallbackApplied[2]; const score = Number(mFallbackApplied[3]);
    const a = ensure(id); a.fallbackApplied.push({ sig: sig, score }); a.events.push(line); return;
  }

  const mFirst = line.match(/^req:(\S+) start-to-first-progress-ms:(\d+)/);
  if (mFirst) { const a = ensure(mFirst[1]); a.firstProgressMs.push(Number(mFirst[2])); a.events.push(line); return; }

  const mProgress = line.match(/^req:(\S+) progress depth:(\d+) exp:(\d+) placed:(\d+) t:(\d+)/);
  if (mProgress) { const id = mProgress[1]; const a = ensure(id); a.progress.push({ depth: Number(mProgress[2]), expanded: Number(mProgress[3]), placed: Number(mProgress[4]), timeMs: Number(mProgress[5]) }); a.events.push(line); return; }

  const mRound = line.match(/^req:(\S+) worker-roundtrip-ms:(\d+)/);
  if (mRound) { const a = ensure(mRound[1]); a.roundtripMs.push(Number(mRound[2])); a.events.push(line); return; }

  const mProfile = line.match(/^req:(\S+) profile totalMs:(\d+) gen:(\d+) hits:(\d+) misses:(\d+) d0:(\S+)/);
  if (mProfile) {
    const id = mProfile[1]; const a = ensure(id);
    a.profileTotals.push(Number(mProfile[2])); a.profileGen.push(Number(mProfile[3])); a.cacheHits.push(Number(mProfile[4])); a.cacheMisses.push(Number(mProfile[5])); a.events.push(line); return;
  }

  const mWorkerInt = line.match(/^req:(\S+) worker-intermediate/);
  if (mWorkerInt) { const a = ensure(mWorkerInt[1]); a.events.push(line); return; }

  const mWorkerRes = line.match(/^req:(\S+) worker-result/);
  if (mWorkerRes) { const a = ensure(mWorkerRes[1]); a.events.push(line); return; }

  const mRaw = line.match(/^raw-msg:(\S+):(.+)/);
  if (mRaw) { const a = ensure(mRaw[1]); a.events.push(line); return; }

  // other lines: ignore or collect under global
}

for (const f of files) {
  try {
    const full = path.join(REC_DIR, f);
    const txt = fs.readFileSync(full, 'utf8');
    let extracted = [];
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) {
        for (const it of parsed) {
          if (it && typeof it === 'object' && Array.isArray(it.sample)) extracted.push(...it.sample);
          else if (typeof it === 'string') extracted.push(it);
        }
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.sample)) extracted.push(...parsed.sample);
        else if (Array.isArray(parsed.logs)) extracted.push(...parsed.logs);
        else if (parsed.sample && typeof parsed.sample === 'string') extracted.push(parsed.sample);
        else extracted.push(JSON.stringify(parsed));
      } else if (typeof parsed === 'string') {
        extracted.push(parsed);
      }
    } catch (e) {
      // not JSON, read lines
      extracted = txt.split(/\r?\n/).filter(Boolean);
    }
    for (const line of extracted) parseLine(line);
  } catch (e) {
    console.error('failed to process', f, String(e));
  }
}

// produce summary
function stats(arr) {
  if (!arr || !arr.length) return null;
  const s = { count: arr.length, min: Math.min(...arr), max: Math.max(...arr), avg: arr.reduce((a,b)=>a+b,0)/arr.length };
  return s;
}

const perReq = Object.values(aggregates);
const summary = {
  filesProcessed: files.length,
  totalLinesMatched: totalLines,
  reqCount: perReq.length,
  generatedAt: Date.now()
};

// compute CSV lines
const csvRows = [];
csvRows.push(['reqId','starts','earlyFallbacks','fallbackAppliedCount','firstProgressMin','firstProgressAvg','roundtripAvg','profileAvg','totalCacheHits','totalCacheMisses'].join(','));
for (const a of perReq) {
  const firstMin = a.firstProgressMs && a.firstProgressMs.length ? Math.min(...a.firstProgressMs) : '';
  const firstAvg = a.firstProgressMs && a.firstProgressMs.length ? (a.firstProgressMs.reduce((x,y)=>x+y,0)/a.firstProgressMs.length).toFixed(2) : '';
  const roundAvg = a.roundtripMs && a.roundtripMs.length ? (a.roundtripMs.reduce((x,y)=>x+y,0)/a.roundtripMs.length).toFixed(2) : '';
  const profAvg = a.profileTotals && a.profileTotals.length ? (a.profileTotals.reduce((x,y)=>x+y,0)/a.profileTotals.length).toFixed(02) : '';
  const totalHits = a.cacheHits && a.cacheHits.length ? a.cacheHits.reduce((x,y)=>x+y,0) : 0;
  const totalMiss = a.cacheMisses && a.cacheMisses.length ? a.cacheMisses.reduce((x,y)=>x+y,0) : 0;
  csvRows.push([a.reqId, a.starts||0, a.earlyFallbacks||0, (a.fallbackApplied&&a.fallbackApplied.length)||0, firstMin, firstAvg, roundAvg, profAvg, totalHits, totalMiss].join(','));
}

const outJson = path.join(REC_DIR, `profile_aggregate_${Date.now()}.json`);
const outCsv = path.join(REC_DIR, `profile_aggregate_${Date.now()}.csv`);
fs.writeFileSync(outJson, JSON.stringify({ summary, perReq }, null, 2), 'utf8');
fs.writeFileSync(outCsv, csvRows.join('\n'), 'utf8');

console.log('Processed', files.length, 'files, matched lines:', totalLines, 'reqs:', perReq.length);
console.log('Wrote', outJson);
console.log('Wrote', outCsv);

process.exit(0);
