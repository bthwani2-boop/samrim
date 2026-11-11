import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveTrustedExecutable } from "../dev/trusted-executables.mjs";
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

const migrationOwnerPath = /^services\/(dsh\/backend\/internal\/storage\/postgres|identity\/database|wlt\/database)\/migrations\/[^/]+\.sql$/;

function sqlMigrationOwner(file) {
  const match = migrationOwnerPath.exec(file);
  if (!match) return null;
  if (match[1].startsWith("dsh/")) return "dsh";
  if (match[1].startsWith("identity/")) return "identity";
  return "wlt";
}

function migrationBoundaryViolations(file, content) {
  const expectedOwner = sqlMigrationOwner(file);
  if (!expectedOwner) return [];
  // Inspect SQL identifiers, not comments or business text literals. This is a
  // static boundary check, not a SQL parser or a substitute for DB role grants.
  const sql = content
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ");
  const violations = [];
  const checkOwner = (foreignOwner, specifier) => {
    if (foreignOwner.toLowerCase() !== expectedOwner) {
      violations.push({ file, specifier, unauthorizedOwner: foreignOwner.toLowerCase() });
    }
  };
  for (const match of sql.matchAll(/(?:"(dsh|identity|wlt)"|\b(dsh|identity|wlt))\s*\.\s*(?:"[a-z_][\w]*"|[a-z_][\w]*)/gi)) {
    checkOwner(match[1] ?? match[2], match[0]);
  }
  for (const match of sql.matchAll(/\b(?:CREATE|ALTER|DROP)\s+SCHEMA\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:"(dsh|identity|wlt)"|\b(dsh|identity|wlt)\b)/gi)) {
    checkOwner(match[1] ?? match[2], match[0]);
  }
  return violations;
}

export function scanServiceBoundaryFile(file, content) {
  if (file.endsWith(".sql")) return migrationBoundaryViolations(file, content);
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
    const raw = execFileSync(resolveTrustedExecutable("git"), args, { cwd: root, encoding: "utf8" });
    for (const file of raw.split("\0")) {
      if (file && (/\.go$/.test(file) || /\.(?:c?js|mjs|mts|cts|tsx?|jsx?)$/.test(file) || sqlMigrationOwner(file))) collected.add(file);
    }
  }
  return [...collected].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

export function scanRepositoryServiceBoundaries(root) {
  const violations = [];
  let checked = 0;
  let migrationsChecked = 0;
  for (const file of trackedSources(root)) {
    const path = resolve(root, file);
    let descriptor;
    try {
      descriptor = openSync(path, "r");
    } catch (error) {
      // Git still lists tracked files deleted or moved in the unstaged worktree.
      // There is no source left to scan; preserve errors other than ENOENT.
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    try {
      if (!fstatSync(descriptor).isFile()) continue;
      checked++;
      if (sqlMigrationOwner(file)) migrationsChecked++;
      violations.push(...scanServiceBoundaryFile(file, readFileSync(descriptor, "utf8")));
    } finally {
      closeSync(descriptor);
    }
  }
  return { checked, migrationsChecked, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, "../..");
  const result = scanRepositoryServiceBoundaries(root);
  if (result.violations.length) {
    console.error("SERVICE_IMPORT_BOUNDARY=FAIL", JSON.stringify(result.violations.slice(0, 20)));
    process.exitCode = 1;
  } else {
    console.log("SERVICE_IMPORT_BOUNDARY=PASS files=" + result.checked + " migrations=" + result.migrationsChecked);
  }
}
