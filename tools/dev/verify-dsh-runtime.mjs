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
const dshToken = required(env, "DSH_CONTROL_PANEL_SERVICE_TOKEN");
const bootstrapToken = required(env, "IDENTITY_OPERATOR_BOOTSTRAP_SECRET");
if (dshToken.length < 24 || bootstrapToken.length < 24) fail("canonical service/bootstrap tokens are too weak");

const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", path.join(root, "infra/local/compose/compose.yaml")];
function sql(query) {
  try {
    return execFileSync("docker", [...composeArgs, "exec", "-T", "postgres", "psql", "-U", required(env, "SAMRIM_POSTGRES_USER"), "-d", required(env, "SAMRIM_POSTGRES_DB"), "-Atc", query], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    fail("database proof failed", String(error?.stderr || error?.message || error));
  }
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

if (sql("SELECT to_regclass('dsh.partner_organizations') IS NULL") !== "t") fail("retired partner organization table still exists");
if (sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='dsh' AND column_name='partner_organization_id'") !== "0") fail("retired partner organization column still exists");

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
