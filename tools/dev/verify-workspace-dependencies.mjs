import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const roots = ["apps", "services", "packages"];
const manifests = [];
const ignoredDirectories = new Set(["node_modules", ".next", ".expo", "dist", "coverage", ".nx", ".git"]);

function walk(rootPath, relativeRoot, visitor) {
  if (!fs.existsSync(rootPath)) return;
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(rootPath, entry.name);
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory()) walk(fullPath, relativePath, visitor);
    else visitor(fullPath, relativePath);
  }
}

for (const root of roots) {
  walk(path.join(repoRoot, root), root, (fullPath, relativePath) => {
    if (path.basename(fullPath) === "package.json") manifests.push(fullPath);
  });
}

const contractsManifest = path.join(repoRoot, "contracts", "package.json");
if (fs.existsSync(contractsManifest)) manifests.push(contractsManifest);

const packages = new Map();
for (const manifest of manifests) {
  const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (typeof json.name === "string" && json.name.trim()) {
    packages.set(json.name, path.posix.dirname(path.relative(repoRoot, manifest).replaceAll("\\", "/")));
  }
}

const missing = [];
for (const manifest of manifests) {
  const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(json[section] ?? {})) {
      if (typeof spec === "string" && spec.startsWith("workspace:") && !packages.has(name)) {
        missing.push(`${path.relative(repoRoot, manifest)}: ${section} -> ${name} (${spec})`);
      }
    }
  }
}

if (missing.length > 0) {
  console.error("NONEXISTENT_WORKSPACE_DEPENDENCIES:");
  for (const item of missing) console.error(`  ${item}`);
  process.exit(1);
}

const boundaryViolations = [];
const repositoryModulePrefix = "github.com/bthwani2-boop/samrim/";

function scriptKind(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".ts")) return ts.ScriptKind.TS;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function javascriptImportSpecifiers(filePath, content) {
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind(filePath));
  const imports = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        imports.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function goImportSpecifiers(content) {
  const imports = [];
  let inBlock = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!inBlock && /^import\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line === ")") {
        inBlock = false;
        continue;
      }
      const match = line.match(/(?:^|\s)["`]([^"`]+)["`]$/);
      if (match) imports.push(match[1]);
      continue;
    }
    const match = line.match(/^import\s+(?:[._A-Za-z][A-Za-z0-9_]*\s+)?["`]([^"`]+)["`]$/);
    if (match) imports.push(match[1]);
  }
  return imports;
}

function workspacePackageTarget(specifier) {
  const matches = [...packages.keys()]
    .filter((name) => specifier === name || specifier.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length);
  if (matches.length === 0) return null;
  const packageName = matches[0];
  const suffix = specifier.slice(packageName.length).replace(/^\//, "");
  return suffix ? path.posix.join(packages.get(packageName), suffix) : packages.get(packageName);
}

function resolveRepositoryTarget(relativePath, specifier) {
  if (specifier.startsWith(repositoryModulePrefix)) return specifier.slice(repositoryModulePrefix.length);
  if (specifier.startsWith("services/") || specifier.startsWith("apps/") || specifier.startsWith("packages/")) return specifier;
  if (specifier.startsWith(".")) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier));
    return target.startsWith("../") ? null : target;
  }
  return workspacePackageTarget(specifier);
}

function serviceOwner(relativePath) {
  const match = relativePath.match(/^services\/([^/]+)\//);
  return match ? match[1] : null;
}

function enforceBoundary(relativePath, specifier) {
  const target = resolveRepositoryTarget(relativePath, specifier);
  if (!target) return;

  const sourceIsApp = relativePath.startsWith("apps/");
  const sourceIsPackage = relativePath.startsWith("packages/");
  const targetService = serviceOwner(target);
  if ((sourceIsApp || sourceIsPackage) && targetService) {
    boundaryViolations.push(`${relativePath}: ${sourceIsApp ? "apps" : "packages"} cannot import service implementation (${specifier} -> ${target})`);
    return;
  }

  const sourceService = serviceOwner(relativePath);
  if (!sourceService || !targetService || sourceService === targetService) return;

  const publicBoundary = target.startsWith(`services/${targetService}/clients/`) || target.startsWith(`services/${targetService}/contracts/`);
  if (!publicBoundary) {
    const detail = target.includes("/internal/") ? "cross-service internal import" : "cross-service implementation import";
    boundaryViolations.push(`${relativePath}: ${detail} is forbidden; ${sourceService} must consume ${targetService} through clients/ or contracts/ (${specifier} -> ${target})`);
  }
}

function checkFileImports(filePath, relativePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const specifiers = filePath.endsWith(".go") ? goImportSpecifiers(content) : javascriptImportSpecifiers(filePath, content);
  for (const specifier of specifiers) enforceBoundary(relativePath, specifier);
}

for (const root of roots) {
  walk(path.join(repoRoot, root), root, (fullPath, relativePath) => {
    if (/\.(ts|tsx|js|jsx|mjs|cjs|go)$/.test(fullPath)) checkFileImports(fullPath, relativePath);
  });
}

if (boundaryViolations.length > 0) {
  console.error("WORKSPACE_BOUNDARY_VIOLATIONS:");
  for (const violation of boundaryViolations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log("NONEXISTENT_WORKSPACE_DEPENDENCIES=0");
console.log("WORKSPACE_BOUNDARY_VIOLATIONS=0");
console.log("WORKSPACE_DEPENDENCIES_VERIFY=PASS");
