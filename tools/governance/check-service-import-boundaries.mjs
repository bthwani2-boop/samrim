import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript-ast";

const internalPath = /(?:^|\/)services\/(dsh|identity|wlt)\/backend\/internal(?:\/|$)/;

function owner(file) {
  const match = /^services\/(dsh|identity|wlt)\/backend\//.exec(file);
  return match?.[1] ?? null;
}

function violatingImport(file, specifier) {
  const match = internalPath.exec(specifier.replaceAll("\\", "/"));
  return match && owner(file) !== match[1]
    ? { file, specifier, unauthorizedOwner: match[1] }
    : null;
}

export function scanServiceBoundaryFile(file, content) {
  const found = [];
  const observe = (specifier) => {
    const violation = violatingImport(file, specifier);
    if (violation) found.push(violation);
  };
  if (file.endsWith(".go")) {
    // Capture Go's single- and grouped-import declarations. Do not examine strings outside imports.
    for (const match of content.matchAll(/\bimport\s*(?:\(([\s\S]*?)\)|(?:[A-Za-z_.][\w.]*\s+)?"([^"\n]+)")/g)) {
      if (match[2]) observe(match[2]);
      else for (const imported of match[1].matchAll(/(?:^|\n)\s*(?:[A-Za-z_.][\w.]*\s+)?["]([^"\n]+)["]/g)) {
        observe(imported[1]);
      }
    }
    return found;
  }
  if (!/\.(?:c?js|mjs|mts|cts|tsx?|jsx?)$/.test(file)) return found;
  const parsed = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      observe(node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      observe(node.moduleReference.expression.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      observe(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

function trackedSources(root) {
  const collected = new Set();
  for (const args of [["ls-files", "-z"], ["ls-files", "--others", "--exclude-standard", "-z"]]) {
    const raw = execFileSync("git", args, { cwd: root, encoding: "utf8" });
    for (const file of raw.split("\0")) {
      if (file && (/\.go$/.test(file) || /\.(?:c?js|mjs|mts|cts|tsx?|jsx?)$/.test(file))) collected.add(file);
    }
  }
  return [...collected].sort();
}

export function scanRepositoryServiceBoundaries(root) {
  const violations = [];
  let checked = 0;
  for (const file of trackedSources(root)) {
    const path = resolve(root, file);
    const descriptor = openSync(path, "r");
    try {
      if (!fstatSync(descriptor).isFile()) continue;
      checked++;
      violations.push(...scanServiceBoundaryFile(file, readFileSync(descriptor, "utf8")));
    } finally {
      closeSync(descriptor);
    }
  }
  return { checked, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, "../..");
  const result = scanRepositoryServiceBoundaries(root);
  if (result.violations.length) {
    console.error("SERVICE_IMPORT_BOUNDARY=FAIL", JSON.stringify(result.violations.slice(0, 20)));
    process.exitCode = 1;
  } else {
    console.log("SERVICE_IMPORT_BOUNDARY=PASS files=" + result.checked);
  }
}
