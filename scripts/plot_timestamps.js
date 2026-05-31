const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const puppeteer = require("puppeteer");

// Configuration via environment variables (timeouts, retries, debug)
const PLOT_WAIT_CHARTSREADY_MS = parseInt(
  process.env.PLOT_WAIT_CHARTSREADY_MS || "20000",
  10,
);
const PLOT_WAIT_CHART_AVAILABLE_MS = parseInt(
  process.env.PLOT_WAIT_CHART_AVAILABLE_MS || "10000",
  10,
);
const PLOT_ADD_SCRIPT_TIMEOUT_BASE_MS = parseInt(
  process.env.PLOT_ADD_SCRIPT_TIMEOUT_BASE_MS || "10000",
  10,
);
const PLOT_ADD_SCRIPT_ATTEMPT_BACKOFF_MS = parseInt(
  process.env.PLOT_ADD_SCRIPT_ATTEMPT_BACKOFF_MS || "5000",
  10,
);
const PLOT_CDN_ATTEMPTS = parseInt(process.env.PLOT_CDN_ATTEMPTS || "2", 10);
const PLOT_WAIT_SELECTOR_MS = parseInt(
  process.env.PLOT_WAIT_SELECTOR_MS || "5000",
  10,
);
const PLOT_CANVAS_RETRIES = parseInt(
  process.env.PLOT_CANVAS_RETRIES || "4",
  10,
);
const PLOT_CANVAS_RETRY_BASE_MS = parseInt(
  process.env.PLOT_CANVAS_RETRY_BASE_MS || "500",
  10,
);
const PLOT_SAVE_DEBUG = (process.env.PLOT_SAVE_DEBUG || "1") !== "0";

function collect() {
  const dir = path.join(process.cwd(), "recordings");
  if (!fs.existsSync(dir)) throw new Error("recordings directory not found");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.match(/^timestamps_.*\.json$/));
  if (files.length === 0)
    throw new Error("no timestamps_*.json files found in recordings/");

  const out = {};
  for (const file of files) {
    const variant = file.includes("fast")
      ? "fast"
      : file.includes("slow")
        ? "slow"
        : file.replace(/[^a-z0-9_]/gi, "");
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    out[variant] = out[variant] || {
      leftInitials: [],
      rightInitials: [],
      leftARRs: [],
      rightARRs: [],
      softIntervals: [],
    };

    function analyzeSide(events) {
      const kd =
        events && events.find ? events.find((e) => e.type === "keydown") : null;
      const arrTimes = (events || [])
        .filter((e) => e.type === "arr-move")
        .map((e) => e.time)
        .sort((a, b) => a - b);
      const first = arrTimes.length ? arrTimes[0] : null;
      const intervals = [];
      for (let i = 1; i < arrTimes.length; i++)
        intervals.push(arrTimes[i] - arrTimes[i - 1]);
      return { kd, first, intervals };
    }

    if (raw.left) {
      const a = analyzeSide(raw.left);
      if (a.first !== null && a.kd)
        out[variant].leftInitials.push(a.first - a.kd.time);
      out[variant].leftARRs.push(...a.intervals);
    }
    if (raw.right) {
      const a = analyzeSide(raw.right);
      if (a.first !== null && a.kd)
        out[variant].rightInitials.push(a.first - a.kd.time);
      out[variant].rightARRs.push(...a.intervals);
    }
    if (raw.down && raw.down.logs) {
      const logs = raw.down.logs;
      const times = logs
        .filter((e) => e.type === "softdrop")
        .map((e) => e.time)
        .sort((a, b) => a - b);
      const intervals = [];
      for (let i = 1; i < times.length; i++)
        intervals.push(times[i] - times[i - 1]);
      out[variant].softIntervals.push(...intervals);
    }
  }

  return out;
}

function writeHTML(data) {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Improved Timestamps Plots</title>
  <style>body{font-family:Arial;margin:8px} .chart-wrap{width:900px;margin:20px auto} canvas{background:#fff;border:1px solid #ddd}</style>
</head>
<body>
  <h2>Improved Timestamps Histograms + KDE</h2>
  <div id="charts"></div>
</body>
</html>`;

  fs.writeFileSync(
    path.join(process.cwd(), "recordings", "plot.html"),
    html,
    "utf8",
  );
}

async function renderScreenshots(data, aggregated) {
  const fileUrl = pathToFileURL(path.resolve("recordings", "plot.html")).href;
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  // render at higher resolution for nicer PNGs
  try {
    await page.setViewport({ width: 1400, height: 1600, deviceScaleFactor: 2 });
  } catch (e) {
    /* ignore */
  }
  page.on("console", (msg) => {
    try {
      console.log("PAGE:", msg.text());
    } catch (e) {}
  });
  // network/request diagnostics
  page.on("requestfailed", (req) => {
    try {
      console.warn(
        "PAGE REQUEST FAILED",
        req.url(),
        req.failure && req.failure().errorText,
      );
    } catch (e) {}
  });
  page.on("response", (res) => {
    try {
      const url = res.url();
      if (url && /chart\.umd|min\.js|chart\.js/.test(url)) {
        console.log("PAGE RESPONSE", res.status(), url);
      }
    } catch (e) {}
  });
  await page.goto(fileUrl, { waitUntil: "networkidle2" });
  // try to add Chart.js (CDN -> alternate CDN -> local fallback -> resolved path)
  let chartLoaded = false;
  const cdnCandidates = [
    "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js",
    "https://unpkg.com/chart.js@4.4.0/dist/chart.umd.min.js",
  ];
  const localDistPath = path.join(
    process.cwd(),
    "node_modules",
    "chart.js",
    "dist",
    "chart.umd.min.js",
  );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function tryAddScriptTag(opts, timeoutMs) {
    return Promise.race([
      page.addScriptTag(opts),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("addScriptTag timeout")), timeoutMs),
      ),
    ]);
  }

  // try CDN candidates with a couple retries
  for (const url of cdnCandidates) {
    for (let attempt = 0; attempt < PLOT_CDN_ATTEMPTS; attempt++) {
      try {
        await tryAddScriptTag(
          { url },
          PLOT_ADD_SCRIPT_TIMEOUT_BASE_MS +
            attempt * PLOT_ADD_SCRIPT_ATTEMPT_BACKOFF_MS,
        );
        chartLoaded = true;
        console.log("PAGE: Chart.js loaded from", url);
        break;
      } catch (e) {
        console.warn(
          "Chart.js CDN attempt failed for",
          url,
          "attempt",
          attempt,
          e && e.message ? e.message : e,
        );
        await sleep(500 + attempt * 500);
      }
    }
    if (chartLoaded) break;
  }

  // try local installed copy
  if (!chartLoaded) {
    try {
      if (fs.existsSync(localDistPath)) {
        await tryAddScriptTag(
          { path: localDistPath },
          PLOT_ADD_SCRIPT_TIMEOUT_BASE_MS,
        );
        chartLoaded = true;
        console.log("PAGE: Chart.js loaded from local node_modules");
      } else {
        try {
          const resolved = require.resolve("chart.js/dist/chart.umd.min.js");
          if (resolved && fs.existsSync(resolved)) {
            await tryAddScriptTag(
              { path: resolved },
              PLOT_ADD_SCRIPT_TIMEOUT_BASE_MS,
            );
            chartLoaded = true;
            console.log("PAGE: Chart.js loaded via require.resolve");
          }
        } catch (er) {
          // ignore
        }
      }
    } catch (e2) {
      console.warn(
        "Chart.js local load failed:",
        e2 && e2.message ? e2.message : e2,
      );
    }
  }

  // final check: ensure Chart is defined in page
  if (chartLoaded) {
    try {
      await page.waitForFunction('typeof Chart !== "undefined"', {
        timeout: PLOT_WAIT_CHART_AVAILABLE_MS,
      });
      console.log("PAGE: Chart object available");
    } catch (e) {
      console.warn(
        "Chart script loaded but Chart not available yet:",
        e && e.message ? e.message : e,
      );
      chartLoaded = false;
    }
  }

  // evaluate chart creation in page context, prefer fetching external plot_data.json from recordings/
  try {
    const dataFileUrl = pathToFileURL(
      path.resolve("recordings", "plot_data.json"),
    ).href;
    // expose a fallback payload in page context in case fetch(file://) is blocked by CORS
    try {
      await page.evaluate((d) => {
        try {
          window.__PLOT_FALLBACK__ = d;
        } catch (e) {}
      }, data);
    } catch (eex) {
      console.warn(
        "Failed to inject fallback plot data into page context:",
        eex && eex.message ? eex.message : eex,
      );
    }
    await page.evaluate(
      async (dataFileUrl, chartLoaded, aggregated) => {
        // try to load the external JSON file first (preferred)
        let data = null;
        try {
          const resp = await fetch(dataFileUrl);
          if (!resp.ok) throw new Error("fetch failed: " + resp.status);
          data = await resp.json();
        } catch (fetchErr) {
          try {
            console.warn(
              "fetch(plot_data.json) failed inside page:",
              String(fetchErr),
            );
          } catch (e) {}
          // No external JSON available from page context. Fall back to any pre-existing global if set.
          try {
            if (window.__PLOT_FALLBACK__) data = window.__PLOT_FALLBACK__;
          } catch (e) {}
        }
        if (!data) {
          window.chartsError = "plot data unavailable in page";
          window.chartsReady = true;
          return;
        }
        try {
          if (!chartLoaded || typeof Chart === "undefined") {
            window.chartsError = "Chart.js unavailable";
            window.chartsReady = true;
            return;
          }
          function stats(arr) {
            if (!arr || arr.length === 0) return null;
            const n = arr.length;
            const mean = arr.reduce((a, b) => a + b, 0) / n;
            const s = arr.slice().sort((a, b) => a - b);
            const mid = Math.floor(n / 2);
            const median = n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
            const sq = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0);
            const std = Math.sqrt(sq / (n - 1 || 1));
            return { n, mean, median, std };
          }
          function histogram(values, bins, lo, hi) {
            const v = (values || []).filter(
              (x) => typeof x === "number" && isFinite(x),
            );
            if (v.length === 0) return null;
            const min = lo !== undefined ? lo : Math.min(...v);
            const max = hi !== undefined ? hi : Math.max(...v);
            const pad = (max - min) * 0.05 || 1;
            const L = min - pad;
            const H = max + pad;
            const w = (H - L) / bins;
            const counts = Array.from({ length: bins }, () => 0);
            const centers = Array.from(
              { length: bins },
              (_, i) => L + i * w + w / 2,
            );
            for (const val of v) {
              const i = Math.min(
                bins - 1,
                Math.max(0, Math.floor((val - L) / w)),
              );
              counts[i]++;
            }
            return { counts, centers, binWidth: w, lo: L, hi: H, N: v.length };
          }
          function kdeEstimate(sample, xpts) {
            if (!sample || sample.length === 0) return xpts.map(() => 0);
            const n = sample.length;
            const mean = sample.reduce((a, b) => a + b, 0) / n;
            const sq = sample.reduce((a, b) => a + (b - mean) * (b - mean), 0);
            const std = Math.sqrt(sq / (n - 1 || 1));
            const h =
              std > 0
                ? 1.06 * std * Math.pow(n, -0.2)
                : (xpts[xpts.length - 1] - xpts[0]) / (Math.max(1, n) * 2);
            const invSqrt2pi = 1 / Math.sqrt(2 * Math.PI);
            return xpts.map((x) => {
              let sum = 0;
              for (const s of sample) {
                const u = (x - s) / h;
                sum += Math.exp(-0.5 * u * u) * invSqrt2pi;
              }
              return sum / (n * h);
            });
          }
          function makeCanvas(id, title) {
            const wrap = document.createElement("div");
            wrap.className = "chart-wrap";
            const h = document.createElement("h3");
            h.textContent = title;
            wrap.appendChild(h);
            const c = document.createElement("canvas");
            c.id = id;
            /* larger canvas for higher-res PNGs */ c.width = 1100;
            c.height = 480;
            try {
              c.style.width = c.width + "px";
              c.style.height = c.height + "px";
            } catch (e) {}
            wrap.appendChild(c);
            document.getElementById("charts").appendChild(wrap);
            return c;
          }

          // accessible, color-blind friendly palette and helper
          const PALETTE = [
            "#1b9e77",
            "#d95f02",
            "#7570b3",
            "#e7298a",
            "#66a61e",
            "#e6ab02",
            "#a6761d",
            "#666666",
          ];
          function hexToRgba(hex, a) {
            try {
              const bigint = parseInt(hex.replace("#", ""), 16);
              const r = (bigint >> 16) & 255;
              const g = (bigint >> 8) & 255;
              const b = bigint & 255;
              return "rgba(" + r + "," + g + "," + b + "," + a + ")";
            } catch (e) {
              return "rgba(0,0,0," + a + ")";
            }
          }

          function drawChartFor(sideTitle, getValsFunc, outIdPrefix, bins) {
            const variants = Object.keys(data);
            let combined = [];
            for (const v of variants)
              combined = combined.concat(getValsFunc(data[v]) || []);
            if (combined.length === 0) return;
            const min = Math.min(...combined);
            const max = Math.max(...combined);
            const histAll = histogram(combined, bins, min, max);

            const idInit = outIdPrefix + "-initial";
            const cInit = makeCanvas(
              idInit,
              sideTitle + " — initial gaps (keydown → first arr)",
            );
            const datasetsInit = [];
            for (let i = 0; i < variants.length; i++) {
              const v = variants[i];
              const vals = getValsFunc(data[v]) || [];
              const info = histogram(
                vals,
                histAll.counts.length,
                histAll.lo,
                histAll.hi,
              ) || {
                counts: Array.from({ length: histAll.counts.length }, () => 0),
                centers: histAll.centers,
                binWidth: histAll.binWidth,
                N: 0,
              };
              const counts = info.counts;
              const points = info.centers.map((c, j) => ({
                x: c,
                y: counts[j],
              }));
              const density = kdeEstimate(vals, info.centers);
              const scaledDensity = density.map(
                (d) => d * vals.length * info.binWidth,
              );
              const kdPoints = info.centers.map((c, j) => ({
                x: c,
                y: +scaledDensity[j].toFixed(3),
              }));
              const baseHex = PALETTE[i % PALETTE.length];
              const color = hexToRgba(baseHex, 0.6);
              const colorStrong = hexToRgba(baseHex, 1);
              const colorFill = hexToRgba(baseHex, 0.12);
              datasetsInit.push({
                type: "bar",
                label: v + " (hist) N=" + (vals.length || 0),
                data: points,
                backgroundColor: color,
                borderColor: colorStrong,
                borderWidth: 1,
              });
              datasetsInit.push({
                type: "line",
                label: v + " (KDE)",
                data: kdPoints,
                borderColor: colorStrong,
                backgroundColor: colorFill,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
              });
              const st = stats(vals);
              if (!cInit._markers) cInit._markers = [];
              if (!cInit._variantInfo) cInit._variantInfo = [];
              cInit._variantInfo.push({
                label: v,
                n: vals.length || 0,
                mean: st ? st.mean : null,
                median: st ? st.median : null,
                color: baseHex,
              });
              if (st)
                cInit._markers.push({
                  value: st.mean,
                  color: colorStrong,
                  label: v + " mean",
                });
              if (st)
                cInit._markers.push({
                  value: st.median,
                  color: colorStrong,
                  label: v + " median",
                  dash: [5, 5],
                });
            }

            // add aggregated markers / CI bands (if available)
            try {
              if (aggregated && typeof aggregated === "object") {
                cInit._ciBands = cInit._ciBands || [];
                cInit._markers = cInit._markers || [];
                for (let i2 = 0; i2 < variants.length; i2++) {
                  const vv = variants[i2];
                  const agg = aggregated[vv];
                  if (!agg) continue;

                  // combined initial gaps (left+right) -> draw as shaded CI band + mean marker
                  if (
                    agg.initialCombined &&
                    agg.initialCombined.initialGaps_summary
                  ) {
                    const a = agg.initialCombined.initialGaps_summary;
                    if (a.ci95) {
                      cInit._ciBands.push({
                        low: a.ci95.low,
                        high: a.ci95.high,
                        color: "rgba(0,0,0,0.08)",
                        label: vv + " agg combined CI",
                      });
                    }
                    if (a.mean !== undefined && a.mean !== null)
                      cInit._markers.push({
                        value: a.mean,
                        color: "#000",
                        label: vv + " agg combined mean",
                      });
                  }

                  // left/right aggregated means (keep as lines for reference) and optional per-side CI bands
                  if (agg.left && agg.left.initialGaps_summary) {
                    const a = agg.left.initialGaps_summary;
                    if (a.mean !== undefined && a.mean !== null)
                      cInit._markers.push({
                        value: a.mean,
                        color: "#000",
                        label: vv + " agg-left mean",
                      });
                    if (a.ci95)
                      cInit._ciBands.push({
                        low: a.ci95.low,
                        high: a.ci95.high,
                        color: "rgba(0,0,200,0.06)",
                        label: vv + " agg-left CI",
                      });
                  }
                  if (agg.right && agg.right.initialGaps_summary) {
                    const a = agg.right.initialGaps_summary;
                    if (a.mean !== undefined && a.mean !== null)
                      cInit._markers.push({
                        value: a.mean,
                        color: "#333",
                        label: vv + " agg-right mean",
                      });
                    if (a.ci95)
                      cInit._ciBands.push({
                        low: a.ci95.low,
                        high: a.ci95.high,
                        color: "rgba(200,0,0,0.06)",
                        label: vv + " agg-right CI",
                      });
                  }
                }
              }
            } catch (e) {
              /* ignore aggregated marker failures */
            }

            const chartInit = new Chart(cInit.getContext("2d"), {
              data: { datasets: datasetsInit },
              options: {
                responsive: false,
                scales: {
                  x: { type: "linear", title: { display: true, text: "ms" } },
                  y: { title: { display: true, text: "count" } },
                },
                plugins: {
                  legend: {
                    position: "top",
                    labels: { usePointStyle: true, boxWidth: 12, padding: 8 },
                  },
                  tooltip: {
                    callbacks: {
                      label: function (ctx) {
                        var raw = ctx.raw;
                        var val =
                          raw && raw.y !== undefined
                            ? raw.y
                            : typeof raw === "number"
                              ? raw
                              : raw && raw.x !== undefined
                                ? raw.x
                                : JSON.stringify(raw);
                        if (typeof val === "number")
                          val = Math.round(val * 100) / 100;
                        return (
                          (ctx.dataset && ctx.dataset.label
                            ? ctx.dataset.label + ": "
                            : "") + String(val)
                        );
                      },
                    },
                  },
                  title: {
                    display: true,
                    text: sideTitle + " — initial gaps (keydown → first arr)",
                    font: { size: 16 },
                  },
                },
                animation: false,
                interaction: { mode: "nearest", axis: "x", intersect: false },
              },
              plugins: [
                {
                  id: "vlines",
                  afterDraw(chart) {
                    const ctx = chart.ctx;
                    const canvas = chart.canvas;
                    const area = chart.chartArea;
                    const lo = histAll.lo;
                    const hi = histAll.hi;
                    const width = area.right - area.left;
                    const markers =
                      chart.canvas._markers || cInit._markers || [];
                    const bands = chart.canvas._ciBands || cInit._ciBands || [];

                    // draw CI bands first (so markers/lines are on top)
                    for (const b of bands) {
                      const lowX =
                        area.left + ((b.low - lo) / (hi - lo)) * width;
                      const highX =
                        area.left + ((b.high - lo) / (hi - lo)) * width;
                      ctx.save();
                      try {
                        ctx.fillStyle = b.color || "rgba(0,0,0,0.08)";
                        ctx.fillRect(
                          lowX,
                          area.top,
                          Math.max(0, highX - lowX),
                          area.bottom - area.top,
                        );
                        // draw a subtle border for the CI band to improve visibility
                        try {
                          ctx.strokeStyle =
                            b.color && b.color.replace
                              ? b.color.replace(
                                  /rgba\(([^,]+),([^,]+),([^,]+),([^\)]+)\)/,
                                  "rgba($1,$2,$3,0.25)",
                                )
                              : "rgba(0,0,0,0.12)";
                          ctx.lineWidth = 1;
                          ctx.strokeRect(
                            lowX,
                            area.top,
                            Math.max(0, highX - lowX),
                            area.bottom - area.top,
                          );
                        } catch (e) {}
                        if (b.label) {
                          ctx.fillStyle = "#000";
                          ctx.font = "12px sans-serif";
                          ctx.fillText(b.label, lowX + 4, area.top + 14);
                        }
                      } catch (e) {}
                      ctx.restore();
                    }

                    // draw per-variant key and stats at top-left for quick reference (with background)
                    try {
                      const variantInfo =
                        chart.canvas._variantInfo || cInit._variantInfo || [];
                      if (variantInfo && variantInfo.length) {
                        ctx.save();
                        ctx.font = "12px sans-serif";
                        // compute max width
                        let maxW = 0;
                        const rows = [];
                        for (const vi of variantInfo) {
                          const meanText =
                            vi.mean !== null && vi.mean !== undefined
                              ? " mean=" + Math.round(vi.mean * 100) / 100
                              : "";
                          const medianText =
                            vi.median !== null && vi.median !== undefined
                              ? " median=" + Math.round(vi.median * 100) / 100
                              : "";
                          const txt =
                            vi.label +
                            " N=" +
                            (vi.n || 0) +
                            meanText +
                            medianText;
                          rows.push({ txt: txt, color: vi.color || "#000" });
                          const w = ctx.measureText(txt).width;
                          if (w > maxW) maxW = w;
                        }
                        const vx = area.left + 8;
                        let vy = area.top + 8;
                        const bgW = 12 + 6 + maxW + 18;
                        const bgH = rows.length * 16 + 8;
                        // background box
                        ctx.fillStyle = "rgba(255,255,255,0.92)";
                        ctx.fillRect(vx - 6, vy - 6, bgW, bgH);
                        ctx.strokeStyle = "rgba(0,0,0,0.06)";
                        ctx.strokeRect(vx - 6, vy - 6, bgW, bgH);
                        // draw rows
                        for (const r of rows) {
                          try {
                            ctx.fillStyle = r.color || "#000";
                            ctx.fillRect(vx, vy, 12, 8);
                            ctx.fillStyle = "rgba(0,0,0,0.85)";
                            ctx.fillText(r.txt, vx + 18, vy + 8);
                          } catch (e) {}
                          vy += 16;
                        }
                        ctx.restore();
                      }
                    } catch (e) {}

                    // then draw vertical mean/marker lines
                    for (const m of markers) {
                      const x =
                        area.left + ((m.value - lo) / (hi - lo)) * width;
                      ctx.save();
                      ctx.beginPath();
                      ctx.strokeStyle = m.color || "#000";
                      ctx.lineWidth = 1.5;
                      if (m.dash) ctx.setLineDash(m.dash);
                      ctx.moveTo(x, area.top);
                      ctx.lineTo(x, area.bottom);
                      ctx.stroke();
                      ctx.setLineDash([]);
                      if (m.label) {
                        ctx.fillStyle = m.color || "#000";
                        ctx.font = "12px sans-serif";
                        ctx.fillText(m.label, x + 4, area.top + 14);
                      }
                      ctx.restore();
                    }
                    // draw sample size annotation
                    try {
                      ctx.save();
                      ctx.fillStyle = "rgba(0,0,0,0.6)";
                      ctx.font = "12px sans-serif";
                      const nText =
                        histAll && histAll.N ? "N=" + histAll.N : "";
                      if (nText)
                        ctx.fillText(nText, area.right - 60, area.top + 16);
                      ctx.restore();
                    } catch (e) {}
                  },
                },
              ],
            });

            const idArr = outIdPrefix + "-arr";
            const cArr = makeCanvas(idArr, sideTitle + " — ARR intervals");
            const datasetsArr = [];
            const arrAll = [].concat(
              ...variants.map((v) => data[v].leftARRs || []),
              ...variants.map((v) => data[v].rightARRs || []),
            );
            const histArrAll = histogram(arrAll, bins);
            for (let i = 0; i < variants.length; i++) {
              const v = variants[i];
              const left = data[v].leftARRs || [];
              const right = data[v].rightARRs || [];
              const vals = left.concat(right);
              const info = histogram(
                vals,
                histArrAll ? histArrAll.counts.length : bins,
              );
              if (!info) continue;
              const points = info.centers.map((c, j) => ({
                x: c,
                y: info.counts[j],
              }));
              const dens = kdeEstimate(vals, info.centers);
              const scaled = dens.map((d) => d * vals.length * info.binWidth);
              const kdPoints = info.centers.map((c, j) => ({
                x: c,
                y: +scaled[j].toFixed(3),
              }));
              const baseHexA = PALETTE[i % PALETTE.length];
              const colorA = hexToRgba(baseHexA, 0.6);
              const colorAStrong = hexToRgba(baseHexA, 1);
              const colorAFill = hexToRgba(baseHexA, 0.12);
              datasetsArr.push({
                type: "bar",
                label: v + " (hist) N=" + (vals.length || 0),
                data: points,
                backgroundColor: colorA,
                borderColor: colorAStrong,
                borderWidth: 1,
              });
              datasetsArr.push({
                type: "line",
                label: v + " (KDE)",
                data: kdPoints,
                borderColor: colorAStrong,
                backgroundColor: colorAFill,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
              });
              if (!cArr._variantInfo) cArr._variantInfo = [];
              const stA = stats(vals);
              cArr._variantInfo.push({
                label: v,
                n: vals.length || 0,
                mean: stA ? stA.mean : null,
                median: stA ? stA.median : null,
                color: baseHexA,
              });
            }
            const chartArr = new Chart(cArr.getContext("2d"), {
              data: { datasets: datasetsArr },
              options: {
                responsive: false,
                scales: {
                  x: { type: "linear", title: { display: true, text: "ms" } },
                  y: { title: { display: true, text: "count" } },
                },
                plugins: {
                  legend: {
                    position: "top",
                    labels: { usePointStyle: true, boxWidth: 12, padding: 8 },
                  },
                  tooltip: {
                    callbacks: {
                      label: function (ctx) {
                        var raw = ctx.raw;
                        var val =
                          raw && raw.y !== undefined
                            ? raw.y
                            : typeof raw === "number"
                              ? raw
                              : raw && raw.x !== undefined
                                ? raw.x
                                : JSON.stringify(raw);
                        if (typeof val === "number")
                          val = Math.round(val * 100) / 100;
                        return (
                          (ctx.dataset && ctx.dataset.label
                            ? ctx.dataset.label + ": "
                            : "") + String(val)
                        );
                      },
                    },
                  },
                  title: {
                    display: true,
                    text: sideTitle + " — ARR intervals",
                    font: { size: 16 },
                  },
                },
                animation: false,
                interaction: { mode: "nearest", axis: "x", intersect: false },
              },
              plugins: [
                {
                  id: "annot",
                  afterDraw(chart) {
                    try {
                      const ctx = chart.ctx;
                      const area = chart.chartArea;
                      ctx.save(); // draw per-variant info top-left
                      try {
                        const variantInfo =
                          chart.canvas._variantInfo || cArr._variantInfo || [];
                        if (variantInfo && variantInfo.length) {
                          ctx.font = "12px sans-serif";
                          let maxW = 0;
                          const rows = [];
                          for (const vi of variantInfo) {
                            const meanT =
                              vi.mean !== null && vi.mean !== undefined
                                ? " mean=" + Math.round(vi.mean * 100) / 100
                                : "";
                            const txt = vi.label + " N=" + (vi.n || 0) + meanT;
                            rows.push({ txt: txt, color: vi.color || "#000" });
                            const w = ctx.measureText(txt).width;
                            if (w > maxW) maxW = w;
                          }
                          const vx = area.left + 8;
                          let vy = area.top + 8;
                          const bgW = 12 + 6 + maxW + 18;
                          const bgH = rows.length * 16 + 8;
                          ctx.fillStyle = "rgba(255,255,255,0.92)";
                          ctx.fillRect(vx - 6, vy - 6, bgW, bgH);
                          ctx.strokeStyle = "rgba(0,0,0,0.06)";
                          ctx.strokeRect(vx - 6, vy - 6, bgW, bgH);
                          for (const r of rows) {
                            try {
                              ctx.fillStyle = r.color || "#000";
                              ctx.fillRect(vx, vy, 12, 8);
                              ctx.fillStyle = "rgba(0,0,0,0.85)";
                              ctx.fillText(r.txt, vx + 18, vy + 8);
                            } catch (e) {}
                            vy += 16;
                          }
                        }
                      } catch (e) {}
                      // fallback: total N top-right
                      try {
                        const total =
                          Array.isArray(arrAll) && arrAll.length
                            ? "N=" + arrAll.length
                            : "";
                        if (total)
                          ctx.fillText(total, area.right - 60, area.top + 16);
                      } catch (e) {}
                      ctx.restore();
                    } catch (e) {}
                  },
                },
              ],
            });
            return { chartInit, chartArr };
          }

          // build initial-gap and ARR charts
          drawChartFor(
            "Key press → first ARR",
            (d) => d.leftInitials.concat(d.rightInitials),
            "chart",
            40,
          );

          // soft-drop combined chart
          (function () {
            const variants = Object.keys(data);
            let combined = [];
            for (const v of variants)
              combined = combined.concat(data[v].softIntervals || []);
            if (combined.length === 0) {
              window.chartsReady = true;
              return;
            }
            const id = "chart-soft";
            const c = makeCanvas(id, "Soft-drop intervals (aggregated)");
            const hist = (function () {
              const bins = 40;
              const min = Math.min(...combined);
              const max = Math.max(...combined);
              return histogram(combined, bins, min, max);
            })();
            if (!hist) {
              window.chartsReady = true;
              return;
            }
            const pts = hist.centers.map((c2, i) => ({
              x: c2,
              y: hist.counts[i],
            }));
            const dens = kdeEstimate(combined, hist.centers);
            const scaled = dens.map((d) => d * combined.length * hist.binWidth);
            const kdPts = hist.centers.map((c2, i) => ({
              x: c2,
              y: +scaled[i].toFixed(3),
            }));
            // prepare per-variant info for soft intervals
            const variantInfoSoft = variants.map((v, idx) => ({
              label: v,
              n: (data[v].softIntervals || []).length || 0,
              color: PALETTE[idx % PALETTE.length],
            }));
            if (!c._variantInfo) c._variantInfo = variantInfoSoft;
            const baseHexS = PALETTE[0];
            const colorS = hexToRgba(baseHexS, 0.7);
            const colorSBorder = hexToRgba(baseHexS, 0.9);
            const colorSFill = hexToRgba(baseHexS, 0.12);
            new Chart(c.getContext("2d"), {
              data: {
                datasets: [
                  {
                    type: "bar",
                    label: "soft (hist)",
                    data: pts,
                    backgroundColor: colorS,
                    borderColor: colorSBorder,
                    borderWidth: 1,
                  },
                  {
                    type: "line",
                    label: "soft (KDE)",
                    data: kdPts,
                    borderColor: colorSBorder,
                    backgroundColor: colorSFill,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                  },
                ],
              },
              options: {
                responsive: false,
                scales: {
                  x: { type: "linear", title: { display: true, text: "ms" } },
                  y: { title: { display: true, text: "count" } },
                },
                plugins: {
                  legend: {
                    position: "top",
                    labels: { usePointStyle: true, boxWidth: 12, padding: 8 },
                  },
                  tooltip: {
                    callbacks: {
                      label: function (ctx) {
                        var raw = ctx.raw;
                        var val =
                          raw && raw.y !== undefined
                            ? raw.y
                            : typeof raw === "number"
                              ? raw
                              : raw && raw.x !== undefined
                                ? raw.x
                                : JSON.stringify(raw);
                        if (typeof val === "number")
                          val = Math.round(val * 100) / 100;
                        return (
                          (ctx.dataset && ctx.dataset.label
                            ? ctx.dataset.label + ": "
                            : "") + String(val)
                        );
                      },
                    },
                  },
                  title: {
                    display: true,
                    text: "Soft-drop intervals (aggregated)",
                    font: { size: 16 },
                  },
                },
                animation: false,
              },
              plugins: [
                {
                  id: "annot",
                  afterDraw(chart) {
                    try {
                      const ctx = chart.ctx;
                      const area = chart.chartArea;
                      ctx.save(); // draw per-variant info top-left
                      try {
                        const variantInfo =
                          chart.canvas._variantInfo || c._variantInfo || [];
                        if (variantInfo && variantInfo.length) {
                          ctx.font = "12px sans-serif";
                          let maxW = 0;
                          const rows = [];
                          for (const vi of variantInfo) {
                            const txt = vi.label + " N=" + (vi.n || 0);
                            rows.push({ txt: txt, color: vi.color || "#000" });
                            const w = ctx.measureText(txt).width;
                            if (w > maxW) maxW = w;
                          }
                          const vx = area.left + 8;
                          let vy = area.top + 8;
                          const bgW = 12 + 6 + maxW + 18;
                          const bgH = rows.length * 16 + 8;
                          ctx.fillStyle = "rgba(255,255,255,0.92)";
                          ctx.fillRect(vx - 6, vy - 6, bgW, bgH);
                          ctx.strokeStyle = "rgba(0,0,0,0.06)";
                          ctx.strokeRect(vx - 6, vy - 6, bgW, bgH);
                          for (const r of rows) {
                            try {
                              ctx.fillStyle = r.color || "#000";
                              ctx.fillRect(vx, vy, 12, 8);
                              ctx.fillStyle = "rgba(0,0,0,0.85)";
                              ctx.fillText(r.txt, vx + 18, vy + 8);
                            } catch (e) {}
                            vy += 16;
                          }
                        }
                      } catch (e) {}
                      ctx.restore();
                    } catch (e) {}
                  },
                },
              ],
            });
            window.chartsReady = true;
          })();
        } catch (err) {
          window.chartsError = String(err && err.stack ? err.stack : err);
          window.chartsReady = true;
        }
      },
      dataFileUrl,
      chartLoaded,
      aggregated,
    );

    // ensure page signals chartsReady (some rendering paths may be async)
    try {
      await page.waitForFunction("window.chartsReady === true", {
        timeout: PLOT_WAIT_CHARTSREADY_MS,
      });
    } catch (waitErr) {
      console.warn(
        "waitForFunction(window.chartsReady) timed out:",
        waitErr && waitErr.message ? waitErr.message : waitErr,
      );
      // attempt additional checks: presence of canvas elements and pixel data
      const ids = ["chart-initial", "chart-arr", "chart-soft"];
      try {
        // wait for canvas elements
        for (const id of ids) {
          try {
            await page.waitForSelector("#" + id, {
              timeout: PLOT_WAIT_SELECTOR_MS,
            });
          } catch (e) {
            /* ignore missing */
          }
        }

        // check canvas data ready with retries
        let ok = false;
        for (let attempt = 0; attempt < PLOT_CANVAS_RETRIES; attempt++) {
          const results = await page.evaluate((ids) => {
            return ids.map((id) => {
              const c = document.getElementById(id);
              if (!c || !c.toDataURL) return false;
              try {
                const data = c.toDataURL();
                return data && data.length > 1000;
              } catch (e) {
                return false;
              }
            });
          }, ids);
          if (results.every(Boolean)) {
            ok = true;
            break;
          }
          await new Promise((r) =>
            setTimeout(r, PLOT_CANVAS_RETRY_BASE_MS * (attempt + 1)),
          );
        }
        if (!ok) {
          if (PLOT_SAVE_DEBUG)
            try {
              await page.screenshot({
                path: path.join("recordings", "plot_page_timeout.png"),
              });
            } catch (e) {}
          if (PLOT_SAVE_DEBUG)
            try {
              const html = await page.content();
              fs.writeFileSync(
                path.join("recordings", "plot_page_timeout.html"),
                html,
                "utf8",
              );
            } catch (e) {}
          await browser.close();
          throw new Error("Chart render timeout (canvases incomplete)");
        }
      } catch (e2) {
        console.warn(
          "Post-timeout canvas checks failed:",
          e2 && e2.message ? e2.message : e2,
        );
        if (PLOT_SAVE_DEBUG)
          try {
            await page.screenshot({
              path: path.join("recordings", "plot_page_timeout.png"),
            });
          } catch (e) {}
        if (PLOT_SAVE_DEBUG)
          try {
            const html = await page.content();
            fs.writeFileSync(
              path.join("recordings", "plot_page_timeout.html"),
              html,
              "utf8",
            );
          } catch (e) {}
        await browser.close();
        throw new Error("Chart render timeout");
      }
    }
  } catch (err) {
    console.warn(
      "Failed to evaluate chart creation:",
      err && err.stack ? err.stack : err,
    );
    try {
      await page.screenshot({
        path: path.join("recordings", "plot_page_timeout.png"),
      });
    } catch (e) {}
    try {
      const html = await page.content();
      fs.writeFileSync(
        path.join("recordings", "plot_page_timeout.html"),
        html,
        "utf8",
      );
    } catch (e) {}
    await browser.close();
    throw err;
  }
  const ids = [
    "chart-initial",
    "chart-arr",
    "chart-soft",
    "chart-initial-right",
    "chart-arr-right",
  ];
  // prefer names we know exist (chart-initial, chart-arr, chart-soft)
  const toCapture = ["chart-initial", "chart-arr", "chart-soft"];
  for (const id of toCapture) {
    const el = await page.$("#" + id);
    if (!el) {
      console.warn("element not found", id);
      continue;
    }
    const out = path.join("recordings", id + ".png");
    await el.screenshot({ path: out });
    console.log("Wrote", out);
  }
  await browser.close();
}

async function main() {
  const data = collect();
  // save data for inspection
  fs.writeFileSync(
    path.join("recordings", "plot_data.json"),
    JSON.stringify(data, null, 2),
  );
  writeHTML(data);
  // try to load aggregated analysis if available
  const aggPath = path.join(
    process.cwd(),
    "recordings",
    "analysis_aggregated.json",
  );
  let aggregated = null;
  if (fs.existsSync(aggPath)) {
    try {
      aggregated = JSON.parse(fs.readFileSync(aggPath, "utf8"));
      console.log("Loaded aggregated analysis");
    } catch (e) {
      console.warn(
        "Failed to parse aggregated analysis:",
        e && e.message ? e.message : e,
      );
    }
  } else {
    console.log("No aggregated analysis found at", aggPath);
  }
  await renderScreenshots(data, aggregated);
  console.log("Saved recordings/plot_data.json and plot.html");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
