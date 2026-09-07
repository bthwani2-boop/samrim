import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appKeys = ["app-captain", "app-client", "app-field", "app-partner"];
const assetNames = ["icon.png", "adaptive-icon.png", "splash-icon.png"];
const mismatches = [];
const assetsByRole = new Map();

for (const appKey of appKeys) {
  const appAssets = [];
  for (const assetName of assetNames) {
    const assetPath = path.join(root, "apps", appKey, "assets", assetName);
    if (!fs.existsSync(assetPath)) {
      mismatches.push(`missing ${path.relative(root, assetPath)}`);
      continue;
    }
    const bytes = fs.readFileSync(assetPath);
    if (bytes.length === 0) mismatches.push(`empty ${path.relative(root, assetPath)}`);
    appAssets.push({ bytes, path: assetPath });
    const role = assetsByRole.get(assetName) ?? [];
    const previous = role.find((candidate) => candidate.bytes.equals(bytes));
    if (previous) mismatches.push(`duplicate ${assetName}: ${path.relative(root, assetPath)} matches ${path.relative(root, previous.path)}`);
    role.push({ bytes, path: assetPath });
    assetsByRole.set(assetName, role);
  }
  for (let index = 0; index < appAssets.length; index += 1) {
    for (let siblingIndex = index + 1; siblingIndex < appAssets.length; siblingIndex += 1) {
      if (appAssets[index].bytes.equals(appAssets[siblingIndex].bytes)) {
        mismatches.push(`duplicate assets in ${appKey}: ${path.relative(root, appAssets[index].path)} matches ${path.relative(root, appAssets[siblingIndex].path)}`);
      }
    }
  }
}

if (mismatches.length > 0) {
  throw new Error(`Brand asset drift detected:\n${mismatches.join("\n")}`);
}

console.log(`BRAND_ASSETS_CHECK=PASS apps=${appKeys.length} assets=${appKeys.length * assetNames.length}`);
