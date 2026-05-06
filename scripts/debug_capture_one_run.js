const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');

async function runOnce(durationMs = 5000) {
  const portToUse = 20000 + Math.floor(Math.random() * 10000);
  const serverUrlLocal = `http://127.0.0.1:${portToUse}/`;
  const serveRoot = path.join(__dirname, '..');
  const mimeMap = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json'};
  const server = http.createServer((req, res) => {
    try {
      let reqUrl = decodeURIComponent((req.url || '').split('?')[0]);
      if (!reqUrl || reqUrl === '/') reqUrl = '/index.html';
      const fp = path.join(serveRoot, reqUrl.replace(/^\//, ''));
      fs.stat(fp, (err, st) => {
        if (err || !st.isFile()) { res.statusCode=404; res.end('Not found'); return; }
        const ext = path.extname(fp).toLowerCase();
        const ct = mimeMap[ext] || 'application/octet-stream';
        res.writeHead(200, {'Content-Type': ct});
        fs.createReadStream(fp).pipe(res);
      });
    } catch (e) { try { res.writeHead(500); res.end('Server error'); } catch(_){} }
  });

  await new Promise((resolve, reject) => server.listen(portToUse, '127.0.0.1', (err) => err ? reject(err) : resolve()));
  console.log('Server ready', serverUrlLocal);

  let browser = null;
  try {
    browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    page.on('console', async msg => {
      try { const args = msg.args(); for (let i=0;i<args.length;i++) { const v = await args[i].jsonValue(); console.log('PAGE_CONSOLE:', v); } } catch (e) { console.log('PAGE_CONSOLE_ERR', e); }
    });
    page.on('pageerror', err => console.log('PAGE_ERROR:', err && err.stack ? err.stack : String(err)));
    await page.goto(serverUrlLocal, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => !!(window.ai && typeof window.ai.getLogs === 'function'), { timeout: 15000 });

    await page.evaluate(() => { try { window.ai.clearLogs(); } catch (e) {} try { window.ai.setDebugEnabled(true); } catch (e) {} try { window.ai.setEnabled(true); } catch (e) {} });
    console.log('Collecting for', durationMs, 'ms...');
    await new Promise(r => setTimeout(r, durationMs));
    const logs = await page.evaluate(() => { try { return (window.ai && typeof window.ai.getLogs === 'function') ? window.ai.getLogs() : []; } catch (e) { return []; } });
    const out = { timestamp: Date.now(), durationMs, logs };
    const outPath = path.join(__dirname, '..', 'recordings', `debug_capture_${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('Saved capture to', outPath);
    await browser.close(); browser = null;
  } catch (e) {
    console.error('Error in debug capture run:', e && e.stack ? e.stack : String(e));
    if (browser) try { await browser.close(); } catch (er) {}
  }

  try { await new Promise((resolve) => server.close(() => resolve())); } catch (e) {}
}

runOnce(parseInt(process.argv[2]||'5000',10)).catch(e=>{ console.error(e); process.exit(1); });
