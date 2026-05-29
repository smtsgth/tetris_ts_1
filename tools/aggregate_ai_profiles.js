const fs = require("fs");
const path = require("path");

function mode(arr) {
  const counts = Object.create(null);
  let max = 0,
    best = null;
  for (const v of arr) {
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > max) {
      max = counts[v];
      best = v;
    }
  }
  return best === null ? null : isFinite(best) ? Number(best) : best;
}

function median(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function collectNumeric(pathParts, out, value) {
  let cur = out;
  for (let i = 0; i < pathParts.length; i++) {
    const p = pathParts[i];
    if (i === pathParts.length - 1) {
      cur[p] = cur[p] || [];
      cur[p].push(value);
    } else {
      cur[p] = cur[p] || {};
      cur = cur[p];
    }
  }
}

function main() {
  const recordingsDir = path.resolve(process.cwd(), "recordings");
  if (!fs.existsSync(recordingsDir)) {
    console.error("recordings ディレクトリが見つかりません:", recordingsDir);
    process.exit(2);
  }

  const files = fs
    .readdirSync(recordingsDir)
    .filter((f) => /^ai_profiles_analysis_.*\.json$/.test(f));
  if (!files.length) {
    console.error("対象ファイルが見つかりません。");
    process.exit(1);
  }

  const suggestionsMap = Object.create(null);
  const numericAgg = {};
  let processed = 0;

  for (const f of files) {
    const fp = path.join(recordingsDir, f);
    try {
      const raw = fs.readFileSync(fp, "utf8");
      const data = JSON.parse(raw);
      processed++;

      if (Array.isArray(data.suggestions)) {
        for (const s of data.suggestions) {
          const key = s.key || s.name || String(s.k || "_unknown");
          if (s.recommended === undefined) continue;
          suggestionsMap[key] = suggestionsMap[key] || {
            values: [],
            reasons: [],
          };
          const rec = safeNumber(s.recommended);
          suggestionsMap[key].values.push(rec !== null ? rec : s.recommended);
          if (s.reason) suggestionsMap[key].reasons.push(s.reason);
        }
      }

      if (data.numericStats && data.numericStats.derivedTotalTimeMs) {
        const d = data.numericStats.derivedTotalTimeMs;
        for (const k of ["mean", "p90", "p95", "p99", "median"]) {
          if (d[k] !== undefined) {
            const n = safeNumber(d[k]);
            if (n !== null)
              collectNumeric(["derivedTotalTimeMs", k], numericAgg, n);
          }
        }
      }

      if (data.numericStats && data.numericStats.perfTs) {
        const p = data.numericStats.perfTs;
        for (const k of ["mean", "p90", "p95", "p99", "median"]) {
          if (p[k] !== undefined) {
            const n = safeNumber(p[k]);
            if (n !== null) collectNumeric(["perfTs", k], numericAgg, n);
          }
        }
      }
    } catch (err) {
      console.error("パース失敗:", f, err && err.message);
    }
  }

  const recommendations = {};
  for (const key of Object.keys(suggestionsMap)) {
    const arr = suggestionsMap[key].values
      .map((v) => safeNumber(v))
      .filter((v) => v !== null);
    const modeV = arr.length ? mode(arr) : null;
    const med = arr.length ? median(arr) : null;
    const mean = arr.length
      ? arr.reduce((a, b) => a + b, 0) / arr.length
      : null;
    recommendations[key] = {
      count: suggestionsMap[key].values.length,
      mode: modeV,
      median: med,
      mean,
    };
  }

  const numericSummary = {};
  for (const statKey of Object.keys(numericAgg)) {
    numericSummary[statKey] = {};
    for (const metric of Object.keys(numericAgg[statKey])) {
      const arr = numericAgg[statKey][metric];
      numericSummary[statKey][metric] = {
        count: arr.length,
        mean: arr.reduce((a, b) => a + b, 0) / arr.length,
        median: median(arr),
        mode: mode(arr),
      };
    }
  }

  const out = {
    filesProcessed: processed,
    recommendations,
    suggestionsRaw: suggestionsMap,
    numericSummary,
    generatedAt: new Date().toISOString(),
  };

  const outJsonPath = path.resolve(
    process.cwd(),
    "docs",
    "ai_profiles_aggregate.json",
  );
  const outMdPath = path.resolve(
    process.cwd(),
    "docs",
    "ai_profiles_recommendations.md",
  );

  fs.writeFileSync(outJsonPath, JSON.stringify(out, null, 2), "utf8");

  let md = `# AI Profiles Aggregation\r\n\r\nFiles processed: ${processed}\r\nGenerated: ${out.generatedAt}\r\n\r\n## Recommendations\r\n\r\n`;
  for (const k of Object.keys(recommendations)) {
    const r = recommendations[k];
    md += `- **${k}** — count=${r.count}, mode=${r.mode}, median=${r.median}, mean=${r.mean}\r\n`;
  }

  md += `\r\n## Numeric summaries (selected)\r\n\r\n`;
  for (const sKey of Object.keys(numericSummary)) {
    md += `### ${sKey}\r\n`;
    for (const m of Object.keys(numericSummary[sKey])) {
      const v = numericSummary[sKey][m];
      md += `- ${m}: count=${v.count}, mean=${v.mean.toFixed(2)}, median=${v.median}, mode=${v.mode}\r\n`;
    }
    md += "\r\n";
  }

  fs.writeFileSync(outMdPath, md, "utf8");

  console.log("集計完了");
  console.log("出力:", outJsonPath);
  console.log("サマリ:", outMdPath);
}

if (require.main === module) main();
