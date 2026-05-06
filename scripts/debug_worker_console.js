const cp = require('child_process');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');

(async ()=>{
  // build
  cp.execSync('npm run build', { stdio: 'inherit' });
  // start server
  const port = 3000 + Math.floor(Math.random()*10000);
  const serverCmd = `npx http-server -p ${port} -c-1 .`;
  const serverProc = cp.exec(serverCmd);
  serverProc.stdout.on('data', d => process.stdout.write(`[server:${port}] ${d}`));
  serverProc.stderr.on('data', d => process.stderr.write(`[server:${port}.err] ${d}`));
  const url = `http://127.0.0.1:${port}/`;
  // wait for server
  await new Promise((resolve,reject)=>{
    const start=Date.now();
    (function probe(){
      http.get(url,()=>resolve(true)).on('error',()=>{ if(Date.now()-start>15000) return reject(new Error('server timeout')); setTimeout(probe,200); });
    })();
  });
  console.log('Server ready at', url);

  const browser = await puppeteer.launch({ args:['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('console', async msg => {
    try {
      const args = msg.args();
      for (let i = 0; i < args.length; ++i) {
        const val = await args[i].jsonValue();
        console.log('PAGE_CONSOLE:', val);
      }
    } catch (e) { console.log('console parse err', e); }
  });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !!(window.ai && typeof window.ai.getLogs === 'function'), { timeout: 15000 });
  await page.evaluate(() => { window.ai.clearLogs(); try{ window.ai.setDebugEnabled(true); }catch(e){} try{ window.ai.setEnabled(true); }catch(e){} });
  console.log('Capturing logs for 15s...');
  await new Promise(r => setTimeout(r, 15000));
  const logs = await page.evaluate(() => window.ai.getLogs());
  console.log('FINAL LOGS LENGTH:', logs.length);
  for (let i=0;i<logs.length;i++) console.log('LOG:', logs[i]);
  await browser.close();
  serverProc.kill();
})().catch(e=>{ console.error(e); process.exit(1); });
