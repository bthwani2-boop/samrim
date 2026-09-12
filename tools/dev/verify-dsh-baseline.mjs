import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const defaultEnvPath = path.join(root, "infra/local/compose/.env");
const envArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envPath = envArg ? path.resolve(root, envArg.slice("--env-file=".length)) : defaultEnvPath;
const canonicalProject = "samrim-local";
const composeFile = path.join(root, "infra/local/compose/compose.yaml");
const goImage = "golang:1.27.1-alpine";
const testPath = path.join(root, "services/dsh/backend/internal/storage/postgres/migrate_test.go");

function fail(message, error) {
  console.error(`DSH_BASELINE=FAIL ${message}`);
  if (error?.stdout) console.error(String(error.stdout));
  if (error?.stderr) console.error(String(error.stderr));
  process.exit(1);
}

function readEnv(file) {
  if (!fs.existsSync(file)) fail(`canonical environment file missing: ${file}`);
  const values = new Map();
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail(`malformed canonical environment line: ${rawLine}`);
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return values;
}

function required(values, name) {
  const value = values.get(name)?.trim();
  if (!value) fail(`required canonical runtime value missing: ${name}`);
  return value;
}

if (!fs.existsSync(composeFile)) fail(`canonical Compose file missing: ${composeFile}`);
const testSource = fs.readFileSync(testPath, "utf8");
if (/127\.0\.0\.1|localhost|55432/.test(testSource)) fail("baseline proof must not contain a host PostgreSQL fallback");

const env = readEnv(envPath);
const postgresUser = required(env, "SAMRIM_POSTGRES_USER");
const postgresPassword = required(env, "SAMRIM_POSTGRES_PASSWORD");
const postgresDatabase = required(env, "SAMRIM_POSTGRES_DB");
const databaseURL = `postgres://${encodeURIComponent(postgresUser)}:${encodeURIComponent(postgresPassword)}@postgres:5432/${encodeURIComponent(postgresDatabase)}?sslmode=disable`;

let networks;
try {
  networks = execFileSync(
    "docker",
    [
      "network",
      "ls",
      "--filter",
      `label=com.docker.compose.project=${canonicalProject}`,
      "--filter",
      "label=com.docker.compose.network=default",
      "--format",
      "{{.Name}}",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
} catch (error) {
  fail("unable to inspect canonical Docker network", error);
}

if (networks.length !== 1) fail(`expected exactly one canonical Docker network; observed=${networks.length}`);

let output;
try {
  output = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      networks[0],
      "--mount",
      `type=bind,source=${path.resolve(root)},target=/src,readonly`,
      "--workdir",
      "/src/services/dsh/backend/internal/storage/postgres",
      "--env",
      `DSH_DATABASE_URL=${databaseURL}`,
      "--env",
      "GOTOOLCHAIN=local",
      goImage,
      "go",
      "test",
      "-v",
      "-run",
      "^TestFreshBaselineIntegrity$",
      ".",
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  fail("canonical-network fresh baseline proof failed", error);
}

console.log(output);
if (output.includes("--- SKIP:") || !output.includes("--- PASS: TestFreshBaselineIntegrity")) fail("fresh baseline test was skipped or did not pass");
console.log(`BASELINE_TEST_NETWORK=${networks[0]}`);
console.log("BASELINE_TEST_HOST_PORTS=0");
console.log("DSH_BASELINE=PASS");
console.log("DSH_BASELINE_RERUN_CHECKSUM=PASS");
console.log("DSH_BASELINE_DATABASE_INTEGRITY=PASS");
