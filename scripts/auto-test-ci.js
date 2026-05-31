#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");

// Lightweight CI wrapper for auto_test_early_fallback.js
// Runs a single short test to verify early-fallback behavior quickly.
const scriptPath = path.join(__dirname, "auto_test_early_fallback.js");
const defaultTest = ["50"]; // single EARLY_FALLBACK_MS value to probe
const args = process.argv.slice(2).length ? process.argv.slice(2) : defaultTest;

const env = {
  ...process.env,
  CI: "true",
  TEST_DURATION_MS: String(process.env.TEST_DURATION_MS || 3000), // 3s capture
  SKIP_BUILD: "true", // assume dist is up-to-date for CI quick run
};

const child = spawn(process.execPath, [scriptPath, ...args], {
  stdio: "inherit",
  env,
});
child.on("exit", (code) => process.exit(code));
child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
