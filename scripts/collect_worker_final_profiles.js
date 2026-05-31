const puppeteer = require("puppeteer");
const fs = require("fs");
(async () => {
  const url = process.argv[2] || "http://127.0.0.1:8080/";
  const duration = Number(process.argv[3] || 20); // seconds
  const maxWorkers = process.argv[4] ? Number(process.argv[4]) : null;
  // optional base plan timeout (ms) to pass into the page for dynamic timeout tuning
  const baseTimeout = process.argv[5] ? Number(process.argv[5]) : null;
  const outDir = "./recordings";
  try {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {}
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(0);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // wait for ai to exist
    try {
      await page.waitForFunction(() => !!window.ai, { timeout: 15000 });
    } catch (e) {
      console.error("ai not present on page");
      await browser.close();
      process.exit(2);
    }

    // clear prior collected profiles and tune AI for rapid sampling
    await page.evaluate(
      (mw, baseTimeoutMs) => {
        try {
          if (window.ai) {
            try {
              window.ai.collectedProfiles = [];
            } catch (e) {}
          }
        } catch (e) {}
        try {
          if (window.ai && typeof window.ai.setSpeedMultiplier === "function")
            window.ai.setSpeedMultiplier(100);
        } catch (e) {}
        try {
          if (
            window.ai &&
            typeof window.ai.setMinScheduleInterval === "function"
          )
            window.ai.setMinScheduleInterval(10);
        } catch (e) {}
        try {
          if (window.ai && typeof window.ai.setLookahead === "function")
            window.ai.setLookahead(2);
        } catch (e) {}
        try {
          if (window.ai) {
            if (typeof mw === "number" && !isNaN(mw)) {
              try {
                if (typeof window.ai.setMaxConcurrentWorkers === "function")
                  window.ai.setMaxConcurrentWorkers(
                    Math.max(1, Math.floor(mw)),
                  );
                else
                  window.ai.maxConcurrentWorkers = Math.max(1, Math.floor(mw));
              } catch (e) {}
            } else {
              try {
                if (typeof window.ai.getMaxConcurrentWorkers === "function") {
                  const cur = window.ai.getMaxConcurrentWorkers();
                  if (typeof window.ai.setMaxConcurrentWorkers === "function")
                    window.ai.setMaxConcurrentWorkers(
                      Math.max(1, Math.min(4, cur || 2)),
                    );
                  else
                    window.ai.maxConcurrentWorkers = Math.max(
                      1,
                      Math.min(4, window.ai.maxConcurrentWorkers || 2),
                    );
                } else {
                  window.ai.maxConcurrentWorkers = Math.max(
                    1,
                    Math.min(4, window.ai.maxConcurrentWorkers || 2),
                  );
                }
              } catch (e) {}
            }
            if (typeof baseTimeoutMs === "number" && !isNaN(baseTimeoutMs)) {
              try {
                window.ai.BASE_PLAN_TIMEOUT_MS = Math.max(
                  500,
                  Math.floor(baseTimeoutMs),
                );
              } catch (e) {}
            }
          }
        } catch (e) {}
      },
      maxWorkers,
      baseTimeout,
    );

    // enable AI
    await page.evaluate(() => {
      try {
        if (window.ai && typeof window.ai.setEnabled === "function")
          window.ai.setEnabled(true);
      } catch (e) {}
    });
    console.log(
      "AI enabled; collecting worker-final profiles for",
      duration,
      "seconds...",
    );

    await new Promise((r) => setTimeout(r, duration * 1000));

    // disable and wait briefly for any finalization
    try {
      await page.evaluate(() => {
        if (window.ai && typeof window.ai.disableAndWait === "function") {
          return window.ai.disableAndWait(2000);
        }
        return Promise.resolve();
      });
    } catch (e) {
      console.error("disableAndWait failed", String(e));
    }

    // gather all collected profiles
    const res = await page.evaluate(() => {
      try {
        const ai = window.ai;
        if (!ai) return { ok: false, error: "no-ai" };
        const arr =
          typeof ai.getAllProfileEvents === "function"
            ? ai.getAllProfileEvents()
            : ai.collectedProfiles || [];
        return {
          ok: true,
          len: Array.isArray(arr) ? arr.length : 0,
          profiles: Array.isArray(arr) ? arr : [],
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    });

    if (!res || !res.ok) {
      console.error("failed to retrieve profiles:", res);
      await browser.close();
      process.exit(3);
    }

    const outPath = `${outDir}/worker_final_profiles_${Date.now()}_mw${maxWorkers || "auto"}.json`;
    fs.writeFileSync(outPath, JSON.stringify(res.profiles, null, 2));
    console.log("wrote", outPath, "count=", res.len);
    // run analysis automatically and print results (synchronous child process)
    try {
      const { spawnSync } = require("child_process");
      const a = spawnSync("node", ["./scripts/analyze_profiles.js", outPath], {
        encoding: "utf8",
      });
      if (a.stdout) console.log(a.stdout);
      if (a.stderr) console.error(a.stderr);
    } catch (e) {
      console.error("analysis spawn failed", String(e));
    }
    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error("fatal", String(e));
    try {
      await browser.close();
    } catch (er) {}
    process.exit(99);
  }
})();
