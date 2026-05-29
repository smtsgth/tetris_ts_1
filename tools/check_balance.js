const fs = require("fs");
const s = fs.readFileSync("c:\\dev_root\\tetris_ts_1\\dist\\ai.js", "utf8");
let inS = false,
  inD = false,
  inB = false,
  inLineC = false,
  inBlockC = false,
  esc = false;
let line = 1,
  col = 0;
let depthParen = 0,
  depthBrace = 0,
  depthBrack = 0;
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  if (ch === "\n") {
    line++;
    col = 0;
    if (inLineC) inLineC = false;
    continue;
  }
  col++;
  if (inLineC) continue;
  if (inBlockC) {
    if (ch === "*" && s[i + 1] === "/") {
      inBlockC = false;
      i++;
      col++;
    }
    continue;
  }
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
  if (ch === "/" && s[i + 1] === "/") {
    inLineC = true;
    continue;
  }
  if (ch === "/" && s[i + 1] === "*") {
    inBlockC = true;
    i++;
    col++;
    continue;
  }
  if (ch === "(") {
    depthParen++;
  } else if (ch === ")") {
    depthParen--;
    if (depthParen < 0) {
      console.log("UNBALANCED ) at", line, col);
      break;
    }
  } else if (ch === "{") {
    depthBrace++;
  } else if (ch === "}") {
    depthBrace--;
    if (depthBrace < 0) {
      console.log("UNBALANCED } at", line, col);
      break;
    }
  } else if (ch === "[") {
    depthBrack++;
  } else if (ch === "]") {
    depthBrack--;
    if (depthBrack < 0) {
      console.log("UNBALANCED ] at", line, col);
      break;
    }
  }
}
console.log(
  "FINAL DEPTHS paren",
  depthParen,
  "brace",
  depthBrace,
  "brack",
  depthBrack,
);
