import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appKeys = ["app-captain", "app-client", "app-field", "app-partner"];
const projections = [
  { sourceName: "icon.png", targetNames: ["icon.png"] },
  { sourceName: "adaptive-icon.png", targetNames: ["adaptive-icon.png"] },
  { sourceName: "splash-icon.png", targetNames: ["splash-icon.png"] },
];
const checkOnly = process.argv.includes("--check");
const mismatches = [];
const canonicalSources = new Map();

for (const appKey of appKeys) {
  for (const { sourceName, targetNames } of projections) {
    const source = path.join(root, "packages", "design-system", "assets", "brand", appKey, sourceName);
    if (!fs.existsSync(source)) {
      throw new Error(`Missing canonical brand asset source: ${path.relative(root, source)}`);
    }
    const sourceBytes = fs.readFileSync(source);
    const siblings = canonicalSources.get(sourceName) ?? [];
    const previous = siblings.find((candidate) => candidate.bytes.equals(sourceBytes));
    if (previous) mismatches.push(`duplicate canonical ${sourceName}: ${path.relative(root, source)} matches ${path.relative(root, previous.path)}`);
    siblings.push({ bytes: sourceBytes, path: source });
    canonicalSources.set(sourceName, siblings);
    for (const targetName of targetNames) {
      const target = path.join(root, "apps", appKey, "assets", targetName);
      if (!checkOnly) fs.copyFileSync(source, target);
      if (!fs.existsSync(target) || !sourceBytes.equals(fs.readFileSync(target))) {
        mismatches.push(path.relative(root, target));
      }
    }
  }
}

if (mismatches.length > 0) {
  throw new Error(`Brand asset drift detected:\n${mismatches.join("\n")}`);
}

console.log(`${checkOnly ? "BRAND_ASSETS_CHECK" : "BRAND_ASSETS_GENERATE"}=PASS sources=${appKeys.length * projections.length} targets=${appKeys.length * projections.length}`);
