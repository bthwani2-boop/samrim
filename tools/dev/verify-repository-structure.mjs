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
  .map((item) => item.replaceAll("\\", "/"));

const trackedSet = new Set(tracked);
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function exactSet(label, actualValues, expectedValues) {
  const actual = [...new Set(actualValues)].sort();
  const expected = [...new Set(expectedValues)].sort();
  const missing = expected.filter((item) => !actual.includes(item));
  const extra = actual.filter((item) => !expected.includes(item));

  if (missing.length) failures.push(label + " missing: " + missing.join(", "));
  if (extra.length) failures.push(label + " unexpected: " + extra.join(", "));
}

const requiredTopLevelDirectories = [
  ".github",
  "apps",
  "contracts",
  "docs",
  "governance",
  "infra",
  "packages",
  "services",
  "tools",
];

const actualTopLevelDirectories = tracked
  .filter((item) => item.includes("/"))
  .map((item) => item.split("/", 1)[0]);

exactSet(
  "TOP_LEVEL_CANONICAL_TAXONOMY",
  actualTopLevelDirectories,
  requiredTopLevelDirectories,
);

for (const forbiddenRoot of ["core/", "shared/"]) {
  assert(
    !tracked.some((item) => item.startsWith(forbiddenRoot)),
    "Forbidden top-level ownership class tracked: " + forbiddenRoot,
  );
}

assert(
  !tracked.some((item) => /^apps\/[^/]+\/runtime\//.test(item)),
  "Pass-through apps/*/runtime topology is forbidden",
);

const expectedApps = [
  "app-client",
  "app-partner",
  "app-captain",
  "app-field",
  "control-panel",
];

const actualApps = tracked
  .filter((item) => item.startsWith("apps/"))
  .map((item) => item.slice("apps/".length))
  .filter((item) => item.includes("/"))
  .map((item) => item.split("/", 1)[0]);

exactSet("CANONICAL_APPS", actualApps, expectedApps);

const mobileApps = [
  "app-client",
  "app-partner",
  "app-captain",
  "app-field",
];

for (const app of mobileApps) {
  const base = "apps/" + app + "/";
  for (const relative of [
    "README.md",
    "app.config.ts",
    "app/_layout.tsx",
    "app/index.tsx",
    "assets/adaptive-icon.png",
    "assets/icon.png",
    "assets/notification-icon.png",
    "assets/splash-icon.png",
    "eas.json",
    "fingerprint.config.js",
    "index.js",
    "metro.config.cjs",
    "mobile.config.json",
    "package.json",
    "project.json",
    "tsconfig.json",
  ]) {
    assert(
      trackedSet.has(base + relative),
      app + " missing deployable host substrate: " + relative,
    );
  }
}

for (const relative of [
  "README.md",
  "app/globals.css",
  "app/layout.tsx",
  "app/page.tsx",
  "next.config.ts",
  "package.json",
  "project.json",
  "tsconfig.json",
]) {
  assert(
    trackedSet.has("apps/control-panel/" + relative),
    "control-panel missing deployable host substrate: " + relative,
  );
}

const expectedServices = ["identity", "workforce", "dsh", "wlt"];
const actualServices = tracked
  .filter((item) => item.startsWith("services/"))
  .map((item) => item.slice("services/".length))
  .filter((item) => item.includes("/"))
  .map((item) => item.split("/", 1)[0]);

exactSet("CANONICAL_SERVICES", actualServices, expectedServices);

for (const service of expectedServices) {
  const base = "services/" + service + "/";
  for (const relative of [
    "README.md",
    "project.json",
    "backend/Dockerfile",
    "backend/go.mod",
    "backend/cmd/api/main.go",
    "backend/internal/runtime/server.go",
    "contracts/README.md",
    "database/README.md",
    "tests/README.md",
  ]) {
    assert(
      trackedSet.has(base + relative),
      service + " missing canonical service substrate: " + relative,
    );
  }
}

const forbiddenAppContainers = [
  "app-client",
  "app-partner",
  "app-captain",
  "app-field",
  "control-panel",
];

for (const item of tracked) {
  if (!item.startsWith("services/")) continue;
  const segments = item.split("/");
  if (segments.some((segment, index) => index > 1 && forbiddenAppContainers.includes(segment))) {
    failures.push("Service contains app-shaped ownership container: " + item);
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
  if (!relative.startsWith("protocol/") && !relative.startsWith("generated/")) {
    failures.push(
      "Root contracts file requires explicit cross-service protocol/generated placement: " +
        item,
    );
  }
}

const actualPackages = tracked
  .filter((item) => item.startsWith("packages/"))
  .map((item) => item.slice("packages/".length))
  .filter((item) => item.includes("/"))
  .map((item) => item.split("/", 1)[0]);

exactSet("CANONICAL_PACKAGES", actualPackages, ["design-system"]);

for (const item of tracked) {
  if (!item.startsWith("infra/")) continue;

  if (
    /\/(?:contracts?|database|migrations?|schema)(?:\/|$)/i.test(item) ||
    /\/(?:orders?|wallet|ledger|catalog|checkout|identity|workforce)(?:\/|$)/i.test(item)
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

console.log("TOP_LEVEL_CANONICAL_TAXONOMY=PASS");
console.log("DIRECT_DEPLOYABLE_HOST_ROOTS=PASS");
console.log("CANONICAL_SERVICE_ROOTS=PASS");
console.log("SERVICE_TO_APP_DEPENDENCIES=0");
console.log("ROOT_CONTRACT_PLACEMENT=PASS");
console.log("PACKAGES_TECHNICAL_BOUNDARY=PASS");
console.log("INFRA_OWNERSHIP_BOUNDARY=PASS");
console.log("REPOSITORY_STRUCTURE=PASS");
