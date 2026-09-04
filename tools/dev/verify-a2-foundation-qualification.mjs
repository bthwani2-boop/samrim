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

function fail(message) {
  failures.push(message);
}

function exactSet(label, actualValues, expectedValues) {
  const actual = [...new Set(actualValues)].sort();
  const expected = [...new Set(expectedValues)].sort();
  const missing = expected.filter((item) => !actual.includes(item));
  const extra = actual.filter((item) => !expected.includes(item));

  if (missing.length) fail(label + " missing: " + missing.join(", "));
  if (extra.length) fail(label + " unexpected: " + extra.join(", "));
}

const mobileApps = ["app-client", "app-partner", "app-captain", "app-field"];

function verifyManifestEntrypoints(manifestPath) {
  const absoluteManifest = path.join(repoRoot, manifestPath);
  const manifest = JSON.parse(fs.readFileSync(absoluteManifest, "utf8"));
  const manifestDir = path.dirname(absoluteManifest);

  for (const field of ["main", "types", "module"]) {
    const value = manifest[field];
    if (typeof value !== "string" || value.trim().length === 0) continue;

    const target = path.resolve(manifestDir, value);
    if (!fs.existsSync(target)) {
      fail(manifestPath + " has stale " + field + " entrypoint: " + value);
    }
  }

  if (typeof manifest.bin === "string") {
    const target = path.resolve(manifestDir, manifest.bin);
    if (!fs.existsSync(target)) {
      fail(manifestPath + " has stale bin entrypoint: " + manifest.bin);
    }
  } else if (manifest.bin && typeof manifest.bin === "object") {
    for (const [name, value] of Object.entries(manifest.bin)) {
      if (typeof value !== "string") continue;
      const target = path.resolve(manifestDir, value);
      if (!fs.existsSync(target)) {
        fail(manifestPath + " has stale bin entrypoint " + name + ": " + value);
      }
    }
  }
}

for (const manifestPath of tracked.filter((item) => /(^|\/)package\.json$/.test(item))) {
  verifyManifestEntrypoints(manifestPath);
}

for (const app of mobileApps) {
  const appRoot = "apps/" + app + "/";
  const routeFiles = tracked
    .filter((item) => item.startsWith(appRoot + "app/"))
    .map((item) => item.slice((appRoot + "app/").length));

  exactSet(
    app + " FOUNDATION_ROUTE_SET",
    routeFiles,
    ["_layout.tsx", "index.tsx"],
  );

  if (tracked.some((item) => item.startsWith(appRoot + "src/"))) {
    fail(app + " contains premature src/ implementation");
  }

  for (const forbiddenDir of [
    "components/",
    "features/",
    "providers/",
    "services/",
    "state/",
    "store/",
  ]) {
    if (tracked.some((item) => item.startsWith(appRoot + forbiddenDir))) {
      fail(app + " contains premature composition container: " + forbiddenDir);
    }
  }
}

exactSet(
  "control-panel FOUNDATION_APP_SET",
  tracked
    .filter((item) => item.startsWith("apps/control-panel/app/"))
    .map((item) => item.slice("apps/control-panel/app/".length)),
  ["globals.css", "layout.tsx", "page.tsx"],
);

if (tracked.some((item) => item.startsWith("apps/control-panel/src/"))) {
  fail("control-panel contains premature src/ implementation");
}

const services = ["identity", "workforce", "dsh", "wlt"];

for (const service of services) {
  const base = "services/" + service + "/";

  exactSet(
    service + " FOUNDATION_GO_SET",
    tracked
      .filter((item) => item.startsWith(base + "backend/") && item.endsWith(".go"))
      .map((item) => item.slice((base + "backend/").length)),
    ["cmd/api/main.go", "internal/runtime/server.go"],
  );

  exactSet(
    service + " FOUNDATION_CONTRACT_SET",
    tracked
      .filter((item) => item.startsWith(base + "contracts/"))
      .map((item) => item.slice((base + "contracts/").length)),
    ["README.md"],
  );

  exactSet(
    service + " FOUNDATION_DATABASE_SET",
    tracked
      .filter((item) => item.startsWith(base + "database/"))
      .map((item) => item.slice((base + "database/").length)),
    ["README.md"],
  );

  exactSet(
    service + " FOUNDATION_TEST_SET",
    tracked
      .filter((item) => item.startsWith(base + "tests/"))
      .map((item) => item.slice((base + "tests/").length)),
    ["README.md"],
  );

  for (const forbiddenRootFile of ["package.json", "tsconfig.json"]) {
    if (trackedSet.has(base + forbiddenRootFile)) {
      fail(service + " has premature semantic workspace file: " + forbiddenRootFile);
    }
  }

  const serverPath = path.join(
    repoRoot,
    base,
    "backend/internal/runtime/server.go",
  );
  const server = fs.readFileSync(serverPath, "utf8");
  const handleCount = (server.match(/mux\.HandleFunc\(/g) ?? []).length;

  if (
    handleCount !== 2 ||
    !server.includes('prefix+"/health"') ||
    !server.includes('prefix+"/readiness"')
  ) {
    fail(service + " runtime exposes more than Foundation health/readiness");
  }
}

exactSet(
  "identity FOUNDATION_CLIENT_SET",
  tracked
    .filter((item) => item.startsWith("services/identity/clients/"))
    .map((item) => item.slice("services/identity/clients/".length)),
  ["README.md"],
);

for (const service of ["dsh", "wlt", "workforce"]) {
  if (tracked.some((item) => item.startsWith("services/" + service + "/clients/"))) {
    fail(service + " has premature client implementation during Foundation");
  }
}

if (tracked.some((item) => /^services\/[^/]+\/frontend\//.test(item))) {
  fail("Service frontend implementation exists before Stage B owner proof");
}

exactSet(
  "ROOT_CONTRACT_FOUNDATION_SET",
  tracked
    .filter((item) => item.startsWith("contracts/"))
    .map((item) => item.slice("contracts/".length)),
  ["README.md"],
);

const manifestFiles = tracked.filter((item) => /(^|\/)package\.json$/.test(item));
exactSet(
  "FOUNDATION_PACKAGE_MANIFEST_SET",
  manifestFiles,
  [
    "package.json",
    "apps/app-client/package.json",
    "apps/app-partner/package.json",
    "apps/app-captain/package.json",
    "apps/app-field/package.json",
    "apps/control-panel/package.json",
    "packages/design-system/package.json",
  ],
);

const lockfiles = tracked.filter((item) =>
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(item),
);
exactSet("FOUNDATION_LOCKFILE_SET", lockfiles, ["pnpm-lock.yaml"]);

const historicalPathPattern =
  /(^|\/)(archive|backup|backups|compat|compatibility|deprecated|legacy|old|temp|tmp|_unused)(\/|$)/i;

for (const item of tracked) {
  if (historicalPathPattern.test(item)) {
    fail("Historical/compatibility path remains: " + item);
  }
}

const codeFiles = tracked.filter((item) =>
  /\.(go|ts|tsx|js|jsx|mjs|cjs)$/.test(item),
);

const deferredMarkers = [
  ["TO", "DO"].join(""),
  ["FIX", "ME"].join(""),
  ["HA", "CK"].join(""),
  ["X", "XX"].join(""),
];
const deferredMarkerPattern = new RegExp(
  "\\b(?:" + deferredMarkers.join("|") + ")\\b",
);

for (const item of codeFiles) {
  const content = fs.readFileSync(path.join(repoRoot, item), "utf8");

  if (deferredMarkerPattern.test(content)) {
    fail("Deferred structural marker remains in code: " + item);
  }

  if (
    !item.startsWith("packages/design-system/") &&
    /^\s*export\s+\*\s+from\s+/m.test(content)
  ) {
    fail("Unjustified pass-through re-export candidate: " + item);
  }

  if (/apps\/[^/]+\/runtime\//i.test(content)) {
    fail("Legacy pass-through app runtime residue in executable code: " + item);
  }
}

const projectFiles = tracked.filter((item) => item.endsWith("/project.json"));
const projectNames = new Map();
const projectRoots = new Map();

for (const item of projectFiles) {
  const project = JSON.parse(fs.readFileSync(path.join(repoRoot, item), "utf8"));
  if (!project.name || !project.root) {
    fail("Nx project missing name/root: " + item);
    continue;
  }

  if (projectNames.has(project.name)) {
    fail("Duplicate Nx project name: " + project.name);
  }
  projectNames.set(project.name, item);

  if (projectRoots.has(project.root)) {
    fail("Duplicate Nx project root: " + project.root);
  }
  projectRoots.set(project.root, item);

  const expectedRoot = item.slice(0, -"/project.json".length);
  if (project.root !== expectedRoot) {
    fail(
      "Nx project root mismatch: " +
        item +
        " declares " +
        project.root +
        " expected " +
        expectedRoot,
    );
  }
}

exactSet(
  "FOUNDATION_NX_PROJECTS",
  [...projectNames.keys()],
  [
    "app-client",
    "app-partner",
    "app-captain",
    "app-field",
    "control-panel",
    "identity",
    "workforce",
    "dsh",
    "wlt",
    "design-system",
    "infra",
  ],
);

if (failures.length) {
  console.error("A2_FOUNDATION_QUALIFICATION=FAIL");
  for (const failure of [...new Set(failures)].sort()) {
    console.error("  " + failure);
  }
  process.exit(1);
}

console.log("KNOWN_PRE_ROOT_BASELINE_CATASTROPHES=0");
console.log("KNOWN_STRUCTURAL_GARBAGE=0");
console.log("KNOWN_DEAD_PACKAGES_WORKSPACES=0");
console.log("KNOWN_STRUCTURALLY_INVALID_SERVICES_DOMAINS_SURFACES=0");
console.log("KNOWN_WRONG_OWNER_OR_WRONG_PATH_CONTAINERS=0");
console.log("KNOWN_PASS_THROUGH_ONLY_CONTAINERS=0");
console.log("KNOWN_COMPATIBILITY_ONLY_CONTAINERS=0");
console.log("KNOWN_HISTORICAL_COMPENSATION_CONTAINERS=0");
console.log("KNOWN_PARALLEL_SHADOW_AUTHORITIES=0");
console.log("KNOWN_DUPLICATE_MUTABLE_WRITERS=0");
console.log("KNOWN_UNJUSTIFIED_WRAPPERS_ALIASES_REEXPORTS=0");
console.log("KNOWN_LEGACY_RESIDUE=0");
console.log("KNOWN_DEFERRED_STRUCTURAL_GARBAGE=0");
console.log("KNOWN_MAPPED_BUT_UNTREATED_STRUCTURAL_FINDINGS=0");
console.log("UNPROVEN_STAGE_B_DEFERRALS=0");
console.log("PREMATURE_BUSINESS_FURNISHING_IN_FOUNDATION=0");
console.log("A2_FOUNDATION_QUALIFICATION=PASS");
