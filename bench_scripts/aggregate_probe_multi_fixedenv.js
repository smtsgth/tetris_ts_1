const fs = require('fs');
const path = 'bench_results';
const re = /^tuned_250ms_pool4_probe(\d+)_run(\d+)-report\.json$/;
const files = fs.readdirSync(path).filter(f=>re.test(f));
const groups = {};
for (const f of files) {
  const m = f.match(re);
  if (!m) continue;
  const rounds = m[1];
  if (!groups[rounds]) groups[rounds] = [];
  groups[rounds].push(f);
}
for (const rounds of Object.keys(groups).sort((a,b)=>parseInt(a)-parseInt(b))) {
  const fns = groups[rounds].sort((a,b)=>{
    const ai = parseInt(a.match(re)[2],10);
    const bi = parseInt(b.match(re)[2],10);
    return ai - bi;
  });
  const means = fns.map(f=>{
    try { const j = JSON.parse(fs.readFileSync(path+'/'+f,'utf8')); return Number(j.meanOfMeans || j.mean || 0); } catch(e) { return null; }
  }).filter(v=>v!=null);
  const sum = means.reduce((a,b)=>a+b,0);
  const mean = means.length? sum/means.length : 0;
  const sorted = means.slice().sort((a,b)=>a-b);
  const median = sorted.length? (sorted.length%2? sorted[(sorted.length-1)/2] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2) : 0;
  const idx90 = Math.max(0, Math.min(sorted.length-1, Math.ceil(sorted.length*0.9)-1));
  const p90 = sorted.length? sorted[idx90] : 0;
  const out = { rounds: Number(rounds), files: fns, count: means.length, meanOfMeans: mean, medianOfMeans: median, p90OfMeans: p90, means };
  fs.writeFileSync(path+`/tuned_250ms_pool4_probe${rounds}-fixedenv-all-report.json`, JSON.stringify(out, null, 2));
  console.log('wrote', path+`/tuned_250ms_pool4_probe${rounds}-fixedenv-all-report.json`);
  console.log(JSON.stringify(out, null, 2));
}
