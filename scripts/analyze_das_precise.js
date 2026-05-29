const fs = require("fs");

function analyze(filePath, sampleInterval) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  function analyzeSide(arr) {
    const xs = arr.map((s) => (s && s.current ? s.current.x : null));
    const changes = [];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] !== xs[i - 1]) changes.push(i);
    }
    const moveCount = changes.length;
    const gaps = [];
    for (let i = 1; i < changes.length; i++)
      gaps.push((changes[i] - changes[i - 1]) * sampleInterval);
    const initialGap = gaps.length > 0 ? gaps[0] : null;
    let medianARR = null;
    if (gaps.length > 0) {
      const sorted = gaps.slice().sort((a, b) => a - b);
      medianARR = sorted[Math.floor(sorted.length / 2)];
    }
    return { moveCount, changes, initialGap, medianARR };
  }

  const left = analyzeSide(data.left);
  const right = analyzeSide(data.right);
  const downScore = data.scoreDelta || 0;
  return { left, right, downScore };
}

const preciseFast = analyze("recordings/das_precise_fast.json", 20);
const preciseSlow = analyze("recordings/das_precise_slow.json", 20);

console.log(JSON.stringify({ preciseFast, preciseSlow }, null, 2));
