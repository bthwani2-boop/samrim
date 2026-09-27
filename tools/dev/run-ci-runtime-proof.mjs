import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { laneTargets } from "./runtime-proof/resolve.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const envPath = path.join(root, "infra/local/.env");
const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
const runtimeFailurePath = path.join(runnerTemp, "samrim-runtime-failure.json");

function fail(message) {
  console.error("CI_RUNTIME_INTEGRATION=FAIL " + message);
  process.exit(1);
}

if (process.env.CI !== "true") fail("disposable CI environment required");
if (!fs.existsSync(envPath)) fail("isolated runtime environment is missing");

const requestedTargets = (process.env.CI_RUNTIME_TARGETS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (requestedTargets.length === 0) fail("CI_RUNTIME_TARGETS is empty");
const needsDshCheckerFixture = requestedTargets.includes("dsh-backend:runtime-proof");
const dshCheckerFixturePath = needsDshCheckerFixture
  ? path.join(runnerTemp, `samrim-dsh-checker-${process.pid}-${crypto.randomUUID()}.json`)
  : "";

const allowedTargets = new Set([
  ...Object.values(laneTargets).flat(),
  "control-panel:dsh-runtime-checker-fixture",
]);
for (const target of requestedTargets) {
  if (!allowedTargets.has(target)) fail("unowned runtime proof target requested: " + target);
}

const runtimeEnv = {};
for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) fail("malformed runtime environment line");
  runtimeEnv[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
}

for (const name of [
  "SAMRIM_CONTROL_PORT",
  "SAMRIM_MAILPIT_WEB_PORT",
  "CONTROL_PANEL_PUBLIC_ORIGIN",
  "IDENTITY_API_BASE_URL",
  "DSH_API_BASE_URL",
  "OPERATOR_BOOTSTRAP_SECRET",
  "CONTROL_PANEL_SERVICE_TOKEN",
]) {
  if (!runtimeEnv[name]) fail("required runtime value missing: " + name);
}

const childEnv = {
  ...process.env,
  BTHWANI_IDENTITY_PROOF_SCOPE: "disposable-ci",
  PLAYWRIGHT_BASE_URL: runtimeEnv.CONTROL_PANEL_PUBLIC_ORIGIN,
  PLAYWRIGHT_IDENTITY_API_BASE_URL: runtimeEnv.IDENTITY_API_BASE_URL,
  PLAYWRIGHT_DSH_API_BASE_URL: runtimeEnv.DSH_API_BASE_URL,
  PLAYWRIGHT_MAILPIT_BASE_URL: "http://127.0.0.1:" + runtimeEnv.SAMRIM_MAILPIT_WEB_PORT,
  PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN: runtimeEnv.OPERATOR_BOOTSTRAP_SECRET,
  PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN: runtimeEnv.CONTROL_PANEL_SERVICE_TOKEN,
  ...(dshCheckerFixturePath ? { DSH_RUNTIME_CHECKER_FIXTURE_PATH: dshCheckerFixturePath } : {}),
};

const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let checkerFixtureCleanupFailed = false;
try { fs.unlinkSync(runtimeFailurePath); } catch {}
console.log("CI_RUNTIME_TASKS=" + requestedTargets.join(","));
try {
  for (const target of requestedTargets) {
    console.log("CI_RUNTIME_TASK=START target=" + target);
    try {
      execFileSync(
        executable,
        ["exec", "nx", "run", target, "--outputStyle=stream"],
        { cwd: root, env: childEnv, stdio: "inherit" },
      );
      console.log("CI_RUNTIME_TASK=PASS target=" + target);
    } catch (error) {
      const failure = {
        target,
        candidate: process.env.CANDIDATE_SHA || process.env.GITHUB_SHA || null,
        progressionBlocked: true,
        nextAction: "classify-highest-causal-root-before-new-material-work",
        capturedAt: new Date().toISOString(),
      };
      fs.writeFileSync(runtimeFailurePath, JSON.stringify(failure, null, 2) + "\n");
      console.error("CI_RUNTIME_TASK=FAIL target=" + target);
      throw error;
    }
  }
} finally {
  if (dshCheckerFixturePath && fs.existsSync(dshCheckerFixturePath)) {
    try {
      execFileSync(
        executable,
        ["exec", "nx", "run", "dsh-backend:runtime-fixture-cleanup", "--outputStyle=stream"],
        { cwd: root, env: childEnv, stdio: "inherit" },
      );
    } catch (error) {
      checkerFixtureCleanupFailed = true;
      console.error(`DSH_RUNTIME_CHECKER_FIXTURE_CLEANUP=FAIL ${error instanceof Error ? error.message : String(error)}`);
      if (!fs.existsSync(runtimeFailurePath)) {
        fs.writeFileSync(runtimeFailurePath, JSON.stringify({
          target: "dsh-backend:runtime-fixture-cleanup",
          candidate: process.env.CANDIDATE_SHA || process.env.GITHUB_SHA || null,
          progressionBlocked: true,
          nextAction: "classify-highest-causal-root-before-new-material-work",
          capturedAt: new Date().toISOString(),
        }, null, 2) + "\n");
      }
      process.exitCode = 1;
    }
  }
}

if (checkerFixtureCleanupFailed) {
  console.error("CI_RUNTIME_INTEGRATION=FAIL disposable checker fixture cleanup failed");
} else {
  console.log("CI_RUNTIME_INTEGRATION=PASS targets=" + requestedTargets.join(","));
}
