import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(process.argv[2] ?? ".");

const files = [
  "ADR-001.md",
  "ADR-002.md",
  "ADR-003A.md",
  "ADR-004.md",
  "ADR-005.md",
  "ADR-006.md",
  "ADR-007.md",
];

for (const file of files) {
  const adrPath = path.join(root, "docs/architecture/adr", file);

  if (fs.existsSync(adrPath) === false) {
    throw new Error(`Missing architecture decision: ${file}`);
  }

  const text = fs.readFileSync(adrPath, "utf8");

  if (/^Status: accepted$/m.test(text) === false) {
    throw new Error(`ADR not accepted: ${file}`);
  }
}

const domainRoot = path.join(root, "packages/domain");
if (!fs.existsSync(domainRoot)) throw new Error("Missing domain kernel");
const forbiddenGlobals = new Set([
  "process",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "globalThis",
  "global",
  "window",
  "document",
  "require",
  "eval",
  "Function",
  "setTimeout",
  "setInterval",
]);

function verifyFile(file) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const fail = (message) => {
    throw new Error(`${path.relative(root, file)}: ${message}`);
  };
  const checkImport = (specifier) => {
    if (!specifier || !ts.isStringLiteral(specifier))
      fail("Nonliteral domain import");
    const target = path.resolve(path.dirname(file), specifier.text);
    if (
      !specifier.text.startsWith(".") ||
      !target.startsWith(domainRoot + path.sep)
    )
      fail(`Domain dependency forbidden: ${specifier.text}`);
    if (!fs.existsSync(target + ".ts") && !fs.existsSync(target + "/index.ts"))
      fail(
        `Domain import must resolve to domain TypeScript: ${specifier.text}`
      );
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      checkImport(node.moduleSpecifier);
    if (ts.isImportTypeNode(node)) {
      if (!ts.isLiteralTypeNode(node.argument))
        fail("Nonliteral domain import type");
      checkImport(node.argument.literal);
    }
    if (ts.isImportEqualsDeclaration(node))
      fail("Import-equals forbidden in domain");
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      checkImport(node.arguments[0]);
    if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text))
      fail(`Domain I/O/global forbidden: ${node.text}`);
    if (
      ts.isPropertyAccessExpression(node) &&
      ((node.expression.getText(source) === "Math" &&
        node.name.text === "random") ||
        (node.expression.getText(source) === "Date" &&
          node.name.text === "now"))
    )
      fail("Implicit clock/random forbidden in domain");
    if (
      ts.isElementAccessExpression(node) &&
      ["Date", "Math"].includes(node.expression.getText(source))
    )
      fail("Computed clock/random access forbidden in domain");
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(source) === "Date" &&
      !node.arguments?.length
    )
      fail("Implicit clock forbidden in domain");
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlinks forbidden in domain");
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith(".ts")) verifyFile(file);
    else if (/\.[cm]?js$/.test(entry.name))
      throw new Error("Domain sources must be TypeScript");
  }
}

walk(domainRoot);
