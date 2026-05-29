#!/usr/bin/env node
const puppeteer = require("puppeteer");
(async () => {
  const url = process.argv[2] || "http://localhost:8080";
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    page.on("console", (msg) => {
      try {
        console.log("PAGE_CONSOLE", msg.text());
      } catch (e) {}
    });
    page.on("pageerror", (err) =>
      console.error("PAGE_ERROR", err && err.stack ? err.stack : String(err)),
    );
    page.on("error", (err) =>
      console.error("PAGE_ERROR", err && err.stack ? err.stack : String(err)),
    );
    await page
      .goto(url, { waitUntil: "networkidle2", timeout: 15000 })
      .catch((e) => {
        console.error("GOTO_ERROR", String(e));
      });
    // allow time for scripts to run and for global error collector to record
    await new Promise((r) => setTimeout(r, 1200));
    // attempt to read window.__copilot_logs
    let logs = null;
    try {
      logs = await page.evaluate(() => {
        try {
          return window.__copilot_logs || null;
        } catch (e) {
          return { evalError: String(e) };
        }
      });
    } catch (e) {
      console.error("EVAL_ERROR", String(e));
    }
    console.log("COPILOT_LOGS", JSON.stringify(logs));
    console.log("SMOKE_DONE");
    await browser.close();
    process.exit(0);
  } catch (e) {
    try {
      if (browser) await browser.close();
    } catch (er) {}
    console.error("SMOKE_ERROR", e && e.stack ? e.stack : String(e));
    process.exit(2);
  }
})();
