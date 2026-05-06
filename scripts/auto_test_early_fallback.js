#!/usr/bin/env node
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const http = require('http');

const puppeteer = require('puppeteer');

const AI_SRC = path.resolve(__dirname, '..', 'src', 'ai.ts');
const BACKUP = AI_SRC + '.bak';
const RESULTS_DIR = path.resolve(__dirname, '..', 'recordings');
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

const args = process.argv.slice(2);
const TESTS = args.length ? args.map(Number) : [30, 50, 100, 150, 200];
  const TEST_DURATION_MS = process.env.TEST_DURATION_MS ? Number(process.env.TEST_DURATION_MS) : 15 * 1000; // ms per test (can override via env)
const SERVER_PORT = 8080;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}/`;

function waitForServer(url, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function probe() {
      http.get(url, res => {
        resolve(true);
      }).on('error', () => {
        if (Date.now() - start > timeout) return reject(new Error('server timeout'));
        setTimeout(probe, 200);
      });
    })();
  });
}

function replaceEarly(ms) {
  let code = fs.readFileSync(AI_SRC, 'utf8');
  const re = /private EARLY_FALLBACK_MS = \d+;/;
  if (!re.test(code)) throw new Error('EARLY_FALLBACK_MS pattern not found in ' + AI_SRC);
  code = code.replace(re, `private EARLY_FALLBACK_MS = ${ms};`);
  fs.writeFileSync(AI_SRC, code, 'utf8');
}

async function run() {
  if (!fs.existsSync(BACKUP)) {
    fs.copyFileSync(AI_SRC, BACKUP);
  }

  const results = [];

  for (const ms of TESTS) {
    console.log(`\n=== TEST EARLY_FALLBACK_MS=${ms} ===`);
    try {
      replaceEarly(ms);
    } catch (e) {
      console.error('Failed to patch ai.ts:', e);
      break;
    }

    // build (skip if SKIP_BUILD is set so we can test with modified dist)
    if (!process.env.SKIP_BUILD) {
      console.log('Building TypeScript...');
      try {
        cp.execSync('npm run build', { stdio: 'inherit' });
      } catch (e) {
        console.error('Build failed:', e);
        break;
      }
    } else {
      console.log('SKIP_BUILD set; not running build');
    }

    // start server on a randomized high port to avoid collisions
    console.log('Starting http-server...');
    const portToUse = 20000 + Math.floor(Math.random() * 10000);
    const serverUrlLocal = `http://127.0.0.1:${portToUse}/`;
    const serverCmd = `npx http-server -p ${portToUse} -c-1 .`;
    const serverProc = cp.exec(serverCmd);
    if (serverProc.stdout) serverProc.stdout.on('data', d => process.stdout.write(`[server:${portToUse}] ${d}`));
    if (serverProc.stderr) serverProc.stderr.on('data', d => process.stderr.write(`[server:${portToUse}.err] ${d}`));

    try {
      await waitForServer(serverUrlLocal);
      console.log('Server ready. Launching headless browser...');
    } catch (e) {
      console.error('Server did not start:', e);
      try { serverProc.kill(); } catch (e) {}
      break;
    }

    let browser = null;
    try {
      browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(30000);
      await page.goto(serverUrlLocal, { waitUntil: 'networkidle2' });
      // wait for window.ai
      await page.waitForFunction(() => !!(window.ai && typeof window.ai.getLogs === 'function'), { timeout: 15000 });

      // start capturing on page -- ensure auto-capture buffer exists BEFORE enabling AI
      await page.evaluate(() => {
        try { window.__autoCapturedLogs = []; } catch (e) {}
        try { window.ai.clearLogs(); } catch (e) {}
        try { window.ai.setDebugEnabled(true); } catch (e) {}
        try { window.ai.setEnabled(true); } catch (e) {}
        // capture both recent ai logs and preserve any raw worker messages pushed to __autoCapturedLogs
        window.__autoCaptureHandle = setInterval(()=>{
          try { const l = (window.ai && typeof window.ai.getLogs === 'function') ? window.ai.getLogs() : []; window.__autoCapturedLogs.push(...(l.slice(-200))); } catch(e){}
        }, 250);
      });

      console.log(`Collecting logs for ${TEST_DURATION_MS/1000}s...`);
      await new Promise(r => setTimeout(r, TEST_DURATION_MS));

      const logs = await page.evaluate(() => {
        try { if (window.__autoCaptureHandle) { clearInterval(window.__autoCaptureHandle); delete window.__autoCaptureHandle; } } catch (e) {}
        try {
          const a = (window.ai && typeof window.ai.getLogs === 'function') ? window.ai.getLogs() : [];
          const b = window.__autoCapturedLogs || [];
          const dom = [];
          try { const el = document.getElementById('__worker_debug'); if (el && el.textContent) dom.push(...el.textContent.split('\n').filter(Boolean)); } catch (e) {}
          // combine captured raw messages, dom debug lines, and ai logs
          return b.concat(dom).concat(a);
        } catch (e) {
          try { const el = document.getElementById('__worker_debug'); if (el && el.textContent) return (window.__autoCapturedLogs || []).concat(el.textContent.split('\n').filter(Boolean)); } catch (er) {}
          return window.__autoCapturedLogs || [];
        }
      });

      const text = logs.join('\n');
      const counts = {
        earlyFallback: (text.match(/early-fallback/g) || []).length,
        fallbackApplied: (text.match(/fallback-applied/g) || []).length,
        workerOverwrite: (text.match(/worker-overwrite applied/g) || []).length,
        workerIgnored: (text.match(/worker-result ignored/g) || []).length,
        timeout: (text.match(/timeout/g) || []).length,
      };

      // capture full logs for deeper analysis during debugging
      const sample = logs.slice();
      const res = { earlyFallbackMs: ms, counts, sample, timestamp: Date.now() };
      results.push(res);
      const outPath = path.join(RESULTS_DIR, `auto_test_early_fallback_${ms}_${Date.now()}.json`);
      fs.writeFileSync(outPath, JSON.stringify(res, null, 2), 'utf8');
      console.log('Saved result to', outPath);

      await browser.close();
      browser = null;
    } catch (e) {
      console.error('Error during test run:', e);
      if (browser) { try { await browser.close(); } catch (e) {} }
    }

    // stop server
    try { serverProc.kill(); } catch (e) {}

    // small cooldown
    await new Promise(r => setTimeout(r, 1000));
  }

  // restore original ai.ts unless explicitly skipped via environment flag
  try {
    if (!process.env.SKIP_AUTOTEST_RESTORE) {
      if (fs.existsSync(BACKUP)) {
        fs.copyFileSync(BACKUP, AI_SRC);
        console.log('Restored original ai.ts from backup.');
        // rebuild original
        try { cp.execSync('npm run build', { stdio: 'inherit' }); } catch (e) { console.error('Rebuild of original failed:', e); }
      }
    } else {
      console.log('Skipping restore of ai.ts because SKIP_AUTOTEST_RESTORE is set');
    }
  } catch (e) { console.error('Failed to restore backup:', e); }

  const summaryPath = path.join(RESULTS_DIR, `auto_test_summary_${Date.now()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('All tests done. Summary saved to', summaryPath);
}

run().catch(err => { console.error('Fatal error:', err); process.exit(1); });
