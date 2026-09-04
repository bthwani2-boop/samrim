import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const apps = ["app-client", "app-partner", "app-captain", "app-field"];
const requiredStringFields = [
  "name",
  "slug",
  "scheme",
  "owner",
  "version",
  "androidPackage",
  "iosBundleIdentifier",
  "projectId",
];

const seen = {
  slug: new Map(),
  scheme: new Map(),
  androidPackage: new Map(),
  iosBundleIdentifier: new Map(),
  projectId: new Map(),
};

let failed = false;

for (const app of apps) {
  const configPath = path.join(repoRoot, "apps", app, "mobile.config.json");
  if (!fs.existsSync(configPath)) {
    console.error(`MISSING ${configPath}`);
    failed = true;
    continue;
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  for (const field of requiredStringFields) {
    if (typeof config[field] !== "string" || config[field].trim().length === 0) {
      console.error(`${app}: invalid ${field}`);
      failed = true;
    }
  }
  if (!Array.isArray(config.nativeCapabilities)) {
    console.error(`${app}: nativeCapabilities must be an array`);
    failed = true;
  }

  for (const field of Object.keys(seen)) {
    const value = config[field];
    if (typeof value !== "string") continue;
    const previous = seen[field].get(value);
    if (previous) {
      console.error(`${field} collision: ${value} used by ${previous} and ${app}`);
      failed = true;
    } else {
      seen[field].set(value, app);
    }
  }
}

if (failed) process.exit(1);
console.log("MOBILE_CONFIG=PASS");
