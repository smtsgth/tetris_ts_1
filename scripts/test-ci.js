#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

// Run the Vitest binary directly via Node to avoid shell/path inconsistencies.
// Use the package's `vitest.mjs` entry as defined in node_modules/vitest/package.json
const vitestBin = path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs');
const args = ['run', '--reporter', 'verbose', '--dir', 'src/__tests__'];

const child = spawn(process.execPath, [vitestBin, ...args], { stdio: 'inherit', env: { ...process.env, CI: 'true' } });

child.on('exit', (code) => process.exit(code));
child.on('error', (err) => { console.error(err); process.exit(1); });
