const fs = require('fs');
const cp = require('child_process');

function safeWrite(path, data) {
  try { fs.writeFileSync(path, String(data || ''), 'utf8'); } catch(e){}
}

try {
  safeWrite('.diagnostic_node.txt', process.version + '\n' + JSON.stringify(process.versions) + '\n');
} catch(e) { safeWrite('.diagnostic_node.txt', 'error:'+String(e)); }

try {
  const npm = cp.execSync('npm -v', { timeout: 5000 }).toString();
  safeWrite('.diagnostic_npm.txt', npm);
} catch(e) { safeWrite('.diagnostic_npm.txt', 'error:'+String(e)); }

try {
  const whereNode = cp.execSync('where node', { timeout: 5000 }).toString();
  safeWrite('.diagnostic_node_path.txt', whereNode);
} catch(e) { safeWrite('.diagnostic_node_path.txt', 'error:'+String(e)); }

try {
  const whereNpm = cp.execSync('where npm', { timeout: 5000 }).toString();
  safeWrite('.diagnostic_npm_path.txt', whereNpm);
} catch(e) { safeWrite('.diagnostic_npm_path.txt', 'error:'+String(e)); }

try {
  const pwshVer = cp.execSync('pwsh -Command "$PSVersionTable.PSVersion.ToString()"', { timeout: 5000 }).toString();
  safeWrite('.diagnostic_pwsh_version.txt', pwshVer);
} catch(e) { safeWrite('.diagnostic_pwsh_version.txt', 'error:'+String(e)); }

try {
  const env = Object.keys(process.env).sort().map(k=>k+"="+process.env[k]).join('\n');
  safeWrite('.diagnostic_env.txt', env);
} catch(e) { safeWrite('.diagnostic_env.txt', 'error:'+String(e)); }

console.log('diagnose_env: done');
