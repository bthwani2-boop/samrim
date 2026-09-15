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
const caseIDs = new Set(), storeIDs = new Set(), actorIDs = new Set(), productIDs = new Set(), categoryIDs = new Set(), cityIDs = new Set(), addressIDs = new Set(), offerIDs = new Set(), cartIDs = new Set(), orderIDs = new Set(), proposalIDs = new Set(), importRunIDs = new Set(), modifierGroupIDs = new Set(), sectionIDs = new Set(), attributeIDs = new Set();
const cityA = `city-a-${suffix}`;
const cityB = `city-b-${suffix}`;
const verticalID = `grocery-${suffix}`;
const categoryID = `coffee-${suffix}`;
const childCategoryID = `beans-${suffix}`;
const enumAttributeID = `roast-${suffix}`;
const measurementAttributeID = `net-weight-${suffix}`;
const dateAttributeID = `expiry-${suffix}`;
const clientPhone = "+96778" + crypto.randomInt(1_000_000, 9_999_999);

function compose(...args) { return execFileSync("docker", [...composeArgs, ...args], { cwd: root, encoding: "utf8" }); }
function sqlLiteral(value) { return String(value).replaceAll("'", "''"); }
function sql(query) {
  try { return execFileSync("docker", [...composeArgs, "exec", "-T", "postgres", "psql", "-U", required(env, "SAMRIM_POSTGRES_USER"), "-d", required(env, "SAMRIM_POSTGRES_DB"), "-Atc", query], { cwd: root, encoding: "utf8" }).trim(); }
  catch (error) { fail("database proof failed", String(error?.stderr || error?.message || error)); }
}
function expectSQL(query, expected, message) { const observed = sql(query); if (observed !== expected) fail(message, `expected=${expected} observed=${observed}`); }

function cleanup() {
  for (const importRunID of importRunIDs) {
    const value = sqlLiteral(importRunID);
    sql(`DELETE FROM dsh.catalog_import_audit WHERE run_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_import_mutation_idempotency WHERE run_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_import_run_items WHERE run_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_import_runs WHERE id='${value}'`);
  }
  for (const orderID of orderIDs) {
    const value = sqlLiteral(orderID);
    sql(`DELETE FROM dsh.commerce_order_audit WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_transition_idempotency WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_checkout_idempotency WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_line_modifier_snapshots WHERE order_line_id IN (SELECT id FROM dsh.commerce_order_lines WHERE order_id='${value}')`);
    sql(`DELETE FROM dsh.commerce_order_line_attribute_snapshots WHERE order_line_id IN (SELECT id FROM dsh.commerce_order_lines WHERE order_id='${value}')`);
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
  for (const proposalID of proposalIDs) {
    const value = sqlLiteral(proposalID);
    sql(`DELETE FROM dsh.catalog_product_proposal_audit WHERE proposal_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_product_proposal_idempotency WHERE proposal_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_product_proposals WHERE id='${value}'`);
  }
  for (const offerID of offerIDs) {
    const value = sqlLiteral(offerID);
    sql(`DELETE FROM dsh.catalog_storefront_section_offers WHERE offer_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offer_modifier_groups WHERE offer_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offer_audit WHERE offer_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offer_mutation_idempotency WHERE offer_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offers WHERE id='${value}'`);
  }
  for (const productID of productIDs) {
    const value = sqlLiteral(productID);
    sql(`DELETE FROM dsh.catalog_variant_attribute_values WHERE variant_id IN (SELECT id FROM dsh.catalog_product_variants WHERE product_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_variant_audit WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_variant_mutation_idempotency WHERE variant_id IN (SELECT id FROM dsh.catalog_product_variants WHERE product_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_product_audit WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_product_mutation_idempotency WHERE product_id='${value}'`);
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
    sql(`DELETE FROM dsh.catalog_storefront_section_offers WHERE section_id IN (SELECT id FROM dsh.catalog_storefront_sections WHERE store_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_storefront_sections WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offer_modifier_groups WHERE offer_id IN (SELECT id FROM dsh.catalog_store_offers WHERE store_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_modifier_options WHERE group_id IN (SELECT id FROM dsh.catalog_modifier_groups WHERE store_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_modifier_groups WHERE store_id='${value}'`);
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
    sql(`DELETE FROM dsh.catalog_category_attribute_rules WHERE category_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_registry_mutation_idempotency WHERE entity_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_categories WHERE id='${value}'`);
  }
  sql(`DELETE FROM dsh.catalog_registry_mutation_idempotency WHERE entity_id='${sqlLiteral(verticalID)}'`);
  for (const attributeID of attributeIDs) {
    const value = sqlLiteral(attributeID);
    sql(`DELETE FROM dsh.catalog_attribute_enum_options WHERE attribute_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_attribute_mutation_idempotency WHERE attribute_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_attribute_definitions WHERE id='${value}'`);
  }
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
function discreteOffer(priceMinor, publicationState, availability = true) { return { priceMinor, availability, publicationState, quantityPolicy: "DISCRETE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 1000, quantityStepBaseUnits: 1, pricingBasis: "PER_UNIT", pricingUnitBaseUnits: 1 }; }
function discreteCreateOffer(variantId, priceMinor) { return { variantId, priceMinor, quantityPolicy: "DISCRETE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 1000, quantityStepBaseUnits: 1, pricingBasis: "PER_UNIT", pricingUnitBaseUnits: 1 }; }
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
expectSQL("SELECT count(*) FROM dsh.schema_migrations", "14", "DSH migration history is not v14");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=10", "010_central_catalog_refoundation.sql", "DSH catalog refoundation migration is not canonical");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=11", "011_cart_checkout_order.sql", "DSH Cart/Checkout/Order migration is not canonical");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=12", "012_catalog_semantic_correction.sql", "DSH catalog semantic correction migration is not canonical");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=13", "013_catalog_variant_mutations.sql", "DSH catalog mutation migration is not canonical");
expectSQL("SELECT name FROM dsh.schema_migrations WHERE version=14", "014_catalog_proposal_import_closure.sql", "DSH proposal/import closure migration is not canonical");
for (const table of ["commerce_carts", "commerce_cart_lines", "commerce_cart_mutation_idempotency", "commerce_cart_audit", "commerce_orders", "commerce_order_lines", "commerce_order_checkout_idempotency", "commerce_order_transition_idempotency", "commerce_order_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required commerce relation is missing: ${table}`);
for (const table of ["central_products", "central_product_mutation_idempotency", "central_product_audit", "store_assortments", "store_assortment_mutation_idempotency", "store_assortment_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NULL`, "t", `retired catalog relation remains: ${table}`);
for (const table of ["catalog_attribute_enum_options", "catalog_category_attribute_rules", "catalog_variant_attribute_values", "catalog_storefront_sections", "catalog_modifier_groups", "catalog_modifier_options", "catalog_variant_mutation_idempotency", "catalog_variant_audit", "catalog_attribute_mutation_idempotency", "commerce_order_line_modifier_snapshots", "commerce_order_line_attribute_snapshots"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required v12/v13 relation is missing: ${table}`);
for (const table of ["catalog_import_mutation_idempotency", "catalog_import_run_items", "catalog_import_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required v14 relation is missing: ${table}`);
console.log("DSH_SCHEMA_V14=PASS");

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

const attributeDefinitions = [
  { id: enumAttributeID, code: "roast", nameAr: `التحميص ${suffix}`, valueKind: "ENUM" },
  { id: measurementAttributeID, code: "net_weight", nameAr: `الوزن ${suffix}`, valueKind: "MEASUREMENT" },
  { id: dateAttributeID, code: "expiry_date", nameAr: `الصلاحية ${suffix}`, valueKind: "DATE" },
];
for (const definition of attributeDefinitions) {
  const response = await request(dshBase, "POST", "/dsh/catalog/attributes", { token: dshToken, headers: serviceHeaders(actingOperatorID, `attribute-${definition.id}`), body: { ...definition, verticalId: verticalID, active: true } });
  if (response.status !== 201 || response.body?.definition?.id !== definition.id || response.body.definition.valueKind !== definition.valueKind) fail("typed catalog Attribute definition failed", JSON.stringify({ definition, response }));
  attributeIDs.add(definition.id);
}
const attributeRead = await request(dshBase, "GET", `/dsh/catalog/attributes?verticalId=${encodeURIComponent(verticalID)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (attributeRead.status !== 200 || !attributeRead.body?.definitions?.some((item) => item.id === enumAttributeID && item.valueKind === "ENUM")) fail("typed Attribute definition readback failed", JSON.stringify(attributeRead));
const enumOption = await request(dshBase, "POST", `/dsh/catalog/attributes/${enumAttributeID}/enum-options`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `enum-option-${suffix}`), body: { optionValue: "Dark", active: true, ordinal: 1 } });
const enumOptionReplay = await request(dshBase, "POST", `/dsh/catalog/attributes/${enumAttributeID}/enum-options`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `enum-option-${suffix}`), body: { optionValue: "Dark", active: true, ordinal: 1 } });
const enumOptions = await request(dshBase, "GET", `/dsh/catalog/attributes/${enumAttributeID}/enum-options`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (enumOption.status !== 201 || enumOption.body?.option?.optionValue !== "Dark" || enumOptionReplay.status !== 200 || enumOptionReplay.body?.idempotentReplay !== true || enumOptions.status !== 200 || enumOptions.body?.options?.length !== 1) fail("ENUM option canonical write/readback failed", JSON.stringify({ enumOption, enumOptionReplay, enumOptions }));
const attributeRule = await request(dshBase, "PUT", `/dsh/catalog/categories/${childCategoryID}/attribute-rules/${enumAttributeID}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID }, body: { required: true, filterable: true, variantAxis: true } });
if (attributeRule.status !== 200 || !attributeRule.body?.rules?.some((item) => item.attributeId === enumAttributeID && item.required && item.variantAxis)) fail("required category Attribute rule failed", JSON.stringify(attributeRule));
console.log("DSH_TYPED_ATTRIBUTES=PASS");

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

const runtimeCoffeeName = `Runtime Coffee ${suffix}`;
const productInput = { canonicalName: runtimeCoffeeName, verticalId: verticalID, scope: "SHARED", variantTitle: "عبوة 250 غ", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [childCategoryID], identifierType: "GTIN", identifierValue: `628100${suffix.replaceAll("-", "").slice(-7)}`, imageUri: "https://example.com/runtime-coffee.jpg" };
const productKey = `product-${suffix}`;
const productCreate = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, productKey), body: productInput });
if (productCreate.status !== 201 || productCreate.body?.product?.version !== 1 || !productCreate.body?.product?.id) fail("catalog Product creation failed", JSON.stringify(productCreate));
const productID = String(productCreate.body.product.id); productIDs.add(productID);
const productRead = await request(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(runtimeCoffeeName)}&verticalId=${encodeURIComponent(verticalID)}&limit=50`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (productRead.status !== 200 || productRead.body?.products?.length !== 1 || productRead.body.products[0].variants?.length !== 1 || productRead.body.products[0].variants[0].identifiers?.[0]?.value !== productInput.identifierValue) fail("catalog Product/Variant canonical readback failed", JSON.stringify(productRead));
const variantID = String(productRead.body.products[0].variants[0].id);
const productMeasurement = await request(dshBase, "PUT", `/dsh/catalog/products/${productID}/attributes/${measurementAttributeID}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID }, body: { valueKind: "MEASUREMENT", decimalValue: "0.25", measurementUnit: "kg" } });
const productExpiry = await request(dshBase, "PUT", `/dsh/catalog/products/${productID}/attributes/${dateAttributeID}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID }, body: { valueKind: "DATE", dateValue: "2026-12-31" } });
const typedProductRead = await request(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(runtimeCoffeeName)}&verticalId=${encodeURIComponent(verticalID)}&limit=50`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (productMeasurement.status !== 200 || productExpiry.status !== 200 || !typedProductRead.body?.products?.[0]?.attributes?.some((item) => item.attributeId === measurementAttributeID && item.valueKind === "MEASUREMENT" && item.measurementUnit === "kg") || !typedProductRead.body?.products?.[0]?.attributes?.some((item) => item.attributeId === dateAttributeID && item.valueKind === "DATE" && item.dateValue === "2026-12-31")) fail("Product typed Attribute values were not read back canonically", JSON.stringify({ productMeasurement, productExpiry, typedProductRead }));
const secondVariantID = `variant-secondary-${suffix}`;
const secondVariantInput = { id: secondVariantID, title: "عبوة 500 غ", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true, identifierType: "SKU", identifierValue: `SKU-${suffix}` };
const secondVariant = await request(dshBase, "POST", `/dsh/catalog/products/${productID}/variants`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `variant-secondary-${suffix}`), body: secondVariantInput });
const secondVariantReplay = await request(dshBase, "POST", `/dsh/catalog/products/${productID}/variants`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `variant-secondary-${suffix}`), body: secondVariantInput });
const secondVariantUpdate = await request(dshBase, "PATCH", `/dsh/catalog/variants/${secondVariantID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `variant-secondary-update-${suffix}`, crypto.randomUUID(), 1), body: { title: "عبوة 500 غ محدثة", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true } });
const secondVariantStale = await request(dshBase, "PATCH", `/dsh/catalog/variants/${secondVariantID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `variant-secondary-stale-${suffix}`, crypto.randomUUID(), 1), body: { title: "نسخة متقادمة", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true } });
const duplicateVariant = await request(dshBase, "POST", `/dsh/catalog/products/${productID}/variants`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `variant-duplicate-${suffix}`), body: { id: `variant-duplicate-${suffix}`, title: "معرّف مكرر", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true, identifierType: "GTIN", identifierValue: productInput.identifierValue } });
if (secondVariant.status !== 201 || secondVariant.body?.variant?.id !== secondVariantID || secondVariantReplay.status !== 200 || secondVariantReplay.body?.idempotentReplay !== true || secondVariantUpdate.status !== 200 || secondVariantUpdate.body?.variant?.version !== 2 || secondVariantStale.status !== 409 || duplicateVariant.status !== 409 || duplicateVariant.body?.error?.code !== "DUPLICATE_IDENTIFIER") fail("Variant lifecycle, version, or identifier guard failed", JSON.stringify({ secondVariant, secondVariantReplay, secondVariantUpdate, secondVariantStale, duplicateVariant }));
const storeProductInput = { verticalId: verticalID, scope: "STORE_SCOPED", storeId: first.storeID, canonicalName: `Store Only ${suffix}`, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [childCategoryID], identifierType: "SKU", identifierValue: `STORE-${suffix}`, imageUri: "https://example.com/store-only.jpg" };
const storeProduct = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/products`, { token: first.accessToken, headers: partnerHeaders(`store-product-${suffix}`), body: storeProductInput });
if (storeProduct.status !== 201 || storeProduct.body?.product?.scope !== "STORE_SCOPED" || storeProduct.body.product.storeId !== first.storeID) fail("Store-scoped Product creation did not preserve owner scope", JSON.stringify(storeProduct));
const storeProductID = String(storeProduct.body.product.id); productIDs.add(storeProductID);
const crossStoreProduct = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/products`, { token: second.accessToken, headers: partnerHeaders(`cross-store-product-${suffix}`), body: storeProductInput });
const storeVariantID = `store-variant-${suffix}`;
const storeVariant = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/products/${storeProductID}/variants`, { token: first.accessToken, headers: partnerHeaders(`store-variant-${suffix}`), body: { id: storeVariantID, title: "عبوة المتجر", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true, identifierType: "SKU", identifierValue: `STORE-VARIANT-${suffix}` } });
const storeProductUpdate = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/products/${storeProductID}`, { token: first.accessToken, headers: partnerHeaders(`store-product-update-${suffix}`, 1), body: { verticalId: verticalID, scope: "STORE_SCOPED", canonicalName: `Store Only Updated ${suffix}`, active: true } });
const storeProductStale = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/products/${storeProductID}`, { token: first.accessToken, headers: partnerHeaders(`store-product-stale-${suffix}`, 1), body: { verticalId: verticalID, scope: "STORE_SCOPED", canonicalName: `Store Only Stale ${suffix}`, active: true } });
const storeVariantUpdate = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/variants/${storeVariantID}`, { token: first.accessToken, headers: partnerHeaders(`store-variant-update-${suffix}`, 1), body: { title: "عبوة المتجر محدثة", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true } });
if (crossStoreProduct.status !== 403 || storeVariant.status !== 201 || storeVariant.body?.variant?.productId !== storeProductID || storeProductUpdate.status !== 200 || storeProductUpdate.body?.product?.version !== 2 || storeProductStale.status !== 409 || storeVariantUpdate.status !== 200 || storeVariantUpdate.body?.variant?.version !== 2) fail("Store-scoped Product/Variant ownership or version boundary failed", JSON.stringify({ crossStoreProduct, storeVariant, storeProductUpdate, storeProductStale, storeVariantUpdate }));
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
const offerCreate = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: first.accessToken, headers: partnerHeaders(offerKey), body: discreteCreateOffer(variantID, 1250) });
if (offerCreate.status !== 201 || offerCreate.body?.offer?.publicationState !== "draft" || offerCreate.body?.offer?.variantId !== variantID) fail("StoreOffer creation failed", JSON.stringify(offerCreate));
const offerAID = String(offerCreate.body.offer.offerId); offerIDs.add(offerAID);
const missingRequiredAttributePublish = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`offer-missing-attribute-${suffix}`, 1), body: discreteOffer(1250, "published") });
const invalidEnumValue = await request(dshBase, "PUT", `/dsh/catalog/variants/${variantID}/attributes/${enumAttributeID}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID }, body: { valueKind: "ENUM", enumValue: "Light" } });
const validEnumValue = await request(dshBase, "PUT", `/dsh/catalog/variants/${variantID}/attributes/${enumAttributeID}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID }, body: { valueKind: "ENUM", enumValue: "Dark" } });
const variantAttributeRead = await request(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(runtimeCoffeeName)}&verticalId=${encodeURIComponent(verticalID)}&limit=50`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (missingRequiredAttributePublish.status !== 409 || missingRequiredAttributePublish.body?.error?.code !== "PRODUCT_NOT_ELIGIBLE" || invalidEnumValue.status !== 404 || validEnumValue.status !== 200 || !variantAttributeRead.body?.products?.[0]?.variants?.some((variant) => variant.id === variantID && variant.attributes?.some((item) => item.attributeId === enumAttributeID && item.enumValue === "Dark"))) fail("required/typed Variant Attribute enforcement failed", JSON.stringify({ missingRequiredAttributePublish, invalidEnumValue, validEnumValue, variantAttributeRead }));
const offerReplay = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: first.accessToken, headers: partnerHeaders(offerKey), body: discreteCreateOffer(variantID, 1250) });
if (offerReplay.status !== 200 || offerReplay.body?.idempotentReplay !== true) fail("StoreOffer replay failed", JSON.stringify(offerReplay));
const offerConflict = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: first.accessToken, headers: partnerHeaders(offerKey), body: discreteCreateOffer(variantID, 1300) });
if (offerConflict.status !== 409 || offerConflict.body?.error?.code !== "IDEMPOTENCY_CONFLICT") fail("divergent StoreOffer retry was accepted", JSON.stringify(offerConflict));
const wrongOwnerRead = await request(dshBase, "GET", `/dsh/stores/${first.storeID}/offers`, { token: second.accessToken });
const wrongOwnerWrite = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: second.accessToken, headers: partnerHeaders(`cross-owner-${suffix}`), body: discreteCreateOffer(variantID, 999) });
if (wrongOwnerRead.status !== 403 || wrongOwnerWrite.status !== 403) fail("cross-partner StoreOffer ownership boundary failed", JSON.stringify({ wrongOwnerRead, wrongOwnerWrite }));
const staleOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`offer-stale-${suffix}`, 9), body: discreteOffer(1250, "published") });
if (staleOffer.status !== 409 || staleOffer.body?.error?.code !== "VERSION_CONFLICT") fail("stale StoreOffer update was accepted", JSON.stringify(staleOffer));
const publishedOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`offer-publish-${suffix}`, 1), body: discreteOffer(1250, "published") });
if (publishedOffer.status !== 200 || publishedOffer.body?.offer?.publicationState !== "published" || publishedOffer.body.offer.version !== 2) fail("StoreOffer publication failed", JSON.stringify(publishedOffer));
const offerB = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/offers`, { token: second.accessToken, headers: partnerHeaders(`offer-b-${suffix}`), body: discreteCreateOffer(variantID, 1500) });
if (offerB.status !== 201) fail("second StoreOffer creation failed", JSON.stringify(offerB));
const offerBID = String(offerB.body.offer.offerId); offerIDs.add(offerBID);
const publishedOfferB = await request(dshBase, "PATCH", `/dsh/stores/${second.storeID}/offers/${offerBID}`, { token: second.accessToken, headers: partnerHeaders(`offer-b-publish-${suffix}`, 1), body: discreteOffer(1500, "published") });
if (publishedOfferB.status !== 200) fail("second StoreOffer publication failed", JSON.stringify(publishedOfferB));
const sectionCreate = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/sections`, { token: first.accessToken, headers: partnerHeaders(`section-${suffix}`), body: { nameAr: `العروض ${suffix}`, nameEn: `Offers ${suffix}`, ordinal: 0, active: true } });
if (sectionCreate.status !== 201 || !sectionCreate.body?.section?.id) fail("Storefront section creation failed", JSON.stringify(sectionCreate));
const sectionID = String(sectionCreate.body.section.id); sectionIDs.add(sectionID);
const sectionAttach = await request(dshBase, "PUT", `/dsh/stores/${first.storeID}/sections/${sectionID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`section-attach-${suffix}`), body: { ordinal: 0 } });
if (sectionAttach.status !== 200 || !sectionAttach.body?.section?.offerIds?.includes(offerAID)) fail("Storefront section offer attachment failed", JSON.stringify(sectionAttach));
const proposalID = `proposal-${suffix}`;
const proposalBody = { id: proposalID, verticalId: verticalID, categoryId: childCategoryID, proposedName: `Runtime Proposal ${suffix}`, proposedBrand: "Samrim", proposedVariantTitle: "الافتراضي", proposedMeasurementKind: "DISCRETE", proposedBaseUnit: "COUNT", proposedIdentifierType: "SKU", proposedIdentifierValue: `PROPOSAL-${suffix}`, proposedImageUri: "https://example.com/proposal.jpg" };
const proposalCreate = await request(dshBase, "POST", "/dsh/catalog/product-proposals", { token: first.accessToken, headers: partnerHeaders(`proposal-create-${suffix}`), body: proposalBody });
if (proposalCreate.status !== 201 || proposalCreate.body?.proposal?.state !== "draft" || proposalCreate.body.proposal.version !== 1) fail("Product proposal creation failed", JSON.stringify(proposalCreate));
proposalIDs.add(proposalID);
const proposalOwnList = await request(dshBase, "GET", "/dsh/catalog/product-proposals?limit=10", { token: first.accessToken });
const proposalSubmit = await request(dshBase, "POST", `/dsh/catalog/product-proposals/${proposalID}/submit`, { token: first.accessToken, headers: partnerHeaders(`proposal-submit-${suffix}`, 1) });
const proposalCorrection = await request(dshBase, "POST", `/dsh/catalog/product-proposals/${proposalID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `proposal-correction-${suffix}`, crypto.randomUUID(), 2), body: { state: "needs_correction", reason: "صحح البيانات" } });
const proposalUpdateBody = { verticalId: proposalBody.verticalId, categoryId: proposalBody.categoryId, proposedName: `Runtime Proposal Corrected ${suffix}`, proposedBrand: proposalBody.proposedBrand, proposedVariantTitle: proposalBody.proposedVariantTitle, proposedMeasurementKind: proposalBody.proposedMeasurementKind, proposedBaseUnit: proposalBody.proposedBaseUnit, proposedIdentifierType: proposalBody.proposedIdentifierType, proposedIdentifierValue: proposalBody.proposedIdentifierValue, proposedImageUri: proposalBody.proposedImageUri };
const proposalUpdate = await request(dshBase, "PATCH", `/dsh/catalog/product-proposals/${proposalID}`, { token: first.accessToken, headers: partnerHeaders(`proposal-update-${suffix}`, 3), body: proposalUpdateBody });
const proposalResubmit = await request(dshBase, "POST", `/dsh/catalog/product-proposals/${proposalID}/submit`, { token: first.accessToken, headers: partnerHeaders(`proposal-resubmit-${suffix}`, 4) });
const proposalApprove = await request(dshBase, "POST", `/dsh/catalog/product-proposals/${proposalID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `proposal-approve-${suffix}`, crypto.randomUUID(), 5), body: { state: "approved", reason: "" } });
const proposalProductID = `proposal_product_${proposalID}`;
productIDs.add(proposalProductID);
const proposalProductRead = await request(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(proposalUpdateBody.proposedName)}&verticalId=${encodeURIComponent(verticalID)}&limit=10`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const proposalReviewQueue = await request(dshBase, "GET", "/dsh/catalog/product-proposals/review-queue?state=approved&limit=10", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (proposalOwnList.status !== 200 || !proposalOwnList.body?.proposals?.some((item) => item.id === proposalID) || proposalSubmit.status !== 200 || proposalSubmit.body?.proposal?.state !== "submitted" || proposalCorrection.status !== 200 || proposalCorrection.body?.proposal?.state !== "needs_correction" || proposalUpdate.status !== 200 || proposalUpdate.body?.proposal?.state !== "draft" || proposalUpdate.body.proposal.version !== 4 || proposalResubmit.status !== 200 || proposalResubmit.body?.proposal?.state !== "submitted" || proposalApprove.status !== 200 || proposalApprove.body?.proposal?.state !== "approved" || proposalApprove.body.proposal.version !== 6 || proposalProductRead.status !== 200 || !proposalProductRead.body?.products?.some((item) => item.id === proposalProductID && item.canonicalName === proposalUpdateBody.proposedName) || proposalReviewQueue.status !== 200 || !proposalReviewQueue.body?.proposals?.some((item) => item.id === proposalID && item.state === "approved")) fail("Product proposal lifecycle and canonical adoption failed", JSON.stringify({ proposalOwnList, proposalSubmit, proposalCorrection, proposalUpdate, proposalResubmit, proposalApprove, proposalProductRead, proposalReviewQueue }));
const importRunID = `import-${suffix}`;
const importedName = `Runtime Imported ${suffix}`;
const importSourceSha256 = crypto.createHash("sha256").update(importRunID).digest("hex");
const importRows = [
  { rowNumber: 1, stableKey: `import-ready-${suffix}`, verticalId: verticalID, scope: "SHARED", canonicalName: importedName, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [childCategoryID], identifierType: "SKU", identifierValue: `IMPORTED-${suffix}` },
  { rowNumber: 2, stableKey: `import-conflict-${suffix}`, verticalId: verticalID, scope: "SHARED", canonicalName: `Conflicting ${suffix}`, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [childCategoryID], identifierType: "GTIN", identifierValue: productInput.identifierValue },
  { rowNumber: 3, stableKey: `import-ready-${suffix}`, verticalId: verticalID, scope: "SHARED", canonicalName: `Duplicate ${suffix}`, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [childCategoryID], identifierType: "SKU", identifierValue: `IMPORTED-DUP-${suffix}` },
];
const importPreview = await request(dshBase, "POST", "/dsh/catalog/imports/preview", { token: dshToken, headers: serviceHeaders(actingOperatorID, `import-preview-${suffix}`), body: { runId: importRunID, sourceSha256: importSourceSha256, rows: importRows } });
importRunIDs.add(importRunID);
const importPreviewReplay = await request(dshBase, "POST", "/dsh/catalog/imports/preview", { token: dshToken, headers: serviceHeaders(actingOperatorID, `import-preview-${suffix}`), body: { runId: importRunID, sourceSha256: importSourceSha256, rows: importRows } });
const importedBeforeCommit = await request(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(importedName)}&verticalId=${encodeURIComponent(verticalID)}&limit=10`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const importCommitKey = `import-commit-${suffix}`;
const importCommit = await request(dshBase, "POST", `/dsh/catalog/imports/${importRunID}/commit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, importCommitKey), body: undefined });
const importedProductID = String(importCommit.body?.items?.find((item) => item.rowNumber === 1)?.productId || "");
if (importedProductID) productIDs.add(importedProductID);
const importedProductRead = await request(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(importedName)}&verticalId=${encodeURIComponent(verticalID)}&limit=10`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const importRunRead = await request(dshBase, "GET", `/dsh/catalog/imports/${importRunID}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const importCommitReplay = await request(dshBase, "POST", `/dsh/catalog/imports/${importRunID}/commit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, importCommitKey), body: undefined });
if (importPreview.status !== 201 || importPreview.body?.run?.state !== "previewed" || importPreview.body?.items?.find((item) => item.rowNumber === 2)?.classification !== "CONFLICT_EXISTING" || importPreview.body?.items?.find((item) => item.rowNumber === 3)?.classification !== "DUPLICATE_INPUT" || importPreviewReplay.status !== 200 || importPreviewReplay.body?.idempotentReplay !== true || importedBeforeCommit.status !== 200 || importedBeforeCommit.body?.products?.length !== 0 || importCommit.status !== 200 || importCommit.body?.run?.state !== "committed" || importCommit.body?.items?.find((item) => item.rowNumber === 1)?.classification !== "IMPORTED" || importedProductRead.status !== 200 || importedProductRead.body?.products?.length !== 1 || importRunRead.status !== 200 || importRunRead.body?.run?.state !== "committed" || importCommitReplay.status !== 200 || importCommitReplay.body?.idempotentReplay !== true) fail("catalog import preview/commit/readback/idempotency failed", JSON.stringify({ importPreview, importPreviewReplay, importedBeforeCommit, importCommit, importedProductRead, importRunRead, importCommitReplay }));
const retryCategoryID = `import-retry-category-${suffix}`;
categoryIDs.add(retryCategoryID);
const retryRunID = `import-retry-${suffix}`;
importRunIDs.add(retryRunID);
const retrySourceSha256 = crypto.createHash("sha256").update(retryRunID).digest("hex");
const retryRow = { rowNumber: 1, stableKey: `import-retry-row-${suffix}`, verticalId: verticalID, scope: "SHARED", canonicalName: `Runtime Retry ${suffix}`, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [retryCategoryID], identifierType: "SKU", identifierValue: `RETRY-${suffix}` };
const retryPreview = await request(dshBase, "POST", "/dsh/catalog/imports/preview", { token: dshToken, headers: serviceHeaders(actingOperatorID, `import-retry-preview-${suffix}`), body: { runId: retryRunID, sourceSha256: retrySourceSha256, rows: [retryRow] } });
const retryCommitFailed = await request(dshBase, "POST", `/dsh/catalog/imports/${retryRunID}/commit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `import-retry-commit-${suffix}`), body: undefined });
const retryCategoryCreate = await request(dshBase, "POST", "/dsh/catalog/categories", { token: dshToken, headers: serviceHeaders(actingOperatorID, `import-retry-category-${suffix}`), body: { id: retryCategoryID, verticalId: verticalID, nameAr: `استرداد ${suffix}`, nameEn: `Recovery ${suffix}`, active: true } });
const retryCommitRecovered = await request(dshBase, "POST", `/dsh/catalog/imports/${retryRunID}/commit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `import-retry-commit-${suffix}`), body: undefined });
const retryItem = retryCommitRecovered.body?.items?.find((item) => item.rowNumber === 1);
if (retryItem?.productId) productIDs.add(String(retryItem.productId));
if (retryPreview.status !== 201 || retryCommitFailed.status !== 200 || retryCommitFailed.body?.run?.state !== "rejected" || retryCommitFailed.body?.items?.[0]?.classification !== "FAILED" || retryCategoryCreate.status !== 201 || retryCommitRecovered.status !== 200 || retryCommitRecovered.body?.run?.state !== "committed" || retryItem?.classification !== "IMPORTED") fail("catalog import rejected-run recovery retry failed", JSON.stringify({ retryPreview, retryCommitFailed, retryCategoryCreate, retryCommitRecovered }));
console.log("DSH_CATALOG_IMPORT=PASS");
console.log("DSH_STORE_OFFER=PASS");
console.log("DSH_PROPOSAL_LIFECYCLE=PASS");

const publishA = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-a-publish-${suffix}`, crypto.randomUUID(), 1), body: { state: "published" } });
const publishB = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-b-publish-${suffix}`, crypto.randomUUID(), 1), body: { state: "published" } });
if (publishA.status !== 200 || publishB.status !== 200) fail("Store publication failed after catalog readiness", JSON.stringify({ publishA, publishB }));
const publicCatalog = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}&categoryId=${encodeURIComponent(childCategoryID)}&q=${encodeURIComponent(productInput.canonicalName)}`);
const publicWrongCategory = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}&categoryId=${encodeURIComponent(categoryID)}`);
const publicWrongCity = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityB)}`);
if (publicCatalog.status !== 200 || publicCatalog.body?.offers?.length !== 1 || publicCatalog.body.offers[0].offerId !== offerAID || publicCatalog.body.offers[0].productName !== productInput.canonicalName || !publicCatalog.body.sections?.some((section) => section.id === sectionID && section.offerIds?.includes(offerAID)) || publicWrongCategory.status !== 200 || publicWrongCategory.body?.offers?.length !== 0 || publicWrongCity.status !== 404) fail("customer-visible catalog evaluator or city/category scope failed", JSON.stringify({ publicCatalog, publicWrongCategory, publicWrongCity }));
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
const disabledOfferPublish = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`disabled-offer-${suffix}`, 2), body: discreteOffer(1250, "published") });
if (disabledOfferPublish.status !== 409 || disabledOfferPublish.body?.error?.code !== "PRODUCT_NOT_ELIGIBLE") fail("disabled Product could be published", JSON.stringify(disabledOfferPublish));
const enabled = await request(dshBase, "PATCH", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `enable-${suffix}`, crypto.randomUUID(), 3), body: renameBody });
if (enabled.status !== 200 || enabled.body?.product?.active !== true || enabled.body.product.version !== 4) fail("catalog Product re-enable failed", JSON.stringify(enabled));
const changedPrice = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`price-${suffix}`, 2), body: discreteOffer(1800, "published") });
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
const modifierGroupCreate = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/modifier-groups`, { token: first.accessToken, headers: partnerHeaders(`modifier-group-${suffix}`), body: { nameAr: `إضافات ${suffix}`, required: true, minSelections: 1, maxSelections: 1, active: true } });
if (modifierGroupCreate.status !== 201 || !modifierGroupCreate.body?.group?.id) fail("modifier group creation failed", JSON.stringify(modifierGroupCreate));
const modifierGroupID = String(modifierGroupCreate.body.group.id); modifierGroupIDs.add(modifierGroupID);
const modifierOptionCreate = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/modifier-groups/${modifierGroupID}/options`, { token: first.accessToken, headers: partnerHeaders(`modifier-option-${suffix}`), body: { nameAr: `حليب ${suffix}`, priceDeltaMinor: 300, availability: true, ordinal: 0 } });
if (modifierOptionCreate.status !== 201 || !modifierOptionCreate.body?.option?.id) fail("modifier option creation failed", JSON.stringify(modifierOptionCreate));
const modifierOptionID = String(modifierOptionCreate.body.option.id);
const modifierAttach = await request(dshBase, "PUT", `/dsh/stores/${first.storeID}/offers/${offerAID}/modifier-groups/${modifierGroupID}`, { token: first.accessToken, headers: partnerHeaders(`modifier-attach-${suffix}`), body: { ordinal: 0 } });
const modifierOfferRead = await request(dshBase, "GET", `/dsh/stores/${first.storeID}/offers`, { token: first.accessToken });
if (modifierAttach.status !== 200 || !modifierOfferRead.body?.offers?.some((offer) => offer.offerId === offerAID && offer.modifierGroups?.some((group) => group.id === modifierGroupID && group.options?.some((option) => option.id === modifierOptionID)))) fail("modifier offer attachment/readback failed", JSON.stringify({ modifierAttach, modifierOfferRead }));
const missingModifierCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`checkout-missing-modifier-${suffix}`, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID } });
const cartWithModifier = await request(dshBase, "PATCH", `/dsh/cart/lines/${encodeURIComponent(cartLineID)}`, { token: client.accessToken, headers: partnerHeaders(`cart-modifier-${suffix}`, 2), body: { quantityBaseUnits: 2, selectedModifierOptionIds: [modifierOptionID] } });
if (missingModifierCheckout.status !== 400 || missingModifierCheckout.body?.error?.code !== "INVALID_INPUT" || cartWithModifier.status !== 201 || cartWithModifier.body?.cart?.version !== 3 || !cartWithModifier.body.cart.lines[0]?.selectedModifierOptionIds?.includes(modifierOptionID)) fail("required modifier selection enforcement failed", JSON.stringify({ missingModifierCheckout, cartWithModifier }));
const cartUnserviceable = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`checkout-unserviceable-${suffix}`, 3), body: { cartId: cartID, storeId: first.storeID, addressId: addressBID } });
if (cartUnserviceable.status !== 409 || cartUnserviceable.body?.error?.code !== "UNSERVICEABLE") fail("cart checkout accepted an out-of-city address", JSON.stringify(cartUnserviceable));
const hiddenCartOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`cart-offer-hide-${suffix}`, 3), body: discreteOffer(1800, "hidden") });
if (hiddenCartOffer.status !== 200 || hiddenCartOffer.body?.offer?.publicationState !== "hidden" || hiddenCartOffer.body.offer.version !== 4) fail("cart offer failure fixture was not applied canonically", JSON.stringify(hiddenCartOffer));
const unavailableCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`checkout-offer-unavailable-${suffix}`, 3), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID } });
if (unavailableCheckout.status !== 409 || unavailableCheckout.body?.error?.code !== "UNSERVICEABLE") fail("checkout did not fail closed when the StoreOffer was hidden", JSON.stringify(unavailableCheckout));
const restoredCartOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`cart-offer-restore-${suffix}`, 4), body: discreteOffer(1800, "published") });
if (restoredCartOffer.status !== 200 || restoredCartOffer.body?.offer?.publicationState !== "published" || restoredCartOffer.body.offer.version !== 5) fail("cart offer recovery failed", JSON.stringify(restoredCartOffer));
const checkoutKey = `checkout-${suffix}`;
const checkout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(checkoutKey, 3), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID } });
if (checkout.status !== 201 || checkout.body?.order?.state !== "CREATED" || checkout.body.order.version !== 1 || checkout.body.order.totalAmountMinor !== 4200 || checkout.body.order.lines?.[0]?.requestedQuantityBaseUnits !== 2 || checkout.body.order.lines?.[0]?.unitPriceMinor !== 1800 || checkout.body.order.lines?.[0]?.modifierAmountMinor !== 600) fail("cart checkout did not create an immutable Order snapshot", JSON.stringify(checkout));
const checkoutLineID = String(checkout.body.order.lines?.[0]?.id || "");
const orderID = String(checkout.body.order.id); orderIDs.add(orderID);
expectSQL(`SELECT count(*) FROM dsh.commerce_order_line_modifier_snapshots WHERE order_line_id='${sqlLiteral(checkoutLineID)}' AND option_id='${sqlLiteral(modifierOptionID)}' AND option_name_ar='حليب ${sqlLiteral(suffix)}'`, "1", "Order modifier snapshot readback is not immutable canonical evidence");
expectSQL(`SELECT count(*) FROM dsh.commerce_order_line_attribute_snapshots WHERE order_line_id='${sqlLiteral(checkoutLineID)}'`, "3", "Order typed Attribute snapshot readback is incomplete");
const checkoutReplay = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(checkoutKey, 3), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID } });
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
if (invalidTransition.status !== 409 || finalOrder.status !== 200 || finalOrder.body?.order?.state !== "READY_FOR_DISPATCH" || finalOrder.body.order.version !== 4 || finalOrder.body.order.lines?.[0]?.lineAmountMinor !== 4200) fail("Order final readback or invalid transition guard failed", JSON.stringify({ invalidTransition, finalOrder }));
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
