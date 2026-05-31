const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    try {
      console.log("PAGE LOG:", msg.text());
    } catch (e) {}
  });
  page.on("pageerror", (err) => {
    console.error("PAGE ERROR:", err.toString());
  });

  const url = "http://127.0.0.1:8080";
  console.log("Opening", url);
  await page.goto(url, { waitUntil: "networkidle2" });
  const initialReady = await page
    .evaluate(() => document.readyState)
    .catch(() => "error");
  console.log("document.readyState:", initialReady);
  try {
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: 10000,
    });
  } catch (e) {
    console.log("readyState did not reach complete within 10s");
  }
  try {
    await page.waitForFunction(
      () => !!window.game && typeof window.game.getState === "function",
      { timeout: 60000 },
    );
    console.log("Game object available");
  } catch (err) {
    try {
      const keys = await page.evaluate(() => Object.keys(window).slice(0, 200));
      console.error("window keys:", keys.join(", "));
    } catch (e) {
      console.error("failed to enumerate window keys", e);
    }
    throw err;
  }

  const fs = require("fs");
  if (!fs.existsSync("recordings")) fs.mkdirSync("recordings");

  const variants = [
    { name: "fast", DAS: 100, ARR: 20, SOFT: 30 },
    { name: "slow", DAS: 250, ARR: 60, SOFT: 80 },
  ];

  const durationMs = 2500;

  for (const v of variants) {
    console.log(`--- Running timestamps variant: ${v.name}`);
    const ok = await page.evaluate(
      (d, a, s) => {
        if (!window.input) return false;
        window.input.DAS = d;
        window.input.ARR = a;
        window.input.SOFT_DROP_INTERVAL = s;
        return true;
      },
      v.DAS,
      v.ARR,
      v.SOFT,
    );
    if (!ok) console.warn("window.input not available — skipping tuning.");

    const results = { left: null, right: null, down: null };

    // Left
    await page.evaluate(() => window.input.clearLogs());
    await page.keyboard.down("ArrowLeft");
    await new Promise((r) => setTimeout(r, durationMs));
    await page.keyboard.up("ArrowLeft");
    const leftLogs = await page.evaluate(() => window.input.getLogs());
    results.left = leftLogs;
    await page.screenshot({ path: `recordings/left_ts_${v.name}.png` });
    await new Promise((r) => setTimeout(r, 400));

    // Right
    await page.evaluate(() => window.input.clearLogs());
    await page.keyboard.down("ArrowRight");
    await new Promise((r) => setTimeout(r, durationMs));
    await page.keyboard.up("ArrowRight");
    const rightLogs = await page.evaluate(() => window.input.getLogs());
    results.right = rightLogs;
    await page.screenshot({ path: `recordings/right_ts_${v.name}.png` });
    await new Promise((r) => setTimeout(r, 400));

    // Down (soft)
    await page.evaluate(() => window.input.clearLogs());
    const before = await page.evaluate(() => window.game.getState().score);
    await page.keyboard.down("ArrowDown");
    await new Promise((r) => setTimeout(r, durationMs));
    await page.keyboard.up("ArrowDown");
    const after = await page.evaluate(() => window.game.getState().score);
    const downLogs = await page.evaluate(() => window.input.getLogs());
    results.down = { logs: downLogs, scoreDelta: after - before };
    await page.screenshot({ path: `recordings/down_ts_${v.name}.png` });

    fs.writeFileSync(
      `recordings/timestamps_${v.name}.json`,
      JSON.stringify(results, null, 2),
    );
    console.log("Wrote recordings/timestamps_" + v.name + ".json");

    await new Promise((r) => setTimeout(r, 800));
  }

  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
