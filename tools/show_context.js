const fs = require("fs");
const lines = fs
  .readFileSync("c:\\dev_root\\tetris_ts_1\\dist\\ai.js", "utf8")
  .split(/\r?\n/);
const lineNo = 830; // 1-based
const col = 1778; // 1-based
const line = lines[lineNo - 1] || "";
console.log("LINE LEN", line.length);
console.log("char at col", col, JSON.stringify(line[col - 1]));
const start = Math.max(0, col - 40);
const end = Math.min(line.length, col + 40);
console.log("context:");
console.log(line.slice(start, end));
