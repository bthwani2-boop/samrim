import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const envArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envPath = envArg ? path.resolve(root, envArg.slice("--env-file=".length)) : path.resolve(root, "infra/local/compose/.env");

function fail(message, detail = "") { console.error(`DSH_RUNTIME=FAIL ${message}${detail ? ` detail=${detail}` : ""}`); process.exit(1); }
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
function required(values, name) { const value = values[name]?.trim(); if (!value) fail("required canonical runtime value missing", name); return value; }

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
const caseIDs = new Set(), storeIDs = new Set(), actorIDs = new Set(), productIDs = new Set(), categoryIDs = new Set(), cityIDs = new Set(), addressIDs = new Set(), offerIDs = new Set(), cartIDs = new Set(), orderIDs = new Set();
const cityA = `city-a-${suffix}`;
const cityB = `city-b-${suffix}`;
const verticalID = `grocery-${suffix}`;
const categoryID = `coffee-${suffix}`;
const childCategoryID = `beans-${suffix}`;
const clientPhone = "+96778" + crypto.randomInt(1_000_000, 9_999_999);

function compose(...args) { return execFileSync("docker", [...composeArgs, ...args], { cwd: root, encoding: "utf8" }); }
function sqlLiteral(value) { return String(value).replaceAll("'", "''"); }
function sql(query) {
  try { return execFileSync("docker", [...composeArgs, "exec", "-T", "postgres", "psql", "-U", required(env, "SAMRIM_POSTGRES_USER"), "-d", required(env, "SAMRIM_POSTGRES_DB"), "-Atc", query], { cwd: root, encoding: "utf8" }).trim(); }
  catch (error) { fail("database proof failed", String(error?.stderr || error?.message || error)); }
}
function expectSQL(query, expected, message) { const observed = sql(query); if (observed !== expected) fail(message, `expected=${expected} observed=${observed}`); }

function cleanup() {
  for (const orderID of orderIDs) {
    const value = sqlLiteral(orderID);
    sql(`DELETE FROM dsh.commerce_order_audit WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_transition_idempotency WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_checkout_idempotency WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_lines WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_orders WHERE id='${value}'`);
  }
  for (const cartID of cartIDs) {
    const value = sqlLiteral(cartID);
    sql(`DELETE FROM dsh.commerce_order_checkout_idempotency WHERE cart_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_cart_audit WHERE cart_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_cart_mutation_idempotency WHERE cart_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_cart_lines WHERE cart_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_carts WHERE id='${value}'`);
  }
  for (const offerID of offerIDs) {
    const value = sqlLiteral(offerID);
    sql(`DELETE FROM dsh.catalog_store_offer_audit WHERE offer_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offer_mutation_idempotency WHERE offer_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offers WHERE id='${value}'`);
  }
  for (const productID of productIDs) {
    const value = sqlLiteral(productID);
    sql(`DELETE FROM dsh.catalog_product_audit WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_product_mutation_idempotency WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_product_proposals WHERE proposed_name LIKE 'Runtime Coffee%'`);
    sql(`DELETE FROM dsh.catalog_product_attribute_values WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_product_categories WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_media WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_variant_identifiers WHERE variant_id IN (SELECT id FROM dsh.catalog_product_variants WHERE product_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_product_variants WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_products WHERE id='${value}'`);
  }
  for (const caseID of caseIDs) {
    const value = sqlLiteral(caseID);
    sql(`DELETE FROM dsh.joining_case_audit WHERE case_id='${value}'`);
    sql(`DELETE FROM dsh.joining_case_mutation_idempotency WHERE case_id='${value}'`);
    sql(`DELETE FROM dsh.joining_cases WHERE id='${value}'`);
  }
  for (const storeID of storeIDs) {
    const value = sqlLiteral(storeID);
    sql(`DELETE FROM dsh.catalog_store_offer_audit WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offer_mutation_idempotency WHERE offer_id IN (SELECT id FROM dsh.catalog_store_offers WHERE store_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_store_offers WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.store_publication_audit WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.store_publication_idempotency WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.stores WHERE id='${value}'`);
  }
  for (const cityID of cityIDs) {
    const value = sqlLiteral(cityID);
    sql(`DELETE FROM dsh.delivery_address_audit WHERE address_id IN (SELECT id FROM dsh.delivery_addresses WHERE service_city_id='${value}')`);
    sql(`DELETE FROM dsh.delivery_address_mutation_idempotency WHERE address_id IN (SELECT id FROM dsh.delivery_addresses WHERE service_city_id='${value}')`);
    sql(`DELETE FROM dsh.delivery_addresses WHERE service_city_id='${value}'`);
    sql(`DELETE FROM dsh.service_city_audit WHERE city_id='${value}'`);
    sql(`DELETE FROM dsh.service_city_mutation_idempotency WHERE city_id='${value}'`);
    sql(`DELETE FROM dsh.service_cities WHERE id='${value}'`);
  }
  for (const addressID of addressIDs) {
    const value = sqlLiteral(addressID);
    sql(`DELETE FROM dsh.delivery_address_audit WHERE address_id='${value}'`);
    sql(`DELETE FROM dsh.delivery_address_mutation_idempotency WHERE address_id='${value}'`);
    sql(`DELETE FROM dsh.delivery_addresses WHERE id='${value}'`);
  }
  for (const categoryIDValue of [...categoryIDs].sort((left, right) => Number(left === categoryID) - Number(right === categoryID))) {
    const value = sqlLiteral(categoryIDValue);
    sql(`DELETE FROM dsh.catalog_registry_mutation_idempotency WHERE entity_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_categories WHERE id='${value}'`);
  }
  sql(`DELETE FROM dsh.catalog_registry_mutation_idempotency WHERE entity_id='${sqlLiteral(verticalID)}'`);
  sql(`DELETE FROM dsh.commerce_verticals WHERE id='${sqlLiteral(verticalID)}'`);
  for (const actorID of actorIDs) sql(`DELETE FROM identity_actors WHERE id='${sqlLiteral(actorID)}'`);
}
process.on("exit", () => { try { cleanup(); } catch (error) { console.error(`DSH_RUNTIME_CLEANUP=FAIL ${error instanceof Error ? error.message : String(error)}`); } });

async function request(base, method, pathname, options = {}) {
  let response;
  try {
    response = await fetch(new URL(pathname, base), { method, headers: { Accept: "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}), ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), signal: AbortSignal.timeout(options.timeoutMs ?? 8_000) });
  } catch (error) {
    if (options.allowNetworkError) return { status: 0, body: null, error };
    fail("HTTP request failed", error instanceof Error ? error.message : String(error));
  }
  const raw = await response.text();
  let body = null;
  if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
  return { status: response.status, body };
}
function serviceHeaders(operatorID, key, correlation = crypto.randomUUID(), expectedVersion) { return { "X-Acting-Actor-ID": operatorID, "X-Correlation-ID": correlation, "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) }; }
function partnerHeaders(key, expectedVersion) { return { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) }; }
function hmacChallengeCode(challengeID, purpose) { const digest = crypto.createHmac("sha256", challengeSecret).update(challengeID).update(Buffer.from([0])).update(purpose).update(Buffer.from([0])).update("challenge-code").digest(); return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0"); }
async function activatePartner(phone, password) {
  const challenge = await request(identityBase, "POST", "/auth/managed/activation/request", { body: { phone, role: "partner" } });
  if (challenge.status !== 201 || typeof challenge.body?.challengeId !== "string") fail("Partner activation challenge failed", JSON.stringify(challenge));
  const activation = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role: "partner", verificationCode: hmacChallengeCode(challenge.body.challengeId, "managed_activate"), password, clientInstanceId: `dsh-runtime-${suffix}` } });
  if (activation.status !== 200 || typeof activation.body?.accessToken !== "string" || activation.body?.identity?.role !== "partner") fail("Partner activation failed", JSON.stringify(activation));
  return String(activation.body.accessToken);
}
async function createClientSession(phone) {
  const challenge = await request(identityBase, "POST", "/auth/client/registration/request", { body: { phone } });
  if (challenge.status !== 201 || typeof challenge.body?.challengeId !== "string") fail("Client registration challenge failed", JSON.stringify(challenge));
  const registration = await request(identityBase, "POST", "/auth/client/register", { body: { phone, code: hmacChallengeCode(challenge.body.challengeId, "client_register"), password: `Clie${crypto.randomBytes(2).toString("hex")}`, clientInstanceId: `dsh-client-${suffix}` } });
  if (registration.status !== 201 || typeof registration.body?.accessToken !== "string" || registration.body?.identity?.role !== "client") fail("Client registration failed", JSON.stringify(registration));
  actorIDs.add(String(registration.body.identity.subject));
  return { accessToken: String(registration.body.accessToken), actorID: String(registration.body.identity.subject) };
}
async function waitForIdentityReady(timeoutMs = 30_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const health = await request(identityBase, "GET", "/identity/health", { timeoutMs: 1_000, allowNetworkError: true }); if (health.status === 200) return; await new Promise((resolve) => setTimeout(resolve, 250)); } fail("Identity did not become ready after restart"); }

let actingOperatorID = sql("SELECT COALESCE(initial_operator_actor_id,'') FROM identity_bootstrap_state WHERE id=1");
if (!actingOperatorID) {
  const bootstrapped = await request(identityBase, "POST", "/internal/bootstrap/operator", { token: bootstrapToken, body: { phoneE164: "+9677" + crypto.randomInt(10_000_000, 99_999_999), role: "operator" } });
  if (bootstrapped.status !== 201 || !bootstrapped.body?.actorId) fail("operator bootstrap failed", JSON.stringify(bootstrapped));
  actingOperatorID = String(bootstrapped.body.actorId);
}
if (!actingOperatorID.startsWith("act_")) fail("acting operator identity is invalid", actingOperatorID);

for (const endpoint of ["/dsh/health", "/dsh/readiness"]) { const response = await request(dshBase, "GET", endpoint); if (response.status !== 200 || response.body?.status !== "ok") fail(`${endpoint} is not ready`, JSON.stringify(response.body)); }
for (const endpoint of ["/dsh/managed-roles/provision", "/dsh/managed-roles/status", "/dsh/managed-roles/disable", "/dsh/managed-roles/enable", "/dsh/managed-roles/reenrollment"]) { const response = await request(dshBase, endpoint.endsWith("status") ? "GET" : "POST", endpoint, { token: dshToken }); if (response.status !== 404) fail("retired DSH managed-access endpoint remains reachable", JSON.stringify({ endpoint, response })); }
expectSQL("SELECT count(*) FROM dsh.schema_migrations", "11", "DSH migration history is not v11");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=10", "010_central_catalog_refoundation.sql", "DSH catalog refoundation migration is not canonical");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=11", "011_cart_checkout_order.sql", "DSH Cart/Checkout/Order migration is not canonical");
for (const table of ["commerce_carts", "commerce_cart_lines", "commerce_cart_mutation_idempotency", "commerce_cart_audit", "commerce_orders", "commerce_order_lines", "commerce_order_checkout_idempotency", "commerce_order_transition_idempotency", "commerce_order_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required commerce relation is missing: ${table}`);
for (const table of ["central_products", "central_product_mutation_idempotency", "central_product_audit", "store_assortments", "store_assortment_mutation_idempotency", "store_assortment_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NULL`, "t", `retired catalog relation remains: ${table}`);
console.log("DSH_SCHEMA_V11=PASS");

for (const role of ["captain", "field"]) {
  const response = await request(identityBase, "POST", "/internal/actor-roles/provision", { token: identityDshToken, headers: { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": crypto.randomUUID() }, body: { phoneE164: "+9677" + crypto.randomInt(10_000_000, 99_999_999), role } });
  if (response.status !== 403) fail("DSH admitted a non-partner managed role", JSON.stringify({ role, response }));
}
const cityAResponse = await request(dshBase, "POST", "/dsh/service-cities", { token: dshToken, headers: serviceHeaders(actingOperatorID, `city-a-${suffix}`), body: { id: cityA, displayNameAr: `مدينة أ ${suffix}`, active: true } });
const cityBResponse = await request(dshBase, "POST", "/dsh/service-cities", { token: dshToken, headers: serviceHeaders(actingOperatorID, `city-b-${suffix}`), body: { id: cityB, displayNameAr: `مدينة ب ${suffix}`, active: true } });
if (cityAResponse.status !== 201 || cityBResponse.status !== 201) fail("service city fixtures could not be created", JSON.stringify({ cityAResponse, cityBResponse }));
cityIDs.add(cityA); cityIDs.add(cityB);
console.log("DSH_CITY_SCOPE_RUNTIME=PASS");

const verticalCreate = await request(dshBase, "POST", "/dsh/catalog/verticals", { token: dshToken, headers: serviceHeaders(actingOperatorID, `vertical-${suffix}`), body: { id: verticalID, nameAr: `بقالة ${suffix}`, nameEn: `Grocery ${suffix}`, active: true } });
if (verticalCreate.status !== 201 || verticalCreate.body?.vertical?.id !== verticalID) fail("commerce vertical creation failed", JSON.stringify(verticalCreate));
const verticalList = await request(dshBase, "GET", "/dsh/catalog/verticals", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (verticalList.status !== 200 || !verticalList.body?.verticals?.some((item) => item.id === verticalID)) fail("commerce vertical registry readback failed", JSON.stringify(verticalList));
const categoryCreate = await request(dshBase, "POST", "/dsh/catalog/categories", { token: dshToken, headers: serviceHeaders(actingOperatorID, `category-${suffix}`), body: { id: categoryID, verticalId: verticalID, nameAr: `قهوة ${suffix}`, nameEn: `Coffee ${suffix}`, active: true } });
const childCategoryCreate = await request(dshBase, "POST", "/dsh/catalog/categories", { token: dshToken, headers: serviceHeaders(actingOperatorID, `category-child-${suffix}`), body: { id: childCategoryID, verticalId: verticalID, parentCategoryId: categoryID, nameAr: `حبوب ${suffix}`, nameEn: `Beans ${suffix}`, active: true } });
if (categoryCreate.status !== 201 || childCategoryCreate.status !== 201 || childCategoryCreate.body?.category?.parentCategoryId !== categoryID) fail("catalog parent category tree failed", JSON.stringify({ categoryCreate, childCategoryCreate }));
categoryIDs.add(categoryID); categoryIDs.add(childCategoryID);
console.log("DSH_CATALOG_REGISTRY=PASS");

async function createApprovedPartner(phone, name, serviceCityId) {
  const createKey = `joining-${crypto.randomUUID()}`;
  const created = await request(dshBase, "POST", "/dsh/joining-cases", { token: dshToken, headers: serviceHeaders(actingOperatorID, createKey), body: { contactPhoneE164: phone, businessName: `${name} business`, firstStoreName: `${name} store`, serviceCityId, firstStoreVerticalId: verticalID } });
  if (created.status !== 201 || created.body?.case?.state !== "draft" || created.body?.case?.firstStoreVerticalId !== verticalID) fail("joining case creation failed", JSON.stringify(created));
  const caseID = String(created.body.case.id); caseIDs.add(caseID);
  const submitted = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/submit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `submit-${crypto.randomUUID()}`, crypto.randomUUID(), 1) });
  if (submitted.status !== 200 || submitted.body?.case?.state !== "submitted" || !submitted.body?.case?.partnerActorId) fail("joining case submission failed", JSON.stringify(submitted));
  const actorID = String(submitted.body.case.partnerActorId); actorIDs.add(actorID);
  const accessToken = await activatePartner(phone, name.slice(0, 4).padEnd(4, "x") + suffix.slice(0, 4));
  const approved = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `approve-${crypto.randomUUID()}`, crypto.randomUUID(), 2), body: { decision: "approved" } });
  if (approved.status !== 200 || approved.body?.case?.state !== "approved" || approved.body?.case?.store?.primaryVerticalId !== verticalID) fail("joining case approval did not preserve vertical", JSON.stringify(approved));
  const storeID = String(approved.body.case.store.id); storeIDs.add(storeID);
  return { accessToken, actorID, caseID, storeID };
}
const first = await createApprovedPartner("+96772" + crypto.randomInt(1_000_000, 9_999_999), "Catalog Runtime A", cityA);
const second = await createApprovedPartner("+96774" + crypto.randomInt(1_000_000, 9_999_999), "Catalog Runtime B", cityB);
const correctionPhone = "+96776" + crypto.randomInt(1_000_000, 9_999_999);
const correctionCreated = await request(dshBase, "POST", "/dsh/joining-cases", { token: dshToken, headers: serviceHeaders(actingOperatorID, `joining-correction-${suffix}`), body: { contactPhoneE164: correctionPhone, businessName: "Correction business", firstStoreName: "Correction store", serviceCityId: cityA, firstStoreVerticalId: verticalID } });
if (correctionCreated.status !== 201 || correctionCreated.body?.case?.state !== "draft") fail("correction joining case creation failed", JSON.stringify(correctionCreated));
const correctionCaseID = String(correctionCreated.body.case.id); caseIDs.add(correctionCaseID);
const correctionSubmitted = await request(dshBase, "POST", `/dsh/joining-cases/${correctionCaseID}/submit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `submit-correction-${suffix}`, crypto.randomUUID(), 1) });
if (correctionSubmitted.status !== 200 || correctionSubmitted.body?.case?.state !== "submitted" || !correctionSubmitted.body?.case?.partnerActorId) fail("correction joining case submission failed", JSON.stringify(correctionSubmitted));
const correctionActorID = String(correctionSubmitted.body.case.partnerActorId); actorIDs.add(correctionActorID);
const correctionAccessToken = await activatePartner(correctionPhone, `Corr${suffix.slice(0, 4)}`);
const needsCorrection = await request(dshBase, "POST", `/dsh/joining-cases/${correctionCaseID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `needs-correction-${suffix}`, crypto.randomUUID(), 2), body: { decision: "needs_correction", correctionReason: "صحح اسم المتجر قبل الاعتماد" } });
if (needsCorrection.status !== 200 || needsCorrection.body?.case?.state !== "needs_correction" || needsCorrection.body.case.version !== 3) fail("joining case correction review failed", JSON.stringify(needsCorrection));
const corrected = await request(dshBase, "POST", `/dsh/joining-cases/${correctionCaseID}/correct-and-resubmit`, { token: correctionAccessToken, headers: partnerHeaders(`correct-and-resubmit-${suffix}`, 3), body: { businessName: "Correction business fixed", firstStoreName: "Correction store fixed", serviceCityId: cityA, firstStoreVerticalId: verticalID } });
if (corrected.status !== 200 || corrected.body?.case?.state !== "submitted" || corrected.body.case.version !== 4 || corrected.body.case.firstStoreVerticalId !== verticalID) fail("joining case correct-and-resubmit failed", JSON.stringify(corrected));
const correctedApproved = await request(dshBase, "POST", `/dsh/joining-cases/${correctionCaseID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `approve-correction-${suffix}`, crypto.randomUUID(), 4), body: { decision: "approved" } });
if (correctedApproved.status !== 200 || correctedApproved.body?.case?.state !== "approved" || !correctedApproved.body?.case?.store?.id) fail("corrected joining case approval failed", JSON.stringify(correctedApproved));
storeIDs.add(String(correctedApproved.body.case.store.id));
console.log("DSH_JOINING_CASE_VERTICAL=PASS");
console.log("DSH_JOINING_CASE_CORRECTION=PASS");

const productInput = { canonicalName: "Runtime Coffee", verticalId: verticalID, scope: "SHARED", variantTitle: "عبوة 250 غ", sellUnit: "piece", categoryIds: [childCategoryID], identifierType: "GTIN", identifierValue: "6281000000001", imageUri: "https://example.com/runtime-coffee.jpg" };
const productKey = `product-${suffix}`;
const productCreate = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, productKey), body: productInput });
if (productCreate.status !== 201 || productCreate.body?.product?.version !== 1 || !productCreate.body?.product?.id) fail("catalog Product creation failed", JSON.stringify(productCreate));
const productID = String(productCreate.body.product.id); productIDs.add(productID);
const productRead = await request(dshBase, "GET", `/dsh/catalog/products?q=Runtime%20Coffee&verticalId=${encodeURIComponent(verticalID)}&limit=50`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (productRead.status !== 200 || productRead.body?.products?.length !== 1 || productRead.body.products[0].variants?.length !== 1 || productRead.body.products[0].variants[0].identifiers?.[0]?.value !== productInput.identifierValue) fail("catalog Product/Variant canonical readback failed", JSON.stringify(productRead));
const variantID = String(productRead.body.products[0].variants[0].id);
const productReplay = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, productKey), body: productInput });
if (productReplay.status !== 200 || productReplay.body?.idempotentReplay !== true || productReplay.body.product.id !== productID) fail("catalog Product replay failed", JSON.stringify(productReplay));
const duplicate = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, `product-duplicate-${suffix}`), body: { ...productInput, canonicalName: "Runtime Duplicate" } });
if (duplicate.status !== 409 || duplicate.body?.error?.code !== "DUPLICATE_IDENTIFIER") fail("duplicate Variant identifier was accepted", JSON.stringify(duplicate));
const partnerWrite = await request(dshBase, "POST", "/dsh/catalog/products", { token: first.accessToken, headers: partnerHeaders(`partner-product-${suffix}`), body: productInput });
if (partnerWrite.status !== 401) fail("partner reached the canonical Product writer", JSON.stringify(partnerWrite));
const partnerLookup = await request(dshBase, "GET", `/dsh/catalog/products?verticalId=${encodeURIComponent(verticalID)}&limit=50`, { token: first.accessToken });
if (partnerLookup.status !== 200 || !partnerLookup.body?.products?.some((item) => item.id === productID && item.variants?.some((variant) => variant.id === variantID))) fail("partner Product/Variant lookup failed", JSON.stringify(partnerLookup));
console.log("DSH_PRODUCT_VARIANT=PASS");

const offerKey = `offer-a-${suffix}`;
const offerCreate = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: first.accessToken, headers: partnerHeaders(offerKey), body: { variantId: variantID, priceMinor: 1250, quantityPolicy: "DISCRETE", pricingBasis: "PER_UNIT" } });
if (offerCreate.status !== 201 || offerCreate.body?.offer?.publicationState !== "draft" || offerCreate.body?.offer?.variantId !== variantID) fail("StoreOffer creation failed", JSON.stringify(offerCreate));
const offerAID = String(offerCreate.body.offer.offerId); offerIDs.add(offerAID);
const offerReplay = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: first.accessToken, headers: partnerHeaders(offerKey), body: { variantId: variantID, priceMinor: 1250, quantityPolicy: "DISCRETE", pricingBasis: "PER_UNIT" } });
if (offerReplay.status !== 200 || offerReplay.body?.idempotentReplay !== true) fail("StoreOffer replay failed", JSON.stringify(offerReplay));
const offerConflict = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: first.accessToken, headers: partnerHeaders(offerKey), body: { variantId: variantID, priceMinor: 1300, quantityPolicy: "DISCRETE", pricingBasis: "PER_UNIT" } });
if (offerConflict.status !== 409 || offerConflict.body?.error?.code !== "IDEMPOTENCY_CONFLICT") fail("divergent StoreOffer retry was accepted", JSON.stringify(offerConflict));
const wrongOwnerRead = await request(dshBase, "GET", `/dsh/stores/${first.storeID}/offers`, { token: second.accessToken });
const wrongOwnerWrite = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: second.accessToken, headers: partnerHeaders(`cross-owner-${suffix}`), body: { variantId: variantID, priceMinor: 999, quantityPolicy: "DISCRETE", pricingBasis: "PER_UNIT" } });
if (wrongOwnerRead.status !== 403 || wrongOwnerWrite.status !== 403) fail("cross-partner StoreOffer ownership boundary failed", JSON.stringify({ wrongOwnerRead, wrongOwnerWrite }));
const staleOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`offer-stale-${suffix}`, 9), body: { priceMinor: 1250, availability: true, publicationState: "published" } });
if (staleOffer.status !== 409 || staleOffer.body?.error?.code !== "VERSION_CONFLICT") fail("stale StoreOffer update was accepted", JSON.stringify(staleOffer));
const publishedOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`offer-publish-${suffix}`, 1), body: { priceMinor: 1250, availability: true, publicationState: "published" } });
if (publishedOffer.status !== 200 || publishedOffer.body?.offer?.publicationState !== "published" || publishedOffer.body.offer.version !== 2) fail("StoreOffer publication failed", JSON.stringify(publishedOffer));
const offerB = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/offers`, { token: second.accessToken, headers: partnerHeaders(`offer-b-${suffix}`), body: { variantId: variantID, priceMinor: 1500, quantityPolicy: "DISCRETE", pricingBasis: "PER_UNIT" } });
if (offerB.status !== 201) fail("second StoreOffer creation failed", JSON.stringify(offerB));
const offerBID = String(offerB.body.offer.offerId); offerIDs.add(offerBID);
const publishedOfferB = await request(dshBase, "PATCH", `/dsh/stores/${second.storeID}/offers/${offerBID}`, { token: second.accessToken, headers: partnerHeaders(`offer-b-publish-${suffix}`, 1), body: { priceMinor: 1500, availability: true, publicationState: "published" } });
if (publishedOfferB.status !== 200) fail("second StoreOffer publication failed", JSON.stringify(publishedOfferB));
console.log("DSH_STORE_OFFER=PASS");

const publishA = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-a-publish-${suffix}`, crypto.randomUUID(), 1), body: { state: "published" } });
const publishB = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-b-publish-${suffix}`, crypto.randomUUID(), 1), body: { state: "published" } });
if (publishA.status !== 200 || publishB.status !== 200) fail("Store publication failed after catalog readiness", JSON.stringify({ publishA, publishB }));
const publicCatalog = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}&categoryId=${encodeURIComponent(childCategoryID)}&q=Runtime%20Coffee`);
const publicWrongCategory = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}&categoryId=${encodeURIComponent(categoryID)}`);
const publicWrongCity = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityB)}`);
if (publicCatalog.status !== 200 || publicCatalog.body?.offers?.length !== 1 || publicCatalog.body.offers[0].offerId !== offerAID || publicCatalog.body.offers[0].productName !== productInput.canonicalName || publicWrongCategory.status !== 200 || publicWrongCategory.body?.offers?.length !== 0 || publicWrongCity.status !== 404) fail("customer-visible catalog evaluator or city/category scope failed", JSON.stringify({ publicCatalog, publicWrongCategory, publicWrongCity }));
const publicStores = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(cityA)}`);
if (publicStores.status !== 200 || !publicStores.body?.stores?.some((store) => store.id === first.storeID) || publicStores.body.stores.find((store) => store.id === first.storeID)?.partnerActorId) fail("public Store projection leaked or omitted the eligible store", JSON.stringify(publicStores));
console.log("DSH_CUSTOMER_VISIBLE_CATALOG=PASS");

const client = await createClientSession(clientPhone);
const addressA = await request(dshBase, "POST", "/dsh/addresses", { token: client.accessToken, headers: partnerHeaders(`address-a-${suffix}`), body: { addressText: `عنوان أ ${suffix}`, latitude: 15.3694457, longitude: 44.1910064, serviceCityId: cityA } });
const addressB = await request(dshBase, "POST", "/dsh/addresses", { token: client.accessToken, headers: partnerHeaders(`address-b-${suffix}`), body: { addressText: `عنوان ب ${suffix}`, latitude: 15.3694458, longitude: 44.1910065, serviceCityId: cityB } });
if (addressA.status !== 201 || addressB.status !== 201) fail("serviceability address fixtures failed", JSON.stringify({ addressA, addressB }));
const addressAID = String(addressA.body.address.id), addressBID = String(addressB.body.address.id); addressIDs.add(addressAID); addressIDs.add(addressBID);
const serviceable = await request(dshBase, "POST", "/dsh/serviceability", { token: client.accessToken, body: { storeId: first.storeID, addressId: addressAID } });
const unserviceable = await request(dshBase, "POST", "/dsh/serviceability", { token: client.accessToken, body: { storeId: second.storeID, addressId: addressAID } });
if (serviceable.status !== 200 || serviceable.body?.status !== "SERVICEABLE" || unserviceable.status !== 200 || unserviceable.body?.status !== "UNSERVICEABLE") fail("city serviceability positive/negative proof failed", JSON.stringify({ serviceable, unserviceable }));
const wrongRole = await request(dshBase, "POST", "/dsh/serviceability", { token: first.accessToken, body: { storeId: first.storeID, addressId: addressAID } });
if (wrongRole.status !== 403) fail("serviceability accepted partner role", JSON.stringify(wrongRole));
console.log("DSH_SERVICEABILITY=PASS");

const renameBody = { canonicalName: "Runtime Coffee Renamed", verticalId: verticalID, scope: "SHARED", active: true };
const renamed = await request(dshBase, "PATCH", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `rename-${suffix}`, crypto.randomUUID(), 1), body: renameBody });
if (renamed.status !== 200 || renamed.body?.product?.version !== 2) fail("catalog Product versioned update failed", JSON.stringify(renamed));
const renamedCatalog = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}`);
if (renamedCatalog.status !== 200 || renamedCatalog.body?.offers?.[0]?.productName !== renameBody.canonicalName) fail("StoreOffer readback retained stale Product identity", JSON.stringify(renamedCatalog));
const disabled = await request(dshBase, "PATCH", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `disable-${suffix}`, crypto.randomUUID(), 2), body: { ...renameBody, active: false } });
if (disabled.status !== 200 || disabled.body?.product?.active !== false || disabled.body.product.version !== 3) fail("catalog Product disable failed", JSON.stringify(disabled));
const disabledPublic = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}`);
if (disabledPublic.status !== 404 || disabledPublic.body?.error?.code !== "NOT_FOUND") fail("disabled Product remained customer-visible", JSON.stringify(disabledPublic));
const disabledOfferPublish = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`disabled-offer-${suffix}`, 2), body: { priceMinor: 1250, availability: true, publicationState: "published" } });
if (disabledOfferPublish.status !== 409 || disabledOfferPublish.body?.error?.code !== "PRODUCT_NOT_ELIGIBLE") fail("disabled Product could be published", JSON.stringify(disabledOfferPublish));
const enabled = await request(dshBase, "PATCH", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `enable-${suffix}`, crypto.randomUUID(), 3), body: renameBody });
if (enabled.status !== 200 || enabled.body?.product?.active !== true || enabled.body.product.version !== 4) fail("catalog Product re-enable failed", JSON.stringify(enabled));
const changedPrice = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`price-${suffix}`, 2), body: { priceMinor: 1800, availability: true, publicationState: "published" } });
if (changedPrice.status !== 200 || changedPrice.body?.offer?.priceMinor !== 1800 || changedPrice.body.offer.version !== 3) fail("StoreOffer price update failed", JSON.stringify(changedPrice));
const secondCatalog = await request(dshBase, "GET", `/dsh/public/stores/${second.storeID}/catalog?serviceCityId=${encodeURIComponent(cityB)}`);
if (secondCatalog.status !== 200 || secondCatalog.body?.offers?.[0]?.priceMinor !== 1500) fail("Store-specific price leaked across stores", JSON.stringify(secondCatalog));
const emptyCart = await request(dshBase, "GET", `/dsh/cart?storeId=${encodeURIComponent(first.storeID)}`, { token: client.accessToken });
if (emptyCart.status !== 404) fail("new client cart did not begin empty", JSON.stringify(emptyCart));
const cartLineBody = { storeId: first.storeID, storeOfferId: offerAID, quantityBaseUnits: 1, selectedModifierOptionIds: [] };
const cartCreateKey = `cart-add-${suffix}`;
const cartCreate = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(cartCreateKey, 0), body: cartLineBody });
if (cartCreate.status !== 201 || cartCreate.body?.cart?.state !== "open" || cartCreate.body?.cart?.version !== 1 || cartCreate.body?.cart?.lines?.length !== 1) fail("cart line creation failed", JSON.stringify(cartCreate));
const cartID = String(cartCreate.body.cart.id); cartIDs.add(cartID);
const cartLineID = String(cartCreate.body.cart.lines[0].id);
const cartReplay = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(cartCreateKey, 0), body: cartLineBody });
if (cartReplay.status !== 200 || cartReplay.body?.idempotentReplay !== true || cartReplay.body.cart.id !== cartID || cartReplay.body.cart.version !== 1) fail("cart line idempotency replay failed", JSON.stringify(cartReplay));
const cartUpdate = await request(dshBase, "PATCH", `/dsh/cart/lines/${encodeURIComponent(cartLineID)}`, { token: client.accessToken, headers: partnerHeaders(`cart-update-${suffix}`, 1), body: { quantityBaseUnits: 2, selectedModifierOptionIds: [] } });
if (cartUpdate.status !== 201 || cartUpdate.body?.cart?.version !== 2 || cartUpdate.body.cart.lines[0]?.quantityBaseUnits !== 2) fail("cart line versioned update failed", JSON.stringify(cartUpdate));
const cartStale = await request(dshBase, "PATCH", `/dsh/cart/lines/${encodeURIComponent(cartLineID)}`, { token: client.accessToken, headers: partnerHeaders(`cart-stale-${suffix}`, 1), body: { quantityBaseUnits: 3, selectedModifierOptionIds: [] } });
if (cartStale.status !== 409 || cartStale.body?.error?.code !== "STALE_CHECKOUT") fail("stale cart mutation was accepted", JSON.stringify(cartStale));
const cartUnserviceable = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`checkout-unserviceable-${suffix}`, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressBID } });
if (cartUnserviceable.status !== 409 || cartUnserviceable.body?.error?.code !== "UNSERVICEABLE") fail("cart checkout accepted an out-of-city address", JSON.stringify(cartUnserviceable));
const hiddenCartOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`cart-offer-hide-${suffix}`, 3), body: { priceMinor: 1800, availability: true, publicationState: "hidden" } });
if (hiddenCartOffer.status !== 200 || hiddenCartOffer.body?.offer?.publicationState !== "hidden" || hiddenCartOffer.body.offer.version !== 4) fail("cart offer failure fixture was not applied canonically", JSON.stringify(hiddenCartOffer));
const unavailableCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`checkout-offer-unavailable-${suffix}`, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID } });
if (unavailableCheckout.status !== 409 || unavailableCheckout.body?.error?.code !== "UNSERVICEABLE") fail("checkout did not fail closed when the StoreOffer was hidden", JSON.stringify(unavailableCheckout));
const restoredCartOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`cart-offer-restore-${suffix}`, 4), body: { priceMinor: 1800, availability: true, publicationState: "published" } });
if (restoredCartOffer.status !== 200 || restoredCartOffer.body?.offer?.publicationState !== "published" || restoredCartOffer.body.offer.version !== 5) fail("cart offer recovery failed", JSON.stringify(restoredCartOffer));
const checkoutKey = `checkout-${suffix}`;
const checkout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(checkoutKey, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID } });
if (checkout.status !== 201 || checkout.body?.order?.state !== "CREATED" || checkout.body.order.version !== 1 || checkout.body.order.totalAmountMinor !== 3600 || checkout.body.order.lines?.[0]?.requestedQuantityBaseUnits !== 2 || checkout.body.order.lines?.[0]?.unitPriceMinor !== 1800) fail("cart checkout did not create an immutable Order snapshot", JSON.stringify(checkout));
const orderID = String(checkout.body.order.id); orderIDs.add(orderID);
const checkoutReplay = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(checkoutKey, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID } });
if (checkoutReplay.status !== 200 || checkoutReplay.body?.idempotentReplay !== true || checkoutReplay.body.order.id !== orderID || checkoutReplay.body.order.version !== 1) fail("checkout idempotency replay failed", JSON.stringify(checkoutReplay));
const closedCart = await request(dshBase, "GET", `/dsh/cart?storeId=${encodeURIComponent(first.storeID)}`, { token: client.accessToken });
if (closedCart.status !== 404) fail("checked-out cart remained an open cart", JSON.stringify(closedCart));
const clientOrders = await request(dshBase, "GET", "/dsh/orders?limit=10", { token: client.accessToken });
const clientOrderRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}`, { token: client.accessToken });
const partnerOrders = await request(dshBase, "GET", `/dsh/stores/${first.storeID}/orders?limit=10`, { token: first.accessToken });
const partnerOrderRead = await request(dshBase, "GET", `/dsh/stores/${first.storeID}/orders/${encodeURIComponent(orderID)}`, { token: first.accessToken });
if (clientOrders.status !== 200 || !clientOrders.body?.orders?.some((item) => item.id === orderID) || clientOrderRead.status !== 200 || clientOrderRead.body?.order?.id !== orderID || partnerOrders.status !== 200 || !partnerOrders.body?.orders?.some((item) => item.id === orderID) || partnerOrderRead.status !== 200 || partnerOrderRead.body?.order?.id !== orderID) fail("client/partner Order readback boundary failed", JSON.stringify({ clientOrders, clientOrderRead, partnerOrders, partnerOrderRead }));
const acceptKey = `order-accept-${suffix}`;
const accepted = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/orders/${encodeURIComponent(orderID)}/transition`, { token: first.accessToken, headers: partnerHeaders(acceptKey, 1), body: { state: "PARTNER_ACCEPTED" } });
if (accepted.status !== 200 || accepted.body?.order?.state !== "PARTNER_ACCEPTED" || accepted.body.order.version !== 2) fail("Order partner acceptance failed", JSON.stringify(accepted));
const acceptedReplay = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/orders/${encodeURIComponent(orderID)}/transition`, { token: first.accessToken, headers: partnerHeaders(acceptKey, 1), body: { state: "PARTNER_ACCEPTED" } });
if (acceptedReplay.status !== 200 || acceptedReplay.body?.idempotentReplay !== true || acceptedReplay.body.order.version !== 2) fail("Order transition idempotency replay failed", JSON.stringify(acceptedReplay));
const staleTransition = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/orders/${encodeURIComponent(orderID)}/transition`, { token: first.accessToken, headers: partnerHeaders(`order-stale-${suffix}`, 1), body: { state: "PREPARING" } });
if (staleTransition.status !== 409) fail("stale Order transition was accepted", JSON.stringify(staleTransition));
const preparing = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/orders/${encodeURIComponent(orderID)}/transition`, { token: first.accessToken, headers: partnerHeaders(`order-preparing-${suffix}`, 2), body: { state: "PREPARING" } });
const ready = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/orders/${encodeURIComponent(orderID)}/transition`, { token: first.accessToken, headers: partnerHeaders(`order-ready-${suffix}`, 3), body: { state: "READY_FOR_DISPATCH" } });
if (preparing.status !== 200 || preparing.body?.order?.state !== "PREPARING" || preparing.body.order.version !== 3 || ready.status !== 200 || ready.body?.order?.state !== "READY_FOR_DISPATCH" || ready.body.order.version !== 4) fail("Order pre-dispatch lifecycle did not reach READY_FOR_DISPATCH", JSON.stringify({ preparing, ready }));
const invalidTransition = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/orders/${encodeURIComponent(orderID)}/transition`, { token: first.accessToken, headers: partnerHeaders(`order-invalid-${suffix}`, 4), body: { state: "PREPARING" } });
const finalOrder = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}`, { token: client.accessToken });
if (invalidTransition.status !== 409 || finalOrder.status !== 200 || finalOrder.body?.order?.state !== "READY_FOR_DISPATCH" || finalOrder.body.order.version !== 4 || finalOrder.body.order.lines?.[0]?.lineAmountMinor !== 3600) fail("Order final readback or invalid transition guard failed", JSON.stringify({ invalidTransition, finalOrder }));
console.log("DSH_CART_CHECKOUT=PASS");
console.log("DSH_ORDER_READY_FOR_DISPATCH=PASS");
const hiddenA = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-a-hide-${suffix}`, crypto.randomUUID(), 2), body: { state: "hidden" } });
if (hiddenA.status !== 200) fail("Store hide failed", JSON.stringify(hiddenA));
const afterHideA = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(cityA)}`);
const afterHideB = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(cityB)}`);
if (afterHideA.status !== 200 || afterHideA.body?.stores?.some((store) => store.id === first.storeID) || afterHideB.status !== 200 || !afterHideB.body?.stores?.some((store) => store.id === second.storeID)) fail("Store publication visibility scope failed", JSON.stringify({ afterHideA, afterHideB }));
console.log("DSH_CATALOG_CROSS_STORE_READBACK=PASS");

let outageFailure = "";
try {
  compose("stop", "identity");
  const unavailable = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(cityB)}`, { timeoutMs: 15_000, allowNetworkError: true });
  if (unavailable.status !== 502 || unavailable.body?.error?.code !== "IDENTITY_UNAVAILABLE") outageFailure = `Identity outage did not fail closed: ${JSON.stringify(unavailable)}`;
} finally {
  try { compose("up", "-d", "identity"); } catch (error) { outageFailure ||= `Identity restart failed: ${String(error?.message || error)}`; }
}
if (outageFailure) fail(outageFailure);
await waitForIdentityReady();
console.log("DSH_IDENTITY_FAILURE_RECOVERY=PASS");
console.log("DSH_RUNTIME=PASS");
