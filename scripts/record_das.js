const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  // forward page console and errors to our terminal for debugging (set before navigation)
  page.on("console", (msg) => {
    try {
      console.log("PAGE LOG:", msg.text());
    } catch (e) {
      /* ignore */
    }
  });
  page.on("pageerror", (err) => {
    console.error("PAGE ERROR:", err.toString());
  });

  const url = "http://127.0.0.1:8080";
  console.log("Opening", url);
  await page.goto(url, { waitUntil: "networkidle2" });

  // wait for game to be exposed
  await page.waitForFunction(
    () => !!window.game && typeof window.game.getState === "function",
    { timeout: 30000 },
  );
  console.log("Game object available");

  const sampleState = async () =>
    await page.evaluate(() => {
      const s = window.game.getState();
      const cur = s.current;
      return {
        current: cur
          ? { x: cur.x, y: cur.y, type: cur.type, rotation: cur.rotation }
          : null,
        score: s.score,
      };
    });
  // variants to test
  const variants = [
    { name: "fast", DAS: 100, ARR: 20, SOFT: 30 },
    { name: "slow", DAS: 250, ARR: 60, SOFT: 80 },
  ];

  // ensure recordings dir exists (may be created externally)
  const fs = require("fs");
  if (!fs.existsSync("recordings")) fs.mkdirSync("recordings");

  for (const v of variants) {
    console.log(
      `--- Running variant: ${v.name} (DAS=${v.DAS} ARR=${v.ARR} SOFT=${v.SOFT})`,
    );
    // set input tuning on the page (window.input is exposed)
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
    if (!ok)
      console.warn("window.input not available — skipping variant tuning.");

    const results = { left: [], right: [], down: [], scoreDelta: 0 };

    console.log("Sampling ArrowLeft hold (2500ms total, 100ms samples)");
    await page.keyboard.down("ArrowLeft");
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 100));
      results.left.push(await sampleState());
    }
    await page.screenshot({ path: `recordings/left_${v.name}.png` });
    await page.keyboard.up("ArrowLeft");

    await new Promise((r) => setTimeout(r, 600));

    console.log("Sampling ArrowRight hold (2500ms total, 100ms samples)");
    await page.keyboard.down("ArrowRight");
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 100));
      results.right.push(await sampleState());
    }
    await page.screenshot({ path: `recordings/right_${v.name}.png` });
    await page.keyboard.up("ArrowRight");

    await new Promise((r) => setTimeout(r, 600));

    console.log("Sampling ArrowDown (soft drop)");
    const before = await page.evaluate(() => window.game.getState().score);
    await page.keyboard.down("ArrowDown");
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 100));
      results.down.push(await sampleState());
    }
    await page.keyboard.up("ArrowDown");
    const after = await page.evaluate(() => window.game.getState().score);
    results.scoreDelta = after - before;
    await page.screenshot({ path: `recordings/down_${v.name}.png` });

    const outPath = `recordings/das_results_${v.name}.json`;
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log("Wrote", outPath);
  }

  console.log("All variants completed");
  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
