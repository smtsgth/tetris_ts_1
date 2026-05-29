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
    // wait briefly to collect console logs (avoid page.waitForTimeout compatibility issues)
    await new Promise((r) => setTimeout(r, 1500));
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
