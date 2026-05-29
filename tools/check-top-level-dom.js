#!/usr/bin/env node
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const scanDirs = ["src", "dist", "scripts", "recordings"];
const files = [];

function collect(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      collect(full);
    } else {
      if (/\.(js|ts|jsx|tsx)$/.test(e.name)) files.push(full);
    }
  }
}

for (const d of scanDirs) collect(path.join(root, d));

if (files.length === 0) {
  console.log("No JS/TS files found to scan.");
  process.exit(0);
}

const findings = [];

for (const file of files) {
  try {
    const content = fs.readFileSync(file, "utf8");
    const ext = path.extname(file).toLowerCase();
    const scriptKind =
      ext === ".ts"
        ? ts.ScriptKind.TS
        : ext === ".tsx"
          ? ts.ScriptKind.TSX
          : ext === ".jsx"
            ? ts.ScriptKind.JSX
            : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );

    function isTopLevel(node) {
      let p = node.parent;
      while (p && p.kind !== ts.SyntaxKind.SourceFile) {
        if (
          ts.isFunctionLike(p) ||
          ts.isClassDeclaration(p) ||
          ts.isMethodDeclaration(p) ||
          p.kind === ts.SyntaxKind.Constructor
        )
          return false;
        p = p.parent;
      }
      return true;
    }

    function visit(node) {
      if (
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)
      ) {
        let left = node.expression;
        while (
          ts.isPropertyAccessExpression(left) ||
          ts.isElementAccessExpression(left)
        )
          left = left.expression;
        if (ts.isIdentifier(left) && left.text === "document") {
          if (isTopLevel(node)) {
            // allow common safe patterns:
            // - document.readyState check used to decide DOMContentLoaded handling
            // - document.addEventListener('DOMContentLoaded', ...)
            let allowed = false;
            if (
              ts.isPropertyAccessExpression(node) &&
              node.name &&
              node.name.text === "readyState"
            ) {
              allowed = true;
            }
            if (
              !allowed &&
              ts.isPropertyAccessExpression(node) &&
              node.name &&
              node.name.text === "addEventListener"
            ) {
              const par = node.parent;
              if (
                par &&
                ts.isCallExpression(par) &&
                par.arguments &&
                par.arguments.length > 0
              ) {
                const arg0 = par.arguments[0];
                if (
                  (ts.isStringLiteral(arg0) ||
                    ts.isNoSubstitutionTemplateLiteral(arg0)) &&
                  arg0.text === "DOMContentLoaded"
                ) {
                  allowed = true;
                }
              }
            }
            if (!allowed) {
              const { line, character } = sf.getLineAndCharacterOfPosition(
                node.getStart(),
              );
              findings.push({
                file,
                line: line + 1,
                column: character + 1,
                text: node.getText(sf),
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sf);
  } catch (e) {
    // ignore parse errors for non-TS/JS or odd files
  }
}

if (findings.length > 0) {
  console.log("Top-level `document` usages detected:");
  for (const f of findings) {
    console.log(
      `- ${path.relative(root, f.file)}:${f.line}:${f.column}  ->  ${f.text}`,
    );
  }
  console.log(
    "\nPlease wrap these in DOMContentLoaded handlers or guard with null-checks.",
  );
  process.exit(1);
} else {
  console.log("No top-level `document` usages found.");
  process.exit(0);
}
