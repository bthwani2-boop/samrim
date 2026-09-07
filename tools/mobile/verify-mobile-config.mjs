import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const appsRoot = path.join(repoRoot, "apps");
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

const apps = fs
  .readdirSync(appsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((app) => fs.existsSync(path.join(appsRoot, app, "mobile.config.json")))
  .sort();

const seen = {
  slug: new Map(),
  scheme: new Map(),
  androidPackage: new Map(),
  iosBundleIdentifier: new Map(),
  projectId: new Map(),
};

let failed = false;

if (apps.length === 0) {
  console.error("No mobile hosts discovered from apps/*/mobile.config.json");
  process.exit(1);
}

for (const app of apps) {
  const appRoot = path.join(appsRoot, app);
  const configPath = path.join(appRoot, "mobile.config.json");
  const projectPath = path.join(appRoot, "project.json");
  const packagePath = path.join(appRoot, "package.json");

  if (!fs.existsSync(projectPath)) {
    console.error(`${app}: missing project.json`);
    failed = true;
    continue;
  }
  if (!fs.existsSync(packagePath)) {
    console.error(`${app}: missing package.json`);
    failed = true;
    continue;
  }

  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  if (!Array.isArray(project.tags) || !project.tags.includes("type:app")) {
    console.error(`${app}: project.json missing type:app`);
    failed = true;
  }
  if (project.root !== `apps/${app}`) {
    console.error(`${app}: project.root does not match apps/${app}`);
    failed = true;
  }

  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (typeof pkg.scripts?.start !== "string" || pkg.scripts.start.trim().length === 0) {
    console.error(`${app}: package.json missing mobile start script`);
    failed = true;
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
console.log("MOBILE_CONFIG=PASS apps=" + apps.join(","));
