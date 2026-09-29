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
  walk(path.join(repoRoot, root), root, (fullPath) => {
    if (path.basename(fullPath) === "package.json") manifests.push(fullPath);
  });
}

const contractsManifest = path.join(repoRoot, "contracts", "package.json");
if (fs.existsSync(contractsManifest)) manifests.push(contractsManifest);

const packages = new Map();
for (const manifest of manifests) {
  const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (typeof json.name === "string" && json.name.trim()) {
    packages.set(json.name, {
      root: path.posix.dirname(path.relative(repoRoot, manifest).replaceAll("\\", "/")),
      exports: json.exports,
    });
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
      const match = /(?:^|\s)["`]([^"`]+)["`]$/.exec(line);
      if (match) imports.push(match[1]);
      continue;
    }
    const match = /^import\s+(?:[._A-Za-z]\w*\s+)?["`]([^"`]+)["`]$/.exec(line);
    if (match) imports.push(match[1]);
  }
  return imports;
}

function packageExportTargets(exportsField, subpath) {
  if (exportsField === undefined) return [];

  const isSubpathMap = exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)
    && Object.keys(exportsField).some((key) => key.startsWith("."));
  let selected;
  if (isSubpathMap && Object.hasOwn(exportsField, subpath)) {
    selected = exportsField[subpath];
  } else if (!isSubpathMap && subpath === ".") {
    selected = exportsField;
  }
  if (selected === undefined) return [];

  const collect = (value) => {
    if (typeof value === "string") return value.startsWith("./") ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(collect);
    if (value && typeof value === "object") return Object.values(value).flatMap(collect);
    return [];
  };
  return [...new Set(collect(selected))];
}

function workspacePackageTargets(specifier) {
  const matches = [...packages.keys()]
    .filter((name) => specifier === name || specifier.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length);
  if (matches.length === 0) return [];
  const packageName = matches[0];
  const suffix = specifier.slice(packageName.length).replace(/^\//, "");
  const packageInfo = packages.get(packageName);
  const fallbackTarget = suffix ? path.posix.join(packageInfo.root, suffix) : packageInfo.root;
  if (packageInfo.exports === undefined) return [{ target: fallbackTarget, packageExported: true }];

  const exportTargets = packageExportTargets(packageInfo.exports, suffix ? `./${suffix}` : ".");
  if (exportTargets.length === 0) return [{ target: fallbackTarget, packageExported: false }];
  return exportTargets.map((target) => ({
    target: path.posix.join(packageInfo.root, target.slice(2)),
    packageExported: true,
  }));
}

function resolveRepositoryTargets(relativePath, specifier) {
  if (specifier.startsWith(repositoryModulePrefix)) return [{ target: specifier.slice(repositoryModulePrefix.length), packageExported: true }];
  if (specifier.startsWith("services/") || specifier.startsWith("apps/") || specifier.startsWith("packages/")) {
    return [{ target: specifier, packageExported: true }];
  }
  if (specifier.startsWith(".")) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier));
    return target.startsWith("../") ? [] : [{ target, packageExported: true }];
  }
  return workspacePackageTargets(specifier);
}

function serviceOwner(relativePath) {
  const match = /^services\/([^/]+)(?:\/|$)/.exec(relativePath);
  return match ? match[1] : null;
}

function isPublicServiceBoundary(target, service) {
  return target.startsWith(`services/${service}/clients/`) || target.startsWith(`services/${service}/contracts/`);
}

function sourceLayer(relativePath) {
  if (relativePath.startsWith("apps/")) return "apps";
  if (relativePath.startsWith("packages/")) return "packages";
  return null;
}

function applicationBoundaryViolation(relativePath, specifier, target, packageExported, targetService, publicBoundary) {
  const layer = sourceLayer(relativePath);
  if (!layer || !targetService || (publicBoundary && packageExported)) return null;
  const detail = packageExported ? "service implementation" : "unexported service package path";
  return `${relativePath}: ${layer} cannot import ${detail} (${specifier} -> ${target})`;
}

function crossServiceBoundaryViolation(relativePath, specifier, target, packageExported, targetService, publicBoundary) {
  const sourceService = serviceOwner(relativePath);
  if (!sourceService || !targetService || sourceService === targetService || (publicBoundary && packageExported)) return null;
  const detail = target.includes("/internal/") ? "cross-service internal import" : "cross-service implementation import";
  return `${relativePath}: ${detail} is forbidden; ${sourceService} must consume ${targetService} through clients/ or contracts/ (${specifier} -> ${target})`;
}

function enforceBoundary(relativePath, specifier) {
  for (const { target, packageExported } of resolveRepositoryTargets(relativePath, specifier)) {
    const targetService = serviceOwner(target);
    const publicBoundary = Boolean(targetService && isPublicServiceBoundary(target, targetService));
    const applicationViolation = applicationBoundaryViolation(relativePath, specifier, target, packageExported, targetService, publicBoundary);
    if (applicationViolation) {
      boundaryViolations.push(applicationViolation);
      continue;
    }
    const crossServiceViolation = crossServiceBoundaryViolation(relativePath, specifier, target, packageExported, targetService, publicBoundary);
    if (crossServiceViolation) boundaryViolations.push(crossServiceViolation);
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
