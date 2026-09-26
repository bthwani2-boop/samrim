import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const envPath = path.join(root, "infra/local/.env");

function fail(message) {
  console.error("CI_RUNTIME_INTEGRATION=FAIL " + message);
  process.exit(1);
}

if (process.env.CI !== "true") fail("disposable CI environment required");
if (!fs.existsSync(envPath)) fail("isolated runtime environment is missing");

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
};

const terminalTarget = "dsh-backend:runtime-proof";
console.log("CI_RUNTIME_TASK_GRAPH_ROOT=" + terminalTarget);
execFileSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "nx", "run", terminalTarget, "--outputStyle=stream"],
  { cwd: root, env: childEnv, stdio: "inherit" },
);

console.log("CI_RUNTIME_INTEGRATION=PASS root=" + terminalTarget);
