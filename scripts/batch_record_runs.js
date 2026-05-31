const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const runs = parseInt(process.argv[2]) || 5;
const recordingsDir = path.join(process.cwd(), "recordings");
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir);

function sleep(ms) {
  const t = Date.now();
  while (Date.now() - t < ms);
}

for (let i = 1; i <= runs; i++) {
  const id = String(i).padStart(3, "0");
  console.log(`=== Batch run ${i}/${runs} ===`);
  const res = cp.spawnSync("node", ["scripts/record_das_timestamps.js"], {
    stdio: "inherit",
    shell: true,
  });
  if (res.error || res.status !== 0) {
    console.error(
      "record_das_timestamps.js failed",
      res.error || "exit " + res.status,
    );
    process.exit(2);
  }

  // rename generated JSONs
  const variants = ["fast", "slow"];
  for (const v of variants) {
    const src = path.join(recordingsDir, `timestamps_${v}.json`);
    if (fs.existsSync(src)) {
      const dst = path.join(recordingsDir, `timestamps_${v}_run${id}.json`);
      fs.renameSync(src, dst);
      console.log("Saved", dst);
    } else {
      console.warn("Missing", src);
    }
  }

  // rename screenshots if present
  const imgs = [
    `left_ts_fast.png`,
    `right_ts_fast.png`,
    `down_ts_fast.png`,
    `left_ts_slow.png`,
    `right_ts_slow.png`,
    `down_ts_slow.png`,
  ];
  for (const im of imgs) {
    const src = path.join(recordingsDir, im);
    if (fs.existsSync(src)) {
      const dst = path.join(recordingsDir, im.replace(".png", `_run${id}.png`));
      fs.renameSync(src, dst);
    }
  }

  // small pause between runs
  sleep(400);
}

console.log("Batch recording complete");
