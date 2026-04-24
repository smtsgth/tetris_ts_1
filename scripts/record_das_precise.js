const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => { try { console.log('PAGE LOG:', msg.text()); } catch (e) {} });
  page.on('pageerror', err => { console.error('PAGE ERROR:', err.toString()); });

  const url = 'http://127.0.0.1:8080';
  console.log('Opening', url);
  await page.goto(url, { waitUntil: 'networkidle2' });

  // wait for game to be exposed
  await page.waitForFunction(() => !!window.game && typeof window.game.getState === 'function', { timeout: 30000 });
  console.log('Game object available');

  const sampleState = async () => await page.evaluate(() => {
    const s = window.game.getState();
    const cur = s.current;
    return { current: cur ? { x: cur.x, y: cur.y, type: cur.type, rotation: cur.rotation } : null, score: s.score };
  });

  const variants = [
    { name: 'fast', DAS: 100, ARR: 20, SOFT: 30 },
    { name: 'slow', DAS: 250, ARR: 60, SOFT: 80 }
  ];

  const fs = require('fs');
  if (!fs.existsSync('recordings')) fs.mkdirSync('recordings');

  // high-precision sampling settings
  const sampleInterval = 20; // ms per sample
  const durationMs = 2500; // total sampling duration per direction
  const sampleCount = Math.floor(durationMs / sampleInterval);

  for (const v of variants) {
    console.log(`--- Running precise variant: ${v.name} (DAS=${v.DAS} ARR=${v.ARR} SOFT=${v.SOFT})`);
    const ok = await page.evaluate((d, a, s) => {
      if (!window.input) return false;
      window.input.DAS = d;
      window.input.ARR = a;
      window.input.SOFT_DROP_INTERVAL = s;
      return true;
    }, v.DAS, v.ARR, v.SOFT);
    if (!ok) console.warn('window.input not available — skipping variant tuning.');

    const results = { left: [], right: [], down: [], scoreDelta: 0 };

    console.log('Sampling ArrowLeft hold (precise)');
    await page.keyboard.down('ArrowLeft');
    for (let i = 0; i < sampleCount; i++) {
      await new Promise(r => setTimeout(r, sampleInterval));
      results.left.push(await sampleState());
    }
    await page.screenshot({ path: `recordings/left_precise_${v.name}.png` });
    await page.keyboard.up('ArrowLeft');

    await new Promise(r => setTimeout(r, 600));

    console.log('Sampling ArrowRight hold (precise)');
    await page.keyboard.down('ArrowRight');
    for (let i = 0; i < sampleCount; i++) {
      await new Promise(r => setTimeout(r, sampleInterval));
      results.right.push(await sampleState());
    }
    await page.screenshot({ path: `recordings/right_precise_${v.name}.png` });
    await page.keyboard.up('ArrowRight');

    await new Promise(r => setTimeout(r, 600));

    console.log('Sampling ArrowDown (soft drop precise)');
    const before = await page.evaluate(() => window.game.getState().score);
    await page.keyboard.down('ArrowDown');
    for (let i = 0; i < sampleCount; i++) {
      await new Promise(r => setTimeout(r, sampleInterval));
      results.down.push(await sampleState());
    }
    await page.keyboard.up('ArrowDown');
    const after = await page.evaluate(() => window.game.getState().score);
    results.scoreDelta = after - before;
    await page.screenshot({ path: `recordings/down_precise_${v.name}.png` });

    const outPath = `recordings/das_precise_${v.name}.json`;
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log('Wrote', outPath);

    await new Promise(r => setTimeout(r, 800));
  }

  console.log('All precise variants completed');
  await browser.close();
  process.exit(0);
})().catch(err => { console.error(err); process.exit(2); });
