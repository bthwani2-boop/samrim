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

console.log("NONEXISTENT_WORKSPACE_DEPENDENCIES=0");
