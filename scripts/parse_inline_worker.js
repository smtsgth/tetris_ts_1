const fs = require("fs");
const acorn = require("acorn");
const s = fs.readFileSync("dist/ai.js", "utf8");
const startMarker = "const code = `";
const start = s.indexOf(startMarker);
if (start < 0) {
  console.error("no start");
  process.exit(2);
}
const blobIdx = s.indexOf("const blob = new Blob([code]", start);
if (blobIdx < 0) {
  console.error("no blob");
  process.exit(2);
}
const close = s.lastIndexOf("`", blobIdx);
if (close < 0) {
  console.error("no close");
  process.exit(2);
}
const inner = s.slice(start + startMarker.length, close);
if (!fs.existsSync("tmp")) fs.mkdirSync("tmp");
fs.writeFileSync("tmp/inline_worker_blob.js", inner, "utf8");
console.log("wrote tmp/inline_worker_blob.js length", inner.length);
try {
  acorn.parse(inner, { ecmaVersion: 2020 });
  console.log("ACORN OK");
} catch (e) {
  console.error("ACORN ERR", e.message);
  console.error(e.loc);
  process.exit(3);
}
