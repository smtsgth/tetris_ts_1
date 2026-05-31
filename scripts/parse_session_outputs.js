const fs = require("fs");

const files = [
  "c:\\Users\\User\\AppData\\Roaming\\Code\\User\\workspaceStorage\\45740db47da2375f2c83af64a137dc1c\\GitHub.copilot-chat\\chat-session-resources\\7d945221-5f6c-499c-938d-5964948e53ad\\call_FdlAf0Uf3gzLLwfijKCc7qEc__vscode-1778758742660\\content.txt",
  "c:\\Users\\User\\AppData\\Roaming\\Code\\User\\workspaceStorage\\45740db47da2375f2c83af64a137dc1c\\GitHub.copilot-chat\\chat-session-resources\\7d945221-5f6c-499c-938d-5964948e53ad\\call_wkbDRnowrok4JuAv9Lb7LIwF__vscode-1778758742657\\content.txt",
];

function parseFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { file: filePath, error: "missing" };
  }
  const s = fs.readFileSync(filePath, "utf8");
  const lines = s.split(/\r?\n/);

  const isoRegex = /^\[([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z)\]/;
  const anomalyRegex =
    /\[([^\]]+)\]\s+\(console\)\s+\[warning\]\s+Lock anomaly detected\s+{ts:\s*([0-9]+),\s*type:\s*([^,}]+),\s*piece:\s*([A-Z]+),\s*beforeFilled:\s*([0-9]+),\s*afterFilled:\s*([0-9]+)}/i;
  const snapshotRegex =
    /Stats:\s*total=(\d+),\s*anomalies=(\d+),\s*last=(\d+)/i;

  const isoTimes = [];
  const anomalies = [];
  let snapshot = null;

  for (const line of lines) {
    const mIso = isoRegex.exec(line);
    if (mIso) {
      const t = Date.parse(mIso[1]);
      if (!isNaN(t)) isoTimes.push(t);
    }
    const m = anomalyRegex.exec(line);
    if (m) {
      anomalies.push({
        iso: m[1],
        ts: Number(m[2]),
        type: m[3].trim(),
        piece: m[4],
        before: Number(m[5]),
        after: Number(m[6]),
      });
    }
    const ms = snapshotRegex.exec(line);
    if (ms) {
      snapshot = {
        total: Number(ms[1]),
        anomalies: Number(ms[2]),
        last: Number(ms[3]),
      };
    }
  }

  const earliest = isoTimes.length
    ? Math.min(...isoTimes)
    : anomalies.length
      ? anomalies[0].ts
      : null;
  const latest = isoTimes.length
    ? Math.max(...isoTimes)
    : anomalies.length
      ? anomalies[anomalies.length - 1].ts
      : null;
  let durationSec = null;
  if (earliest && latest) {
    durationSec = (latest - earliest) / 1000;
    if (durationSec <= 0) durationSec = null;
  } else if (earliest && snapshot && snapshot.last) {
    durationSec = (snapshot.last - earliest) / 1000;
  }

  const pieceCounts = {};
  for (const a of anomalies)
    pieceCounts[a.piece] = (pieceCounts[a.piece] || 0) + 1;

  const totalEvents = snapshot ? snapshot.total : null;
  const snapshotAnom = snapshot ? snapshot.anomalies : null;

  const eventsPerSec =
    durationSec && totalEvents ? totalEvents / durationSec : null;
  const anomaliesPerSec =
    durationSec && snapshotAnom ? snapshotAnom / durationSec : null;
  const anomalyRatio =
    totalEvents && snapshotAnom ? (snapshotAnom / totalEvents) * 100 : null;

  const topPieces = Object.entries(pieceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    file: filePath,
    durationSec,
    countedAnomalies: anomalies.length,
    snapshotTotal: totalEvents,
    snapshotAnomalies: snapshotAnom,
    eventsPerSec,
    anomaliesPerSec,
    anomalyRatio,
    topPieces,
  };
}

const results = files.map(parseFile);
const out = { timestamp: Date.now(), results };
console.log(JSON.stringify(out, null, 2));
try {
  fs.writeFileSync(
    "scripts/session_analysis.json",
    JSON.stringify(out, null, 2),
  );
} catch (e) {
  /* ignore */
}
