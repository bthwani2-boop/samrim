import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const roots = ["apps", "services", "packages"];
const manifests = [];

for (const root of roots) {
  const rootPath = path.join(repoRoot, root);
  if (!fs.existsSync(rootPath)) continue;

  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(rootPath, entry.name, "package.json");
    if (fs.existsSync(manifest)) manifests.push(manifest);
  }
}

const contractsManifest = path.join(repoRoot, "contracts", "package.json");
if (fs.existsSync(contractsManifest)) manifests.push(contractsManifest);

const packages = new Map();
for (const manifest of manifests) {
  const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (typeof json.name === "string" && json.name.trim()) {
    packages.set(json.name, path.relative(repoRoot, manifest));
  }
}

const missing = [];
for (const manifest of manifests) {
  const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(json[section] ?? {})) {
      if (typeof spec === "string" && spec.startsWith("workspace:") && !packages.has(name)) {
        missing.push(
          `${path.relative(repoRoot, manifest)}: ${section} -> ${name} (${spec})`,
        );
      }
    }
  }
}

if (missing.length > 0) {
  console.error("NONEXISTENT_WORKSPACE_DEPENDENCIES:");
  for (const item of missing) console.error(`  ${item}`);
  process.exit(1);
}

// Architectural Boundary & Dependency Direction Enforcement
const boundaryViolations = [];

function checkFileImports(filePath, relativePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Apps cannot import private service backend internals
    if (relativePath.startsWith("apps/")) {
      const match = line.match(/(?:import|from|require)\s*\(?['"]([^'"]+)['"]/);
      if (match) {
        const importPath = match[1];
        if (
          importPath.includes("services/") ||
          importPath.includes("/backend/") ||
          importPath.includes("/internal/")
        ) {
          boundaryViolations.push(
            `${relativePath}:${i + 1}: apps cannot import service private internals (${importPath})`
          );
        }
      }
    }

    // DSH cannot import Identity backend internals (only public Go client)
    if (relativePath.startsWith("services/dsh/")) {
      if (line.includes("services/identity/backend/internal")) {
        boundaryViolations.push(
          `${relativePath}:${i + 1}: DSH cannot import Identity backend internals directly`
        );
      }
    }
  }
}

function scanDir(dir, relDir = "") {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".expo" || entry.name === "dist") continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relDir, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      scanDir(fullPath, relPath);
    } else if (/\.(ts|tsx|js|mjs|cjs|go)$/.test(entry.name)) {
      checkFileImports(fullPath, relPath);
    }
  }
}

scanDir(path.join(repoRoot, "apps"), "apps");
scanDir(path.join(repoRoot, "services/dsh"), "services/dsh");

if (boundaryViolations.length > 0) {
  console.error("WORKSPACE_BOUNDARY_VIOLATIONS:");
  for (const v of boundaryViolations) console.error(`  ${v}`);
  process.exit(1);
}

console.log("NONEXISTENT_WORKSPACE_DEPENDENCIES=0");
console.log("WORKSPACE_BOUNDARY_VIOLATIONS=0");
console.log("WORKSPACE_DEPENDENCIES_VERIFY=PASS");
