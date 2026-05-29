const fs = require("fs");
const lines = fs
  .readFileSync("c:\\dev_root\\tetris_ts_1\\dist\\ai.js", "utf8")
  .split(/\r?\n/);
const lineIndex = 829; // zero-based
const line = lines[lineIndex] || "";
console.log("LINE", lineIndex + 1, "LEN", line.length);
let inS = false,
  inD = false,
  inB = false,
  esc = false;
let depth = 0;
for (let i = 0; i < line.length; i++) {
  const ch = line[i];
  if (esc) {
    esc = false;
    continue;
  }
  if (ch === "\\") {
    esc = true;
    continue;
  }
  if (inS) {
    if (ch === "'") inS = false;
    continue;
  }
  if (inD) {
    if (ch === '"') inD = false;
    continue;
  }
  if (inB) {
    if (ch === "`") inB = false;
    continue;
  }
  if (ch === "'") {
    inS = true;
    continue;
  }
  if (ch === '"') {
    inD = true;
    continue;
  }
  if (ch === "`") {
    inB = true;
    continue;
  }
  if (ch === "(") {
    depth++;
  } else if (ch === ")") {
    depth--;
    if (depth < 0) {
      console.log("NEGATIVE at pos", i + 1, "char", ch);
      break;
    }
  }
}
console.log("final depth", depth);
// Print context around negative pos if found
let pos = -1;
for (let i = 0; i < line.length; i++) {
  if (line[i] === ")") {
    // naive check: count opens until this )
    let d = 0;
    let bad = false;
    for (let j = 0; j <= i; j++) {
      const ch = line[j];
      if (ch === "(") d++;
      if (ch === ")") d--;
      if (d < 0) {
        bad = true;
        break;
      }
    }
    if (bad) {
      pos = i + 1;
      break;
    }
  }
}
if (pos > 0) {
  console.log(
    "bad pos",
    pos,
    "context:",
    line.slice(Math.max(0, pos - 40), pos + 10),
  );
} else {
  console.log("no premature ) found");
}
