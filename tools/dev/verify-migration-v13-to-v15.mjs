import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const defaultEnvPath = path.join(root, "infra/local/compose/.env");
const envArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envPath = envArg ? path.resolve(root, envArg.slice("--env-file=".length)) : defaultEnvPath;
const canonicalProject = "samrim-local";
const goImage = "golang:1.27.1-alpine";
const migrationTestPath = path.join(root, "services/identity/backend/internal/storage/postgres/migrate_test.go");

function fail(message, error) {
  console.error(`MIGRATION_V13_TO_V15=FAIL ${message}`);
  if (error?.stdout) console.error(String(error.stdout));
  if (error?.stderr) console.error(String(error.stderr));
  process.exit(1);
}

function readEnv(file) {
  if (!fs.existsSync(file)) fail(`canonical env file missing: ${file}`);
  const values = new Map();
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail(`malformed canonical env line: ${rawLine}`);
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return values;
}

function requireEnv(values, name) {
  const value = values.get(name)?.trim();
  if (!value) fail(`required canonical runtime value missing: ${name}`);
  return value;
}

const migrationTestSource = fs.readFileSync(migrationTestPath, "utf8");
if (/127\.0\.0\.1|localhost|55432/.test(migrationTestSource)) {
  fail("migration proof must not contain a host PostgreSQL fallback");
}

console.log("==================================================");
console.log("VERIFYING MIGRATION V13 -> V15 UPGRADE, DATA PRESERVATION & SIX-DIGIT CUTOVER");
console.log("==================================================");

const env = readEnv(envPath);
const postgresUser = requireEnv(env, "SAMRIM_POSTGRES_USER");
const postgresPassword = requireEnv(env, "SAMRIM_POSTGRES_PASSWORD");
const postgresDatabase = requireEnv(env, "SAMRIM_POSTGRES_DB");
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

if (networks.length !== 1) {
  fail(`expected exactly one canonical Docker network for ${canonicalProject}; observed=${networks.length}`);
}

const mountSource = path.resolve(root);
const workdir = "/src/services/identity/backend/internal/storage/postgres";
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
      `type=bind,source=${mountSource},target=/src,readonly`,
      "--workdir",
      workdir,
      "--env",
      `IDENTITY_DATABASE_URL=${databaseURL}`,
      "--env",
      "GOTOOLCHAIN=local",
      goImage,
      "go",
      "test",
      "-v",
      "-run",
      "^TestMigrationV13ToV15Upgrade$",
      ".",
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  fail("canonical-network migration proof failed", error);
}

console.log(output);
if (output.includes("--- SKIP:") || !output.includes("--- PASS: TestMigrationV13ToV15Upgrade")) {
  fail("migration test was skipped or did not pass");
}

console.log(`MIGRATION_TEST_NETWORK=${networks[0]}`);
console.log("MIGRATION_TEST_HOST_PORTS=0");
console.log("MIGRATION_V13_TO_V15=PASS");
console.log("MIGRATION_DATA_PRESERVATION=PASS");
