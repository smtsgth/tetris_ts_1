const fs = require('fs');
const path = require('path');

// bootstrap reps can be overridden via env `BOOTSTRAP_REPS` or first CLI arg
// default increased to 10000 for more stable CI estimates
const _bs = parseInt(process.env.BOOTSTRAP_REPS || process.argv[2] || '10000', 10);
const BOOTSTRAP_REPS = Number.isFinite(_bs) && _bs > 0 ? _bs : 5000;
console.log('Bootstrap reps:', BOOTSTRAP_REPS);

function mean(arr){ if(!arr||arr.length===0) return null; return arr.reduce((a,b)=>a+b,0)/arr.length; }
function median(arr){ if(!arr||arr.length===0) return null; const s=arr.slice().sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2? s[m] : (s[m-1]+s[m])/2; }
function stddev(arr){ if(!arr||arr.length<2) return 0; const m=mean(arr); return Math.sqrt(arr.reduce((a,b)=>a+(b-m)*(b-m),0)/(arr.length-1)); }

// bootstrap percentile CI for the mean (robust for small samples)
function bootstrap_ci_for_mean(arr, reps){
  const n = (arr||[]).length;
  if (!n) return null;
  reps = reps || BOOTSTRAP_REPS;
  const means = new Array(reps);
  for (let i=0;i<reps;i++){
    let s = 0;
    for (let j=0;j<n;j++){ const idx = Math.floor(Math.random()*n); s += arr[idx]; }
    means[i] = s / n;
  }
  means.sort((a,b)=>a-b);
  const lowIdx = Math.floor(reps * 0.025);
  const highIdx = Math.ceil(reps * 0.975) - 1;
  const low = means[Math.max(0, Math.min(reps-1, lowIdx))];
  const high = means[Math.max(0, Math.min(reps-1, highIdx))];
  const m = mean(arr);
  const sd = stddev(arr);
  return { low: +low.toFixed(4), high: +high.toFixed(4), mean: +m.toFixed(4), std: +sd.toFixed(4), n };
}

// CI: use bootstrap for small-to-moderate samples, normal approx for very large samples
function ci95_for_mean(arr){ const m = mean(arr); if (m===null) return null; const n = arr.length || 0; if (n < 500) return bootstrap_ci_for_mean(arr, 2000); const sd = stddev(arr); const se = sd / Math.sqrt(n||1); const margin = 1.96 * se; return { low: +(m - margin).toFixed(4), high: +(m + margin).toFixed(4), mean: +m.toFixed(4), std: +sd.toFixed(4), n }; }

function analyzeKeyEvents(events){
  if(!events || !Array.isArray(events)) return null;
  const kd = events.find(e=>e.type==='keydown');
  const arrTimes = events.filter(e=>e.type==='arr-move').map(e=>e.time).sort((a,b)=>a-b);
  const first = arrTimes.length?arrTimes[0]:null;
  const intervals = [];
  for(let i=1;i<arrTimes.length;i++) intervals.push(+(arrTimes[i]-arrTimes[i-1]));
  return {
    keydownTime: kd? kd.time : null,
    firstArrTime: first,
    initialGap_ms: (kd && first) ? +(first - kd.time).toFixed(4) : null,
    arrIntervals_ms: intervals,
    medianARR_ms: intervals.length? +median(intervals).toFixed(4) : null,
    meanARR_ms: intervals.length? +mean(intervals).toFixed(4) : null
  };
}

function analyzeSoft(obj){
  if(!obj || !obj.logs) return null;
  const events = obj.logs;
  const kd = events.find(e=>e.type==='keydown');
  const times = events.filter(e=>e.type==='softdrop').map(e=>e.time).sort((a,b)=>a-b);
  const first = times.length?times[0]:null;
  const intervals = [];
  for(let i=1;i<times.length;i++) intervals.push(+(times[i]-times[i-1]));
  return {
    keydownTime: kd? kd.time : null,
    firstSoft_ms: (kd && first) ? +(first - kd.time).toFixed(4) : null,
    softIntervals_ms: intervals,
    medianSoft_ms: intervals.length? +median(intervals).toFixed(4) : null,
    meanSoft_ms: intervals.length? +mean(intervals).toFixed(4) : null,
    softCount: times.length
  };
}

function gatherFiles(){
  const dir = path.join(process.cwd(),'recordings');
  if(!fs.existsSync(dir)) throw new Error('recordings folder not found');
  const files = fs.readdirSync(dir).filter(f=>/^timestamps_(fast|slow)_run\d+\.json$/i.test(f)).sort();
  return files.map(f=>path.join(dir,f));
}

function analyzeFileRaw(raw){
  return {
    left: analyzeKeyEvents(raw.left || []),
    right: analyzeKeyEvents(raw.right || []),
    down: analyzeSoft(raw.down || {})
  };
}

function numericFilter(arr){ return (arr||[]).filter(v=>typeof v==='number' && isFinite(v)); }

function summarizeRuns(runs){
  const numeric = numericFilter(runs);
  return {
    n: numeric.length,
    mean: numeric.length? +mean(numeric).toFixed(4) : null,
    median: numeric.length? +median(numeric).toFixed(4) : null,
    std: numeric.length? +stddev(numeric).toFixed(4) : null,
    ci95: numeric.length? ci95_for_mean(numeric) : null,
    values: numeric
  };
}

function main(){
  const files = gatherFiles();
  if(files.length===0){ console.warn('no per-run timestamp files found'); return; }
  const agg = { fast: { left: {}, right: {}, down: {} }, slow: { left: {}, right: {}, down: {} } };
  const perVariant = { fast: [], slow: [] };

  for(const fp of files){
    const name = path.basename(fp);
    const variant = /fast/i.test(name)? 'fast' : /slow/i.test(name)? 'slow' : 'other';
    try{
      const raw = JSON.parse(fs.readFileSync(fp,'utf8'));
      const a = analyzeFileRaw(raw);
      perVariant[variant].push({ file: name, analysis: a });
    }catch(e){ console.warn('failed to parse', fp, e.message); }
  }

  for(const v of ['fast','slow']){
    const runs = perVariant[v];
    const leftInitials = [], leftMedianARRs = [], leftPooledARRs = [];
    const rightInitials = [], rightMedianARRs = [], rightPooledARRs = [];
    const softMedians = [], softPooled = [];
    for(const r of runs){
      const la = r.analysis.left;
      if(la){ if(la.initialGap_ms!==null) leftInitials.push(la.initialGap_ms); if(Array.isArray(la.arrIntervals_ms)) leftPooledARRs.push(...la.arrIntervals_ms); if(la.medianARR_ms!==null) leftMedianARRs.push(la.medianARR_ms); }
      const ra = r.analysis.right;
      if(ra){ if(ra.initialGap_ms!==null) rightInitials.push(ra.initialGap_ms); if(Array.isArray(ra.arrIntervals_ms)) rightPooledARRs.push(...ra.arrIntervals_ms); if(ra.medianARR_ms!==null) rightMedianARRs.push(ra.medianARR_ms); }
      const d = r.analysis.down;
      if(d){ if(d.medianSoft_ms!==null) softMedians.push(d.medianSoft_ms); if(Array.isArray(d.softIntervals_ms)) softPooled.push(...d.softIntervals_ms); }
    }

      // combined (left + right) initial gaps
      const combinedInitials = leftInitials.concat(rightInitials);

    agg[v].left = {
      runs: runs.map(r=>r.file),
      initialGaps_ms: leftInitials,
      initialGaps_summary: summarizeRuns(leftInitials),
      medianARRs_ms: leftMedianARRs,
      medianARRs_summary: summarizeRuns(leftMedianARRs),
      pooledARRIntervals_ms: leftPooledARRs,
      pooledARR_summary: summarizeRuns(leftPooledARRs)
    };

    agg[v].right = {
      runs: runs.map(r=>r.file),
      initialGaps_ms: rightInitials,
      initialGaps_summary: summarizeRuns(rightInitials),
      medianARRs_ms: rightMedianARRs,
      medianARRs_summary: summarizeRuns(rightMedianARRs),
      pooledARRIntervals_ms: rightPooledARRs,
      pooledARR_summary: summarizeRuns(rightPooledARRs)
    };

    // also provide combined initial gaps summary (left+right pooled)
    agg[v].initialCombined = {
      runs: runs.map(r=>r.file),
      initialGaps_ms: combinedInitials,
      initialGaps_summary: summarizeRuns(combinedInitials)
    };

    agg[v].down = {
      runs: runs.map(r=>r.file),
      medianSofts_ms: softMedians,
      medianSofts_summary: summarizeRuns(softMedians),
      pooledSoftIntervals_ms: softPooled,
      pooledSoft_summary: summarizeRuns(softPooled)
    };
  }

  const outPath = path.join(process.cwd(),'recordings','analysis_aggregated.json');
  fs.writeFileSync(outPath, JSON.stringify(agg, null, 2), 'utf8');
  console.log('Wrote', outPath);
}

main();
