#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const argv = process.argv.slice(2);
let url = 'http://127.0.0.1:8080/';
let out = null;
let trials = 20;
let budgetMs = 250;
let pool = null;
let warmPoolSizeArg = null;
let warmRoundsArg = 3;
let warmBudgetMsArg = null;
let warmDelayMsArg = 50;
let warmModeArg = 'probe';
let probeRoundsArg = 5;
for (let i=0;i<argv.length;i++){
  const a = argv[i];
  if ((a==='--url'||a==='-u') && argv[i+1]) url = argv[++i];
  else if ((a==='--out'||a==='-o') && argv[i+1]) out = argv[++i];
  else if ((a==='--trials'||a==='-t') && argv[i+1]) trials = Number(argv[++i]);
  else if ((a==='--budget'||a==='-b') && argv[i+1]) budgetMs = Number(argv[++i]);
  else if ((a==='--pool'||a==='-p') && argv[i+1]) pool = Number(argv[++i]);
  else if (a === '--warmPoolSize' && argv[i+1]) warmPoolSizeArg = Number(argv[++i]);
  else if (a === '--warmRounds' && argv[i+1]) warmRoundsArg = Number(argv[++i]);
  else if ((a==='--warmBudget' || a==='--warmBudgetMs') && argv[i+1]) warmBudgetMsArg = Number(argv[++i]);
  else if ((a==='--warmDelay' || a==='--warmDelayMs') && argv[i+1]) warmDelayMsArg = Number(argv[++i]);
  else if (a === '--warmMode' && argv[i+1]) warmModeArg = argv[++i];
  else if (a === '--probeRounds' && argv[i+1]) probeRoundsArg = Number(argv[++i]);
}

(async ()=>{
  try{
    const benchDir = path.join(process.cwd(),'bench_results');
    if (!fs.existsSync(benchDir)) fs.mkdirSync(benchDir,{recursive:true});
    const ts = new Date().toISOString().replace(/[:.]/g,'-');
    const outFile = out || path.join(benchDir, `tuned_250ms_bench_${ts}.json`);

    console.log('Launching headless browser with stable flags...');
    const stableArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-popup-blocking',
      '--disable-sync',
      '--disable-translate',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-first-run',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-hang-monitor',
      '--enable-precise-memory-info'
    ];
    const browser = await puppeteer.launch({ headless: true, args: stableArgs, defaultViewport: { width: 1280, height: 800 } });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultNavigationTimeout(60000);
    await page.goto(url, { waitUntil: 'networkidle2' });
    console.log('Page loaded:', url);

    try {
      await page.waitForFunction(() => window.ai && typeof window.ai.decideWithBudget === 'function', { timeout: 15000 });
      console.log('Detected window.ai.decideWithBudget');
    } catch (e) {
      console.warn('ai.decideWithBudget not detected within timeout; continuing');
    }

    const res = await page.evaluate(async (trials, budgetMs, poolArg, warmPoolSizeArg, warmRoundsArg, warmBudgetMsArg, warmDelayMsArg, warmModeArg, probeRoundsArg) => {
      const ai = window.ai || {};
      const pools = (typeof poolArg === 'number' && !isNaN(poolArg)) ? [poolArg] : [1,2,3,4];
      const results = [];
      for (const pool of pools) {
        try{ if (typeof ai.setWorkerPoolSize === 'function') ai.setWorkerPoolSize(pool); }catch(e){}
        try{ if (typeof ai.ensureWorkerPoolInitialized === 'function') await ai.ensureWorkerPoolInitialized(); }catch(e){}
        await new Promise(r=>setTimeout(r,50));
        const perNodeLimit = 1;
        const topK = 1;
        const beamWidthBase = 1;

        // Pre-warm / probe: initialize workers and optionally run short decide calls
        try {
          const warmMode = (typeof warmModeArg === 'string' && warmModeArg) ? String(warmModeArg).toLowerCase() : 'warm';
          const warmPool = (typeof warmPoolSizeArg === 'number' && !isNaN(warmPoolSizeArg)) ? warmPoolSizeArg : (pool || 1);
          if (warmMode === 'probe') {
            const probeBudgetMs = (typeof warmBudgetMsArg === 'number' && !isNaN(warmBudgetMsArg)) ? warmBudgetMsArg : Math.max(5, Math.round(budgetMs * 0.02));
            const probeDelayMs = (typeof warmDelayMsArg === 'number' && !isNaN(warmDelayMsArg)) ? warmDelayMsArg : 10;
            const probeRounds = (typeof probeRoundsArg === 'number' && !isNaN(probeRoundsArg) && probeRoundsArg > 0) ? probeRoundsArg : 1;
            try{ if (typeof ai.setWorkerPoolSize === 'function') ai.setWorkerPoolSize(warmPool); }catch(e){}
            try{ if (typeof ai.ensureWorkerPoolInitialized === 'function') await ai.ensureWorkerPoolInitialized(); }catch(e){}
            await new Promise(r=>setTimeout(r, probeDelayMs));
            for (let pr=0; pr<probeRounds; pr++) {
              try{
                if (typeof ai.decideWithBudget === 'function'){
                  await ai.decideWithBudget(probeBudgetMs, { perNodeLimit, beamWidthBase, topK });
                } else if (typeof ai.probeStateWithParams === 'function'){
                  const state = (ai.game && typeof ai.game.getState === 'function') ? ai.game.getState() : null;
                  await ai.probeStateWithParams(state, {}, { beamWidthBase, perNodeLimit, topK }, probeBudgetMs);
                } else {
                  await new Promise(r=>setTimeout(r, Math.min(10, probeBudgetMs)));
                }
              } catch(e) {}
              await new Promise(r=>setTimeout(r, Math.max(5, probeDelayMs)));
            }
            try{ if (typeof ai.setWorkerPoolSize === 'function') ai.setWorkerPoolSize(pool); }catch(e){}
            try{ if (typeof ai.ensureWorkerPoolInitialized === 'function') await ai.ensureWorkerPoolInitialized(); }catch(e){}
            await new Promise(r=>setTimeout(r,50));
          } else {
            const warmRounds = (typeof warmRoundsArg === 'number' && !isNaN(warmRoundsArg)) ? warmRoundsArg : 3;
            const warmBudgetMs = (typeof warmBudgetMsArg === 'number' && !isNaN(warmBudgetMsArg)) ? warmBudgetMsArg : Math.max(20, Math.round(budgetMs * 0.15));
            const warmDelayMs = (typeof warmDelayMsArg === 'number' && !isNaN(warmDelayMsArg)) ? warmDelayMsArg : 50;
            try{ if (typeof ai.setWorkerPoolSize === 'function') ai.setWorkerPoolSize(warmPool); }catch(e){}
            try{ if (typeof ai.ensureWorkerPoolInitialized === 'function') await ai.ensureWorkerPoolInitialized(); }catch(e){}
            await new Promise(r=>setTimeout(r, warmDelayMs));
            for (let wr=0; wr<warmRounds; wr++){
              try{
                if (typeof ai.decideWithBudget === 'function'){
                  await ai.decideWithBudget(warmBudgetMs, { perNodeLimit, beamWidthBase, topK });
                } else if (typeof ai.probeStateWithParams === 'function'){
                  const state = (ai.game && typeof ai.game.getState === 'function') ? ai.game.getState() : null;
                  await ai.probeStateWithParams(state, {}, { beamWidthBase, perNodeLimit, topK }, warmBudgetMs);
                } else {
                  await new Promise(r=>setTimeout(r, Math.min(20, warmBudgetMs)));
                }
              } catch(e) {}
              await new Promise(r=>setTimeout(r, Math.max(10, warmDelayMs)));
            }
            // restore requested pool size
            try{ if (typeof ai.setWorkerPoolSize === 'function') ai.setWorkerPoolSize(pool); }catch(e){}
            try{ if (typeof ai.ensureWorkerPoolInitialized === 'function') await ai.ensureWorkerPoolInitialized(); }catch(e){}
            await new Promise(r=>setTimeout(r,50));
          }
        } catch(e) { /* ignore warm errors */ }
        const sampleTimes = [];
        for (let t=0;t<trials;t++){
          const start = Date.now();
          try{
            if (typeof ai.decideWithBudget === 'function'){
              await ai.decideWithBudget(budgetMs, { perNodeLimit, beamWidthBase, topK });
            } else if (typeof ai.probeStateWithParams === 'function'){
              const state = (ai.game && typeof ai.game.getState === 'function') ? ai.game.getState() : null;
              await ai.probeStateWithParams(state, {}, { beamWidthBase, perNodeLimit, topK }, budgetMs);
            } else {
              await new Promise(r=>setTimeout(r,1));
            }
          } catch(e) {
            // swallow
          }
          sampleTimes.push(Date.now() - start);
          await new Promise(r=>setTimeout(r,1));
        }
        results.push({ pool, perNodeLimit, topK, beamWidthBase, trials, sampleTimes });
      }
      const now = Date.now();
      return { startedAt: now, endedAt: now, durationMs: 0, results };
    }, trials, budgetMs, pool);

    fs.writeFileSync(outFile, JSON.stringify(res, null, 2), 'utf8');
    console.log('Bench results written to', outFile);
    await browser.close();
  } catch (err) {
    console.error('run_tuned_250ms_bench error:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
})();
