#!/usr/bin/env node
const https = require('https');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GIT_TOKEN;
if (!token) { console.error('GITHUB token not set'); process.exit(1); }
const owner = 'smtsgth';
const repo = 'tetris_ts_1';
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'User-Agent': 'node',
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github+json'
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (e) {}
        resolve({ statusCode: res.statusCode, body: json, raw: data });
      });
    });
    req.on('error', reject);
    if (body) {
      const s = JSON.stringify(body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(s));
      req.write(s);
    }
    req.end();
  });
}

(async () => {
  console.log('Listing open PRs...');
  const listRes = await request('GET', `/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
  const prs = listRes.body || [];
  if (!prs.length) { console.log('No open PRs found.'); return; }
  for (const pr of prs) {
    const num = pr.number;
    const title = pr.title;
    const headRef = pr.head.ref;
    const headRepoFull = pr.head.repo && pr.head.repo.full_name;
    console.log(`Processing PR #${num}: ${title} (head: ${headRef} from ${headRepoFull})`);
    try {
      const closeRes = await request('PATCH', `/repos/${owner}/${repo}/pulls/${num}`, { state: 'closed' });
      console.log(`Closed PR #${num} (status ${closeRes.statusCode})`);
    } catch (e) {
      console.error(`Failed to close PR #${num}:`, e && e.message || e);
    }
    if (headRepoFull === `${owner}/${repo}` && headRef !== 'main' && headRef !== 'develop') {
      try {
        const delRes = await request('DELETE', `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(headRef)}`);
        console.log(`Deleted remote branch ${headRef} (status ${delRes.statusCode})`);
      } catch (e) {
        console.error(`Failed to delete remote branch ${headRef}:`, e && e.message || e);
      }
    } else {
      console.log(`Skipping branch deletion for ${headRef} (not same repo or excluded).`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
