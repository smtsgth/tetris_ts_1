const fs = require("fs");
const s = fs.readFileSync("c:\\dev_root\\tetris_ts_1\\dist\\ai.js", "utf8");
let i = 0;
let line = 1,
  col = 0;
let stateStack = []; // 'S','D','T' for '',"`, or template expr
let depthParen = 0,
  depthBrace = 0,
  depthBrack = 0;
function cur() {
  return stateStack[stateStack.length - 1];
}
while (i < s.length) {
  const ch = s[i];
  if (ch === "\n") {
    line++;
    col = 0;
    i++;
    continue;
  }
  col++;
  // handle escapes in strings/template
  if (ch === "\\") {
    i += 2;
    col++; // skip next char
    continue;
  }
  if (cur() === "S") {
    if (ch === "'") stateStack.pop();
    i++;
    continue;
  }
  if (cur() === "D") {
    if (ch === '"') stateStack.pop();
    i++;
    continue;
  }
  if (cur() === "T") {
    // inside template literal
    if (ch === "`") {
      stateStack.pop();
      i++;
      continue;
    }
    if (ch === "$" && s[i + 1] === "{") {
      // enter template expression
      stateStack.push("{");
      depthBrace++;
      i += 2;
      col += 2;
      continue;
    }
    // other chars inside template literal ignored
    i++;
    continue;
  }
  // inside template expression handled as normal code, but need to handle nested strings
  if (cur() === "{") {
    if (ch === "'") {
      stateStack.push("S");
      i++;
      continue;
    }
    if (ch === '"') {
      stateStack.push("D");
      i++;
      continue;
    }
    if (ch === "`") {
      stateStack.push("T");
      i++;
      continue;
    }
    if (ch === "(") {
      depthParen++;
      i++;
      continue;
    }
    if (ch === ")") {
      depthParen--;
      if (depthParen < 0) {
        console.log("UNBALANCED ) at", line, col);
        process.exit(1);
      }
      i++;
      continue;
    }
    if (ch === "[") {
      depthBrack++;
      i++;
      continue;
    }
    if (ch === "]") {
      depthBrack--;
      if (depthBrack < 0) {
        console.log("UNBALANCED ] at", line, col);
        process.exit(1);
      }
      i++;
      continue;
    }
    if (ch === "{") {
      depthBrace++;
      i++;
      continue;
    }
    if (ch === "}") {
      depthBrace--; // close one
      stateStack.pop(); // pop the '{'
      i++;
      continue;
    }
    // comments
    if (ch === "/" && s[i + 1] === "/") {
      // line comment
      i += 2;
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) {
        if (s[i] === "\n") {
          line++;
          col = 0;
        }
        i++;
      }
      i += 2;
      continue;
    }
    i++;
    continue;
  }
  // not in any special state
  if (ch === "'") {
    stateStack.push("S");
    i++;
    continue;
  }
  if (ch === '"') {
    stateStack.push("D");
    i++;
    continue;
  }
  if (ch === "`") {
    stateStack.push("T");
    i++;
    continue;
  }
  if (ch === "/" && s[i + 1] === "/") {
    i += 2;
    while (i < s.length && s[i] !== "\n") i++;
    continue;
  }
  if (ch === "/" && s[i + 1] === "*") {
    i += 2;
    while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) {
      if (s[i] === "\n") {
        line++;
        col = 0;
      }
      i++;
    }
    i += 2;
    continue;
  }
  if (ch === "(") {
    depthParen++;
    i++;
    continue;
  }
  if (ch === ")") {
    depthParen--;
    if (depthParen < 0) {
      console.log("UNBALANCED ) at", line, col);
      process.exit(1);
    }
    i++;
    continue;
  }
  if (ch === "[") {
    depthBrack++;
    i++;
    continue;
  }
  if (ch === "]") {
    depthBrack--;
    if (depthBrack < 0) {
      console.log("UNBALANCED ] at", line, col);
      process.exit(1);
    }
    i++;
    continue;
  }
  if (ch === "{") {
    depthBrace++;
    i++;
    continue;
  }
  if (ch === "}") {
    depthBrace--;
    if (depthBrace < 0) {
      console.log("UNBALANCED } at", line, col);
      process.exit(1);
    }
    i++;
    continue;
  }
  i++;
}
console.log("FINAL depths:", {
  paren: depthParen,
  brace: depthBrace,
  brack: depthBrack,
  stack: stateStack,
});
