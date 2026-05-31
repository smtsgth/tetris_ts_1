const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer");

function serveRoot(port) {
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
  return new Promise((resolve, reject) =>
    server.listen(port, "127.0.0.1", (err) =>
      err ? reject(err) : resolve(server),
    ),
  );
}

async function run(
  durationMs = 60000,
  dropIntervalMs = 60,
  exportIntervalMs = 2000,
) {
  const port = 20000 + Math.floor(Math.random() * 10000);
  const url = `http://127.0.0.1:${port}/`;
  const server = await serveRoot(port);
  console.log("Serving at", url);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    await page.goto(url, { waitUntil: "networkidle2" });

    await page.waitForFunction(
      () => !!(window.game && typeof window.game.hardDrop === "function"),
      { timeout: 15000 },
    );

    await page.evaluate(() => {
      try {
        window.game.setLockMonitorEnabled &&
          window.game.setLockMonitorEnabled(true);
      } catch (e) {}
      try {
        window.game.clearLockEvents && window.game.clearLockEvents();
      } catch (e) {}
      try {
        window.game.reset && window.game.reset();
      } catch (e) {}
    });

    const aggregated = [];
    const seen = new Set();
    const start = Date.now();
    let lastExport = 0;
    console.log("Beginning drops for", durationMs, "ms");

    while (Date.now() - start < durationMs) {
      try {
        await page.evaluate(() => {
          try {
            window.game.hardDrop && window.game.hardDrop();
          } catch (e) {}
        });
      } catch (e) {}
      await new Promise((r) => setTimeout(r, dropIntervalMs));
      if (Date.now() - lastExport >= exportIntervalMs) {
        try {
          const data = await page.evaluate(() => {
            try {
              window.game.exportLockEventsToWindow &&
                window.game.exportLockEventsToWindow();
            } catch (e) {}
            return {
              events: window.__gameLockEvents || [],
              stats: window.__gameLockStats || null,
            };
          });
          if (data && Array.isArray(data.events)) {
            for (const ev of data.events) {
              const key = JSON.stringify(ev);
              if (!seen.has(key)) {
                seen.add(key);
                aggregated.push(ev);
              }
            }
          }
        } catch (e) {
          console.warn("export failed", e);
        }
        lastExport = Date.now();
      }
      try {
        const over = await page.evaluate(
          () =>
            !!(
              window.game &&
              window.game.getState &&
              window.game.getState().over
            ),
        );
        if (over) break;
      } catch (e) {}
    }

    // final export
    try {
      const data = await page.evaluate(() => {
        try {
          window.game.exportLockEventsToWindow &&
            window.game.exportLockEventsToWindow();
        } catch (e) {}
        return {
          events: window.__gameLockEvents || [],
          stats: window.__gameLockStats || null,
        };
      });
      if (data && Array.isArray(data.events)) {
        for (const ev of data.events) {
          const key = JSON.stringify(ev);
          if (!seen.has(key)) {
            seen.add(key);
            aggregated.push(ev);
          }
        }
      }
    } catch (e) {}

    const timestamp = Date.now();
    const outDir = path.join(__dirname, "..", "recordings");
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (e) {}
    const outJson = path.join(outDir, `lock_events_${timestamp}.json`);
    fs.writeFileSync(
      outJson,
      JSON.stringify(
        { ts: timestamp, durationMs, events: aggregated },
        null,
        2,
      ),
      "utf8",
    );
    console.log("Wrote", outJson, "events=", aggregated.length);

    // write CSV
    if (aggregated.length) {
      const csvPath = path.join(outDir, `lock_events_${timestamp}.csv`);
      const header = [
        "ts",
        "type",
        "piece",
        "beforeFilled",
        "afterFilled",
        "delta",
      ];
      const lines = [header.join(",")];
      for (const it of aggregated) {
        const cells = [
          it.ts,
          it.type,
          it.piece,
          it.beforeFilled,
          it.afterFilled,
          it.delta,
        ].map((v) => `${String(v).replace(/"/g, '""')}`);
        lines.push('"' + cells.join('","') + '"');
      }
      fs.writeFileSync(csvPath, lines.join("\n"), "utf8");
      console.log("Wrote CSV", csvPath);
    }

    try {
      await browser.close();
    } catch (e) {}
    try {
      await new Promise((resolve) => server.close(() => resolve()));
    } catch (e) {}

    return { ok: true, events: aggregated.length, json: outJson };
  } catch (e) {
    console.error("Capture error", e);
    if (browser)
      try {
        await browser.close();
      } catch (er) {}
    try {
      await new Promise((resolve) => server.close(() => resolve()));
    } catch (e) {}
    return { ok: false, error: String(e) };
  }
}

if (require.main === module) {
  const duration = parseInt(process.argv[2] || "15000", 10);
  const dropInterval = parseInt(process.argv[3] || "60", 10);
  const exportInterval = parseInt(process.argv[4] || "2000", 10);
  run(duration, dropInterval, exportInterval)
    .then((res) => {
      if (!res.ok) process.exit(2);
      else process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(2);
    });
}

module.exports = { run };
