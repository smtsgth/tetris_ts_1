const puppeteer = require("puppeteer");
const fs = require("fs");
(async () => {
  const url = process.argv[2] || "http://127.0.0.1:8080/";
  const total = Number(process.argv[3] || 5000);
  const bs = Number(process.argv[4] || 100);
  const pause = Number(process.argv[5] || 10);
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
    try {
      await page.waitForFunction(
        () => typeof window.__bulkForceInject === "function",
        { timeout: 10000 },
      );
    } catch (e) {
      console.error("bulk helper missing or not ready:", String(e));
      await browser.close();
      process.exit(2);
    }
    console.log("starting bulk inject", total, "batch", bs, "pause", pause);
    try {
      await page.evaluate(
        (t, bs, p) => {
          try {
            window.__bulkForceInject(t, bs, p);
          } catch (e) {
            throw e;
          }
        },
        total,
        bs,
        pause,
      );
    } catch (e) {
      console.error("start failed", String(e));
      await browser.close();
      process.exit(3);
    }
    const start = Date.now();
    const timeout = 10 * 60 * 1000;
    let lastStatus = null;
    while (true) {
      try {
        lastStatus = await page.evaluate(() =>
          window.__getBulkInjectionStatus
            ? window.__getBulkInjectionStatus()
            : { running: false, injected: 0 },
        );
      } catch (e) {
        lastStatus = { error: String(e) };
      }
      console.log(
        "inject status",
        lastStatus &&
          (typeof lastStatus.injected !== "undefined"
            ? `${lastStatus.injected}/${lastStatus.total || 0}`
            : JSON.stringify(lastStatus)),
      );
      if (lastStatus && lastStatus.running === false) break;
      if (Date.now() - start > timeout) {
        console.error("inject timeout");
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("inject finished, gathering profile summary...");
    let analysis = null;
    try {
      analysis = await page.evaluate(() => {
        try {
          if (typeof window.__getAiProfilesSummary === "function")
            return window.__getAiProfilesSummary();
        } catch (e) {}
        try {
          const ai = window.ai;
          if (ai && typeof ai.getAllProfileEvents === "function") {
            const p = ai.getAllProfileEvents();
            return {
              ok: true,
              len: Array.isArray(p) ? p.length : null,
              sample: Array.isArray(p) ? p.slice(-50) : [],
            };
          }
        } catch (e) {}
        return { ok: false, error: "no-profile-helper" };
      });
    } catch (e) {
      analysis = { ok: false, error: String(e) };
    }
    const outPath = `${outDir}/ai_profiles_${Date.now()}.json`;
    try {
      fs.writeFileSync(
        outPath,
        JSON.stringify({ injectStatus: lastStatus, analysis }, null, 2),
      );
      console.log("wrote", outPath);
    } catch (e) {
      console.error("write failed", String(e));
    }

    // Try to retrieve full profiles from the page (if available) and save them.
    try {
      const fullProfiles = await page.evaluate(() => {
        try {
          // Prefer a dedicated helper if present
          if (typeof window.__getAllAiProfiles === "function")
            return window.__getAllAiProfiles();
        } catch (e) {}
        try {
          const ai = window.ai;
          if (ai && typeof ai.getAllProfileEvents === "function")
            return ai.getAllProfileEvents();
        } catch (e) {}
        return null;
      });
      if (Array.isArray(fullProfiles)) {
        const outFull = `${outDir}/ai_profiles_full_${Date.now()}.json`;
        try {
          fs.writeFileSync(outFull, JSON.stringify(fullProfiles, null, 2));
          console.log("wrote full profiles", outFull);
        } catch (e) {
          console.error("write full failed", String(e));
        }
      } else {
        console.log("no full profile array available on page");
      }
    } catch (e) {
      console.error("failed to fetch full profiles from page", String(e));
    }

    console.log(
      "analysis summary:",
      JSON.stringify(
        analysis &&
          (analysis.ok
            ? {
                total: analysis.len || analysis.total,
                sampleLen: (analysis.sample || []).length,
              }
            : analysis),
        null,
        2,
      ),
    );
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
