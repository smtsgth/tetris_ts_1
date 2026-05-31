#!/usr/bin/env node
const fs = require("fs");
const cp = require("child_process");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer");

const RESULTS_DIR = path.resolve(__dirname, "..", "recordings");
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

function waitForServer(url, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function probe() {
      http
        .get(url, (res) => resolve(true))
        .on("error", () => {
          if (Date.now() - start > timeout)
            return reject(new Error("server timeout"));
          setTimeout(probe, 200);
        });
    })();
  });
}

async function runOnce({ durationMs = 8000 } = {}) {
  const port = 20000 + Math.floor(Math.random() * 10000);
  const serverUrl = `http://127.0.0.1:${port}/`;

  console.log("Starting http-server on port", port);
  const serverCmd = "node";
  const serverArgs = [
    path.join("node_modules", "http-server", "bin", "http-server"),
    "-p",
    String(port),
    "-c-1",
    ".",
  ];
  const serverProc = cp.spawn(serverCmd, serverArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on("data", (d) =>
    process.stderr.write(`[server.err] ${d}`),
  );

  try {
    await waitForServer(serverUrl);
  } catch (e) {
    serverProc.kill();
    throw e;
  }

  console.log("Server ready. Launching headless browser...");
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(30000);
  await page.goto(serverUrl, { waitUntil: "networkidle2" });

  try {
    await page.waitForFunction(
      () => !!(window.ai && typeof window.ai.getLogs === "function"),
      { timeout: 15000 },
    );
  } catch (e) {
    console.error("AI object not found on page");
  }

  // enable AI and profiling hooks (support overriding EARLY_FALLBACK_MS via env EARLY_FALLBACK_MS)
  const earlyMs = process.env.EARLY_FALLBACK_MS
    ? Number(process.env.EARLY_FALLBACK_MS)
    : null;
  const planTimeoutMs = process.env.PLAN_TIMEOUT_MS
    ? Number(process.env.PLAN_TIMEOUT_MS)
    : null;
  const disableFallbacks = process.env.DISABLE_FALLBACKS ? true : null;
  const beamWidth = process.env.BEAM_WIDTH
    ? Number(process.env.BEAM_WIDTH)
    : null;
  const perNode = process.env.PER_NODE_LIMIT
    ? Number(process.env.PER_NODE_LIMIT)
    : null;
  const topK = process.env.TOP_K ? Number(process.env.TOP_K) : null;
  await page.evaluate(
    (earlyMsArg, planTimeoutArg, disableFallbacksArg) => {
      try {
        window.__autoCapturedLogs = [];
      } catch (e) {}
      try {
        if (window.ai && typeof window.ai.clearLogs === "function")
          window.ai.clearLogs();
      } catch (e) {}
      try {
        if (window.ai && typeof window.ai.setDebugEnabled === "function")
          window.ai.setDebugEnabled(true);
      } catch (e) {}
      try {
        if (earlyMsArg != null && window.ai) {
          try {
            window.ai.EARLY_FALLBACK_MS = earlyMsArg;
          } catch (e) {}
        }
      } catch (e) {}
      try {
        if (planTimeoutArg != null && window.ai) {
          try {
            window.ai.PLAN_TIMEOUT_MS = planTimeoutArg;
          } catch (e) {}
        }
      } catch (e) {}
      try {
        if (disableFallbacksArg != null && window.ai) {
          try {
            window.ai.DISABLE_FALLBACKS = !!disableFallbacksArg;
          } catch (e) {}
        }
      } catch (e) {}
      try {
        if (window.ai && typeof window.ai.setEnabled === "function")
          window.ai.setEnabled(true);
      } catch (e) {}
      window.__autoCaptureHandle = setInterval(() => {
        try {
          const l =
            window.ai && typeof window.ai.getLogs === "function"
              ? window.ai.getLogs()
              : [];
          window.__autoCapturedLogs.push(...l.slice(-200));
        } catch (e) {}
      }, 250);
    },
    earlyMs,
    planTimeoutMs,
    disableFallbacks,
  );
  // apply optional runtime tuning params
  await page.evaluate(
    (bw, pnl, tk) => {
      try {
        if (
          typeof bw === "number" &&
          window.ai &&
          typeof window.ai.setBeamWidthBase === "function"
        )
          window.ai.setBeamWidthBase(bw);
      } catch (e) {}
      try {
        if (
          typeof pnl === "number" &&
          window.ai &&
          typeof window.ai.setPerNodeLimit === "function"
        )
          window.ai.setPerNodeLimit(pnl);
      } catch (e) {}
      try {
        if (
          typeof tk === "number" &&
          window.ai &&
          typeof window.ai.setTopK === "function"
        )
          window.ai.setTopK(tk);
      } catch (e) {}
    },
    beamWidth,
    perNode,
    topK,
  );

  console.log(`Collecting for ${durationMs}ms...`);
  await new Promise((r) => setTimeout(r, durationMs));

  const logs = await page.evaluate(() => {
    try {
      if (window.__autoCaptureHandle) {
        clearInterval(window.__autoCaptureHandle);
        delete window.__autoCaptureHandle;
      }
    } catch (e) {}
    try {
      const a =
        window.ai && typeof window.ai.getLogs === "function"
          ? window.ai.getLogs()
          : [];
      const b = window.__autoCapturedLogs || [];
      const dom = [];
      try {
        const el = document.getElementById("__worker_debug");
        if (el && el.textContent)
          dom.push(...el.textContent.split("\n").filter(Boolean));
      } catch (e) {}
      return b.concat(dom).concat(a);
    } catch (e) {
      return window.__autoCapturedLogs || [];
    }
  });

  let profiles = null;
  try {
    profiles = await page.evaluate(() => {
      try {
        if (
          window.ai &&
          typeof window.ai.exportProfilesToWindow === "function"
        ) {
          window.ai.exportProfilesToWindow();
        }
      } catch (e) {}
      try {
        return window.__workerProfiles || null;
      } catch (e) {
        return null;
      }
    });
  } catch (e) {}

  const timestamp = Date.now();
  const paramSuffix = `bw${beamWidth !== null ? beamWidth : "auto"}_pnl${perNode !== null ? perNode : "auto"}_topk${topK !== null ? topK : "auto"}`;
  const outLogs = path.join(
    RESULTS_DIR,
    `capture_logs_${paramSuffix}_${timestamp}.json`,
  );
  fs.writeFileSync(
    outLogs,
    JSON.stringify({ timestamp, logs }, null, 2),
    "utf8",
  );
  console.log("Saved logs to", outLogs);

  if (profiles) {
    const profPath = path.join(
      RESULTS_DIR,
      `worker_profiles_manual_${paramSuffix}_${timestamp}.json`,
    );
    fs.writeFileSync(profPath, JSON.stringify(profiles, null, 2), "utf8");
    console.log("Saved profiles to", profPath);
  } else {
    console.log("No profiles exported by runtime");
  }

  await browser.close();
  try {
    serverProc.kill();
  } catch (e) {}
}

runOnce({
  durationMs: process.env.DURATION_MS ? Number(process.env.DURATION_MS) : 8000,
}).catch((err) => {
  console.error("capture failed:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
