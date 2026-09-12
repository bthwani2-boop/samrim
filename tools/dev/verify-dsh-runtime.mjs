import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const envArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envPath = envArg ? path.resolve(root, envArg.slice("--env-file=".length)) : path.resolve(root, "infra/local/compose/.env");

function fail(message, detail = "") {
  console.error(`DSH_RUNTIME=FAIL ${message}${detail ? ` detail=${detail}` : ""}`);
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
const dshBase = required(env, "DSH_API_BASE_URL").replace(/\/+$/, "");
const identityBase = required(env, "IDENTITY_API_BASE_URL").replace(/\/+$/, "");
const dshToken = required(env, "CONTROL_PANEL_SERVICE_TOKEN");
const bootstrapToken = required(env, "OPERATOR_BOOTSTRAP_SECRET");
if (dshToken.length < 24 || bootstrapToken.length < 24) fail("canonical service/bootstrap tokens are too weak");

const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", path.join(root, "infra/local/compose/compose.yaml")];
const retiredPartnerTable = ["partner", "organizations"].join("_");
const retiredPartnerColumn = ["partner", "organization", "id"].join("_");
function sql(query) {
  try {
    return execFileSync("docker", [...composeArgs, "exec", "-T", "postgres", "psql", "-U", required(env, "SAMRIM_POSTGRES_USER"), "-d", required(env, "SAMRIM_POSTGRES_DB"), "-Atc", query], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    fail("database proof failed", String(error?.stderr || error?.message || error));
  }
}

function expectSQL(query, expected, message) {
  const observed = sql(query);
  if (observed !== expected) fail(message, `expected=${expected} observed=${observed}`);
}

async function request(base, method, pathname, options = {}) {
  let response;
  try {
    response = await fetch(new URL(pathname, base), {
      method,
      headers: {
        Accept: "application/json",
        ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
        ...(options.headers || {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    fail("HTTP request failed", error instanceof Error ? error.message : String(error));
  }
  const raw = await response.text();
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return { status: response.status, body };
}

for (const endpoint of ["/dsh/health", "/dsh/readiness"]) {
  const response = await request(dshBase, "GET", endpoint);
  if (response.status !== 200 || response.body?.status !== "ok") fail(`${endpoint} is not ready`, JSON.stringify(response.body));
}

expectSQL("SELECT count(*) FROM dsh.schema_migrations", "1", "DSH baseline migration history is not exact");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=1", "001_partner_store_baseline.sql", "DSH baseline migration name is not canonical");
for (const [table, constraint] of [
  ["dsh.schema_migrations", "schema_migrations_pkey"],
  ["dsh.stores", "stores_pkey"],
  ["dsh.stores", "stores_id_partner_actor_uq"],
  ["dsh.stores", "stores_name_length_chk"],
  ["dsh.stores", "stores_version_positive_chk"],
  ["dsh.partner_bootstrap_idempotency", "partner_bootstrap_idempotency_pkey"],
  ["dsh.partner_bootstrap_idempotency", "partner_bootstrap_idempotency_facts_uq"],
  ["dsh.partner_bootstrap_idempotency", "partner_bootstrap_idempotency_store_partner_fk"],
  ["dsh.partner_bootstrap_audit", "partner_bootstrap_audit_pkey"],
  ["dsh.partner_bootstrap_audit", "partner_bootstrap_audit_event_type_chk"],
  ["dsh.partner_bootstrap_audit", "partner_bootstrap_audit_event_idempotency_uq"],
  ["dsh.partner_bootstrap_audit", "partner_bootstrap_audit_idempotency_facts_fk"],
]) {
  expectSQL(
    `SELECT count(*) FROM pg_constraint WHERE conrelid='${table}'::regclass AND conname='${constraint}'`,
    "1",
    `DSH baseline constraint is missing: ${constraint}`,
  );
}
for (const [table, index] of [
  ["stores", "stores_partner_actor_idx"],
  ["partner_bootstrap_idempotency", "partner_bootstrap_idempotency_partner_idx"],
  ["partner_bootstrap_audit", "partner_bootstrap_audit_partner_idx"],
]) {
  expectSQL(
    `SELECT count(*) FROM pg_indexes WHERE schemaname='dsh' AND tablename='${table}' AND indexname='${index}'`,
    "1",
    `DSH baseline index is missing: ${index}`,
  );
}
console.log("DSH_BASELINE_SCHEMA=PASS");

let actingOperatorID = sql("SELECT COALESCE(initial_operator_actor_id,'') FROM identity_bootstrap_state WHERE id=1");
if (!actingOperatorID) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const firstOperator = await request(identityBase, "POST", "/internal/bootstrap/operator", {
    token: bootstrapToken,
    body: {
      phoneE164: "+9677" + String(Math.floor(10_000_000 + Math.random() * 90_000_000)),
      role: "operator",
      password: "First-Operator-" + suffix + "-Strong-Password-1!",
    },
  });
  if (firstOperator.status !== 201 || firstOperator.body?.role !== "operator" || !firstOperator.body?.actorId) {
    fail("first-operator bootstrap failed", JSON.stringify(firstOperator));
  }
  actingOperatorID = firstOperator.body.actorId;
}
if (!actingOperatorID.startsWith("act_")) fail("acting operator identity is invalid", actingOperatorID);

if (sql(`SELECT to_regclass('dsh.' || '${retiredPartnerTable}') IS NULL`) !== "t") fail("retired partner organization table still exists");
if (sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema='dsh' AND column_name='${retiredPartnerColumn}'`) !== "0") fail("retired partner organization column still exists");

const phone = "+96771" + String(Math.floor(1_000_000 + Math.random() * 9_000_000));
const unauthenticated = await request(dshBase, "POST", "/dsh/managed-roles/provision", { body: { phoneE164: phone, role: "captain" } });
if (unauthenticated.status !== 401) fail("DSH managed provisioning did not require service authentication", String(unauthenticated.status));

const unattributed = await request(dshBase, "POST", "/dsh/managed-roles/provision", { token: dshToken, body: { phoneE164: phone, role: "captain" } });
if (unattributed.status !== 400) fail("DSH managed provisioning did not require acting operator attribution", String(unattributed.status));

const provisioned = await request(dshBase, "POST", "/dsh/managed-roles/provision", {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-runtime-" + Date.now() },
  body: { phoneE164: phone, role: "captain" },
});
if (provisioned.status !== 201 || provisioned.body?.role !== "captain" || !provisioned.body?.actorId) fail("DSH managed provisioning failed", JSON.stringify(provisioned));

const status = await request(dshBase, "GET", `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(phone)}&role=captain`, { token: dshToken });
if (status.status !== 200 || status.body?.actorId !== provisioned.body.actorId) fail("DSH managed role readback failed", JSON.stringify(status));

console.log("DSH_RUNTIME=PASS");
console.log(`ACTING_OPERATOR_ID=${actingOperatorID}`);
console.log("DSH_CONTROL_PANEL_AUTHORITY=operator-attributed");
