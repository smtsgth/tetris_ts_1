const fs = require('fs');
const path = require('path');

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = arr.slice().sort((a,b)=>a-b);
  const m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
function mean(arr) { if (!arr || arr.length===0) return null; return arr.reduce((a,b)=>a+b,0)/arr.length; }

function analyzeKeyEvents(events) {
  if (!events || events.length === 0) return null;
  const kd = events.find(e => e.type === 'keydown');
  const das = events.find(e => e.type === 'das-fired');
  const move = events.find(e => e.type === 'move');
  const arrTimes = events.filter(e => e.type === 'arr-move').map(e => e.time).sort((a,b)=>a-b);
  const firstArr = arrTimes.length ? arrTimes[0] : null;
  const intervals = [];
  for (let i=1;i<arrTimes.length;i++) intervals.push(arrTimes[i]-arrTimes[i-1]);
  return {
    keydownTime: kd ? kd.time : null,
    immediateMoveTime: move ? move.time : null,
    dasFiredTime: das ? das.time : null,
    firstArrTime: firstArr,
    initialGap_ms: (kd && firstArr) ? +(firstArr - kd.time).toFixed(3) : null,
    dasFiredGap_ms: (kd && das) ? +(das.time - kd.time).toFixed(3) : null,
    arrCount: arrTimes.length,
    arrIntervals_ms: intervals.map(v=>+v.toFixed(3)),
    medianARR_ms: median(intervals) === null ? null : +median(intervals).toFixed(3),
    meanARR_ms: mean(intervals) === null ? null : +mean(intervals).toFixed(3)
  };
}

function analyzeSoftDrop(obj) {
  if (!obj || !obj.logs) return null;
  const events = obj.logs;
  const kd = events.find(e => e.type === 'keydown');
  const times = events.filter(e => e.type === 'softdrop').map(e=>e.time).sort((a,b)=>a-b);
  const first = times.length ? times[0] : null;
  const intervals = [];
  for (let i=1;i<times.length;i++) intervals.push(times[i]-times[i-1]);
  return {
    keydownTime: kd ? kd.time : null,
    firstSoft_ms: (kd && first) ? +(first - kd.time).toFixed(3) : null,
    softCount: times.length,
    softIntervals_ms: intervals.map(v=>+v.toFixed(3)),
    medianSoft_ms: median(intervals) === null ? null : +median(intervals).toFixed(3),
    meanSoft_ms: mean(intervals) === null ? null : +mean(intervals).toFixed(3),
    scoreDelta: typeof obj.scoreDelta === 'number' ? obj.scoreDelta : null
  };
}

function analyzeFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  return {
    left: analyzeKeyEvents(data.left),
    right: analyzeKeyEvents(data.right),
    down: analyzeSoftDrop(data.down)
  };
}

function main() {
  const inputs = ['recordings/timestamps_fast.json','recordings/timestamps_slow.json'];
  const out = {};
  for (const p of inputs) {
    if (!fs.existsSync(p)) { console.warn('Missing', p); continue; }
    const name = path.basename(p).includes('fast') ? 'fast' : 'slow';
    out[name] = analyzeFile(p);
  }
  fs.writeFileSync('recordings/analysis_timestamps.json', JSON.stringify(out, null, 2));
  console.log('Wrote recordings/analysis_timestamps.json');
  console.log(JSON.stringify(out, null, 2));
}

main();
