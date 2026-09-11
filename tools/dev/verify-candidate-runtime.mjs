import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const requestedEnv = process.argv.find((arg) => arg.startsWith("--env-file="))?.slice("--env-file=".length);
const envFile = path.resolve(root, requestedEnv || "infra/local/compose/.env");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function readEnv(file) {
  if (!fs.existsSync(file)) throw new Error(`canonical environment file missing: ${file}`);
  const values = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`malformed canonical environment line: ${rawLine}`);
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function required(values, name) {
  const value = values[name]?.trim();
  if (!value) throw new Error(`required canonical runtime value missing: ${name}`);
  return value;
}

const fileEnv = readEnv(envFile);
const runtimeEnv = { ...process.env, ...fileEnv };
const controlOrigin = required(fileEnv, "CONTROL_PANEL_PUBLIC_ORIGIN");
const identityBase = required(fileEnv, "IDENTITY_API_BASE_URL");
const mailpitPort = required(fileEnv, "SAMRIM_MAILPIT_WEB_PORT");
const bootstrapToken = required(fileEnv, "IDENTITY_PLATFORM_BOOTSTRAP_SECRET");
const composeArgs = [
  "compose",
  "--project-name",
  "samrim-local",
  "--env-file",
  envFile,
  "-f",
  path.join(root, "infra/local/compose/compose.yaml"),
];
runtimeEnv.PLAYWRIGHT_BASE_URL = controlOrigin;
runtimeEnv.PLAYWRIGHT_IDENTITY_API_BASE_URL = identityBase;
runtimeEnv.PLAYWRIGHT_MAILPIT_BASE_URL = `http://127.0.0.1:${mailpitPort}`;
runtimeEnv.PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN = bootstrapToken;
delete runtimeEnv.PLAYWRIGHT_LIVE_IDENTITY;

const checks = [
  ["Identity exact schema", "docker", [...composeArgs, "exec", "-T", "identity", "/schema-verify"], runtimeEnv],
  ["DSH exact schema", "docker", [...composeArgs, "exec", "-T", "dsh", "/schema-verify"], runtimeEnv],
  ["Control Panel browser shell", pnpm, ["--dir", "apps/control-panel", "test:e2e"], runtimeEnv],
  ["Control Panel live Identity browser", pnpm, ["--dir", "apps/control-panel", "test:e2e:live"], { ...runtimeEnv, PLAYWRIGHT_LIVE_IDENTITY: "1" }],
  ["Identity migration v13 to v15", process.execPath, ["tools/dev/verify-migration-v13-to-v15.mjs", `--env-file=${envFile}`], runtimeEnv],
  ["Identity runtime semantics", process.execPath, ["tools/dev/verify-identity-runtime.mjs", `--env-file=${envFile}`], runtimeEnv],
  ["DSH managed-access runtime", process.execPath, ["tools/dev/verify-dsh-runtime.mjs", `--env-file=${envFile}`], runtimeEnv],
];

for (const [name, command, args, env] of checks) {
  console.log(`=== CANONICAL RUNTIME: ${name} ===`);
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: command === pnpm && process.platform === "win32" });
  if (result.error) {
    console.error(`CANDIDATE_RUNTIME=FAIL check=${name} error=${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`CANDIDATE_RUNTIME=FAIL check=${name} exit=${result.status ?? "unknown"}`);
    process.exit(result.status ?? 1);
  }
}

console.log("CANDIDATE_RUNTIME=PASS");
