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
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail("malformed canonical runtime env line", raw);
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
const identityDshToken = required(env, "IDENTITY_DSH_SERVICE_TOKEN");
const bootstrapToken = required(env, "OPERATOR_BOOTSTRAP_SECRET");
const challengeSecret = required(env, "IDENTITY_CHALLENGE_HMAC_SECRET");
if (dshToken.length < 24 || bootstrapToken.length < 24 || challengeSecret.length < 32) fail("canonical internal secrets are too weak");

const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", path.join(root, "infra/local/compose/compose.yaml")];
const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
const caseIDs = new Set();
const storeIDs = new Set();
const actorIDs = new Set();
const productIDs = new Set();

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
  for (const productID of productIDs) {
    const value = sqlLiteral(productID);
    sql(`DELETE FROM dsh.store_assortment_audit WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.store_assortment_mutation_idempotency WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.store_assortments WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.central_product_audit WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.central_product_mutation_idempotency WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.central_products WHERE id='${value}'`);
  }
  for (const caseID of caseIDs) {
    const value = sqlLiteral(caseID);
    sql(`DELETE FROM dsh.joining_case_audit WHERE case_id='${value}'`);
    sql(`DELETE FROM dsh.joining_case_mutation_idempotency WHERE case_id='${value}'`);
    sql(`DELETE FROM dsh.joining_cases WHERE id='${value}'`);
  }
  for (const storeID of storeIDs) {
    const value = sqlLiteral(storeID);
    sql(`DELETE FROM dsh.store_assortment_audit WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.store_assortment_mutation_idempotency WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.store_assortments WHERE store_id='${value}'`);
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

async function waitForIdentityReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const health = await request(identityBase, "GET", "/identity/health", { timeoutMs: 1_000, allowNetworkError: true });
    lastStatus = health.status;
    if (health.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("Identity did not become ready after restart", `last_status=${lastStatus}`);
}

function serviceHeaders(operatorID, key, correlation = crypto.randomUUID(), expectedVersion) {
  return { "X-Acting-Actor-ID": operatorID, "X-Correlation-ID": correlation, "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}

function partnerHeaders(key, expectedVersion) {
  return { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}

function hmacChallengeCode(challengeID, purpose) {
  const digest = crypto.createHmac("sha256", challengeSecret).update(challengeID).update(Buffer.from([0])).update(purpose).update(Buffer.from([0])).update("challenge-code").digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

async function activatePartner(phone, password) {
  const challenge = await request(identityBase, "POST", "/auth/managed/activation/request", { body: { phone, role: "partner" } });
  if (challenge.status !== 201 || typeof challenge.body?.challengeId !== "string") fail("Partner activation challenge failed", JSON.stringify(challenge));
  const activation = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role: "partner", verificationCode: hmacChallengeCode(challenge.body.challengeId, "managed_activate"), password, clientInstanceId: `dsh-runtime-${suffix}` } });
  if (activation.status !== 200 || typeof activation.body?.accessToken !== "string" || activation.body?.identity?.role !== "partner") fail("Partner activation failed", JSON.stringify(activation));
  return String(activation.body.accessToken);
}

async function createApprovedPartner(operatorID, phone, name, exerciseCorrection = false) {
  const createKey = `joining-create-${crypto.randomUUID()}`;
  const created = await request(dshBase, "POST", "/dsh/joining-cases", { token: dshToken, headers: serviceHeaders(operatorID, createKey), body: { contactPhoneE164: phone, businessName: `${name} business`, firstStoreName: `${name} store` } });
  if (created.status !== 201 || created.body?.case?.state !== "draft") fail("joining case creation failed", JSON.stringify(created));
  const caseID = String(created.body.case.id);
  caseIDs.add(caseID);
  const queue = await request(dshBase, "GET", "/dsh/joining-cases?state=draft&limit=50", { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  if (queue.status !== 200 || !Array.isArray(queue.body?.cases) || !queue.body.cases.some((item) => item.id === caseID && item.state === "draft")) fail("canonical joining-case queue did not expose the created case", JSON.stringify(queue));
  const submitted = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/submit`, { token: dshToken, headers: serviceHeaders(operatorID, `joining-submit-${crypto.randomUUID()}`, crypto.randomUUID(), 1) });
  if (submitted.status !== 200 || submitted.body?.case?.state !== "submitted" || !submitted.body?.case?.partnerActorId) fail("joining case submission failed", JSON.stringify(submitted));
  const actorID = String(submitted.body.case.partnerActorId);
  actorIDs.add(actorID);
  const accessToken = await activatePartner(phone, name.slice(0, 4).padEnd(4, "x") + suffix.slice(0, 4));
  if (exerciseCorrection) {
    const partnerRead = await request(dshBase, "GET", "/dsh/joining-cases/self", { token: accessToken });
    if (partnerRead.status !== 200 || partnerRead.body?.case?.state !== "submitted") fail("partner joining readback failed", JSON.stringify(partnerRead));
    const returned = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/review`, { token: dshToken, headers: serviceHeaders(operatorID, `joining-return-${crypto.randomUUID()}`, crypto.randomUUID(), 2), body: { decision: "needs_correction", correctionReason: "صحح اسم النشاط واسم المتجر" } });
    if (returned.status !== 200 || returned.body?.case?.state !== "needs_correction" || returned.body?.case?.version !== 3) fail("operator correction decision failed", JSON.stringify(returned));
    const correctionRead = await request(dshBase, "GET", "/dsh/joining-cases/self", { token: accessToken });
    if (correctionRead.status !== 200 || correctionRead.body?.case?.state !== "needs_correction" || correctionRead.body?.case?.correctionReason !== "صحح اسم النشاط واسم المتجر") fail("partner correction reason readback failed", JSON.stringify(correctionRead));
    const correctedBusiness = `${name} corrected business`;
    const correctedStore = `${name} corrected store`;
    const operatorResubmit = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/submit`, { token: dshToken, headers: serviceHeaders(operatorID, `joining-operator-resubmit-${suffix}`, crypto.randomUUID(), 3) });
    if (operatorResubmit.status !== 409 || operatorResubmit.body?.error?.code !== "STATE_CONFLICT") fail("operator could resubmit a needs_correction case", JSON.stringify(operatorResubmit));
    const oldCorrect = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/correct`, { token: accessToken, headers: partnerHeaders(`joining-old-correct-${suffix}`, 3), body: { businessName: correctedBusiness, firstStoreName: correctedStore } });
    const oldResubmit = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/resubmit`, { token: accessToken, headers: partnerHeaders(`joining-old-resubmit-${suffix}`, 3) });
    if (oldCorrect.status !== 404 || oldResubmit.status !== 404) fail("retired split correction endpoints remain reachable", JSON.stringify({ oldCorrect, oldResubmit }));
    const corrected = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/correct-and-resubmit`, { token: accessToken, headers: partnerHeaders(`joining-correct-resubmit-${suffix}`, 3), body: { businessName: correctedBusiness, firstStoreName: correctedStore } });
    if (corrected.status !== 200 || corrected.body?.case?.state !== "submitted" || corrected.body?.case?.version !== 4 || corrected.body?.case?.businessName !== correctedBusiness || corrected.body?.case?.firstStoreName !== correctedStore || corrected.body?.case?.correctionReason) fail("partner atomic correction and resubmission failed", JSON.stringify(corrected));
    const correctedReplay = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/correct-and-resubmit`, { token: accessToken, headers: partnerHeaders(`joining-correct-resubmit-${suffix}`, 3), body: { businessName: correctedBusiness, firstStoreName: correctedStore } });
    if (correctedReplay.status !== 200 || correctedReplay.body?.idempotentReplay !== true || correctedReplay.body?.case?.version !== 4) fail("partner atomic correction replay failed", JSON.stringify(correctedReplay));
    const approvedAfterCorrection = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/review`, { token: dshToken, headers: serviceHeaders(operatorID, `joining-approve-${crypto.randomUUID()}`, crypto.randomUUID(), 4), body: { decision: "approved" } });
    if (approvedAfterCorrection.status !== 200 || approvedAfterCorrection.body?.case?.state !== "approved" || approvedAfterCorrection.body?.case?.version !== 5 || approvedAfterCorrection.body?.case?.store?.name !== correctedStore) fail("corrected joining approval failed", JSON.stringify(approvedAfterCorrection));
    const storeID = String(approvedAfterCorrection.body.case.store.id);
    storeIDs.add(storeID);
    return { accessToken, actorID, caseID, storeID };
  }
  const approved = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/review`, { token: dshToken, headers: serviceHeaders(operatorID, `joining-approve-${crypto.randomUUID()}`, crypto.randomUUID(), 2), body: { decision: "approved" } });
  if (approved.status !== 200 || approved.body?.case?.state !== "approved" || !approved.body?.case?.store?.id) fail("joining case approval failed", JSON.stringify(approved));
  const storeID = String(approved.body.case.store.id);
  storeIDs.add(storeID);
  return { accessToken, actorID, caseID, storeID };
}

for (const endpoint of ["/dsh/health", "/dsh/readiness"]) {
  const response = await request(dshBase, "GET", endpoint);
  if (response.status !== 200 || response.body?.status !== "ok") fail(`${endpoint} is not ready`, JSON.stringify(response.body));
}
for (const endpoint of ["/dsh/managed-roles/provision", "/dsh/managed-roles/status", "/dsh/managed-roles/disable", "/dsh/managed-roles/enable", "/dsh/managed-roles/reenrollment"]) {
  const response = await request(dshBase, endpoint.endsWith("status") ? "GET" : "POST", endpoint, { token: dshToken });
  if (response.status !== 404) fail("retired DSH managed-access endpoint remains reachable", JSON.stringify({ endpoint, response }));
}

expectSQL("SELECT count(*) FROM dsh.schema_migrations", "7", "DSH migration history is not exact");
for (const [version, name] of [[1, "001_partner_store_baseline.sql"], [2, "002_store_publication.sql"], [3, "003_joining_cases_and_catalog.sql"], [4, "004_central_product_store_assortment_cutover.sql"], [5, "005_joining_case_partner_correction.sql"], [6, "006_joining_case_correct_and_resubmit.sql"], [7, "007_location_core.sql"]]) expectSQL(`SELECT name FROM dsh.schema_migrations WHERE version=${version}`, name, `DSH migration ${version} is not canonical`);
for (const table of ["catalog_items", "catalog_item_mutation_idempotency", "catalog_item_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NULL`, "t", `legacy relation remains: ${table}`);
for (const [table, constraint] of [
  ["dsh.central_products", "central_products_pkey"], ["dsh.central_products", "central_products_name_chk"], ["dsh.central_products", "central_products_sell_unit_chk"], ["dsh.central_products", "central_products_version_chk"],
  ["dsh.central_product_mutation_idempotency", "central_product_mutation_idempotency_pkey"], ["dsh.central_product_mutation_idempotency", "central_product_idempotency_facts_uq"], ["dsh.central_product_mutation_idempotency", "central_product_idempotency_product_fk"],
  ["dsh.central_product_audit", "central_product_audit_pkey"], ["dsh.central_product_audit", "central_product_audit_event_idempotency_uq"], ["dsh.central_product_audit", "central_product_audit_product_fk"],
  ["dsh.store_assortments", "store_assortments_pkey"], ["dsh.store_assortments", "store_assortments_store_fk"], ["dsh.store_assortments", "store_assortments_product_fk"], ["dsh.store_assortments", "store_assortments_price_chk"], ["dsh.store_assortments", "store_assortments_currency_chk"], ["dsh.store_assortments", "store_assortments_state_chk"],
  ["dsh.store_assortment_mutation_idempotency", "store_assortment_mutation_idempotency_pkey"], ["dsh.store_assortment_mutation_idempotency", "store_assortment_idempotency_facts_uq"], ["dsh.store_assortment_mutation_idempotency", "store_assortment_idempotency_product_fk"],
  ["dsh.store_assortment_audit", "store_assortment_audit_pkey"], ["dsh.store_assortment_audit", "store_assortment_audit_event_idempotency_uq"], ["dsh.store_assortment_audit", "store_assortment_audit_product_fk"],
  ["dsh.store_publication_idempotency", "store_publication_idempotency_pkey"], ["dsh.store_publication_audit", "store_publication_audit_pkey"],
]) expectSQL(`SELECT count(*) FROM pg_constraint WHERE conrelid='${table}'::regclass AND conname='${constraint}'`, "1", `DSH constraint is missing: ${constraint}`);
for (const [table, index] of [
  ["central_products", "central_products_barcode_uq"], ["central_products", "central_products_active_idx"], ["central_products", "central_products_name_prefix_idx"], ["central_product_mutation_idempotency", "central_product_idempotency_product_idx"], ["central_product_audit", "central_product_audit_product_idx"],
  ["store_assortments", "store_assortments_store_idx"], ["store_assortments", "store_assortments_public_idx"], ["store_assortment_mutation_idempotency", "store_assortment_idempotency_store_idx"], ["store_assortment_audit", "store_assortment_audit_store_idx"],
]) expectSQL(`SELECT count(*) FROM pg_indexes WHERE schemaname='dsh' AND tablename='${table}' AND indexname='${index}'`, "1", `DSH index is missing: ${index}`);
console.log("DSH_SCHEMA_V7=PASS");

let actingOperatorID = sql("SELECT COALESCE(initial_operator_actor_id,'') FROM identity_bootstrap_state WHERE id=1");
if (!actingOperatorID) {
  const bootstrapped = await request(identityBase, "POST", "/internal/bootstrap/operator", { token: bootstrapToken, body: { phoneE164: "+9677" + crypto.randomInt(10_000_000, 99_999_999), role: "operator" } });
  if (bootstrapped.status !== 201 || !bootstrapped.body?.actorId) fail("operator bootstrap failed", JSON.stringify(bootstrapped));
  actingOperatorID = String(bootstrapped.body.actorId);
}
if (!actingOperatorID.startsWith("act_")) fail("acting operator identity is invalid", actingOperatorID);

for (const role of ["captain", "field"]) {
  const response = await request(identityBase, "POST", "/internal/actor-roles/provision", { token: identityDshToken, headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": crypto.randomUUID() }, body: { phoneE164: "+9677" + crypto.randomInt(10_000_000, 99_999_999), role } });
  if (response.status !== 403) fail("DSH can still admit a non-partner managed role", JSON.stringify({ role, response }));
}

const firstPhone = "+96772" + crypto.randomInt(1_000_000, 9_999_999);
const first = await createApprovedPartner(actingOperatorID, firstPhone, "Central Product Runtime A", true);
const second = await createApprovedPartner(actingOperatorID, "+96774" + crypto.randomInt(1_000_000, 9_999_999), "Central Product Runtime B");
console.log("DSH_JOINING_CASE=PASS");

const productInput = { canonicalName: "Runtime Coffee", brand: "BThwani", barcode: "6281000000001", canonicalImageUrl: "https://example.com/runtime-coffee.jpg", sellUnit: "piece" };
const productCreateKey = `product-create-${suffix}`;
const productCreate = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, productCreateKey, `product-create-${suffix}`), body: productInput });
if (productCreate.status !== 201 || productCreate.body?.product?.version !== 1 || productCreate.body?.product?.active !== true) fail("central Product creation failed", JSON.stringify(productCreate));
const productID = String(productCreate.body.product.id);
productIDs.add(productID);
const productReplay = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, productCreateKey, `product-replay-${suffix}`), body: productInput });
if (productReplay.status !== 200 || productReplay.body?.idempotentReplay !== true || productReplay.body.product.id !== productID) fail("central Product create replay failed", JSON.stringify(productReplay));
const productDuplicate = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, `product-duplicate-${suffix}`), body: { ...productInput, canonicalName: "Runtime Duplicate" } });
if (productDuplicate.status !== 409 || productDuplicate.body?.error?.code !== "DUPLICATE_BARCODE") fail("duplicate central barcode was accepted", JSON.stringify(productDuplicate));
const partnerProductWrite = await request(dshBase, "POST", "/dsh/catalog/products", { token: first.accessToken, headers: partnerHeaders(`partner-product-write-${suffix}`), body: { ...productInput, barcode: "6281000000002" } });
if (partnerProductWrite.status !== 401) fail("Partner reached central Product writer", JSON.stringify(partnerProductWrite));
const partnerLookup = await request(dshBase, "GET", "/dsh/catalog/products?q=Runtime%20Cof&limit=50", { token: first.accessToken });
if (partnerLookup.status !== 200 || partnerLookup.body?.products?.length !== 1 || partnerLookup.body.products[0].id !== productID || partnerLookup.body.products[0].canonicalName !== productInput.canonicalName) fail("Partner central Product lookup failed", JSON.stringify(partnerLookup));
console.log("DSH_CENTRAL_PRODUCT=PASS");

const emptyAssortment = await request(dshBase, "GET", `/dsh/stores/${first.storeID}/assortment`, { token: first.accessToken });
if (emptyAssortment.status !== 200 || emptyAssortment.body?.assortments?.length !== 0) fail("new Store Assortment was not empty", JSON.stringify(emptyAssortment));
const legacyEndpoint = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/catalog/items`, { token: first.accessToken, headers: partnerHeaders(`legacy-route-${suffix}`), body: { name: "legacy" } });
if (legacyEndpoint.status !== 404) fail("legacy catalog endpoint remains reachable", JSON.stringify(legacyEndpoint));
const assortmentKey = `assortment-create-${suffix}`;
const assortmentCreate = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/assortment`, { token: first.accessToken, headers: partnerHeaders(assortmentKey), body: { productId: productID, priceMinor: 1250 } });
if (assortmentCreate.status !== 201 || assortmentCreate.body?.assortment?.publicationState !== "draft" || assortmentCreate.body.assortment.version !== 1 || assortmentCreate.body.assortment.canonicalName !== productInput.canonicalName) fail("Store Assortment creation failed", JSON.stringify(assortmentCreate));
const assortmentReplay = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/assortment`, { token: first.accessToken, headers: partnerHeaders(assortmentKey), body: { productId: productID, priceMinor: 1250 } });
if (assortmentReplay.status !== 200 || assortmentReplay.body?.idempotentReplay !== true) fail("Store Assortment create replay failed", JSON.stringify(assortmentReplay));
const assortmentConflict = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/assortment`, { token: first.accessToken, headers: partnerHeaders(assortmentKey), body: { productId: productID, priceMinor: 1300 } });
if (assortmentConflict.status !== 409 || assortmentConflict.body?.error?.code !== "IDEMPOTENCY_CONFLICT") fail("divergent Store Assortment retry was accepted", JSON.stringify(assortmentConflict));
const wrongOwnerRead = await request(dshBase, "GET", `/dsh/stores/${first.storeID}/assortment`, { token: second.accessToken });
if (wrongOwnerRead.status !== 403) fail("cross-partner Store Assortment read was accepted", JSON.stringify(wrongOwnerRead));
const wrongOwnerMutation = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/assortment`, { token: second.accessToken, headers: partnerHeaders(`cross-owner-${suffix}`), body: { productId: productID, priceMinor: 999 } });
if (wrongOwnerMutation.status !== 403) fail("cross-partner Store Assortment mutation was accepted", JSON.stringify(wrongOwnerMutation));
const staleAssortment = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/assortment/${productID}`, { token: first.accessToken, headers: partnerHeaders(`assortment-stale-${suffix}`, 9), body: { priceMinor: 1250, availability: true, publicationState: "published" } });
if (staleAssortment.status !== 409 || staleAssortment.body?.error?.code !== "VERSION_CONFLICT") fail("stale Store Assortment update was accepted", JSON.stringify(staleAssortment));
const publishedAssortment = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/assortment/${productID}`, { token: first.accessToken, headers: partnerHeaders(`assortment-publish-${suffix}`, 1), body: { priceMinor: 1250, availability: true, publicationState: "published" } });
if (publishedAssortment.status !== 200 || publishedAssortment.body?.assortment?.publicationState !== "published" || publishedAssortment.body.assortment.version !== 2) fail("Store Assortment publication failed", JSON.stringify(publishedAssortment));
const publicBeforeStore = await request(dshBase, "GET", "/dsh/public/stores");
if (publicBeforeStore.status !== 200 || publicBeforeStore.body.stores.some((store) => store.id === first.storeID)) fail("Store was visible before Store publication", JSON.stringify(publicBeforeStore.body));

const secondAssortment = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/assortment`, { token: second.accessToken, headers: partnerHeaders(`assortment-second-${suffix}`), body: { productId: productID, priceMinor: 1500 } });
if (secondAssortment.status !== 201) fail("second Store Assortment creation failed", JSON.stringify(secondAssortment));
const secondPublished = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/assortment/${productID}`, { token: second.accessToken, headers: partnerHeaders(`assortment-second-publish-${suffix}`, 1), body: { priceMinor: 1500, availability: true, publicationState: "published" } });
if (secondPublished.status !== 200) fail("second Store Assortment publication failed", JSON.stringify(secondPublished));
const firstStorePublished = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-first-publish-${suffix}`, `store-first-publish-${suffix}`, 1), body: { state: "published" } });
const secondStorePublished = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-second-publish-${suffix}`, `store-second-publish-${suffix}`, 1), body: { state: "published" } });
if (firstStorePublished.status !== 200 || secondStorePublished.status !== 200) fail("Store publication failed", JSON.stringify({ firstStorePublished, secondStorePublished }));
const publicPublished = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}`);
if (publicPublished.status !== 200 || publicPublished.body?.assortments?.length !== 1 || publicPublished.body.assortments[0].productId !== productID || publicPublished.body.assortments[0].canonicalImageUrl !== productInput.canonicalImageUrl || publicPublished.body.partnerActorId) fail("public Store/Product composition failed", JSON.stringify(publicPublished.body));

const renamedProductInput = { canonicalName: "Runtime Coffee Roasted", brand: productInput.brand, barcode: productInput.barcode, canonicalImageUrl: "https://example.com/runtime-coffee-roasted.jpg", active: true };
const renamedProduct = await request(dshBase, "POST", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `product-rename-${suffix}`, `product-rename-${suffix}`, 1), body: renamedProductInput });
if (renamedProduct.status !== 200 || renamedProduct.body?.product?.version !== 2) fail("central Product rename failed", JSON.stringify(renamedProduct));
const liveIdentityRead = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}`);
if (liveIdentityRead.status !== 200 || liveIdentityRead.body.assortments[0].canonicalName !== renamedProductInput.canonicalName || liveIdentityRead.body.assortments[0].canonicalImageUrl !== renamedProductInput.canonicalImageUrl) fail("public readback retained a stale Product identity copy", JSON.stringify(liveIdentityRead.body));

const disabledProduct = await request(dshBase, "POST", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `product-disable-${suffix}`, `product-disable-${suffix}`, 2), body: { ...renamedProductInput, active: false } });
if (disabledProduct.status !== 200 || disabledProduct.body?.product?.active !== false || disabledProduct.body.product.version !== 3) fail("central Product disable failed", JSON.stringify(disabledProduct));
const disabledPublic = await request(dshBase, "GET", "/dsh/public/stores");
if (disabledPublic.status !== 200 || disabledPublic.body.stores.some((store) => store.id === first.storeID || store.id === second.storeID)) fail("disabled central Product remained customer-visible", JSON.stringify(disabledPublic.body));
const disabledPublish = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/assortment/${productID}`, { token: first.accessToken, headers: partnerHeaders(`assortment-disabled-${suffix}`, 2), body: { priceMinor: 1250, availability: true, publicationState: "published" } });
if (disabledPublish.status !== 409 || disabledPublish.body?.error?.code !== "PRODUCT_DISABLED") fail("disabled Product could be published through Store Assortment", JSON.stringify(disabledPublish));
const enabledProduct = await request(dshBase, "POST", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `product-enable-${suffix}`, `product-enable-${suffix}`, 3), body: renamedProductInput });
if (enabledProduct.status !== 200 || enabledProduct.body?.product?.active !== true || enabledProduct.body.product.version !== 4) fail("central Product enable failed", JSON.stringify(enabledProduct));

const changedPrice = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/assortment/${productID}`, { token: first.accessToken, headers: partnerHeaders(`assortment-price-${suffix}`, 2), body: { priceMinor: 1800, availability: true, publicationState: "published" } });
if (changedPrice.status !== 200 || changedPrice.body?.assortment?.priceMinor !== 1800 || changedPrice.body.assortment.version !== 3) fail("Store-specific price update failed", JSON.stringify(changedPrice));
const secondPriceRead = await request(dshBase, "GET", `/dsh/public/stores/${second.storeID}`);
if (secondPriceRead.status !== 200 || secondPriceRead.body.assortments[0].priceMinor !== 1500) fail("Store A price update changed Store B", JSON.stringify(secondPriceRead.body));
const hiddenFirst = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-first-hide-${suffix}`, `store-first-hide-${suffix}`, 2), body: { state: "hidden" } });
if (hiddenFirst.status !== 200 || hiddenFirst.body?.store?.version !== 3) fail("Store-specific hide failed", JSON.stringify(hiddenFirst));
const publicAfterHide = await request(dshBase, "GET", "/dsh/public/stores");
if (publicAfterHide.status !== 200 || publicAfterHide.body.stores.some((store) => store.id === first.storeID) || !publicAfterHide.body.stores.some((store) => store.id === second.storeID)) fail("Store Assortment/Store visibility scope is wrong", JSON.stringify(publicAfterHide.body));
console.log("DSH_CENTRAL_PRODUCT_STORE_ASSORTMENT_PUBLIC_READBACK=PASS");

let outageFailure = "";
try {
  compose("stop", "identity");
  const unavailableList = await request(dshBase, "GET", "/dsh/public/stores", { timeoutMs: 15_000, allowNetworkError: true });
  if (unavailableList.status !== 502 || unavailableList.body?.error?.code !== "IDENTITY_UNAVAILABLE") outageFailure = `Identity outage did not fail closed: ${JSON.stringify(unavailableList)}`;
} finally {
  try { compose("up", "-d", "identity"); } catch (error) { outageFailure ||= `Identity restart failed: ${String(error?.message || error)}`; }
}
if (outageFailure) fail(outageFailure);
await waitForIdentityReady();
const recoveredList = await request(dshBase, "GET", "/dsh/public/stores");
if (recoveredList.status !== 200 || !recoveredList.body.stores.some((store) => store.id === second.storeID)) fail("public visibility did not recover after Identity restart", JSON.stringify(recoveredList.body));
const hiddenSecond = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-second-hide-${suffix}`, `store-second-hide-${suffix}`, 2), body: { state: "hidden" } });
if (hiddenSecond.status !== 200) fail("final Store cleanup transition failed", JSON.stringify(hiddenSecond));

console.log("DSH_IDENTITY_GATE=PASS");
console.log("DSH_RUNTIME=PASS");
console.log(`ACTING_OPERATOR_ID=${actingOperatorID}`);
console.log("DSH_CONTROL_PANEL_AUTHORITY=operator-attributed");
