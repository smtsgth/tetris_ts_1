#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const argv = process.argv.slice(2);
let url = null;
let trials = 50;
let pieces = ['I','J','L','O','S','T','Z'];
let topKs = [1,2,3];
let outDir = path.join(process.cwd(), 'bench_results');
let useMprof = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if ((a === '--url' || a === '-u') && argv[i + 1]) url = argv[++i];
  else if ((a === '--trials' || a === '-t') && argv[i + 1]) trials = Number(argv[++i]);
  else if ((a === '--pieces' || a === '-P') && argv[i + 1]) pieces = argv[++i].split(',').map(s=>s.trim());
  else if ((a === '--topKs' || a === '-K') && argv[i + 1]) topKs = argv[++i].split(',').map(x=>Number(x));
  else if ((a === '--outDir' || a === '-o') && argv[i + 1]) outDir = argv[++i];
  else if (a === '--mprof' || a === '-m') useMprof = true;
}

(async function main(){
  try {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    const pageUrl = url || 'file://' + path.join(process.cwd(), 'index.html');
    await page.goto(pageUrl, { waitUntil: 'load' });
    console.log('Page loaded:', pageUrl);

    for (const piece of pieces) {
      for (const k of topKs) {
        console.log('Running microbench:', piece, 'topK=', k);
        const res = await page.evaluate(async (trials, piece, topK, useMprof) => {
          return new Promise((resolve, reject) => {
            try {
              const w = new Worker('dist/ai_worker.js', { type: 'module' });
              let _mb = null;
              let resolved = false;
              w.onmessage = (e) => {
                try {
                  const d = e.data || {};
                  if (d && d.type === 'microbench_result') {
                    if (useMprof) {
                      _mb = d;
                      try { w.postMessage({ type: 'mprof', action: 'report' }); } catch (err) {}
                    } else {
                      resolved = true;
                      resolve(d);
                    }
                  } else if (d && d.type === 'microbench_error') {
                    if (!resolved) { resolved = true; reject(String(d.error)); }
                  } else if (d && d.type === 'mprof_report') {
                    // attach profiler report and resolve
                    if (_mb) {
                      try { _mb.mprof = d.data; } catch (e) {}
                      if (!resolved) { resolved = true; resolve(_mb); }
                    } else {
                      if (!resolved) { resolved = true; resolve({ type: 'mprof_report', data: d.data }); }
                    }
                  }
                } catch (e) { if (!resolved) { resolved = true; reject(String(e)); } }
              };
              w.onerror = (err) => { try { if (!resolved) { resolved = true; reject(String(err && err.message ? err.message : err)); } } catch (e) {} };
              const board = [];
              try {
                if (useMprof) {
                  try { w.postMessage({ type: 'mprof', action: 'enable' }); } catch (e) {}
                }
                w.postMessage({ type: 'microbench', reqId: 'mb1', trials, piece, topK, board, clearCache: true });
              } catch (err) { if (!resolved) { resolved = true; reject(String(err)); } }
            } catch (err) { reject(String(err)); }
          });
        }, trials, piece, k, useMprof);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const outFile = path.join(outDir, `microprof_${piece}_k${k}_${ts}.json`);
        fs.writeFileSync(outFile, JSON.stringify(res, null, 2), 'utf8');
        console.log('Wrote', outFile);
      }
    }
    await browser.close();
  } catch (err) {
    console.error('run_microbench_sweep error:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
})();
