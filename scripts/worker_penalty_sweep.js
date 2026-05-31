const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const workerPath = path.join(__dirname, "..", "worker_planner.js");
const recordingsDir = path.join(__dirname, "..", "recordings");
if (!fs.existsSync(recordingsDir))
  fs.mkdirSync(recordingsDir, { recursive: true });

const penalties = process.argv[2]
  ? process.argv[2].split(",").map((x) => Number(x))
  : [80, 160, 320, 640];
const duration = parseInt(process.argv[3] || "4000", 10);
const repeats = parseInt(process.argv[4] || "5", 10);
// params to pass to capture runs (tune as needed)
const params = {
  DEBOUNCE_MS: 200,
  DEBOUNCE_HOLD_MS: 800,
  MAX_INTERMEDIATE_APPLIES_PER_REQ: 1,
};

function runCapture(duration, params) {
  const cmd = `node scripts/capture_one_run.js ${duration} '${JSON.stringify(params)}'`;
  const out = cp.execSync(cmd, { stdio: "pipe" }).toString();
  const m = out.match(/Saved capture to (.+\.json)/);
  if (!m) throw new Error("No capture file in output:\n" + out);
  const saved = m[1].trim();
  const raw = fs.readFileSync(saved, "utf8");
  const json = JSON.parse(raw);
  const logs = Array.isArray(json.logs)
    ? json.logs
    : Array.isArray(json.log)
      ? json.log
      : [];
  const applyCount = logs.filter(
    (l) => typeof l === "string" && l.indexOf("apply plan sig") !== -1,
  ).length;
  const holdCount = logs.filter(
    (l) => typeof l === "string" && l.indexOf("action:hold") !== -1,
  ).length;
  const skipDup = logs.filter(
    (l) => typeof l === "string" && l.indexOf("skipping duplicate") !== -1,
  ).length;
  return { saved, applyCount, holdCount, skipDup };
}

function replaceHoldPenalty(content, newVal) {
  return content.replace(
    /HOLD_PENALTY\s*=\s*\d+\s*;/,
    `HOLD_PENALTY = ${newVal};`,
  );
}

(async function () {
  const original = fs.readFileSync(workerPath, "utf8");
  const backupPath = workerPath + ".bak." + Date.now();
  fs.writeFileSync(backupPath, original, "utf8");
  console.log("Backed up original to", backupPath);

  const summary = {
    timestamp: Date.now(),
    duration,
    repeats,
    params,
    penalties: [],
  };
  try {
    for (const pen of penalties) {
      console.log("Applying HOLD_PENALTY =", pen);
      const patched = replaceHoldPenalty(original, pen);
      fs.writeFileSync(workerPath, patched, "utf8");
      // run repeats
      const runs = [];
      for (let i = 0; i < repeats; i++) {
        try {
          console.log(`Run ${i + 1}/${repeats} (penalty=${pen})`);
          const res = runCapture(duration, params);
          runs.push(res);
        } catch (err) {
          console.error("capture failed:", err && err.message);
          runs.push({ error: err && String(err) });
        }
      }
      const totals = runs.reduce(
        (acc, r) => {
          if (r && r.applyCount != null) {
            acc.apply += r.applyCount;
            acc.hold += r.holdCount;
            acc.skipped += r.skipDup;
            acc.success += 1;
          } else acc.fail += 1;
          return acc;
        },
        { apply: 0, hold: 0, skipped: 0, success: 0, fail: 0 },
      );
      summary.penalties.push({ penalty: pen, runs, totals });
    }
  } finally {
    // restore original
    fs.writeFileSync(workerPath, original, "utf8");
    console.log("Restored original worker_planner.js");
  }

  const outPath = path.join(
    recordingsDir,
    `worker_penalty_sweep_${Date.now()}.json`,
  );
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  console.log("Sweep complete. Summary saved to", outPath);
})();
