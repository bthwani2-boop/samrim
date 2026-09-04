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

  if (missing.length > 0) {
    failures.push(label + " missing: " + missing.join(", "));
  }

  if (extra.length > 0) {
    failures.push(label + " unexpected: " + extra.join(", "));
  }
}

function filesUnder(prefix) {
  return tracked
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice(prefix.length));
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

const mobileRequiredFiles = [
  "README.md",
  "app.config.ts",
  "app/_layout.tsx",
  "app/index.tsx",
  "eas.json",
  "fingerprint.config.js",
  "index.js",
  "metro.config.cjs",
  "mobile.config.json",
  "package.json",
  "project.json",
  "tsconfig.json",
];

for (const app of mobileApps) {
  const base = "apps/" + app + "/";

  for (const relative of mobileRequiredFiles) {
    assert(
      trackedSet.has(base + relative),
      app + " missing Foundation host file: " + relative,
    );
  }

  const routeFiles = filesUnder(base + "app/");
  exactSet(
    app + " FOUNDATION_ROUTES",
    routeFiles,
    ["_layout.tsx", "index.tsx"],
  );

  assert(
    !tracked.some((item) => item.startsWith(base + "src/")),
    app + " contains premature src/ implementation during Foundation",
  );
}

const controlPanelBase = "apps/control-panel/";
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
    trackedSet.has(controlPanelBase + relative),
    "control-panel missing Foundation host file: " + relative,
  );
}

exactSet(
  "control-panel FOUNDATION_ROUTES",
  filesUnder(controlPanelBase + "app/"),
  ["globals.css", "layout.tsx", "page.tsx"],
);

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
      service + " missing Foundation service file: " + relative,
    );
  }

  const goFiles = filesUnder(base + "backend/")
    .filter((item) => item.endsWith(".go"));

  exactSet(
    service + " FOUNDATION_GO_FILES",
    goFiles,
    ["cmd/api/main.go", "internal/runtime/server.go"],
  );

  exactSet(
    service + " FOUNDATION_CONTRACT_FILES",
    filesUnder(base + "contracts/"),
    ["README.md"],
  );

  exactSet(
    service + " FOUNDATION_DATABASE_FILES",
    filesUnder(base + "database/"),
    ["README.md"],
  );

  exactSet(
    service + " FOUNDATION_TEST_FILES",
    filesUnder(base + "tests/"),
    ["README.md"],
  );

  const serverPath = path.join(
    repoRoot,
    base,
    "backend/internal/runtime/server.go",
  );
  const server = fs.readFileSync(serverPath, "utf8");
  const routeRegistrations = server.match(/mux\.HandleFunc\(/g) ?? [];

  assert(
    routeRegistrations.length === 2,
    service + " runtime must expose exactly health/readiness during Foundation",
  );

  assert(
    server.includes('prefix+"/health"') &&
      server.includes('prefix+"/readiness"'),
    service + " runtime health/readiness routes are incomplete",
  );
}

exactSet(
  "ROOT_CONTRACT_AUTHORITY_FILES",
  filesUnder("contracts/"),
  ["README.md"],
);

const actualPackages = tracked
  .filter((item) => item.startsWith("packages/"))
  .map((item) => item.slice("packages/".length))
  .filter((item) => item.includes("/"))
  .map((item) => item.split("/", 1)[0]);

exactSet("CANONICAL_PACKAGES", actualPackages, ["design-system"]);

const mobileLauncherPath = path.join(
  repoRoot,
  "tools/mobile/start-mobile-runtime.ps1",
);
const mobileLauncher = fs.readFileSync(mobileLauncherPath, "utf8");

for (const forbiddenSemanticBinding of [
  "IDENTITY_API_BASE_URL",
  "BTHWANI_IDENTITY_API_HOST_PORT",
  "WLT_API_BASE_URL",
  "DSH_API_BASE_URL",
]) {
  assert(
    !mobileLauncher.includes(forbiddenSemanticBinding),
    "Foundation mobile launcher contains premature semantic binding: " +
      forbiddenSemanticBinding,
  );
}

if (failures.length > 0) {
  console.error("FOUNDATION_STRUCTURE=FAIL");
  for (const failure of failures) {
    console.error("  " + failure);
  }
  process.exit(1);
}

console.log("TOP_LEVEL_CANONICAL_TAXONOMY=PASS");
console.log("DIRECT_DEPLOYABLE_HOST_SHELLS=PASS");
console.log("PREMATURE_BUSINESS_ROUTES_SCREENS=0");
console.log("SERVICE_PROCESS_SKELETONS=PASS");
console.log("PREMATURE_BUSINESS_ENDPOINTS_CONTRACTS_STATE_MACHINES=0");
console.log("ROOT_CONTRACT_AUTHORITY_BOUNDARY=PASS");
console.log("FOUNDATION_STRUCTURE=PASS");
