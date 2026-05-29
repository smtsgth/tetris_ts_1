const fs = require("fs");
const cp = require("child_process");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer");

function waitForServer(url, timeout = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function probe() {
      http
        .get(url, (res) => {
          resolve(true);
        })
        .on("error", () => {
          if (Date.now() - start > timeout)
            return reject(new Error("server timeout"));
          setTimeout(probe, 200);
        });
    })();
  });
}

async function runOnce(durationMs = 5000) {
  const portToUse = 20000 + Math.floor(Math.random() * 10000);
  const serverUrlLocal = `http://127.0.0.1:${portToUse}/`;
  // Start a lightweight internal static file server instead of launching an external process.
  // This avoids orphaned child processes that can keep the script running.
  const serveRoot = path.join(__dirname, "..");
  const mimeMap = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".txt": "text/plain",
  };
  const server = http.createServer((req, res) => {
    try {
      let reqUrl = decodeURIComponent((req.url || "").split("?")[0]);
      if (!reqUrl || reqUrl === "/") reqUrl = "/index.html";
      const fp = path.join(serveRoot, reqUrl.replace(/^\//, ""));
      fs.stat(fp, (err, st) => {
        if (err || !st.isFile()) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const ext = path.extname(fp).toLowerCase();
        const ct = mimeMap[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": ct });
        const rs = fs.createReadStream(fp);
        rs.on("error", () => {
          try {
            res.writeHead(500);
            res.end("Server error");
          } catch (e) {}
        });
        rs.pipe(res);
      });
    } catch (e) {
      try {
        res.writeHead(500);
        res.end("Server error");
      } catch (er) {}
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(portToUse, "127.0.0.1", (err) =>
      err ? reject(err) : resolve(),
    );
  });
  console.log("Server ready", serverUrlLocal);

  // parse optional AI params JSON from argv[3]
  let aiParams = null;
  try {
    const raw = process.argv[3];
    if (raw) aiParams = JSON.parse(raw);
  } catch (e) {
    console.warn("invalid ai params, ignoring");
    aiParams = null;
  }

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    await page.goto(serverUrlLocal, { waitUntil: "networkidle2" });
    await page.waitForFunction(
      () => !!(window.ai && typeof window.ai.getLogs === "function"),
      { timeout: 15000 },
    );

    // initialize auto capture buffer and optionally set AI parameters before enabling
    await page.evaluate((params) => {
      try {
        window.__autoCapturedLogs = [];
      } catch (e) {}
      try {
        window.ai.clearLogs();
      } catch (e) {}
      try {
        if (params && window.ai) {
          try {
            Object.keys(params).forEach((k) => {
              try {
                window.ai[k] = params[k];
              } catch (e) {}
            });
          } catch (e) {}
        }
      } catch (e) {}
      try {
        window.ai.setDebugEnabled(true);
      } catch (e) {}
      try {
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
    }, aiParams);

    console.log("Collecting for", durationMs, "ms...");
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
        try {
          const el = document.getElementById("__worker_debug");
          if (el && el.textContent)
            return (window.__autoCapturedLogs || []).concat(
              el.textContent.split("\n").filter(Boolean),
            );
        } catch (er) {}
        return window.__autoCapturedLogs || [];
      }
    });

    const out = { timestamp: Date.now(), durationMs, logs };
    const outPath = path.join(
      __dirname,
      "..",
      "recordings",
      `capture_one_${Date.now()}.json`,
    );
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    console.log("Saved capture to", outPath);

    await browser.close();
    browser = null;
  } catch (e) {
    console.error("Error in capture run:", e);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }

  try {
    await new Promise((resolve) => server.close(() => resolve()));
  } catch (e) {}
}

runOnce(parseInt(process.argv[2] || "5000", 10)).catch((e) => {
  console.error(e);
  process.exit(1);
});
