import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const envArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envPath = envArg ? path.resolve(root, envArg.slice("--env-file=".length)) : path.resolve(root, "infra/local/compose/.env");
const corePath = path.join(root, "tools/dev/verify-dsh-runtime-core.mjs");

function fail(message, detail = "") {
  console.error(`DSH_RUNTIME_FIXTURE=FAIL ${message}${detail ? ` detail=${detail}` : ""}`);
  process.exit(1);
}

function readEnv(file) {
  if (!fs.existsSync(file)) fail("canonical env file missing", file);
  const values = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail("malformed canonical env line", rawLine);
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function required(values, name) {
  const value = values[name]?.trim();
  if (!value) fail("required canonical runtime value missing", name);
  return value;
}

const env = readEnv(envPath);
const composeArgs = [
  "compose",
  "--project-name",
  "samrim-local",
  "--env-file",
  envPath,
  "-f",
  path.join(root, "infra/local/compose/compose.yaml"),
];

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function sql(query) {
  return execFileSync(
    "docker",
    [
      ...composeArgs,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      required(env, "SAMRIM_POSTGRES_USER"),
      "-d",
      required(env, "SAMRIM_POSTGRES_DB"),
      "-Atc",
      query,
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

if (!fs.existsSync(corePath)) fail("DSH runtime core proof is missing", corePath);

const suffix = Date.now().toString(36) + crypto.randomBytes(6).toString("hex");
const fixtureActorID = "act_dsh_runtime_" + suffix;
const fixturePhone = "+96773" + String(crypto.randomInt(1_000_000, 9_999_999));
const actor = sqlLiteral(fixtureActorID);
const phone = sqlLiteral(fixturePhone);

let originalBootstrapExists = false;
let originalOperatorID = "";
let fixtureCreated = false;
let bootstrapRepointed = false;
let exitCode = 1;

try {
  const bootstrapState = sql("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_bootstrap_state WHERE id=1) THEN '1' ELSE '0' END || '|' || COALESCE((SELECT initial_operator_actor_id FROM identity_bootstrap_state WHERE id=1),'')");
  const separator = bootstrapState.indexOf("|");
  originalBootstrapExists = bootstrapState.slice(0, separator) === "1";
  originalOperatorID = separator >= 0 ? bootstrapState.slice(separator + 1) : "";

  sql(`INSERT INTO identity_actors(id,phone_e164,security_enabled,version) VALUES('${actor}','${phone}',true,1)`);
  sql(`INSERT INTO identity_actor_roles(actor_id,role,enabled,activated_at,version) VALUES('${actor}','operator',true,clock_timestamp(),1)`);
  fixtureCreated = true;

  if (originalBootstrapExists) {
    sql(`UPDATE identity_bootstrap_state SET initial_operator_actor_id='${actor}' WHERE id=1`);
  } else {
    sql(`INSERT INTO identity_bootstrap_state(id,initial_operator_actor_id) VALUES(1,'${actor}')`);
  }
  bootstrapRepointed = true;

  const roleState = sql(`SELECT r.role || '|' || r.enabled::text || '|' || (r.activated_at IS NOT NULL)::text || '|' || a.security_enabled::text FROM identity_actor_roles r JOIN identity_actors a ON a.id=r.actor_id WHERE r.actor_id='${actor}' AND r.role='operator'`);
  if (roleState !== "operator|true|true|true") fail("isolated operator eligibility fixture is invalid", roleState);

  console.log("DSH_RUNTIME_OPERATOR_FIXTURE=ROLE_ELIGIBILITY_ONLY");
  console.log("DSH_RUNTIME_OPERATOR_FIXTURE_SESSION=0");
  console.log("DSH_RUNTIME_OPERATOR_FIXTURE_PASSKEY_PROOF=EXTERNAL_TO_THIS_CHECK");

  const result = spawnSync(process.execPath, [corePath, ...process.argv.slice(2)], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`DSH_RUNTIME_FIXTURE=FAIL core_spawn_error=${result.error.message}`);
    exitCode = 1;
  } else {
    exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(`DSH_RUNTIME_FIXTURE=FAIL ${error instanceof Error ? error.message : String(error)}`);
  if (error?.stderr) console.error(String(error.stderr));
  exitCode = 1;
} finally {
  try {
    if (bootstrapRepointed) {
      if (originalBootstrapExists) {
        const original = sqlLiteral(originalOperatorID);
        sql(`UPDATE identity_bootstrap_state SET initial_operator_actor_id='${original}' WHERE id=1`);
      } else {
        sql("DELETE FROM identity_bootstrap_state WHERE id=1");
      }
    }
    if (fixtureCreated) sql(`DELETE FROM identity_actors WHERE id='${actor}'`);
    console.log("DSH_RUNTIME_OPERATOR_FIXTURE_CLEANUP=PASS");
  } catch (cleanupError) {
    console.error(`DSH_RUNTIME_FIXTURE_CLEANUP=FAIL ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    exitCode = 1;
  }
}

process.exit(exitCode);
