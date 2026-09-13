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
  const result = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail("malformed canonical env line", raw);
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
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
const suffix = Date.now().toString(36) + crypto.randomBytes(6).toString("hex");
const caseIDs = new Set();
const storeIDs = new Set();
const actorIDs = new Set();

function compose(...args) {
  return execFileSync("docker", [...composeArgs, ...args], { cwd: root, encoding: "utf8" });
}

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function sql(query) {
  try {
    return execFileSync("docker", [...composeArgs, "exec", "-T", "postgres", "psql", "-U", required(env, "SAMRIM_POSTGRES_USER"), "-d", required(env, "SAMRIM_POSTGRES_DB"), "-Atc", query], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    fail("database proof failed", String(error?.stderr || error?.message || error));
  }
}

function cleanup() {
	for (const caseID of caseIDs) {
		const value = sqlLiteral(caseID);
		sql(`DELETE FROM dsh.joining_case_audit WHERE case_id='${value}'`);
		sql(`DELETE FROM dsh.joining_case_mutation_idempotency WHERE case_id='${value}'`);
		sql(`DELETE FROM dsh.joining_cases WHERE id='${value}'`);
	}
	for (const storeID of storeIDs) {
		const value = sqlLiteral(storeID);
		sql(`DELETE FROM dsh.catalog_item_audit WHERE store_id='${value}'`);
		sql(`DELETE FROM dsh.catalog_item_mutation_idempotency WHERE store_id='${value}'`);
		sql(`DELETE FROM dsh.catalog_items WHERE store_id='${value}'`);
		sql(`DELETE FROM dsh.store_publication_audit WHERE store_id='${value}'`);
		sql(`DELETE FROM dsh.store_publication_idempotency WHERE store_id='${value}'`);
		sql(`DELETE FROM dsh.stores WHERE id='${value}'`);
	}
	for (const actorID of actorIDs) sql(`DELETE FROM identity_actors WHERE id='${sqlLiteral(actorID)}'`);
}

process.on("exit", () => {
  try { cleanup(); } catch (error) { console.error(`DSH_RUNTIME_CLEANUP=FAIL ${error instanceof Error ? error.message : String(error)}`); }
});

function expectSQL(query, expected, message) {
  const observed = sql(query);
  if (observed !== expected) fail(message, `expected=${expected} observed=${observed}`);
}

function hmacChallengeCode(challengeID, purpose) {
  const digest = crypto.createHmac("sha256", challengeSecret).update(challengeID).update(Buffer.from([0])).update(purpose).update(Buffer.from([0])).update("challenge-code").digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

async function request(base, method, pathname, options = {}) {
  let response;
  try {
    response = await fetch(new URL(pathname, base), {
      method,
      headers: { Accept: "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}), ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
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

async function waitForIdentity(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await request(identityBase, "GET", "/identity/readiness", { allowNetworkError: true, timeoutMs: 2_000 });
    if (response.status === 200 && response.body?.status === "ok") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail("Identity readiness did not recover within bounded timeout");
}

function serviceHeaders(operatorID, key, correlation = crypto.randomUUID(), expectedVersion) {
  return { "X-Acting-Actor-ID": operatorID, "X-Correlation-ID": correlation, "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}

function partnerHeaders(key, expectedVersion) {
  return { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}

async function activatePartner(phone, password) {
  const challenge = await request(identityBase, "POST", "/auth/managed/activation/request", { body: { phone, role: "partner" } });
  if (challenge.status !== 201 || typeof challenge.body?.challengeId !== "string") fail("Partner activation challenge failed", JSON.stringify(challenge));
  const activation = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role: "partner", verificationCode: hmacChallengeCode(challenge.body.challengeId, "managed_activate"), password, clientInstanceId: `dsh-runtime-${suffix}` } });
  if (activation.status !== 200 || typeof activation.body?.accessToken !== "string" || activation.body?.identity?.role !== "partner") fail("Partner activation failed", JSON.stringify(activation));
  return String(activation.body.accessToken);
}

async function createApprovedPartner(operatorID, phone, name) {
  const createKey = `joining-create-${crypto.randomUUID()}`;
  const created = await request(dshBase, "POST", "/dsh/joining-cases", { token: dshToken, headers: serviceHeaders(operatorID, createKey), body: { contactPhoneE164: phone, businessName: `${name} business`, firstStoreName: `${name} store` } });
  if (created.status !== 201 || created.body?.case?.state !== "draft") fail("joining case creation failed", JSON.stringify(created));
  const caseID = String(created.body.case.id);
  caseIDs.add(caseID);
  const submitted = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/submit`, { token: dshToken, headers: serviceHeaders(operatorID, `joining-submit-${crypto.randomUUID()}`, crypto.randomUUID(), 1) });
  if (submitted.status !== 200 || submitted.body?.case?.state !== "submitted" || !submitted.body?.case?.partnerActorId) fail("joining case submission failed", JSON.stringify(submitted));
  const actorID = String(submitted.body.case.partnerActorId);
  actorIDs.add(actorID);
  const approved = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/review`, { token: dshToken, headers: serviceHeaders(operatorID, `joining-approve-${crypto.randomUUID()}`, crypto.randomUUID(), 2), body: { decision: "approved" } });
  if (approved.status !== 200 || approved.body?.case?.state !== "approved" || !approved.body?.case?.store?.id) fail("joining case approval failed", JSON.stringify(approved));
  const storeID = String(approved.body.case.store.id);
  storeIDs.add(storeID);
  const accessToken = await activatePartner(phone, `${name}-${suffix}-Strong-Password-1!`);
  return { accessToken, actorID, caseID, storeID };
}

for (const endpoint of ["/dsh/health", "/dsh/readiness"]) {
  const response = await request(dshBase, "GET", endpoint);
  if (response.status !== 200 || response.body?.status !== "ok") fail(`${endpoint} is not ready`, JSON.stringify(response.body));
}

expectSQL("SELECT count(*) FROM dsh.schema_migrations", "3", "DSH migration history is not exact");
for (const [version, name] of [[1, "001_partner_store_baseline.sql"], [2, "002_store_publication.sql"], [3, "003_joining_cases_and_catalog.sql"]]) expectSQL(`SELECT name FROM dsh.schema_migrations WHERE version=${version}`, name, `DSH migration ${version} is not canonical`);
for (const [table, constraint] of [
  ["dsh.schema_migrations", "schema_migrations_pkey"],
  ["dsh.stores", "stores_pkey"], ["dsh.stores", "stores_id_partner_actor_uq"], ["dsh.stores", "stores_name_length_chk"], ["dsh.stores", "stores_version_positive_chk"], ["dsh.stores", "stores_publication_state_chk"],
  ["dsh.joining_cases", "joining_cases_pkey"], ["dsh.joining_cases", "joining_cases_state_chk"], ["dsh.joining_cases", "joining_cases_store_fk"],
  ["dsh.joining_case_mutation_idempotency", "joining_case_mutation_idempotency_pkey"], ["dsh.joining_case_mutation_idempotency", "joining_case_idempotency_facts_uq"], ["dsh.joining_case_mutation_idempotency", "joining_case_idempotency_case_fk"],
  ["dsh.joining_case_audit", "joining_case_audit_pkey"], ["dsh.joining_case_audit", "joining_case_audit_event_idempotency_uq"], ["dsh.joining_case_audit", "joining_case_audit_case_fk"],
  ["dsh.catalog_items", "catalog_items_pkey"], ["dsh.catalog_items", "catalog_items_store_fk"], ["dsh.catalog_items", "catalog_items_state_chk"],
  ["dsh.catalog_item_mutation_idempotency", "catalog_item_mutation_idempotency_pkey"], ["dsh.catalog_item_mutation_idempotency", "catalog_item_idempotency_facts_uq"], ["dsh.catalog_item_mutation_idempotency", "catalog_item_idempotency_item_fk"],
  ["dsh.catalog_item_audit", "catalog_item_audit_pkey"], ["dsh.catalog_item_audit", "catalog_item_audit_event_idempotency_uq"], ["dsh.catalog_item_audit", "catalog_item_audit_item_fk"],
  ["dsh.store_publication_idempotency", "store_publication_idempotency_pkey"], ["dsh.store_publication_audit", "store_publication_audit_pkey"],
]) expectSQL(`SELECT count(*) FROM pg_constraint WHERE conrelid='${table}'::regclass AND conname='${constraint}'`, "1", `DSH constraint is missing: ${constraint}`);
for (const [table, index] of [
  ["stores", "stores_partner_actor_idx"], ["stores", "stores_publication_state_idx"], ["joining_cases", "joining_cases_active_phone_uq"], ["joining_cases", "joining_cases_partner_actor_uq"], ["joining_cases", "joining_cases_state_idx"], ["catalog_items", "catalog_items_store_idx"], ["catalog_items", "catalog_items_public_idx"], ["store_publication_idempotency", "store_publication_idempotency_store_idx"], ["store_publication_audit", "store_publication_audit_store_idx"],
]) expectSQL(`SELECT count(*) FROM pg_indexes WHERE schemaname='dsh' AND tablename='${table}' AND indexname='${index}'`, "1", `DSH index is missing: ${index}`);
expectSQL("SELECT to_regclass('dsh.partner_bootstrap_idempotency') IS NULL AND to_regclass('dsh.partner_bootstrap_audit') IS NULL", "t", "retired Partner bootstrap tables remain");
console.log("DSH_SCHEMA_V3=PASS");

let actingOperatorID = sql("SELECT COALESCE(initial_operator_actor_id,'') FROM identity_bootstrap_state WHERE id=1");
if (!actingOperatorID) {
  const bootstrapped = await request(identityBase, "POST", "/internal/bootstrap/operator", { token: bootstrapToken, body: { phoneE164: "+9677" + crypto.randomInt(10_000_000, 99_999_999), role: "operator" } });
  if (bootstrapped.status !== 201 || !bootstrapped.body?.actorId) fail("operator bootstrap failed", JSON.stringify(bootstrapped));
  actingOperatorID = String(bootstrapped.body.actorId);
}
if (!actingOperatorID.startsWith("act_")) fail("acting operator identity is invalid", actingOperatorID);

const captainPhone = "+96771" + crypto.randomInt(1_000_000, 9_999_999);
const captainUnauthenticated = await request(dshBase, "POST", "/dsh/managed-roles/provision", { body: { phoneE164: captainPhone, role: "captain" } });
if (captainUnauthenticated.status !== 401) fail("managed provisioning did not require service authentication");
const captain = await request(dshBase, "POST", "/dsh/managed-roles/provision", { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-${crypto.randomUUID()}`), body: { phoneE164: captainPhone, role: "captain" } });
if (captain.status !== 201 || !captain.body?.actorId) fail("managed captain provisioning failed", JSON.stringify(captain));
actorIDs.add(String(captain.body.actorId));
const captainStatus = await request(dshBase, "GET", `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(captainPhone)}&role=captain`, { token: dshToken });
if (captainStatus.status !== 200 || captainStatus.body?.actorId !== captain.body.actorId) fail("managed role readback failed", JSON.stringify(captainStatus));
console.log("DSH_MANAGED_ACCESS=PASS");

const firstPhone = "+96772" + crypto.randomInt(1_000_000, 9_999_999);
const firstCreateKey = `joining-first-${suffix}`;
const firstCreate = await request(dshBase, "POST", "/dsh/joining-cases", { token: dshToken, headers: serviceHeaders(actingOperatorID, firstCreateKey, `joining-first-create-${suffix}`), body: { contactPhoneE164: firstPhone, businessName: "Runtime Cafe", firstStoreName: "Runtime Catalog Store" } });
if (firstCreate.status !== 201 || firstCreate.body?.case?.state !== "draft" || firstCreate.body.case.partnerActorId || firstCreate.body.case.store) fail("canonical joining draft is not prospective", JSON.stringify(firstCreate));
const firstCaseID = String(firstCreate.body.case.id);
caseIDs.add(firstCaseID);
const firstReplay = await request(dshBase, "POST", "/dsh/joining-cases", { token: dshToken, headers: serviceHeaders(actingOperatorID, firstCreateKey, `joining-first-replay-${suffix}`), body: { contactPhoneE164: firstPhone, businessName: "Runtime Cafe", firstStoreName: "Runtime Catalog Store" } });
if (firstReplay.status !== 200 || firstReplay.body?.idempotentReplay !== true || firstReplay.body.case.id !== firstCaseID) fail("joining create replay failed", JSON.stringify(firstReplay));
const duplicateLogical = await request(dshBase, "POST", "/dsh/joining-cases", { token: dshToken, headers: serviceHeaders(actingOperatorID, `joining-duplicate-${suffix}`), body: { contactPhoneE164: firstPhone, businessName: "Changed Cafe", firstStoreName: "Changed Store" } });
if (duplicateLogical.status !== 409 || duplicateLogical.body?.error?.code !== "JOINING_CASE_EXISTS") fail("duplicate logical joining case was accepted", JSON.stringify(duplicateLogical));
const firstSubmit = await request(dshBase, "POST", `/dsh/joining-cases/${firstCaseID}/submit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `joining-submit-${suffix}`, `joining-submit-${suffix}`, 1) });
if (firstSubmit.status !== 200 || firstSubmit.body?.case?.state !== "submitted" || !firstSubmit.body.case.partnerActorId || firstSubmit.body.case.store) fail("joining submit did not resolve Identity actor without creating Store", JSON.stringify(firstSubmit));
const firstActorID = String(firstSubmit.body.case.partnerActorId);
actorIDs.add(firstActorID);
const selfGrant = await request(dshBase, "POST", `/dsh/joining-cases/${firstCaseID}/submit`, { token: dshToken, headers: serviceHeaders(firstActorID, `joining-self-grant-${suffix}`, `joining-self-grant-${suffix}`, 2) });
if (selfGrant.status === 200 || selfGrant.status === 201) fail("partner actor self-granted operator joining capability", JSON.stringify(selfGrant));
const staleSubmit = await request(dshBase, "POST", `/dsh/joining-cases/${firstCaseID}/submit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `joining-stale-${suffix}`, `joining-stale-${suffix}`, 1) });
if (staleSubmit.status !== 409 || staleSubmit.body?.error?.code !== "VERSION_CONFLICT") fail("stale joining submit was accepted", JSON.stringify(staleSubmit));
const submitReplay = await request(dshBase, "POST", `/dsh/joining-cases/${firstCaseID}/submit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `joining-submit-${suffix}`, `joining-submit-replay-${suffix}`, 1) });
if (submitReplay.status !== 200 || submitReplay.body?.idempotentReplay !== true) fail("joining submit replay failed", JSON.stringify(submitReplay));
const identityPartnerToken = await activatePartner(firstPhone, `first-${suffix}-Strong-Password-1!`);
const unauthorizedReview = await request(dshBase, "POST", `/dsh/joining-cases/${firstCaseID}/review`, { token: identityPartnerToken, headers: serviceHeaders(firstActorID, `joining-unauthorized-review-${suffix}`, `joining-unauthorized-review-${suffix}`, 2), body: { decision: "approved" } });
if (unauthorizedReview.status === 200) fail("partner session reached operator review boundary", JSON.stringify(unauthorizedReview));
const correction = await request(dshBase, "POST", `/dsh/joining-cases/${firstCaseID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `joining-correction-${suffix}`, `joining-correction-${suffix}`, 2), body: { decision: "needs_correction", correctionReason: "أكمل عنوان المتجر" } });
if (correction.status !== 200 || correction.body?.case?.state !== "needs_correction" || correction.body.case.version !== 3 || correction.body.case.correctionReason !== "أكمل عنوان المتجر" || correction.body.case.store) fail("joining correction transition failed", JSON.stringify(correction));
const resubmit = await request(dshBase, "POST", `/dsh/joining-cases/${firstCaseID}/submit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `joining-resubmit-${suffix}`, `joining-resubmit-${suffix}`, 3) });
if (resubmit.status !== 200 || resubmit.body?.case?.state !== "submitted" || resubmit.body.case.version !== 4) fail("joining resubmission failed", JSON.stringify(resubmit));
const approval = await request(dshBase, "POST", `/dsh/joining-cases/${firstCaseID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `joining-approval-${suffix}`, `joining-approval-${suffix}`, 4), body: { decision: "approved" } });
if (approval.status !== 200 || approval.body?.case?.state !== "approved" || approval.body.case.version !== 5 || !approval.body.case.store?.id || approval.body.case.store.partnerActorId !== firstActorID) fail("joining approval did not create canonical Store", JSON.stringify(approval));
const firstStoreID = String(approval.body.case.store.id);
storeIDs.add(firstStoreID);
const partnerRead = await request(dshBase, "GET", "/dsh/joining-cases/self", { token: identityPartnerToken });
if (partnerRead.status !== 200 || partnerRead.body?.case?.id !== firstCaseID || partnerRead.body.case.store?.id !== firstStoreID) fail("partner joining self readback failed", JSON.stringify(partnerRead));
const crossCase = await request(dshBase, "GET", `/dsh/joining-cases/${firstCaseID}`, { token: identityPartnerToken, headers: { "X-Acting-Actor-ID": firstActorID } });
if (crossCase.status === 200) fail("partner session crossed operator joining case boundary", JSON.stringify(crossCase));
console.log("DSH_JOINING_CASE=PASS");

const second = await createApprovedPartner(actingOperatorID, "+96774" + crypto.randomInt(1_000_000, 9_999_999), "Second Runtime");
const emptyCatalog = await request(dshBase, "GET", `/dsh/stores/${firstStoreID}/catalog`, { token: identityPartnerToken });
if (emptyCatalog.status !== 200 || emptyCatalog.body?.items?.length !== 0) fail("new Store catalog was not empty", JSON.stringify(emptyCatalog));
const catalogKey = `catalog-create-${suffix}`;
const legacyCatalogHeader = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items`, { token: identityPartnerToken, headers: { ...partnerHeaders(`catalog-legacy-${suffix}`), "X-Actor-ID": firstActorID }, body: { name: "legacy header" } });
if (legacyCatalogHeader.status !== 400 || legacyCatalogHeader.body?.error?.code !== "INVALID_INPUT") fail("catalog accepted a legacy actor header", JSON.stringify(legacyCatalogHeader));
const createdItem = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items`, { token: identityPartnerToken, headers: partnerHeaders(catalogKey), body: { name: "قهوة عربية" } });
if (createdItem.status !== 201 || createdItem.body?.item?.publicationState !== "draft" || createdItem.body.item.version !== 1) fail("catalog item creation failed", JSON.stringify(createdItem));
const itemID = String(createdItem.body.item.itemId);
const itemReplay = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items`, { token: identityPartnerToken, headers: partnerHeaders(catalogKey), body: { name: "قهوة عربية" } });
if (itemReplay.status !== 200 || itemReplay.body?.idempotentReplay !== true || itemReplay.body.item.itemId !== itemID) fail("catalog create replay failed", JSON.stringify(itemReplay));
const itemConflict = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items`, { token: identityPartnerToken, headers: partnerHeaders(catalogKey), body: { name: "شاي" } });
if (itemConflict.status !== 409 || itemConflict.body?.error?.code !== "IDEMPOTENCY_CONFLICT") fail("catalog divergent idempotency was accepted", JSON.stringify(itemConflict));
const wrongOwnerRead = await request(dshBase, "GET", `/dsh/stores/${firstStoreID}/catalog`, { token: second.accessToken });
if (wrongOwnerRead.status !== 403) fail("cross-partner catalog read was accepted", JSON.stringify(wrongOwnerRead));
const wrongOwnerCreate = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items`, { token: second.accessToken, headers: partnerHeaders(`catalog-cross-owner-${suffix}`), body: { name: "غير مصرح" } });
if (wrongOwnerCreate.status !== 403) fail("cross-partner catalog mutation was accepted", JSON.stringify(wrongOwnerCreate));
const staleItem = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items/${itemID}`, { token: identityPartnerToken, headers: partnerHeaders(`catalog-stale-${suffix}`, 9), body: { name: "قهوة عربية", publicationState: "published", availability: true } });
if (staleItem.status !== 409 || staleItem.body?.error?.code !== "VERSION_CONFLICT") fail("stale catalog update was accepted", JSON.stringify(staleItem));
const publishedItem = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items/${itemID}`, { token: identityPartnerToken, headers: partnerHeaders(`catalog-publish-${suffix}`, 1), body: { name: "قهوة عربية", publicationState: "published", availability: true } });
if (publishedItem.status !== 200 || publishedItem.body?.item?.publicationState !== "published" || publishedItem.body.item.version !== 2) fail("catalog publication failed", JSON.stringify(publishedItem));
const itemPublishReplay = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items/${itemID}`, { token: identityPartnerToken, headers: partnerHeaders(`catalog-publish-${suffix}`, 1), body: { name: "قهوة عربية", publicationState: "published", availability: true } });
if (itemPublishReplay.status !== 200 || itemPublishReplay.body?.idempotentReplay !== true) fail("catalog update replay failed", JSON.stringify(itemPublishReplay));
const publicBeforeStore = await request(dshBase, "GET", "/dsh/public/stores");
if (publicBeforeStore.status !== 200 || publicBeforeStore.body.stores.some((store) => store.id === firstStoreID)) fail("Store was visible before Store publication intent", JSON.stringify(publicBeforeStore.body));
const storePublished = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-publish-${suffix}`, `store-publish-${suffix}`, 1), body: { state: "published" } });
if (storePublished.status !== 200 || storePublished.body?.store?.publicationState !== "published" || storePublished.body.store.version !== 2 || storePublished.body.store.items?.some((item) => item.itemId !== itemID)) fail("Store publication readback omitted catalog", JSON.stringify(storePublished));
const publicPublished = await request(dshBase, "GET", "/dsh/public/stores");
const publicStore = publicPublished.body?.stores?.find((store) => store.id === firstStoreID);
if (publicPublished.status !== 200 || !publicStore || publicStore.partnerActorId || publicStore.items?.length !== 1 || publicStore.items[0].itemId !== itemID) fail("public Store/catalog readback failed", JSON.stringify(publicPublished.body));
const publicDetail = await request(dshBase, "GET", `/dsh/public/stores/${firstStoreID}`);
if (publicDetail.status !== 200 || publicDetail.body?.id !== firstStoreID || publicDetail.body.partnerActorId || publicDetail.body.items?.[0]?.itemId !== itemID) fail("public Store detail leaked or omitted assortment", JSON.stringify(publicDetail.body));
const unavailable = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items/${itemID}`, { token: identityPartnerToken, headers: partnerHeaders(`catalog-unavailable-${suffix}`, 2), body: { name: "قهوة عربية", publicationState: "published", availability: false } });
if (unavailable.status !== 200 || unavailable.body?.item?.version !== 3) fail("catalog unavailable transition failed", JSON.stringify(unavailable));
const publicUnavailable = await request(dshBase, "GET", "/dsh/public/stores");
if (publicUnavailable.status !== 200 || publicUnavailable.body.stores.some((store) => store.id === firstStoreID)) fail("unavailable last catalog item remained customer eligible", JSON.stringify(publicUnavailable.body));
const restoredItem = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/catalog/items/${itemID}`, { token: identityPartnerToken, headers: partnerHeaders(`catalog-restore-${suffix}`, 3), body: { name: "قهوة عربية", publicationState: "published", availability: true } });
if (restoredItem.status !== 200 || restoredItem.body?.item?.version !== 4) fail("catalog availability restore failed", JSON.stringify(restoredItem));
const hiddenStore = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-hide-${suffix}`, `store-hide-${suffix}`, 2), body: { state: "hidden" } });
if (hiddenStore.status !== 200 || hiddenStore.body?.store?.publicationState !== "hidden" || hiddenStore.body.store.version !== 3) fail("Store hide failed", JSON.stringify(hiddenStore));
const publicHidden = await request(dshBase, "GET", `/dsh/public/stores/${firstStoreID}`);
if (publicHidden.status !== 404) fail("hidden Store remained public", JSON.stringify(publicHidden.body));
const restoredStore = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-republish-${suffix}`, `store-republish-${suffix}`, 3), body: { state: "published" } });
if (restoredStore.status !== 200 || restoredStore.body?.store?.version !== 4) fail("Store publication restore failed", JSON.stringify(restoredStore));
console.log("DSH_CATALOG_AND_PUBLIC_VISIBILITY=PASS");

const partnerStatus = await request(dshBase, "GET", `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(firstPhone)}&role=partner`, { token: dshToken });
const disabled = await request(dshBase, "POST", "/dsh/managed-roles/disable", { token: dshToken, headers: serviceHeaders(actingOperatorID, `disable-partner-${suffix}`, `disable-partner-${suffix}`, partnerStatus.body?.roleVersion), body: { phoneE164: firstPhone, role: "partner", reason: "runtime public eligibility proof" } });
if (partnerStatus.status !== 200 || disabled.status !== 204) fail("Partner disable proof failed", JSON.stringify({ partnerStatus, disabled }));
const publicDisabled = await request(dshBase, "GET", "/dsh/public/stores");
if (publicDisabled.status !== 200 || publicDisabled.body.stores.some((store) => store.id === firstStoreID)) fail("disabled Partner remained customer eligible", JSON.stringify(publicDisabled.body));
const blockedPublication = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-blocked-${suffix}`, `store-blocked-${suffix}`, 4), body: { state: "published" } });
if (blockedPublication.status !== 409 || blockedPublication.body?.error?.code !== "READINESS_BLOCKED") fail("disabled Partner publication was not blocked", JSON.stringify(blockedPublication));
const disabledAgain = await request(dshBase, "GET", `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(firstPhone)}&role=partner`, { token: dshToken });
const enabled = await request(dshBase, "POST", "/dsh/managed-roles/enable", { token: dshToken, headers: serviceHeaders(actingOperatorID, `enable-partner-${suffix}`, `enable-partner-${suffix}`, disabledAgain.body?.roleVersion), body: { phoneE164: firstPhone, role: "partner", reason: "runtime public eligibility restore" } });
if (disabledAgain.status !== 200 || enabled.status !== 204) fail("Partner enable proof failed", JSON.stringify({ disabledAgain, enabled }));
const publicEnabled = await request(dshBase, "GET", "/dsh/public/stores");
if (publicEnabled.status !== 200 || !publicEnabled.body.stores.some((store) => store.id === firstStoreID)) fail("eligible Partner did not restore public visibility", JSON.stringify(publicEnabled.body));

let outageFailure = "";
try {
  compose("stop", "identity");
  const unavailableList = await request(dshBase, "GET", "/dsh/public/stores", { timeoutMs: 15_000, allowNetworkError: true });
  if (unavailableList.status !== 502 || unavailableList.body?.error?.code !== "IDENTITY_UNAVAILABLE") outageFailure = `Identity outage did not fail closed: ${JSON.stringify(unavailableList)}`;
} finally {
  try { compose("up", "-d", "identity"); } catch (error) { outageFailure ||= `Identity restart failed: ${String(error?.message || error)}`; }
  if (!outageFailure) await waitForIdentity();
}
if (outageFailure) fail(outageFailure);
const recoveredList = await request(dshBase, "GET", "/dsh/public/stores");
if (recoveredList.status !== 200 || !recoveredList.body.stores.some((store) => store.id === firstStoreID)) fail("public visibility did not recover after Identity restart", JSON.stringify(recoveredList.body));
const finalHidden = await request(dshBase, "POST", `/dsh/stores/${firstStoreID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-final-hide-${suffix}`, `store-final-hide-${suffix}`, 4), body: { state: "hidden" } });
if (finalHidden.status !== 200 || finalHidden.body?.store?.publicationState !== "hidden" || finalHidden.body.store.version !== 5) fail("final Store cleanup transition failed", JSON.stringify(finalHidden));

console.log("DSH_IDENTITY_GATE=PASS");
console.log("DSH_RUNTIME=PASS");
console.log(`ACTING_OPERATOR_ID=${actingOperatorID}`);
console.log("DSH_CONTROL_PANEL_AUTHORITY=operator-attributed");
