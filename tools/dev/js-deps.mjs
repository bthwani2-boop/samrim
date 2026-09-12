import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const checkOnly = process.argv.includes("--check");
const fingerprintFile = path.join(
  repoRoot,
  "node_modules",
  ".samrim-js-deps-fingerprint",
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function collectWorkspaceManifestFiles() {
  const files = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];

  for (const parent of ["apps", "packages", "services"]) {
    const parentPath = path.join(repoRoot, parent);
    if (!fs.existsSync(parentPath)) continue;

    for (const entry of fs.readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = path.posix.join(parent, entry.name, "package.json");
      if (fs.existsSync(path.join(repoRoot, relative))) files.push(relative);
    }
  }

  return [...new Set(files)].sort();
}

function calculateFingerprint() {
  const hash = crypto.createHash("sha256");
  for (const relative of collectWorkspaceManifestFiles()) {
    const absolute = path.join(repoRoot, relative);
    if (!fs.existsSync(absolute)) fail(`JS_DEPS_INPUT_MISSING=${relative}`);
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const requiredRuntimeModules = [
  "apps/app-client/node_modules/expo/package.json",
  "apps/app-partner/node_modules/expo/package.json",
  "apps/app-captain/node_modules/expo/package.json",
  "apps/app-field/node_modules/expo/package.json",
  "apps/control-panel/node_modules/next/package.json",
];

function runtimeModulesPresent() {
  return requiredRuntimeModules.every((relative) =>
    fs.existsSync(path.join(repoRoot, relative)),
  );
}

const expected = calculateFingerprint();
const current = fs.existsSync(fingerprintFile)
  ? fs.readFileSync(fingerprintFile, "utf8").trim()
  : "";

if (current === expected && runtimeModulesPresent()) {
  console.log(`JS_DEPS=READY fingerprint=${expected}`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `JS_DEPS=STALE expected=${expected} actual=${current || "missing"}`,
  );
  process.exit(1);
}

console.log(
  `JS_DEPS=INSTALL reason=${current ? "fingerprint-changed" : "bootstrap"} fingerprint=${expected}`,
);

console.log("JS_DEPS_EXECUTION=NONINTERACTIVE_CI");

const result = spawnSync(
  "pnpm",
  ["install", "--frozen-lockfile", "--store-dir", "/pnpm/store"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  },
);

if (result.error) fail(`JS_DEPS_INSTALL=FAIL error=${result.error.message}`);
if (result.status !== 0) fail(`JS_DEPS_INSTALL=FAIL exit=${result.status}`);

if (!runtimeModulesPresent()) {
  const missing = requiredRuntimeModules.filter(
    (relative) => !fs.existsSync(path.join(repoRoot, relative)),
  );
  fail(`JS_DEPS_RUNTIME_MODULES=FAIL missing=${missing.join(",")}`);
}

fs.mkdirSync(path.dirname(fingerprintFile), { recursive: true });
fs.writeFileSync(fingerprintFile, `${expected}\n`, "utf8");

console.log(`JS_DEPS=PASS fingerprint=${expected}`);
