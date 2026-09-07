import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  })
  .split("\0")
  .filter(Boolean)
  .map((item) => item.replaceAll("\\", "/"))
  .filter((item) => fs.existsSync(path.join(repoRoot, item)));

const trackedSet = new Set(tracked);
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
  } catch (error) {
    failures.push(relativePath + " is missing or invalid JSON: " + error.message);
    return null;
  }
}

function directChildren(rootName) {
  return [...new Set(
    tracked
      .filter((item) => item.startsWith(rootName + "/"))
      .map((item) => item.slice(rootName.length + 1))
      .filter((item) => item.includes("/"))
      .map((item) => item.split("/", 1)[0]),
  )].sort();
}

function projectFor(rootName, name, expectedTag) {
  const base = rootName + "/" + name + "/";
  const projectPath = base + "project.json";
  assert(trackedSet.has(projectPath), base + " must contain project.json");
  if (!trackedSet.has(projectPath)) return null;

  const project = readJson(projectPath);
  if (!project) return null;

  assert(project.root === rootName + "/" + name, projectPath + " root must equal its repository path");
  assert(project.name === name, projectPath + " name must equal direct child directory name");
  assert(Array.isArray(project.tags) && project.tags.includes(expectedTag), projectPath + " missing " + expectedTag);
  return { base, project };
}

const allowedTopLevelDirectories = new Set([
  ".github",
  "apps",
  "contracts",
  "docs",
  "governance",
  "infra",
  "packages",
  "services",
  "tools",
]);

const actualTopLevelDirectories = [...new Set(
  tracked
    .filter((item) => item.includes("/"))
    .map((item) => item.split("/", 1)[0]),
)].sort();

for (const top of actualTopLevelDirectories) {
  assert(allowedTopLevelDirectories.has(top), "Unadmitted top-level ownership class tracked: " + top);
}

for (const required of [".github", "governance", "docs", "tools"]) {
  assert(actualTopLevelDirectories.includes(required), "Required repository knowledge/tooling root missing: " + required);
}

for (const forbiddenRoot of ["core/", "shared/"]) {
  assert(
    !tracked.some((item) => item.startsWith(forbiddenRoot)),
    "Forbidden top-level ownership class tracked: " + forbiddenRoot,
  );
}

const packageManagerLockfiles = tracked.filter((item) =>
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(item),
);
assert(
  packageManagerLockfiles.length === 1 && packageManagerLockfiles[0] === "pnpm-lock.yaml",
  "Canonical package-manager lockfile must be exactly pnpm-lock.yaml; found: " + packageManagerLockfiles.join(", "),
);

assert(
  !tracked.some((item) => /^apps\/[^/]+\/runtime\//.test(item)),
  "Pass-through apps/*/runtime topology is forbidden",
);

const appNames = directChildren("apps");
for (const app of appNames) {
  const record = projectFor("apps", app, "type:app");
  if (!record) continue;

  const { base, project } = record;
  assert(project.projectType === "application", base + " projectType must be application");
  for (const relative of ["README.md", "package.json"]) {
    assert(trackedSet.has(base + relative), app + " missing deployable host substrate: " + relative);
  }

  const isExpo = trackedSet.has(base + "mobile.config.json") || trackedSet.has(base + "app.config.ts");
  const isNext = trackedSet.has(base + "next.config.ts") || trackedSet.has(base + "next.config.js") || trackedSet.has(base + "next.config.mjs");

  if (isExpo) {
    for (const relative of [
      ".easignore",
      "app.config.ts",
      "app/_layout.tsx",
      "app/index.tsx",
      "eas.json",
      "fingerprint.config.js",
      "index.js",
      "metro.config.cjs",
      "mobile.config.json",
      "tsconfig.json",
    ]) {
      assert(trackedSet.has(base + relative), app + " missing Expo host substrate: " + relative);
    }
  }

  if (isNext) {
    const hasNextConfig = trackedSet.has(base + "next.config.ts") || trackedSet.has(base + "next.config.js") || trackedSet.has(base + "next.config.mjs");
    assert(hasNextConfig, app + " missing Next config substrate");
    for (const relative of [
      "app/layout.tsx",
      "app/page.tsx",
      "tsconfig.json",
    ]) {
      assert(trackedSet.has(base + relative), app + " missing Next host substrate: " + relative);
    }
  }

  assert(isExpo || isNext || Object.keys(project.targets ?? {}).some((name) => ["build", "serve", "dev"].includes(name)),
    app + " has no recognized deployable/runtime target");
}

const serviceNames = directChildren("services");
for (const service of serviceNames) {
  const record = projectFor("services", service, "type:service");
  if (!record) continue;

  const { base, project } = record;
  assert(project.projectType === "application", base + " projectType must be application");
  assert(trackedSet.has(base + "README.md"), service + " missing service README.md");

  const hasGoBackend = trackedSet.has(base + "backend/go.mod");
  if (hasGoBackend) {
    for (const relative of [
      "backend/Dockerfile",
      "backend/cmd/api/main.go",
      "backend/internal/runtime/server.go",
    ]) {
      assert(trackedSet.has(base + relative), service + " missing Go service substrate: " + relative);
    }
  }

  for (const lane of ["contracts/", "database/", "tests/"]) {
    const laneFiles = tracked.filter((item) => item.startsWith(base + lane));
    if (laneFiles.length > 0) {
      const materialLaneFiles = laneFiles.filter((item) => !item.endsWith("/README.md"));
      assert(
        materialLaneFiles.length > 0,
        service + " has an empty admitted lane: " + lane,
      );
    }
  }
}

const forbiddenAppContainers = new Set(appNames);
for (const item of tracked) {
  if (!item.startsWith("services/")) continue;
  const segments = item.split("/");
  if (segments.some((segment, index) => index > 1 && forbiddenAppContainers.has(segment))) {
    failures.push("Service contains app-shaped ownership container: " + item);
  }
  if (/^services\/[^/]+\/frontend\//.test(item)) {
    failures.push("Service contains non-admitted frontend tree: " + item);
  }
}

const codeLikeServiceFiles = tracked.filter(
  (item) =>
    item.startsWith("services/") &&
    /\.(go|ts|tsx|js|jsx|mjs|cjs|json|yaml|yml)$/.test(item),
);

for (const item of codeLikeServiceFiles) {
  const absolute = path.join(repoRoot, item);
  const content = fs.readFileSync(absolute, "utf8");

  if (
    /github\.com\/bthwani2-boop\/samrim\/apps\//.test(content) ||
    /(?:\.\.\/)+apps\//.test(content)
  ) {
    failures.push("SERVICE_TO_APP_DEPENDENCY: " + item);
  }
}

const rootContractFiles = tracked.filter((item) => item.startsWith("contracts/"));
for (const item of rootContractFiles) {
  if (item === "contracts/README.md") continue;

  const relative = item.slice("contracts/".length);
  if (
    !relative.startsWith("protocol/") &&
    !relative.startsWith("generated/") &&
    !relative.startsWith("catalog/")
  ) {
    failures.push(
      "Root contracts file requires explicit cross-service protocol/generated/catalog placement: " +
        item,
    );
  }
}

const packageNames = directChildren("packages");
for (const packageName of packageNames) {
  const record = projectFor("packages", packageName, "type:package");
  if (!record) continue;

  const { base, project } = record;
  assert(project.projectType === "library", base + " projectType must be library");
  assert(trackedSet.has(base + "package.json"), packageName + " missing package.json");

  for (const forbidden of ["backend/", "database/", "migrations/", "cmd/"]) {
    assert(
      !tracked.some((item) => item.startsWith(base + forbidden)),
      "Reusable package contains service/storage ownership lane: " + base + forbidden,
    );
  }
}

for (const item of tracked) {
  if (!item.startsWith("infra/")) continue;

  if (
    /\/(?:contracts?|database|migrations?|schema)(?:\/|$)/i.test(item) ||
    /\/(?:orders?|wallet|ledger|catalog|checkout|identity)(?:\/|$)/i.test(item)
  ) {
    failures.push("Infra contains service/business ownership path: " + item);
  }
}

if (failures.length) {
  console.error("REPOSITORY_STRUCTURE=FAIL");
  for (const failure of [...new Set(failures)].sort()) {
    console.error("  " + failure);
  }
  process.exit(1);
}

console.log("TOP_LEVEL_TAXONOMY=PASS");
console.log("DISCOVERED_APPS=" + appNames.join(","));
console.log("DISCOVERED_SERVICES=" + serviceNames.join(","));
console.log("DISCOVERED_PACKAGES=" + packageNames.join(","));
console.log("DIRECT_DEPLOYABLE_HOST_ROOTS=PASS");
console.log("SERVICE_TO_APP_DEPENDENCIES=0");
console.log("SERVICE_FRONTEND_TREES=0");
console.log("ROOT_CONTRACT_PLACEMENT=PASS");
console.log("PACKAGES_TECHNICAL_BOUNDARY=PASS");
console.log("INFRA_OWNERSHIP_BOUNDARY=PASS");
console.log("MANUAL_PROJECT_NAME_REGISTRY=0");
console.log("REPOSITORY_STRUCTURE=PASS");
