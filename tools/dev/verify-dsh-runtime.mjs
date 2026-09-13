import crypto from "node:crypto";
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
const challengeSecret = required(env, "IDENTITY_CHALLENGE_HMAC_SECRET");
if (dshToken.length < 24 || bootstrapToken.length < 24 || challengeSecret.length < 32) fail("canonical internal secrets are too weak");

const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", path.join(root, "infra/local/compose/compose.yaml")];
const retiredPartnerTable = ["partner", "organizations"].join("_");
const retiredPartnerColumn = ["partner", "organization", "id"].join("_");
const testStoreIDs = new Set();

function compose(...args) {
  return execFileSync("docker", [...composeArgs, ...args], { cwd: root, encoding: "utf8" });
}

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function cleanupStore(storeID) {
  try {
    sql(`DELETE FROM dsh.partner_bootstrap_audit WHERE store_id='${sqlLiteral(storeID)}'`);
    sql(`DELETE FROM dsh.partner_bootstrap_idempotency WHERE store_id='${sqlLiteral(storeID)}'`);
    sql(`DELETE FROM dsh.store_publication_audit WHERE store_id='${sqlLiteral(storeID)}'`);
    sql(`DELETE FROM dsh.store_publication_idempotency WHERE store_id='${sqlLiteral(storeID)}'`);
    sql(`DELETE FROM dsh.stores WHERE id='${sqlLiteral(storeID)}'`);
  } catch {
    // Cleanup is best effort after a failed proof; the IDs are unique to this run.
  }
}

process.on("exit", () => {
  for (const storeID of testStoreIDs) cleanupStore(storeID);
});
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

function hmacChallengeCode(challengeID, purpose) {
  const digest = crypto.createHmac("sha256", challengeSecret)
    .update(challengeID)
    .update(Buffer.from([0]))
    .update(purpose)
    .update(Buffer.from([0]))
    .update("challenge-code")
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
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
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    });
  } catch (error) {
    if (options.allowNetworkError) return { status: 0, body: null, error };
    fail("HTTP request failed", error instanceof Error ? error.message : String(error));
  }
  const raw = await response.text();
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return { status: response.status, body };
}

async function waitForIdentity({ timeoutMs = 30_000, pollMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastObservation = "no readiness response";

  while (Date.now() < deadline) {
    const response = await request(identityBase, "GET", "/identity/readiness", {
      allowNetworkError: true,
      timeoutMs: Math.min(2_000, Math.max(250, deadline - Date.now())),
    });
    if (response.status === 200 && response.body?.status === "ok") return;

    lastObservation = `status=${response.status} body=${JSON.stringify(response.body)}`;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remainingMs)));
  }

  fail("Identity readiness did not recover within bounded timeout", `timeout_ms=${timeoutMs} last=${lastObservation}`);
}

for (const endpoint of ["/dsh/health", "/dsh/readiness"]) {
  const response = await request(dshBase, "GET", endpoint);
  if (response.status !== 200 || response.body?.status !== "ok") fail(`${endpoint} is not ready`, JSON.stringify(response.body));
}

expectSQL("SELECT count(*) FROM dsh.schema_migrations", "2", "DSH migration history is not exact");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=1", "001_partner_store_baseline.sql", "DSH baseline migration name is not canonical");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=2", "002_store_publication.sql", "DSH Store publication migration name is not canonical");
for (const [table, constraint] of [
  ["dsh.schema_migrations", "schema_migrations_pkey"],
  ["dsh.stores", "stores_pkey"],
  ["dsh.stores", "stores_id_partner_actor_uq"],
  ["dsh.stores", "stores_name_length_chk"],
  ["dsh.stores", "stores_version_positive_chk"],
  ["dsh.stores", "stores_publication_state_chk"],
  ["dsh.store_publication_idempotency", "store_publication_idempotency_pkey"],
  ["dsh.store_publication_idempotency", "store_publication_idempotency_facts_uq"],
  ["dsh.store_publication_idempotency", "store_publication_idempotency_store_fk"],
  ["dsh.store_publication_audit", "store_publication_audit_pkey"],
  ["dsh.store_publication_audit", "store_publication_audit_event_type_chk"],
  ["dsh.store_publication_audit", "store_publication_audit_event_idempotency_uq"],
  ["dsh.store_publication_audit", "store_publication_audit_idempotency_fk"],
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
  ["stores", "stores_publication_state_idx"],
  ["partner_bootstrap_idempotency", "partner_bootstrap_idempotency_partner_idx"],
  ["partner_bootstrap_audit", "partner_bootstrap_audit_partner_idx"],
  ["store_publication_idempotency", "store_publication_idempotency_store_idx"],
  ["store_publication_audit", "store_publication_audit_store_idx"],
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

const captainPhone = "+96771" + String(Math.floor(1_000_000 + Math.random() * 9_000_000));
const unauthenticated = await request(dshBase, "POST", "/dsh/managed-roles/provision", { body: { phoneE164: captainPhone, role: "captain" } });
if (unauthenticated.status !== 401) fail("DSH managed provisioning did not require service authentication", String(unauthenticated.status));
const unattributed = await request(dshBase, "POST", "/dsh/managed-roles/provision", { token: dshToken, body: { phoneE164: captainPhone, role: "captain" } });
if (unattributed.status !== 400) fail("DSH managed provisioning did not require acting operator attribution", String(unattributed.status));
const provisionedCaptain = await request(dshBase, "POST", "/dsh/managed-roles/provision", {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-runtime-" + Date.now() },
  body: { phoneE164: captainPhone, role: "captain" },
});
if (provisionedCaptain.status !== 201 || provisionedCaptain.body?.role !== "captain" || !provisionedCaptain.body?.actorId) fail("DSH managed provisioning failed", JSON.stringify(provisionedCaptain));
const captainStatus = await request(dshBase, "GET", `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(captainPhone)}&role=captain`, { token: dshToken });
if (captainStatus.status !== 200 || captainStatus.body?.actorId !== provisionedCaptain.body.actorId) fail("DSH managed role readback failed", JSON.stringify(captainStatus));

const suffix = Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
const partnerPhone = "+96772" + String(Math.floor(1_000_000 + Math.random() * 9_000_000));
const partnerProvisioned = await request(dshBase, "POST", "/dsh/managed-roles/provision", {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-partner-provision-" + suffix },
  body: { phoneE164: partnerPhone, role: "partner" },
});
if (partnerProvisioned.status !== 201 || partnerProvisioned.body?.role !== "partner" || !partnerProvisioned.body?.actorId) fail("canonical Partner provisioning failed", JSON.stringify(partnerProvisioned));
const partnerActorID = String(partnerProvisioned.body.actorId);
const activationRequest = await request(identityBase, "POST", "/auth/managed/activation/request", { body: { phone: partnerPhone, role: "partner" } });
if (activationRequest.status !== 201 || typeof activationRequest.body?.challengeId !== "string") fail("canonical Partner activation challenge failed", JSON.stringify(activationRequest));
const activation = await request(identityBase, "POST", "/auth/managed/activate", {
  body: {
    phone: partnerPhone,
    role: "partner",
    verificationCode: hmacChallengeCode(activationRequest.body.challengeId, "managed_activate"),
    password: "Partner-" + suffix + "-Strong-Password-1!",
    deviceFingerprint: "dsh-runtime-partner-" + suffix,
  },
});
if (activation.status !== 200 || typeof activation.body?.accessToken !== "string" || activation.body?.identity?.role !== "partner") fail("canonical Partner activation failed", JSON.stringify(activation));
const partnerAccessToken = String(activation.body.accessToken);

const runtimeStoreID = `store_dsh_publication_${suffix}`;
const missingStoreID = `store_dsh_missing_${suffix}`;
const pendingStoreID = `store_dsh_pending_${suffix}`;
testStoreIDs.add(runtimeStoreID);
testStoreIDs.add(missingStoreID);
testStoreIDs.add(pendingStoreID);
const bootstrapHeaders = {
  "X-Acting-Actor-ID": actingOperatorID,
  "X-Correlation-ID": "dsh-bootstrap-" + suffix,
  "Idempotency-Key": "dsh-bootstrap-" + suffix,
};
const bootstrapped = await request(dshBase, "POST", "/dsh/partner-bootstrap", {
  token: dshToken,
  headers: bootstrapHeaders,
  body: { partnerActorId: partnerActorID, storeName: "Runtime Publication Store " + suffix.slice(-6) },
});
if (bootstrapped.status !== 201 || bootstrapped.body?.partnerActorId !== partnerActorID || bootstrapped.body?.firstStore?.partnerActorId !== partnerActorID || bootstrapped.body?.firstStore?.publicationState !== "unpublished" || bootstrapped.body?.firstStore?.publicationReadiness?.ready !== true || bootstrapped.body?.firstStore?.version !== 1) fail("canonical Partner→Store bootstrap did not return ready unpublished Store", JSON.stringify(bootstrapped));
const actualStoreID = String(bootstrapped.body.firstStore.id);
testStoreIDs.delete(runtimeStoreID);
testStoreIDs.add(actualStoreID);

const partnerReadback = await request(dshBase, "GET", "/dsh/partner-bootstrap/self", { token: partnerAccessToken });
if (partnerReadback.status !== 200 || partnerReadback.body?.firstStore?.publicationReadiness?.ready !== true || partnerReadback.body?.firstStore?.publicationState !== "unpublished") fail("Partner self readback did not expose canonical readiness", JSON.stringify(partnerReadback));
const publicBefore = await request(dshBase, "GET", "/dsh/public/stores");
if (publicBefore.status !== 200 || publicBefore.body?.stores?.some((store) => store.id === actualStoreID)) fail("unpublished Store leaked into public discovery", JSON.stringify(publicBefore.body));
const partnerPublishAttempt = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, {
  token: partnerAccessToken,
  headers: { "X-Acting-Actor-ID": partnerActorID, "X-Correlation-ID": "partner-self-publish", "X-Expected-Version": "1", "Idempotency-Key": "partner-self-publish-1" },
  body: { state: "published" },
});
if (partnerPublishAttempt.status !== 401) fail("Partner user access reached operator publication boundary", JSON.stringify(partnerPublishAttempt));
const legacyHeader = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, {
  token: dshToken,
  headers: { ...bootstrapHeaders, "X-Actor-ID": actingOperatorID, "X-Expected-Version": "1", "Idempotency-Key": "dsh-legacy-header" },
  body: { state: "published" },
});
if (legacyHeader.status !== 400) fail("legacy X-Actor-ID publication header was accepted", JSON.stringify(legacyHeader));
const missingServiceAuth = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, {
  headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-publication-auth", "X-Expected-Version": "1", "Idempotency-Key": "dsh-pub-auth-1" },
  body: { state: "published" },
});
if (missingServiceAuth.status !== 401) fail("Store publication did not require service authentication", JSON.stringify(missingServiceAuth));

const publicationHeaders = {
  "X-Acting-Actor-ID": actingOperatorID,
  "X-Correlation-ID": "dsh-publication-" + suffix,
  "X-Expected-Version": "1",
  "Idempotency-Key": "dsh-publication-" + suffix,
};
const published = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: publicationHeaders, body: { state: "published" } });
if (published.status !== 200 || published.body?.store?.publicationState !== "published" || published.body?.store?.version !== 2 || published.body?.store?.publicationReadiness?.ready !== true || published.body?.idempotentReplay !== false) fail("canonical Store publication failed", JSON.stringify(published));
const replayed = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: publicationHeaders, body: { state: "published" } });
if (replayed.status !== 200 || replayed.body?.idempotentReplay !== true || replayed.body?.store?.version !== 2) fail("identical Store publication retry did not replay", JSON.stringify(replayed));
const divergentRetry = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: { ...publicationHeaders, "X-Correlation-ID": "dsh-publication-conflict" }, body: { state: "hidden" } });
if (divergentRetry.status !== 409 || divergentRetry.body?.error?.code !== "IDEMPOTENCY_CONFLICT") fail("divergent publication retry was accepted", JSON.stringify(divergentRetry));
const staleTransition = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: { ...publicationHeaders, "X-Correlation-ID": "dsh-publication-stale", "Idempotency-Key": "dsh-publication-stale-" + suffix }, body: { state: "hidden" } });
if (staleTransition.status !== 409 || staleTransition.body?.error?.code !== "VERSION_CONFLICT") fail("stale publication transition was accepted", JSON.stringify(staleTransition));
const publicAfterPublish = await request(dshBase, "GET", "/dsh/public/stores");
if (publicAfterPublish.status !== 200 || !publicAfterPublish.body?.stores?.some((store) => store.id === actualStoreID) || publicAfterPublish.body.stores.find((store) => store.id === actualStoreID)?.partnerActorId) fail("published Store discovery readback was incomplete or leaked private scope", JSON.stringify(publicAfterPublish.body));
const publicDetail = await request(dshBase, "GET", `/dsh/public/stores/${actualStoreID}`);
if (publicDetail.status !== 200 || publicDetail.body?.id !== actualStoreID || publicDetail.body?.partnerActorId) fail("published Store detail readback failed", JSON.stringify(publicDetail.body));
const privateRead = await request(dshBase, "GET", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (privateRead.status !== 200 || privateRead.body?.store?.publicationState !== "published" || privateRead.body?.store?.publicationReadiness?.ready !== true) fail("operator Store publication readback failed", JSON.stringify(privateRead.body));

const partnerStatusBeforeDisable = await request(dshBase, "GET", `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(partnerPhone)}&role=partner`, { token: dshToken });
const disabled = await request(dshBase, "POST", "/dsh/managed-roles/disable", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-disable-partner-" + suffix, "X-Expected-Version": String(partnerStatusBeforeDisable.body?.roleVersion) }, body: { phoneE164: partnerPhone, role: "partner", reason: "runtime readiness gate proof" } });
if (partnerStatusBeforeDisable.status !== 200 || disabled.status !== 204) fail("disabling Partner for readiness proof failed", JSON.stringify({ partnerStatusBeforeDisable, disabled }));
const publicAfterGateLoss = await request(dshBase, "GET", "/dsh/public/stores");
if (publicAfterGateLoss.status !== 200 || publicAfterGateLoss.body?.stores?.some((store) => store.id === actualStoreID)) fail("ineligible published Store remained publicly visible", JSON.stringify(publicAfterGateLoss.body));
const publicDetailAfterGateLoss = await request(dshBase, "GET", `/dsh/public/stores/${actualStoreID}`);
if (publicDetailAfterGateLoss.status !== 404) fail("ineligible published Store detail remained publicly readable", JSON.stringify(publicDetailAfterGateLoss.body));
const privateAfterGateLoss = await request(dshBase, "GET", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (privateAfterGateLoss.status !== 200 || privateAfterGateLoss.body?.store?.publicationState !== "published" || privateAfterGateLoss.body?.store?.version !== 2 || privateAfterGateLoss.body?.store?.publicationReadiness?.ready !== false || privateAfterGateLoss.body?.store?.publicationReadiness?.blockedReason !== "PARTNER_IDENTITY_NOT_ELIGIBLE") fail("private Store readback did not preserve intent while exposing blocked readiness", JSON.stringify(privateAfterGateLoss.body));
const replayAfterGateLoss = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: publicationHeaders, body: { state: "published" } });
if (replayAfterGateLoss.status !== 200 || replayAfterGateLoss.body?.idempotentReplay !== true || replayAfterGateLoss.body?.store?.publicationReadiness?.ready !== false) fail("publication replay did not re-read current readiness", JSON.stringify(replayAfterGateLoss.body));

const partnerStatusBeforeEnable = await request(dshBase, "GET", `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(partnerPhone)}&role=partner`, { token: dshToken });
const enabled = await request(dshBase, "POST", "/dsh/managed-roles/enable", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-enable-partner-" + suffix, "X-Expected-Version": String(partnerStatusBeforeEnable.body?.roleVersion) }, body: { phoneE164: partnerPhone, role: "partner", reason: "runtime readiness gate restore" } });
if (partnerStatusBeforeEnable.status !== 200 || enabled.status !== 204) fail("restoring Partner readiness failed", JSON.stringify({ partnerStatusBeforeEnable, enabled }));
const publicAfterGateRestore = await request(dshBase, "GET", "/dsh/public/stores");
if (publicAfterGateRestore.status !== 200 || !publicAfterGateRestore.body?.stores?.some((store) => store.id === actualStoreID)) fail("eligible published Store did not return to public discovery", JSON.stringify(publicAfterGateRestore.body));

const hidden = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: { ...publicationHeaders, "X-Correlation-ID": "dsh-publication-hide-" + suffix, "X-Expected-Version": "2", "Idempotency-Key": "dsh-publication-hide-" + suffix }, body: { state: "hidden" } });
if (hidden.status !== 200 || hidden.body?.store?.publicationState !== "hidden" || hidden.body?.store?.version !== 3) fail("canonical Store hide failed", JSON.stringify(hidden));
const publicAfterHide = await request(dshBase, "GET", `/dsh/public/stores/${actualStoreID}`);
if (publicAfterHide.status !== 404) fail("hidden Store remained publicly readable", JSON.stringify(publicAfterHide.body));

sql(`INSERT INTO dsh.stores(id, partner_actor_id, name) VALUES('${sqlLiteral(missingStoreID)}', 'act_missing_${sqlLiteral(suffix)}', 'Missing Partner Fixture')`);
const missingPublish = await request(dshBase, "POST", `/dsh/stores/${missingStoreID}/publication`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-missing-partner-" + suffix, "X-Expected-Version": "1", "Idempotency-Key": "dsh-missing-partner-" + suffix }, body: { state: "published" } });
if (missingPublish.status !== 409 || missingPublish.body?.error?.code !== "READINESS_BLOCKED") fail("missing Partner readiness did not block publication", JSON.stringify(missingPublish));
expectSQL(`SELECT version || ':' || publication_state FROM dsh.stores WHERE id='${sqlLiteral(missingStoreID)}'`, "1:unpublished", "missing Partner guard changed Store state");
expectSQL(`SELECT count(*) FROM dsh.store_publication_idempotency WHERE idempotency_key='dsh-missing-partner-${sqlLiteral(suffix)}'`, "0", "blocked missing Partner publication wrote idempotency");
expectSQL(`SELECT count(*) FROM dsh.store_publication_audit WHERE idempotency_key='dsh-missing-partner-${sqlLiteral(suffix)}'`, "0", "blocked missing Partner publication wrote audit");

const pendingPhone = "+96773" + String(Math.floor(1_000_000 + Math.random() * 9_000_000));
const pendingProvisioned = await request(dshBase, "POST", "/dsh/managed-roles/provision", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-pending-partner-" + suffix }, body: { phoneE164: pendingPhone, role: "partner" } });
if (pendingProvisioned.status !== 201 || !pendingProvisioned.body?.actorId) fail("pending Partner fixture provisioning failed", JSON.stringify(pendingProvisioned));
const pendingActorID = String(pendingProvisioned.body.actorId);
sql(`INSERT INTO dsh.stores(id, partner_actor_id, name) VALUES('${sqlLiteral(pendingStoreID)}', '${sqlLiteral(pendingActorID)}', 'Pending Partner Fixture')`);
const pendingPublish = await request(dshBase, "POST", `/dsh/stores/${pendingStoreID}/publication`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-pending-partner-publish-" + suffix, "X-Expected-Version": "1", "Idempotency-Key": "dsh-pending-partner-publish-" + suffix }, body: { state: "published" } });
if (pendingPublish.status !== 409 || pendingPublish.body?.error?.code !== "READINESS_BLOCKED") fail("pending Partner readiness did not block publication", JSON.stringify(pendingPublish));
expectSQL(`SELECT version || ':' || publication_state FROM dsh.stores WHERE id='${sqlLiteral(pendingStoreID)}'`, "1:unpublished", "pending Partner guard changed Store state");

const disabledStatus = await request(dshBase, "GET", `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(partnerPhone)}&role=partner`, { token: dshToken });
const disabledAgain = await request(dshBase, "POST", "/dsh/managed-roles/disable", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-disable-partner-hidden-" + suffix, "X-Expected-Version": String(disabledStatus.body?.roleVersion) }, body: { phoneE164: partnerPhone, role: "partner", reason: "runtime blocked publish proof" } });
if (disabledStatus.status !== 200 || disabledAgain.status !== 204) fail("second Partner disable for blocked publish proof failed", JSON.stringify({ disabledStatus, disabledAgain }));
const blockedDisabledPublish = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: { ...publicationHeaders, "X-Correlation-ID": "dsh-disabled-publish-" + suffix, "X-Expected-Version": "3", "Idempotency-Key": "dsh-disabled-publish-" + suffix }, body: { state: "published" } });
if (blockedDisabledPublish.status !== 409 || blockedDisabledPublish.body?.error?.code !== "READINESS_BLOCKED") fail("disabled Partner readiness did not block publication", JSON.stringify(blockedDisabledPublish));
expectSQL(`SELECT version || ':' || publication_state FROM dsh.stores WHERE id='${sqlLiteral(actualStoreID)}'`, "3:hidden", "disabled Partner guard changed Store state");
const disabledEnableStatus = await request(dshBase, "GET", `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(partnerPhone)}&role=partner`, { token: dshToken });
const enabledAgain = await request(dshBase, "POST", "/dsh/managed-roles/enable", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": "dsh-enable-partner-hidden-" + suffix, "X-Expected-Version": String(disabledEnableStatus.body?.roleVersion) }, body: { phoneE164: partnerPhone, role: "partner", reason: "runtime restore after blocked publish proof" } });
if (disabledEnableStatus.status !== 200 || enabledAgain.status !== 204) fail("restoring Partner after blocked publish proof failed", JSON.stringify({ disabledEnableStatus, enabledAgain }));

const republishedForOutage = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: { ...publicationHeaders, "X-Correlation-ID": "dsh-publication-outage-" + suffix, "X-Expected-Version": "3", "Idempotency-Key": "dsh-publication-outage-" + suffix }, body: { state: "published" } });
if (republishedForOutage.status !== 200 || republishedForOutage.body?.store?.version !== 4 || republishedForOutage.body?.store?.publicationReadiness?.ready !== true) fail("republish before Identity outage failed", JSON.stringify(republishedForOutage));
let outageFailure = "";
try {
  compose("stop", "identity");
  const unavailableList = await request(dshBase, "GET", "/dsh/public/stores", { allowNetworkError: true, timeoutMs: 15_000 });
  if (unavailableList.status !== 502 || unavailableList.body?.error?.code !== "IDENTITY_UNAVAILABLE") outageFailure = "Identity outage did not fail closed for public discovery: " + JSON.stringify(unavailableList);
} finally {
  try { compose("up", "-d", "identity"); } catch (error) { outageFailure = outageFailure || "Identity restart failed: " + String(error?.message || error); }
  if (!outageFailure) await waitForIdentity();
}
if (outageFailure) fail(outageFailure);
const publicAfterIdentityRestore = await request(dshBase, "GET", "/dsh/public/stores");
if (publicAfterIdentityRestore.status !== 200 || !publicAfterIdentityRestore.body?.stores?.some((store) => store.id === actualStoreID)) fail("public discovery did not recover after Identity restore", JSON.stringify(publicAfterIdentityRestore.body));
const finalHidden = await request(dshBase, "POST", `/dsh/stores/${actualStoreID}/publication`, { token: dshToken, headers: { ...publicationHeaders, "X-Correlation-ID": "dsh-publication-final-hide-" + suffix, "X-Expected-Version": "4", "Idempotency-Key": "dsh-publication-final-hide-" + suffix }, body: { state: "hidden" } });
if (finalHidden.status !== 200 || finalHidden.body?.store?.publicationState !== "hidden" || finalHidden.body?.store?.version !== 5) fail("final canonical Store hide failed", JSON.stringify(finalHidden));

for (const storeID of testStoreIDs) cleanupStore(storeID);
console.log("DSH_STORE_PUBLICATION=PASS");
console.log("DSH_RUNTIME=PASS");
console.log(`ACTING_OPERATOR_ID=${actingOperatorID}`);
console.log("DSH_CONTROL_PANEL_AUTHORITY=operator-attributed");
