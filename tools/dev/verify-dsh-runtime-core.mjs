import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { captureMailpitMessageIds, readMailpitCode } from "./mailpit-challenge.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const envArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envPath = envArg ? path.resolve(root, envArg.slice("--env-file=".length)) : path.resolve(root, "infra/local/.env");

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
const dshMigrationDirectory = path.resolve(root, "services/dsh/database/migrations");
const dshMigrationNames = fs.readdirSync(dshMigrationDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^\d{3}_.+\.sql$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
if (dshMigrationNames.length === 0) fail("canonical DSH migration set is empty");
for (const [index, name] of dshMigrationNames.entries()) {
  if (Number(name.slice(0, 3)) !== index + 1) fail("canonical DSH migration sequence is not contiguous", name);
}

const env = readEnv(envPath);
const dshBase = required(env, "DSH_API_BASE_URL").replace(/\/+$/, "");
const identityBase = required(env, "IDENTITY_API_BASE_URL").replace(/\/+$/, "");
const dshToken = required(env, "CONTROL_PANEL_SERVICE_TOKEN");
const identityDshToken = required(env, "IDENTITY_DSH_SERVICE_TOKEN");
const bootstrapToken = required(env, "OPERATOR_BOOTSTRAP_SECRET");
const mailpitPort = required(env, "SAMRIM_MAILPIT_WEB_PORT");
const wltBase = `http://127.0.0.1:${required(env, "SAMRIM_WLT_PORT")}`;
const wltToken = required(env, "WLT_DSH_SERVICE_TOKEN");
if (dshToken.length < 24 || identityDshToken.length < 24 || bootstrapToken.length < 24) fail("canonical internal secrets are too weak");
const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", path.join(root, "infra/local/compose/compose.yaml")];
const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
const citySuffix = String(Date.now());
const caseIDs = new Set(), storeIDs = new Set(), actorIDs = new Set(), challengeIDs = new Set(), productIDs = new Set(), categoryIDs = new Set(), cityIDs = new Set(), addressIDs = new Set(), offerIDs = new Set(), cartIDs = new Set(), orderIDs = new Set(), paymentIntentIDs = new Set(), deliveryFeePolicyIDs = new Set(), fieldCommissionPolicyIDs = new Set(), proposalIDs = new Set(), importRunIDs = new Set(), modifierGroupIDs = new Set(), sectionIDs = new Set(), attributeIDs = new Set(), captainAdmissionIDs = new Set(), captainOfferIDs = new Set(), captainAssignmentIDs = new Set(), captainFundingIDs = new Set(), fieldAdmissionIDs = new Set(), destinationIDs = new Set(), payoutIDs = new Set(), settlementBatchIDs = new Set(), promotionIDs = new Set(), contentIDs = new Set(), multiStoreCheckoutIDs = new Set(), partnerCommissionRemittanceIDs = new Set();
let cityA = "";
let cityB = "";
let verticalID = "";
let storeLocalVerticalID = "";
let categoryID = "";
let childCategoryID = "";
const enumAttributeID = `roast-${suffix}`;
const measurementAttributeID = `net-weight-${suffix}`;
const dateAttributeID = `expiry-${suffix}`;
const clientPhone = `+96778${crypto.randomInt(1_000_000, 9_999_999)}`;

function compose(...args) { return execFileSync("docker", [...composeArgs, ...args], { cwd: root, encoding: "utf8" }); }
function sqlLiteral(value) { return String(value).replaceAll("'", "''"); }
// SQL is limited to schema/readback assertions, bounded cleanup of IDs captured
  // by this run, and the bounded database-time fault injections below. Business fixtures
// are created through canonical HTTP owners; this is not a SQL setup path.
const postgresContainerID = compose("ps", "-aq", "postgres").trim();
function sql(query) {
  try {
    if (!postgresContainerID) fail("postgres container is not present");
    return execFileSync("docker", ["exec", postgresContainerID, "psql", "-U", required(env, "SAMRIM_POSTGRES_USER"), "-d", required(env, "SAMRIM_POSTGRES_DB"), "-Atc", query], { cwd: root, encoding: "utf8" }).trim();
  }
  catch (error) { fail("database proof failed", String(error?.stderr || error?.message || error)); }
}
function expectSQL(query, expected, message) { const observed = sql(query); if (observed !== expected) fail(message, `expected=${expected} observed=${observed}`); }

function cleanup() {
  // Disposable cleanup is intentionally ID-scoped to this verifier's fresh state;
  // it must never delete the reusable local baseline or synthetic world locators.
  for (const challengeID of challengeIDs) {
    sql(`DELETE FROM identity_challenges WHERE id='${sqlLiteral(challengeID)}'`);
  }
  for (const importRunID of importRunIDs) {
    const value = sqlLiteral(importRunID);
    sql(`DELETE FROM dsh.catalog_import_audit WHERE run_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_import_mutation_idempotency WHERE run_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_import_run_items WHERE run_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_import_runs WHERE id='${value}'`);
  }
  for (const assignmentID of captainAssignmentIDs) {
    const value = sqlLiteral(assignmentID);
    sql(`DELETE FROM dsh.captain_location_audit WHERE assignment_id='${value}'`);
    sql(`DELETE FROM dsh.captain_location_mutation_idempotency WHERE assignment_id='${value}'`);
    sql(`DELETE FROM dsh.captain_location_snapshots WHERE assignment_id='${value}'`);
    sql(`DELETE FROM dsh.captain_audit WHERE assignment_id='${value}'`);
    sql(`DELETE FROM dsh.captain_operation_idempotency WHERE assignment_id='${value}'`);
    sql(`DELETE FROM dsh.captain_handoffs WHERE assignment_id='${value}'`);
    sql(`DELETE FROM dsh.captain_assignments WHERE id='${value}'`);
  }
  for (const offerID of captainOfferIDs) {
    const value = sqlLiteral(offerID);
    sql(`DELETE FROM dsh.captain_audit WHERE offer_id='${value}'`);
    sql(`DELETE FROM dsh.captain_operation_idempotency WHERE offer_id='${value}'`);
    sql(`DELETE FROM dsh.captain_dispatch_offers WHERE id='${value}'`);
  }
  for (const admissionID of captainAdmissionIDs) {
    const value = sqlLiteral(admissionID);
    sql(`DELETE FROM dsh.captain_admission_audit WHERE admission_id='${value}'`);
    sql(`DELETE FROM dsh.captain_admission_idempotency WHERE admission_id='${value}'`);
    sql(`DELETE FROM dsh.captain_operation_idempotency WHERE admission_id='${value}'`);
    sql(`DELETE FROM dsh.captain_admissions WHERE id='${value}'`);
  }
  for (const admissionID of fieldAdmissionIDs) {
    const value = sqlLiteral(admissionID);
    sql(`DELETE FROM dsh.field_admission_audit WHERE admission_id='${value}'`);
    sql(`DELETE FROM dsh.field_admission_idempotency WHERE admission_id='${value}'`);
    sql(`DELETE FROM dsh.field_admissions WHERE id='${value}'`);
  }
  for (const checkoutID of multiStoreCheckoutIDs) {
    const value = sqlLiteral(checkoutID);
    sql(`DELETE FROM dsh.commerce_multi_store_checkout_idempotency WHERE checkout_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_multi_store_checkout_children WHERE checkout_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_multi_store_checkouts WHERE id='${value}'`);
  }
  for (const orderID of orderIDs) {
    const value = sqlLiteral(orderID);
    sql(`DELETE FROM wlt.captain_cod_reservation_events WHERE reservation_id IN (SELECT id FROM wlt.captain_cod_reservations WHERE order_id='${value}')`);
    sql(`DELETE FROM wlt.captain_cod_reservations WHERE order_id='${value}'`);
    sql(`DELETE FROM wlt.ledger_entries WHERE transaction_id IN (SELECT ledger_transaction_id FROM wlt.partner_order_earnings WHERE order_id='${value}')`);
    sql(`DELETE FROM wlt.partner_order_earnings WHERE order_id='${value}'`);
    sql("DELETE FROM wlt.ledger_entries WHERE transaction_id IN (SELECT ledger_transaction_id FROM wlt.partner_store_cash_commissions WHERE order_id='" + value + "')");
    sql("DELETE FROM wlt.partner_store_cash_commissions WHERE order_id='" + value + "'");
    sql("DELETE FROM wlt.ledger_transactions WHERE source_type='PARTNER_STORE_CASH_COMMISSION' AND source_id='" + value + "'");
    sql(`DELETE FROM wlt.ledger_transactions WHERE source_type='ORDER_DELIVERED' AND source_id='${value}'`);
    sql(`DELETE FROM dsh.captain_location_audit WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.captain_location_mutation_idempotency WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.captain_location_snapshots WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.captain_audit WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.captain_operation_idempotency WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.captain_handoffs WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.captain_assignments WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.captain_dispatch_offers WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_rating_audit WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_ratings WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_financial_handoff_outbox WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_payment_audit WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_audit WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_transition_idempotency WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_checkout_idempotency WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_line_modifier_snapshots WHERE order_line_id IN (SELECT id FROM dsh.commerce_order_lines WHERE order_id='${value}')`);
    sql(`DELETE FROM dsh.commerce_order_line_attribute_snapshots WHERE order_line_id IN (SELECT id FROM dsh.commerce_order_lines WHERE order_id='${value}')`);
    sql(`DELETE FROM dsh.commerce_promotion_redemptions WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_order_lines WHERE order_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_orders WHERE id='${value}'`);
  }
  for (const remittanceID of partnerCommissionRemittanceIDs) {
    const value = sqlLiteral(remittanceID);
    sql("DELETE FROM wlt.ledger_entries WHERE transaction_id IN (SELECT ledger_transaction_id FROM wlt.partner_commission_remittances WHERE id='" + value + "')");
    sql("DELETE FROM wlt.partner_commission_remittances WHERE id='" + value + "'");
    sql("DELETE FROM wlt.ledger_transactions WHERE source_type='PARTNER_COMMISSION_REMITTANCE' AND source_id='" + value + "'");
  }
  for (const batchID of settlementBatchIDs) {
    const value = sqlLiteral(batchID);
    sql(`DELETE FROM wlt.payout_audit_events WHERE batch_id='${value}'`);
    sql(`DELETE FROM wlt.manual_transfer_executions WHERE batch_id='${value}'`);
    sql(`DELETE FROM wlt.settlement_batch_items WHERE batch_id='${value}'`);
    sql(`DELETE FROM wlt.settlement_batches WHERE id='${value}'`);
  }
  for (const payoutID of payoutIDs) {
    const value = sqlLiteral(payoutID);
    const ledgerTransactionID = sql(`SELECT COALESCE(ledger_transaction_id,'') FROM wlt.payout_requests WHERE id='${value}'`);
    sql(`DELETE FROM wlt.payout_audit_events WHERE payout_id='${value}'`);
    sql(`DELETE FROM wlt.manual_transfer_executions WHERE payout_id='${value}'`);
    sql(`DELETE FROM wlt.settlement_batch_items WHERE payout_id='${value}'`);
    sql(`DELETE FROM wlt.approved_payout_snapshots WHERE payout_id='${value}'`);
    if (ledgerTransactionID) {
      const ledgerValue = sqlLiteral(ledgerTransactionID);
      sql(`DELETE FROM wlt.ledger_entries WHERE transaction_id='${ledgerValue}'`);
    }
    sql(`DELETE FROM wlt.payout_holds WHERE payout_id='${value}'`);
    sql(`DELETE FROM wlt.payout_requests WHERE id='${value}'`);
    if (ledgerTransactionID) {
      sql(`DELETE FROM wlt.ledger_transactions WHERE id='${sqlLiteral(ledgerTransactionID)}'`);
    }
  }
  for (const destinationID of destinationIDs) {
    sql(`DELETE FROM wlt.official_wallet_destination_transitions WHERE destination_id='${sqlLiteral(destinationID)}'`);
    sql(`DELETE FROM wlt.official_wallet_destinations WHERE id='${sqlLiteral(destinationID)}'`);
  }
  for (const paymentIntentID of paymentIntentIDs) {
    const value = sqlLiteral(paymentIntentID);
    sql(`DELETE FROM wlt.cash_remittance_events WHERE payment_intent_id='${value}'`);
    sql(`DELETE FROM wlt.ledger_entries WHERE transaction_id IN (SELECT t.id FROM wlt.ledger_transactions t JOIN wlt.cash_remittances r ON t.source_type='CASH_REMITTANCE' AND t.source_id=r.id WHERE r.payment_intent_id='${value}')`);
    sql(`DELETE FROM wlt.ledger_transactions WHERE source_type='CASH_REMITTANCE' AND source_id IN (SELECT id FROM wlt.cash_remittances WHERE payment_intent_id='${value}')`);
    sql(`DELETE FROM wlt.cash_remittances WHERE payment_intent_id='${value}'`);
    sql(`DELETE FROM wlt.customer_payment_allocation_events WHERE payment_intent_id='${value}'`);
    sql(`DELETE FROM wlt.customer_payment_allocations WHERE payment_intent_id='${value}'`);
    sql(`DELETE FROM wlt.payment_intent_events WHERE intent_id='${value}'`);
    sql(`DELETE FROM wlt.payment_intents WHERE id='${value}'`);
  }
  for (const fundingID of captainFundingIDs) {
    const value = sqlLiteral(fundingID);
    sql(`DELETE FROM wlt.ledger_entries WHERE transaction_id=(SELECT ledger_transaction_id FROM wlt.captain_wallet_funding WHERE id='${value}')`);
    sql(`DELETE FROM wlt.captain_wallet_funding WHERE id='${value}'`);
    sql(`DELETE FROM wlt.ledger_transactions WHERE source_type='CAPTAIN_OPENING_FUNDING' AND source_id='${value}'`);
  }
  for (const policyID of deliveryFeePolicyIDs) {
    const value = sqlLiteral(policyID);
    sql(`DELETE FROM wlt.delivery_fee_policy_events WHERE policy_id='${value}'`);
    sql(`DELETE FROM wlt.delivery_fee_policies WHERE id='${value}'`);
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
    sql(`DELETE FROM dsh.catalog_media_assets WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_media_audit WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_media_mutation_idempotency WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_product_attribute_values WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_product_categories WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_media WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_variant_identifiers WHERE variant_id IN (SELECT id FROM dsh.catalog_product_variants WHERE product_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_product_variants WHERE product_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_products WHERE id='${value}'`);
  }
  for (const caseID of caseIDs) {
    const value = sqlLiteral(caseID);
    sql(`DELETE FROM dsh.joining_case_financial_profile_outbox WHERE case_id='${value}'`);
    sql(`DELETE FROM wlt.partner_store_commission_policy_events WHERE store_id IN (SELECT store_id FROM wlt.partner_store_commission_policies WHERE profile_id IN (SELECT id FROM wlt.partner_financial_profiles WHERE joining_case_id='${value}'))`);
    sql(`DELETE FROM wlt.partner_store_commission_policies WHERE profile_id IN (SELECT id FROM wlt.partner_financial_profiles WHERE joining_case_id='${value}')`);
    sql(`DELETE FROM wlt.partner_store_commission_policy_initializations WHERE profile_id IN (SELECT id FROM wlt.partner_financial_profiles WHERE joining_case_id='${value}')`);
    sql(`DELETE FROM wlt.partner_financial_profile_events WHERE profile_id IN (SELECT id FROM wlt.partner_financial_profiles WHERE joining_case_id='${value}')`);
    sql(`DELETE FROM wlt.partner_financial_profiles WHERE joining_case_id='${value}'`);
    sql(`DELETE FROM dsh.joining_case_audit WHERE case_id='${value}'`);
    sql(`DELETE FROM dsh.joining_case_mutation_idempotency WHERE case_id='${value}'`);
    sql(`DELETE FROM dsh.joining_cases WHERE id='${value}'`);
  }
  for (const contentID of contentIDs) {
    const value = sqlLiteral(contentID);
    sql(`DELETE FROM dsh.commerce_marketing_mutation_idempotency WHERE resource_id='${value}'`);
    sql(`DELETE FROM dsh.discovery_content WHERE id='${value}'`);
  }
  for (const promotionID of promotionIDs) {
    const value = sqlLiteral(promotionID);
    sql(`DELETE FROM dsh.commerce_promotion_redemptions WHERE promotion_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_marketing_mutation_idempotency WHERE resource_id='${value}'`);
    sql(`DELETE FROM dsh.commerce_promotions WHERE id='${value}'`);
  }
  for (const storeID of storeIDs) {
    const value = sqlLiteral(storeID);
    sql(`DELETE FROM wlt.ledger_entries WHERE transaction_id IN (SELECT ledger_transaction_id FROM wlt.field_commission_earnings WHERE store_id='${value}')`);
    sql(`DELETE FROM wlt.field_commission_earnings WHERE store_id='${value}'`);
    sql(`DELETE FROM wlt.ledger_transactions WHERE source_type='STORE_CLIENT_VISIBLE' AND source_id='${value}'`);
    sql(`DELETE FROM dsh.field_commission_publication_outbox WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.client_favorite_store_audit WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.client_favorite_store_mutation_idempotency WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.client_favorite_stores WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_storefront_section_offers WHERE section_id IN (SELECT id FROM dsh.catalog_storefront_sections WHERE store_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_storefront_sections WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offer_modifier_groups WHERE offer_id IN (SELECT id FROM dsh.catalog_store_offers WHERE store_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_modifier_options WHERE group_id IN (SELECT id FROM dsh.catalog_modifier_groups WHERE store_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_modifier_groups WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offer_audit WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_store_offer_mutation_idempotency WHERE offer_id IN (SELECT id FROM dsh.catalog_store_offers WHERE store_id='${value}')`);
    sql(`DELETE FROM dsh.catalog_store_offers WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.store_origin_audit WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.store_origin_mutation_idempotency WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.store_publication_audit WHERE store_id='${value}'`);
    sql(`DELETE FROM dsh.store_publication_idempotency WHERE store_id='${value}'`);
    sql("DELETE FROM dsh.store_fulfillment_modes_audit WHERE store_id='" + value + "'");
    sql("DELETE FROM dsh.store_fulfillment_modes_idempotency WHERE store_id='" + value + "'");
    sql(`DELETE FROM dsh.stores WHERE id='${value}'`);
  }
  for (const policyID of fieldCommissionPolicyIDs) {
    sql(`DELETE FROM wlt.field_commission_policies WHERE id='${sqlLiteral(policyID)}'`);
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
  if (storeLocalVerticalID) sql(`DELETE FROM dsh.catalog_registry_mutation_idempotency WHERE entity_id='${sqlLiteral(storeLocalVerticalID)}'`);
  for (const attributeID of attributeIDs) {
    const value = sqlLiteral(attributeID);
    sql(`DELETE FROM dsh.catalog_attribute_enum_options WHERE attribute_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_attribute_mutation_idempotency WHERE attribute_id='${value}'`);
    sql(`DELETE FROM dsh.catalog_attribute_definitions WHERE id='${value}'`);
  }
  if (storeLocalVerticalID) sql(`DELETE FROM dsh.commerce_verticals WHERE id='${sqlLiteral(storeLocalVerticalID)}'`);
  sql(`DELETE FROM dsh.commerce_verticals WHERE id='${sqlLiteral(verticalID)}'`);
  for (const actorID of actorIDs) {
    const value = sqlLiteral(actorID);
    sql(`DELETE FROM dsh.notification_read_state WHERE actor_id='${value}'`);
    sql(`DELETE FROM identity_actors WHERE id='${value}'`);
  }
}
process.on("exit", () => { try { cleanup(); } catch (error) { console.error(`DSH_RUNTIME_CLEANUP=FAIL ${error instanceof Error ? error.message : String(error)}`); } });

async function request(base, method, pathname, options = {}) {
  let response;
  try {
    const hasRawBody = options.rawBody !== undefined;
    const hasJsonBody = options.body !== undefined;
    response = await fetch(new URL(pathname, base), { method, headers: { Accept: "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(hasJsonBody && !hasRawBody ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }, ...(hasRawBody ? { body: options.rawBody } : hasJsonBody ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(options.timeoutMs ?? 8_000) });
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
function discreteOffer(priceMinor, publicationState, availability = true, inventoryPolicy = "QUANTITY_ON_HAND", inventoryOnHandBaseUnits = 10) { return { priceMinor, availability, publicationState, quantityPolicy: "DISCRETE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 1000, quantityStepBaseUnits: 1, pricingBasis: "PER_UNIT", pricingUnitBaseUnits: 1, inventoryPolicy, inventoryOnHandBaseUnits }; }
function discreteCreateOffer(variantId, priceMinor, inventoryPolicy = "AVAILABILITY_ONLY", inventoryOnHandBaseUnits = 0) { return { variantId, priceMinor, quantityPolicy: "DISCRETE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 1000, quantityStepBaseUnits: 1, pricingBasis: "PER_UNIT", pricingUnitBaseUnits: 1, inventoryPolicy, inventoryOnHandBaseUnits }; }
function variableCreateOffer(variantId, priceMinor) { return { variantId, priceMinor, quantityPolicy: "VARIABLE_MEASURE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 10000, quantityStepBaseUnits: 1, pricingBasis: "PER_MEASURE", pricingUnitBaseUnits: 1, inventoryPolicy: "AVAILABILITY_ONLY", inventoryOnHandBaseUnits: 0 }; }
function discreteStockOffer(priceMinor, publicationState, availability = true, inventoryOnHandBaseUnits = 10) { return discreteOffer(priceMinor, publicationState, availability, "QUANTITY_ON_HAND", inventoryOnHandBaseUnits); }
async function collectCursorPages(base, pathname, options, itemKey) {
  const items = [];
  const seenCursors = new Set();
  let cursor = "";
  for (;;) {
    const separator = pathname.includes("?") ? "&" : "?";
    const response = await request(base, "GET", `${pathname}${cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : ""}`, options);
    if (response.status !== 200) return response;
    items.push(...(Array.isArray(response.body?.[itemKey]) ? response.body[itemKey] : []));
    const nextCursor = response.body?.nextCursor ? String(response.body.nextCursor) : "";
    if (!nextCursor) return { ...response, body: { ...response.body, [itemKey]: items, nextCursor: "" } };
    if (seenCursors.has(nextCursor)) fail("catalog cursor pagination repeated", JSON.stringify({ pathname, nextCursor }));
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}
async function activatePartner(phone, password) {
  const previousMessageIds = await captureMailpitMessageIds({ port: mailpitPort, phone, purpose: "managed_activate" });
  const challenge = await request(identityBase, "POST", "/auth/managed/activation/request", { body: { phone, role: "partner" } });
  if (challenge.status !== 201 || typeof challenge.body?.challengeId !== "string") fail("Partner activation challenge failed", JSON.stringify(challenge));
  challengeIDs.add(String(challenge.body.challengeId));
  const verificationCode = await readMailpitCode({ port: mailpitPort, phone, purpose: "managed_activate", excludeMessageIds: previousMessageIds });
  const activation = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role: "partner", verificationCode, password, clientInstanceId: `dsh-runtime-${suffix}` } });
  if (activation.status !== 200 || typeof activation.body?.accessToken !== "string" || activation.body?.identity?.role !== "partner") fail("Partner activation failed", JSON.stringify(activation));
  return String(activation.body.accessToken);
}
async function activateCaptain(phone, password) {
  const previousMessageIds = await captureMailpitMessageIds({ port: mailpitPort, phone, purpose: "managed_activate" });
  const challenge = await request(identityBase, "POST", "/auth/managed/activation/request", { body: { phone, role: "captain" } });
  if (challenge.status !== 201 || typeof challenge.body?.challengeId !== "string") fail("Captain activation challenge failed", JSON.stringify(challenge));
  challengeIDs.add(String(challenge.body.challengeId));
  const verificationCode = await readMailpitCode({ port: mailpitPort, phone, purpose: "managed_activate", excludeMessageIds: previousMessageIds });
  const activation = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role: "captain", verificationCode, password, clientInstanceId: `dsh-captain-${suffix}` } });
  if (activation.status !== 200 || typeof activation.body?.accessToken !== "string" || activation.body?.identity?.role !== "captain" || activation.body?.identity?.surface !== "app-captain") fail("Captain activation failed", JSON.stringify(activation));
  return String(activation.body.accessToken);
}
async function activateField(phone, password) {
  const previousMessageIds = await captureMailpitMessageIds({ port: mailpitPort, phone, purpose: "managed_activate" });
  const challenge = await request(identityBase, "POST", "/auth/managed/activation/request", { body: { phone, role: "field" } });
  if (challenge.status !== 201 || typeof challenge.body?.challengeId !== "string") fail("Field activation challenge failed", JSON.stringify(challenge));
  challengeIDs.add(String(challenge.body.challengeId));
  const verificationCode = await readMailpitCode({ port: mailpitPort, phone, purpose: "managed_activate", excludeMessageIds: previousMessageIds });
  const activation = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role: "field", verificationCode, password, clientInstanceId: `dsh-field-${suffix}` } });
  if (activation.status !== 200 || typeof activation.body?.accessToken !== "string" || activation.body?.identity?.role !== "field" || activation.body?.identity?.surface !== "app-field") fail("Field activation failed", JSON.stringify(activation));
  return String(activation.body.accessToken);
}
async function createClientSession(phone) {
  const previousMessageIds = await captureMailpitMessageIds({ port: mailpitPort, phone, purpose: "client_register" });
  const challenge = await request(identityBase, "POST", "/auth/client/registration/request", { body: { phone } });
  if (challenge.status !== 201 || typeof challenge.body?.challengeId !== "string") fail("Client registration challenge failed", JSON.stringify(challenge));
  challengeIDs.add(String(challenge.body.challengeId));
  const code = await readMailpitCode({ port: mailpitPort, phone, purpose: "client_register", excludeMessageIds: previousMessageIds });
  const registration = await request(identityBase, "POST", "/auth/client/register", { body: { phone, code, password: `Clie${crypto.randomBytes(2).toString("hex")}`, clientInstanceId: `dsh-client-${suffix}` } });
  if (registration.status !== 201 || typeof registration.body?.accessToken !== "string" || registration.body?.identity?.role !== "client") fail("Client registration failed", JSON.stringify(registration));
  actorIDs.add(String(registration.body.identity.subject));
  return { accessToken: String(registration.body.accessToken), actorID: String(registration.body.identity.subject) };
}
async function waitForIdentityReady(timeoutMs = 30_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const health = await request(identityBase, "GET", "/identity/health", { timeoutMs: 1_000, allowNetworkError: true }); if (health.status === 200) return; await new Promise((resolve) => setTimeout(resolve, 250)); } fail("Identity did not become ready after restart"); }
async function waitForSQL(query, expected, message, timeoutMs = 20_000) { const deadline = Date.now() + timeoutMs; let actual = ""; while (Date.now() < deadline) { actual = sql(query); if (actual === expected) return; await new Promise((resolve) => setTimeout(resolve, 250)); } fail(message, `expected=${expected} actual=${actual}`); }
async function waitForFinancialHandoff(effectType, orderID, message, timeoutMs = 20_000) { const deadline = Date.now() + timeoutMs; let actual = ""; while (Date.now() < deadline) { actual = sql(`SELECT state || '|' || COALESCE(last_error,'') FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='${sqlLiteral(effectType)}' AND order_id='${sqlLiteral(orderID)}'`); if (actual.startsWith("POSTED|")) return; await new Promise((resolve) => setTimeout(resolve, 250)); } fail(message, `actual=${actual}`); }

let actingOperatorID = sql("SELECT r.actor_id FROM identity_actor_roles r JOIN identity_actors a ON a.id=r.actor_id JOIN identity_operator_permissions p ON p.actor_id=r.actor_id AND p.permission='platform_policies' AND p.enabled JOIN identity_bootstrap_state b ON b.id=1 WHERE r.role='operator' AND r.enabled AND a.security_enabled AND r.activated_at IS NOT NULL ORDER BY (r.actor_id=b.initial_operator_actor_id) DESC, r.activated_at DESC, r.actor_id LIMIT 1");
if (!actingOperatorID) console.log(`DSH_OPERATOR_CANDIDATES=${sql("SELECT COALESCE(string_agg(r.actor_id || ':' || r.enabled::text || ':' || (r.activated_at IS NOT NULL)::text || ':' || a.security_enabled::text, ',' ORDER BY r.activated_at DESC NULLS LAST, r.actor_id), 'none') FROM identity_actor_roles r JOIN identity_actors a ON a.id=r.actor_id WHERE r.role='operator'")}`);
if (!actingOperatorID) actingOperatorID = sql("SELECT b.initial_operator_actor_id FROM identity_bootstrap_state b JOIN identity_actor_roles r ON r.actor_id=b.initial_operator_actor_id AND r.role='operator' JOIN identity_actors a ON a.id=r.actor_id WHERE b.id=1 AND r.enabled AND a.security_enabled AND r.activated_at IS NOT NULL");
if (!actingOperatorID) {
  const bootstrapped = await request(identityBase, "POST", "/internal/bootstrap/operator", { token: bootstrapToken, body: { phoneE164: `+9677${crypto.randomInt(10_000_000, 99_999_999)}`, role: "operator" } });
  if (bootstrapped.status !== 201 || !bootstrapped.body?.actorId) fail("operator bootstrap failed", JSON.stringify(bootstrapped));
  actingOperatorID = String(bootstrapped.body.actorId);
}
if (!actingOperatorID.startsWith("act_")) fail("acting operator identity is invalid", actingOperatorID);
const platformPoliciesAccess = await request(identityBase, "GET", `/internal/operators/${encodeURIComponent(actingOperatorID)}/permissions/platform_policies`, { token: identityDshToken });
if (platformPoliciesAccess.status !== 200 || platformPoliciesAccess.body?.actorId !== actingOperatorID || platformPoliciesAccess.body?.permission !== "platform_policies" || platformPoliciesAccess.body?.enabled !== true) fail("DSH proof operator lacks Platform Policies permission", JSON.stringify(platformPoliciesAccess));
let checkerOperatorID = sql(`SELECT r.actor_id FROM identity_actor_roles r JOIN identity_actors a ON a.id=r.actor_id WHERE r.role='operator' AND r.enabled AND a.security_enabled AND r.activated_at IS NOT NULL AND r.actor_id<>'' AND r.actor_id<> '${sqlLiteral(actingOperatorID)}' ORDER BY r.activated_at DESC, r.actor_id LIMIT 1`);
if (!checkerOperatorID) {
  const checkerBootstrapped = await request(identityBase, "POST", "/internal/actor-roles/provision", { token: dshToken, headers: serviceHeaders(actingOperatorID, `checker-operator-provision-${suffix}`), body: { phoneE164: `+9677${crypto.randomInt(10_000_000, 99_999_999)}`, role: "operator" } });
  if (checkerBootstrapped.status !== 201 || !checkerBootstrapped.body?.actorId) fail("checker operator bootstrap failed", JSON.stringify(checkerBootstrapped));
  checkerOperatorID = String(checkerBootstrapped.body.actorId);
  actorIDs.add(checkerOperatorID);
}
if (!checkerOperatorID.startsWith("act_") || checkerOperatorID === actingOperatorID) fail("checker operator identity is invalid", checkerOperatorID);

for (const endpoint of ["/dsh/health", "/dsh/readiness"]) { const response = await request(dshBase, "GET", endpoint); if (response.status !== 200 || response.body?.status !== "ok") fail(`${endpoint} is not ready`, JSON.stringify(response.body)); }
for (const endpoint of ["/dsh/managed-roles/provision", "/dsh/managed-roles/status", "/dsh/managed-roles/disable", "/dsh/managed-roles/enable", "/dsh/managed-roles/reenrollment"]) { const response = await request(dshBase, endpoint.endsWith("status") ? "GET" : "POST", endpoint, { token: dshToken }); if (response.status !== 404) fail("retired DSH managed-access endpoint remains reachable", JSON.stringify({ endpoint, response })); }
const canonicalMigrationRows = dshMigrationNames.map((name, index) => `(${index + 1}, '${sqlLiteral(name)}')`).join(",");
expectSQL(
  `SELECT count(*) FROM (VALUES ${canonicalMigrationRows}) AS expected(version, name) LEFT JOIN dsh.schema_migrations actual USING (version) WHERE actual.name IS DISTINCT FROM expected.name`,
  "0",
  "DSH migration history does not match the canonical migration sources",
);
expectSQL(
  "SELECT count(*) FROM dsh.schema_migrations",
  String(dshMigrationNames.length),
  `DSH migration history is incomplete through v${dshMigrationNames.length}`,
);
  expectSQL("SELECT to_regclass('dsh.joining_case_financial_profile_outbox') IS NOT NULL", "t", "DSH financial profile outbox is missing");
  expectSQL("SELECT to_regclass('dsh.field_commission_publication_outbox') IS NOT NULL", "t", "DSH field commission publication outbox is missing");
  expectSQL("SELECT to_regclass('dsh.commerce_financial_handoff_outbox') IS NOT NULL", "t", "DSH financial handoff outbox is missing");
  expectSQL("SELECT count(*) FROM pg_constraint WHERE conname IN ('commerce_financial_handoff_outbox_effect_chk','commerce_financial_handoff_outbox_shape_chk','commerce_financial_handoff_outbox_actor_chk')", "3", "DSH financial handoff constraints are incomplete");
  expectSQL("SELECT to_regclass('wlt.partner_financial_profiles') IS NOT NULL AND to_regclass('wlt.partner_financial_profile_events') IS NOT NULL", "t", "WLT partner financial profile relations are missing");
  expectSQL("SELECT count(*) FROM pg_constraint WHERE conname IN ('catalog_store_offers_inventory_on_hand_chk','catalog_store_offers_inventory_reserved_chk','catalog_store_offers_inventory_mode_chk','commerce_order_lines_inventory_reserved_chk')", "4", "DSH quantity inventory constraints are incomplete");
  expectSQL("SELECT pg_get_constraintdef(oid) LIKE '%CANCELLED%' FROM pg_constraint WHERE conname='commerce_orders_state_chk'", "t", "DSH Order cancellation state is not canonical");
  expectSQL("SELECT pg_get_constraintdef(oid) LIKE '%CANCELLED%' FROM pg_constraint WHERE conname='commerce_order_transition_state_chk'", "t", "DSH Order cancellation transition is not canonical");
  expectSQL("SELECT pg_get_constraintdef(oid) LIKE '%order_cancelled%' FROM pg_constraint WHERE conname='commerce_order_audit_event_type_chk'", "t", "DSH Order cancellation audit is not canonical");
for (const table of ["commerce_carts", "commerce_cart_lines", "commerce_cart_mutation_idempotency", "commerce_cart_audit", "commerce_orders", "commerce_order_lines", "commerce_order_checkout_idempotency", "commerce_order_transition_idempotency", "commerce_order_audit", "commerce_order_payment_audit", "commerce_order_delivery_proofs", "commerce_order_conversation_messages", "commerce_order_conversation_read_state"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required commerce relation is missing: ${table}`);
for (const table of ["commerce_promotions", "commerce_promotion_redemptions", "discovery_content", "commerce_marketing_mutation_idempotency"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required marketing relation is missing: ${table}`);
for (const table of ["commerce_multi_store_checkouts", "commerce_multi_store_checkout_children", "commerce_multi_store_checkout_idempotency"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required multi-store checkout relation is missing: ${table}`);
for (const table of ["central_products", "central_product_mutation_idempotency", "central_product_audit", "store_assortments", "store_assortment_mutation_idempotency", "store_assortment_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NULL`, "t", `retired catalog relation remains: ${table}`);
for (const table of ["catalog_attribute_enum_options", "catalog_category_attribute_rules", "catalog_variant_attribute_values", "catalog_storefront_sections", "catalog_modifier_groups", "catalog_modifier_options", "catalog_variant_mutation_idempotency", "catalog_variant_audit", "catalog_attribute_mutation_idempotency", "commerce_order_line_modifier_snapshots", "commerce_order_line_attribute_snapshots"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required v12/v13 relation is missing: ${table}`);
for (const table of ["catalog_import_mutation_idempotency", "catalog_import_run_items", "catalog_import_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required v14 relation is missing: ${table}`);
  for (const table of ["catalog_media_mutation_idempotency", "catalog_media_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required v23 relation is missing: ${table}`);
  expectSQL("SELECT to_regclass('dsh.catalog_media_assets') IS NOT NULL", "t", "required v24 media asset relation is missing");
for (const table of ["captain_admissions", "captain_admission_idempotency", "captain_admission_audit", "captain_dispatch_offers", "captain_assignments", "captain_handoffs", "captain_operation_idempotency", "captain_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required Captain relation is missing: ${table}`);
for (const table of ["captain_location_snapshots", "captain_location_mutation_idempotency", "captain_location_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required Captain live-location relation is missing: ${table}`);
  expectSQL("SELECT to_regclass('dsh.notification_read_state') IS NOT NULL", "t", "required notification read-state relation is missing");
expectSQL("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='captain_admissions_phone_chk'", "CHECK (((contact_phone_e164 IS NULL) OR (contact_phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'::text)))", "Captain phone constraint is not canonical");
expectSQL("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='captain_admissions_suspended_availability_chk'", "CHECK (((state <> 'suspended'::text) OR (availability_state = 'unavailable'::text)))", "Captain suspended availability invariant is not canonical");
expectSQL("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='captain_admissions_state_chk'", "CHECK ((state = ANY (ARRAY['pending_identity'::text, 'eligible'::text, 'suspended'::text])))", "Captain admission state set is not canonical");
expectSQL("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='captain_admission_idempotency_state_chk'", "CHECK ((result_state = ANY (ARRAY['pending_identity'::text, 'eligible'::text, 'suspended'::text])))", "Captain admission idempotency state set is not canonical");
expectSQL("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='captain_operation_idempotency_operation_chk'", "CHECK ((operation = ANY (ARRAY['availability'::text, 'dispatch'::text, 'store_dispatch'::text, 'respond_offer'::text, 'reassign'::text, 'store_confirm'::text, 'pickup'::text, 'complete'::text, 'recover'::text])))", "Captain recovery operation is not canonical");
expectSQL("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='captain_audit_event_type_chk'", "CHECK ((event_type = ANY (ARRAY['dispatch_offer_created'::text, 'dispatch_offer_accepted'::text, 'dispatch_offer_rejected'::text, 'dispatch_offer_expired'::text, 'captain_offer_superseded_by_access'::text, 'captain_assignment_reassigned'::text, 'store_handoff_confirmed'::text, 'captain_pickup_completed'::text, 'delivery_completed'::text, 'delivery_failed'::text, 'delivery_recovered'::text])))", "Captain delivery recovery audit events are not canonical");
for (const table of ["field_admissions", "field_admission_idempotency", "field_admission_audit"]) expectSQL(`SELECT to_regclass('dsh.${table}') IS NOT NULL`, "t", `required Field relation is missing: ${table}`);
expectSQL("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='field_admissions_state_chk'", "CHECK ((state = ANY (ARRAY['pending_identity'::text, 'eligible'::text, 'suspended'::text])))", "Field admission state set is not canonical");
expectSQL("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='field_admission_idempotency_operation_chk'", "CHECK ((operation = 'create'::text))", "Field admission idempotency operation is not canonical");
expectSQL("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='field_admission_audit_event_type_chk'", "CHECK ((event_type = ANY (ARRAY['field_admission_created'::text, 'field_admission_bound'::text, 'field_admission_suspended'::text, 'field_admission_restored'::text])))", "Field admission audit events are not canonical");
expectSQL("SELECT pg_get_constraintdef(oid) LIKE '%origin%' AND pg_get_constraintdef(oid) LIKE '%control_panel%' AND pg_get_constraintdef(oid) LIKE '%field%' FROM pg_constraint WHERE conname='joining_cases_origin_chk'", "t", "Joining-case origin values are not canonical");
expectSQL("SELECT pg_get_constraintdef(oid) LIKE '%control_panel%' AND pg_get_constraintdef(oid) LIKE '%originating_field_actor_id%' FROM pg_constraint WHERE conname='joining_cases_field_actor_chk'", "t", "Joining-case field provenance invariant is not canonical");
expectSQL("SELECT to_regclass('dsh.joining_cases') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='dsh' AND table_name='joining_cases' AND column_name IN ('originating_field_actor_id','origin') GROUP BY table_schema,table_name HAVING count(*)=2)", "t", "Joining-case provenance columns are missing");
console.log("DSH_SCHEMA_V33=PASS");
expectSQL("SELECT name FROM wlt.schema_migrations WHERE version=2", "002_cash_remittances.sql", "WLT cash-remittance migration is not canonical");
expectSQL("SELECT name FROM wlt.schema_migrations WHERE version=3", "003_partner_financial_profiles.sql", "WLT partner financial profile migration is not canonical");
expectSQL("SELECT name FROM wlt.schema_migrations WHERE version=6", "006_partner_order_earnings_ledger.sql", "WLT partner order earnings ledger migration is not canonical");
expectSQL("SELECT name FROM wlt.schema_migrations WHERE version=7", "007_official_wallet_destinations_and_payout_intents.sql", "WLT official-wallet destination and payout migration is not canonical");
expectSQL("SELECT to_regclass('wlt.ledger_transactions') IS NOT NULL AND to_regclass('wlt.ledger_entries') IS NOT NULL AND to_regclass('wlt.partner_order_earnings') IS NOT NULL", "t", "WLT partner order earnings ledger relations are missing");
expectSQL("SELECT name FROM wlt.schema_migrations WHERE version=4", "004_payment_allocations.sql", "WLT payment allocation migration is not canonical");
expectSQL("SELECT to_regclass('wlt.customer_payment_allocations') IS NOT NULL AND to_regclass('wlt.customer_payment_allocation_events') IS NOT NULL", "t", "WLT payment allocation relations are missing");
expectSQL("SELECT name FROM wlt.schema_migrations WHERE version=5", "005_delivery_fee_policies.sql", "WLT delivery-fee policy migration is not canonical");
expectSQL("SELECT to_regclass('wlt.delivery_fee_policies') IS NOT NULL AND to_regclass('wlt.delivery_fee_policy_events') IS NOT NULL", "t", "WLT delivery-fee policy relations are missing");
expectSQL("SELECT to_regclass('wlt.official_wallet_destinations') IS NOT NULL AND to_regclass('wlt.official_wallet_destination_transitions') IS NOT NULL AND to_regclass('wlt.payout_requests') IS NOT NULL AND to_regclass('wlt.payout_holds') IS NOT NULL", "t", "WLT official-wallet destination and payout relations are missing");
expectSQL("SELECT to_regclass('wlt.field_commission_policies') IS NOT NULL AND to_regclass('wlt.field_commission_earnings') IS NOT NULL", "t", "WLT field commission relations are missing");
  expectSQL("SELECT name FROM wlt.schema_migrations WHERE version=13", "013_captain_cod_reassignment_reservations.sql", "WLT Captain COD reassignment migration is not canonical");
  console.log("WLT_SCHEMA_V13=PASS");
const cityAResponse = await request(dshBase, "POST", "/dsh/service-cities", { token: dshToken, headers: serviceHeaders(actingOperatorID, `city-a-${suffix}`), body: { displayNameAr: `مدينة أ ${citySuffix}`, active: true } });
const cityBResponse = await request(dshBase, "POST", "/dsh/service-cities", { token: dshToken, headers: serviceHeaders(actingOperatorID, `city-b-${suffix}`), body: { displayNameAr: `مدينة ب ${citySuffix}`, active: true } });
if (cityAResponse.status !== 201 || cityBResponse.status !== 201 || typeof cityAResponse.body?.city?.id !== "string" || typeof cityBResponse.body?.city?.id !== "string") fail("service city fixtures could not be created", JSON.stringify({ cityAResponse, cityBResponse }));
cityA = cityAResponse.body.city.id;
cityB = cityBResponse.body.city.id;
cityIDs.add(cityA); cityIDs.add(cityB);
const deliveryFeePolicyCreate = await request(dshBase, "POST", "/dsh/operator/delivery-fee-policy", { token: dshToken, headers: serviceHeaders(actingOperatorID, `delivery-fee-policy-${suffix}`), body: { serviceCityId: cityA, baseFeeMinor: 100, distanceUnitMeters: 1000000, distanceRateMinor: 0, orderSizeUnitBaseUnits: 100, orderSizeRateMinor: 0, zoneSurchargeMinor: 0, roundingUnitMinor: 50, expectedVersion: 0, reason: "DSH runtime city delivery fee policy proof" } });
if (deliveryFeePolicyCreate.status !== 201 || deliveryFeePolicyCreate.body?.policy?.serviceCityId !== cityA || deliveryFeePolicyCreate.body.policy?.state !== "ACTIVE" || deliveryFeePolicyCreate.body.policy?.baseFeeMinor !== 100 || deliveryFeePolicyCreate.body.policy?.roundingUnitMinor !== 50 || typeof deliveryFeePolicyCreate.body.policy?.policyVersion !== "string") fail("city-scoped delivery-fee policy could not be activated", JSON.stringify(deliveryFeePolicyCreate));
deliveryFeePolicyIDs.add(String(deliveryFeePolicyCreate.body.policy.id));
const deliveryFeePolicyRead = await request(dshBase, "GET", `/dsh/operator/delivery-fee-policy?serviceCityId=${encodeURIComponent(cityA)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (deliveryFeePolicyRead.status !== 200 || deliveryFeePolicyRead.body?.policy?.id !== deliveryFeePolicyCreate.body.policy.id || deliveryFeePolicyRead.body.policy?.serviceCityId !== cityA) fail("delivery-fee policy readback did not return the active city policy", JSON.stringify({ deliveryFeePolicyCreate, deliveryFeePolicyRead }));
console.log("DSH_DELIVERY_FEE_POLICY=PASS");
console.log("DSH_CITY_SCOPE_RUNTIME=PASS");
let partnerFinancialTermsPolicyRead = await request(wltBase, "GET", "/wlt/v1/operator/partner-financial-terms-policy", { token: wltToken });
if (partnerFinancialTermsPolicyRead.status === 404 && process.env.BTHWANI_IDENTITY_PROOF_SCOPE === "disposable-ci") {
  partnerFinancialTermsPolicyRead = await request(wltBase, "POST", "/wlt/v1/operator/partner-financial-terms-policy", {
    token: wltToken,
    headers: serviceHeaders(actingOperatorID, `dsh-runtime-terms-policy-${suffix}`),
    body: { commissionRateBps: 1500, settlementPeriod: "MONTHLY", expectedVersion: 0, reason: "DSH runtime disposable financial terms policy proof" },
  });
  if (partnerFinancialTermsPolicyRead.status !== 201) fail("disposable WLT partner financial terms policy could not be created", JSON.stringify(partnerFinancialTermsPolicyRead));
}
const partnerFinancialTermsPolicy = partnerFinancialTermsPolicyRead.body?.policy;
if (partnerFinancialTermsPolicyRead.status !== 200 && partnerFinancialTermsPolicyRead.status !== 201 || partnerFinancialTermsPolicy?.state !== "ACTIVE" || partnerFinancialTermsPolicy?.commissionRateBps !== 1500 || partnerFinancialTermsPolicy?.settlementPeriod !== "MONTHLY" || typeof partnerFinancialTermsPolicy?.policyVersion !== "string") fail("canonical WLT partner financial terms policy is unavailable for DSH proof", JSON.stringify(partnerFinancialTermsPolicyRead));
console.log("DSH_PARTNER_FINANCIAL_TERMS_POLICY=PASS");
const deliveryFeeMinor = 100;
const mainOrderSubtotal = 4200;
const mainOrderTotal = mainOrderSubtotal + deliveryFeeMinor;
const singleOrderSubtotal = 2100;
const singleOrderTotal = singleOrderSubtotal + deliveryFeeMinor;

const verticalCreate = await request(dshBase, "POST", "/dsh/catalog/verticals", { token: dshToken, headers: serviceHeaders(actingOperatorID, `vertical-${suffix}`), body: { nameAr: `بقالة ${suffix}`, nameEn: `Grocery ${suffix}`, catalogModel: "SHARED_CATALOG", active: true, reason: "DSH runtime catalog vertical proof" } });
if (verticalCreate.status !== 201 || !String(verticalCreate.body?.vertical?.id || "").startsWith("vertical_")) fail("commerce vertical creation failed", JSON.stringify(verticalCreate));
verticalID = String(verticalCreate.body.vertical.id);
const storeLocalVerticalCreate = await request(dshBase, "POST", "/dsh/catalog/verticals", { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-local-vertical-${suffix}`), body: { nameAr: `متجر محلي ${suffix}`, nameEn: `Local Store ${suffix}`, catalogModel: "STORE_LOCAL_CATALOG", active: true, reason: "DSH runtime store-local catalog proof" } });
if (storeLocalVerticalCreate.status !== 201 || !String(storeLocalVerticalCreate.body?.vertical?.id || "").startsWith("vertical_")) fail("store-local commerce vertical creation failed", JSON.stringify(storeLocalVerticalCreate));
storeLocalVerticalID = String(storeLocalVerticalCreate.body.vertical.id);
const verticalList = await request(dshBase, "GET", "/dsh/catalog/verticals", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (verticalList.status !== 200 || !verticalList.body?.verticals?.some((item) => item.id === verticalID)) fail("commerce vertical registry readback failed", JSON.stringify(verticalList));
const categoryCreate = await request(dshBase, "POST", "/dsh/catalog/categories", { token: dshToken, headers: serviceHeaders(actingOperatorID, `category-${suffix}`), body: { verticalId: verticalID, nameAr: `قهوة ${suffix}`, nameEn: `Coffee ${suffix}`, active: true, reason: "DSH runtime catalog category proof" } });
if (categoryCreate.status !== 201 || !String(categoryCreate.body?.category?.id || "").startsWith("category_")) fail("catalog category creation failed", JSON.stringify(categoryCreate));
categoryID = String(categoryCreate.body.category.id);
const childCategoryCreate = await request(dshBase, "POST", "/dsh/catalog/categories", { token: dshToken, headers: serviceHeaders(actingOperatorID, `category-child-${suffix}`), body: { verticalId: verticalID, parentCategoryId: categoryID, nameAr: `حبوب ${suffix}`, nameEn: `Beans ${suffix}`, active: true, reason: "DSH runtime child catalog category proof" } });
if (childCategoryCreate.status !== 201 || !String(childCategoryCreate.body?.category?.id || "").startsWith("category_") || childCategoryCreate.body?.category?.parentCategoryId !== categoryID) fail("catalog parent category tree failed", JSON.stringify({ categoryCreate, childCategoryCreate }));
childCategoryID = String(childCategoryCreate.body.category.id);
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
for (const attributeID of [measurementAttributeID, dateAttributeID]) {
  const productAttributeRule = await request(dshBase, "PUT", `/dsh/catalog/categories/${childCategoryID}/attribute-rules/${attributeID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `product-attribute-rule-${attributeID}-${suffix}`), body: { required: false, filterable: false, variantAxis: false, expectedVersion: 0, reason: "DSH runtime optional product attribute proof" } });
  if (productAttributeRule.status !== 200 || !productAttributeRule.body?.rules?.some((item) => item.attributeId === attributeID && !item.required && !item.variantAxis)) fail("optional product Attribute rule failed", JSON.stringify({ attributeID, productAttributeRule }));
}

const firstStoreOrigin = { firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006 };
const correctedStoreOrigin = { firstStoreLatitude: 15.370001, firstStoreLongitude: 44.192002 };

async function createApprovedPartner(phone, name, serviceCityId, origin = "control_panel", partnerVerticalID = verticalID) {
  const createKey = `joining-${crypto.randomUUID()}`;
  const fieldOrigin = origin === "field";
  const created = await request(dshBase, "POST", fieldOrigin ? "/dsh/field/joining-cases" : "/dsh/joining-cases", { token: fieldOrigin ? fieldAccessToken : dshToken, headers: fieldOrigin ? partnerHeaders(createKey) : serviceHeaders(actingOperatorID, createKey), body: { contactPhoneE164: phone, businessName: `${name} business`, firstStoreName: `${name} store`, serviceCityId, firstStoreVerticalId: partnerVerticalID, firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], ...firstStoreOrigin } });
  if (created.status !== 201 || created.body?.case?.state !== "draft" || created.body?.case?.origin !== origin || created.body?.case?.firstStoreVerticalId !== partnerVerticalID || created.body?.case?.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || created.body?.case?.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude) fail("joining case creation did not preserve source provenance or fixed store origin", JSON.stringify(created));
  const caseID = String(created.body.case.id); caseIDs.add(caseID);
  const submitted = await request(dshBase, "POST", fieldOrigin ? `/dsh/field/joining-cases/${caseID}/submit` : `/dsh/joining-cases/${caseID}/submit`, { token: fieldOrigin ? fieldAccessToken : dshToken, headers: fieldOrigin ? partnerHeaders(`submit-${crypto.randomUUID()}`, 1) : serviceHeaders(actingOperatorID, `submit-${crypto.randomUUID()}`, crypto.randomUUID(), 1) });
  if (submitted.status !== 200 || submitted.body?.case?.state !== "submitted" || !submitted.body?.case?.partnerActorId) fail("joining case submission failed", JSON.stringify(submitted));
  const actorID = String(submitted.body.case.partnerActorId); actorIDs.add(actorID);
  const accessToken = await activatePartner(phone, name.slice(0, 4).padEnd(4, "x") + suffix.slice(0, 4));
  const approved = await request(dshBase, "POST", `/dsh/joining-cases/${caseID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `approve-${crypto.randomUUID()}`, crypto.randomUUID(), 2), body: { decision: "approved", expectedTermsPolicyVersion: partnerFinancialTermsPolicy.policyVersion } });
  const storeID = String(approved.body?.case?.store?.id || ""); if (storeID) storeIDs.add(storeID);
  if (approved.status !== 200 || approved.body?.case?.state !== "approved" || approved.body?.case?.financialProfileState !== "ACTIVE" || approved.body?.case?.commissionRateBps !== 1500 || approved.body?.case?.settlementPeriod !== "MONTHLY" || typeof approved.body?.case?.financialProfileId !== "string" || approved.body?.case?.store?.primaryVerticalId !== partnerVerticalID || approved.body?.case?.store?.deliveryOrigin?.latitude !== firstStoreOrigin.firstStoreLatitude || approved.body?.case?.store?.deliveryOrigin?.longitude !== firstStoreOrigin.firstStoreLongitude) fail("joining case approval did not bind financial terms and transfer the fixed store origin", JSON.stringify(approved));
  return { accessToken, actorID, caseID, storeID };
}
const fieldPhone = `+96771${crypto.randomInt(1_000_000, 9_999_999)}`;
const fieldAdmissionResponse = await request(dshBase, "POST", "/dsh/fields/admissions", { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-admit-${suffix}`), body: { contactPhoneE164: fieldPhone } });
const fieldAdmissionReplay = await request(dshBase, "POST", "/dsh/fields/admissions", { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-admit-${suffix}`), body: { contactPhoneE164: fieldPhone } });
if (fieldAdmissionResponse.status !== 201 || fieldAdmissionResponse.body?.admission?.state !== "eligible" || !fieldAdmissionResponse.body?.admission?.actorId || fieldAdmissionReplay.status !== 200 || fieldAdmissionReplay.body?.idempotentReplay !== true || fieldAdmissionReplay.body.admission.id !== fieldAdmissionResponse.body.admission.id) fail("Field admission did not bind and replay one DSH-owned actor", JSON.stringify({ fieldAdmissionResponse, fieldAdmissionReplay }));
const fieldAdmissionID = String(fieldAdmissionResponse.body.admission.id);
const fieldActorID = String(fieldAdmissionResponse.body.admission.actorId);
fieldAdmissionIDs.add(fieldAdmissionID); actorIDs.add(fieldActorID);
const fieldPassword = `Fiel${suffix.slice(0, 4)}`;
let fieldAccessToken = await activateField(fieldPhone, fieldPassword);
const fieldSelf = await request(dshBase, "GET", "/dsh/fields/me", { token: fieldAccessToken });
const fieldAdmissionRead = await request(dshBase, "GET", `/dsh/fields/admissions/${encodeURIComponent(fieldAdmissionID)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const fieldActorAdmissionRead = await request(dshBase, "GET", `/dsh/fields/actors/${encodeURIComponent(fieldActorID)}/admission`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const fieldDirectIdentityWrite = await request(identityBase, "POST", "/internal/actor-roles/provision", { token: fieldAccessToken, body: { phoneE164: `+96770${crypto.randomInt(1_000_000, 9_999_999)}`, role: "field" } });
if (fieldSelf.status !== 200 || fieldSelf.body?.admission?.actorId !== fieldActorID || fieldAdmissionRead.status !== 200 || fieldAdmissionRead.body?.admission?.id !== fieldAdmissionID || fieldActorAdmissionRead.status !== 200 || fieldActorAdmissionRead.body?.admission?.actorId !== fieldActorID || fieldDirectIdentityWrite.status !== 401) fail("Field admission readback or direct Identity creation boundary failed", JSON.stringify({ fieldSelf, fieldAdmissionRead, fieldActorAdmissionRead, fieldDirectIdentityWrite }));
const fieldRoleBeforeReenrollment = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(fieldActorID)}/roles/field`, { token: identityDshToken });
const fieldReenrollmentPath = `/dsh/fields/${encodeURIComponent(fieldActorID)}/reenrollment`;
const fieldReenrollmentBody = { expectedActorVersion: fieldRoleBeforeReenrollment.body?.actorVersion, expectedRoleVersion: fieldRoleBeforeReenrollment.body?.roleVersion, reason: "استرداد جهاز الميدان وإعادة تسجيل الوصول" };
const fieldReenrollmentHeaders = { "X-Acting-Actor-ID": actingOperatorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(fieldAdmissionRead.body?.admission?.version) };
const directFieldReenrollment = await request(identityBase, "POST", `/internal/actors/${encodeURIComponent(fieldActorID)}/roles/field/reenrollment`, { token: dshToken, headers: { ...fieldReenrollmentHeaders, "X-Expected-Actor-Version": String(fieldReenrollmentBody.expectedActorVersion), "X-Reason": "direct-identity-reenrollment-boundary-probe" } });
const staleFieldReenrollment = await request(dshBase, "POST", fieldReenrollmentPath, { token: dshToken, headers: { ...fieldReenrollmentHeaders, "X-Expected-Version": String(Number(fieldAdmissionRead.body?.admission?.version) + 1) }, body: fieldReenrollmentBody });
const fieldReenrollment = await request(dshBase, "POST", fieldReenrollmentPath, { token: dshToken, headers: fieldReenrollmentHeaders, body: fieldReenrollmentBody });
const fieldReenrollmentReplay = await request(dshBase, "POST", fieldReenrollmentPath, { token: dshToken, headers: fieldReenrollmentHeaders, body: fieldReenrollmentBody });
const fieldRoleAfterReenrollment = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(fieldActorID)}/roles/field`, { token: identityDshToken });
const fieldAdmissionAfterReenrollment = await request(dshBase, "GET", `/dsh/fields/actors/${encodeURIComponent(fieldActorID)}/admission`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const staleFieldSession = await request(dshBase, "GET", "/dsh/fields/me", { token: fieldAccessToken });
if (fieldRoleBeforeReenrollment.status !== 200 || directFieldReenrollment.status !== 403 || staleFieldReenrollment.status !== 409 || fieldReenrollment.status !== 204 || fieldReenrollmentReplay.status !== 409 || fieldRoleAfterReenrollment.status !== 200 || fieldRoleAfterReenrollment.body?.enabled !== true || fieldRoleAfterReenrollment.body?.activatedAt != null || fieldRoleAfterReenrollment.body?.actorVersion !== fieldRoleBeforeReenrollment.body?.actorVersion || fieldRoleAfterReenrollment.body?.roleVersion !== Number(fieldRoleBeforeReenrollment.body?.roleVersion) + 1 || fieldAdmissionAfterReenrollment.status !== 200 || fieldAdmissionAfterReenrollment.body?.admission?.state !== "eligible" || fieldAdmissionAfterReenrollment.body?.admission?.version !== fieldAdmissionRead.body?.admission?.version || staleFieldSession.status !== 401) fail("Field reenrollment was not DSH-owned, version-fenced, replay-safe, or session-revoking", JSON.stringify({ fieldRoleBeforeReenrollment, directFieldReenrollment, staleFieldReenrollment, fieldReenrollment, fieldReenrollmentReplay, fieldRoleAfterReenrollment, fieldAdmissionAfterReenrollment, staleFieldSession }));
fieldAccessToken = await activateField(fieldPhone, fieldPassword);
const fieldReactivatedSession = await request(dshBase, "GET", "/dsh/fields/me", { token: fieldAccessToken });
if (fieldReactivatedSession.status !== 200 || fieldReactivatedSession.body?.admission?.actorId !== fieldActorID) fail("Field reenrollment could not activate the existing DSH-bound actor", JSON.stringify(fieldReactivatedSession));
const first = await createApprovedPartner(`+96772${crypto.randomInt(1_000_000, 9_999_999)}`, "Catalog Runtime A", cityA);
const second = await createApprovedPartner(`+96774${crypto.randomInt(1_000_000, 9_999_999)}`, "Catalog Runtime B", cityB, "field");
const storeLocal = await createApprovedPartner(`+96775${crypto.randomInt(1_000_000, 9_999_999)}`, "Store Local Runtime", cityA, "control_panel", storeLocalVerticalID);
const secondFieldPhone = `+96773${crypto.randomInt(1_000_000, 9_999_999)}`;
const secondFieldAdmission = await request(dshBase, "POST", "/dsh/fields/admissions", { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-admit-second-${suffix}`), body: { contactPhoneE164: secondFieldPhone } });
if (secondFieldAdmission.status !== 201 || secondFieldAdmission.body?.admission?.state !== "eligible" || !secondFieldAdmission.body?.admission?.actorId) fail("second Field admission fixture failed", JSON.stringify(secondFieldAdmission));
const secondFieldAdmissionID = String(secondFieldAdmission.body.admission.id); const secondFieldActorID = String(secondFieldAdmission.body.admission.actorId); fieldAdmissionIDs.add(secondFieldAdmissionID); actorIDs.add(secondFieldActorID);
const secondFieldAccessToken = await activateField(secondFieldPhone, `Fiel${suffix.slice(0, 4)}`);
const fieldCasePhone = `+96775${crypto.randomInt(1_000_000, 9_999_999)}`;
const fieldCaseKey = `field-case-${suffix}`;
const fieldCaseCreated = await request(dshBase, "POST", "/dsh/field/joining-cases", { token: fieldAccessToken, headers: { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": fieldCaseKey }, body: { contactPhoneE164: fieldCasePhone, businessName: `Field ${suffix} business`, firstStoreName: `Field ${suffix} store`, serviceCityId: cityA, firstStoreVerticalId: verticalID, ...firstStoreOrigin } });
const fieldCaseReplay = await request(dshBase, "POST", "/dsh/field/joining-cases", { token: fieldAccessToken, headers: { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": fieldCaseKey }, body: { contactPhoneE164: fieldCasePhone, businessName: `Field ${suffix} business`, firstStoreName: `Field ${suffix} store`, serviceCityId: cityA, firstStoreVerticalId: verticalID, ...firstStoreOrigin } });
if (fieldCaseCreated.status !== 201 || fieldCaseCreated.body?.case?.state !== "draft" || fieldCaseCreated.body?.case?.version !== 1 || fieldCaseCreated.body?.case?.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || fieldCaseCreated.body?.case?.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude || fieldCaseReplay.status !== 200 || fieldCaseReplay.body?.idempotentReplay !== true || fieldCaseReplay.body.case.id !== fieldCaseCreated.body.case.id || fieldCaseReplay.body.case.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || fieldCaseReplay.body.case.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude) fail("Field joining-case create/replay did not preserve one draft and its fixed store origin", JSON.stringify({ fieldCaseCreated, fieldCaseReplay }));
const fieldCaseID = String(fieldCaseCreated.body.case.id); caseIDs.add(fieldCaseID);
const fieldCases = await request(dshBase, "GET", "/dsh/field/joining-cases?limit=25", { token: fieldAccessToken });
const fieldCaseRead = await request(dshBase, "GET", `/dsh/field/joining-cases/${encodeURIComponent(fieldCaseID)}`, { token: fieldAccessToken });
const secondFieldCaseRead = await request(dshBase, "GET", `/dsh/field/joining-cases/${encodeURIComponent(fieldCaseID)}`, { token: secondFieldAccessToken });
const secondFieldCases = await request(dshBase, "GET", "/dsh/field/joining-cases?limit=25", { token: secondFieldAccessToken });
if (fieldCases.status !== 200 || !fieldCases.body?.cases?.some((item) => item.id === fieldCaseID && item.state === "draft" && item.firstStoreLatitude === firstStoreOrigin.firstStoreLatitude && item.firstStoreLongitude === firstStoreOrigin.firstStoreLongitude) || fieldCaseRead.status !== 200 || fieldCaseRead.body?.case?.id !== fieldCaseID || fieldCaseRead.body?.case?.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || fieldCaseRead.body?.case?.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude || secondFieldCaseRead.status !== 404 || secondFieldCases.status !== 200 || secondFieldCases.body?.cases?.some((item) => item.id === fieldCaseID)) fail("Field joining-case scope or fixed store origin readback failed", JSON.stringify({ fieldCases, fieldCaseRead, secondFieldCaseRead, secondFieldCases }));
const fieldSubmitKey = `field-submit-${suffix}`;
const fieldSubmitted = await request(dshBase, "POST", `/dsh/field/joining-cases/${encodeURIComponent(fieldCaseID)}/submit`, { token: fieldAccessToken, headers: partnerHeaders(fieldSubmitKey, 1) });
const fieldSubmittedReplay = await request(dshBase, "POST", `/dsh/field/joining-cases/${encodeURIComponent(fieldCaseID)}/submit`, { token: fieldAccessToken, headers: partnerHeaders(fieldSubmitKey, 1) });
const fieldSubmittedCanonical = await request(dshBase, "GET", `/dsh/joining-cases/${encodeURIComponent(fieldCaseID)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const fieldReviewAttempt = await request(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(fieldCaseID)}/review`, { token: fieldAccessToken, headers: serviceHeaders(fieldActorID, `field-self-review-${suffix}`, crypto.randomUUID(), 2), body: { decision: "approved" } });
if (fieldSubmitted.status !== 200 || fieldSubmitted.body?.case?.state !== "submitted" || fieldSubmitted.body?.case?.version !== 2 || fieldSubmitted.body?.case?.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || fieldSubmitted.body?.case?.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude || fieldSubmittedReplay.status !== 200 || fieldSubmittedReplay.body?.idempotentReplay !== true || fieldSubmittedReplay.body.case.version !== 2 || fieldSubmittedReplay.body.case.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || fieldSubmittedReplay.body.case.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude || fieldSubmittedCanonical.status !== 200 || !fieldSubmittedCanonical.body?.case?.partnerActorId || fieldSubmittedCanonical.body?.case?.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || fieldSubmittedCanonical.body?.case?.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude || fieldReviewAttempt.status !== 401) fail("Field joining-case submission, replay, readback, or review boundary failed", JSON.stringify({ fieldSubmitted, fieldSubmittedReplay, fieldSubmittedCanonical, fieldReviewAttempt }));
const fieldPartnerActorID = String(fieldSubmittedCanonical.body.case.partnerActorId); actorIDs.add(fieldPartnerActorID);
const fieldPublicationAttempt = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(first.storeID)}/publication`, { token: fieldAccessToken, headers: partnerHeaders(`field-publication-${suffix}`, 1), body: { state: "published" } });
if (fieldPublicationAttempt.status !== 401 && fieldPublicationAttempt.status !== 403) fail("Field reached the Store publication writer", JSON.stringify(fieldPublicationAttempt));
const fieldApproved = await request(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(fieldCaseID)}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-approve-${suffix}`, crypto.randomUUID(), 2), body: { decision: "approved", expectedTermsPolicyVersion: partnerFinancialTermsPolicy.policyVersion } });
if (fieldApproved.status !== 200 || fieldApproved.body?.case?.state !== "approved" || fieldApproved.body?.case?.financialProfileState !== "ACTIVE" || fieldApproved.body?.case?.commissionRateBps !== 1500 || fieldApproved.body?.case?.settlementPeriod !== "MONTHLY" || typeof fieldApproved.body?.case?.financialProfileId !== "string" || !fieldApproved.body?.case?.store?.id || fieldApproved.body?.case?.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || fieldApproved.body?.case?.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude || fieldApproved.body?.case?.store?.deliveryOrigin?.latitude !== firstStoreOrigin.firstStoreLatitude || fieldApproved.body?.case?.store?.deliveryOrigin?.longitude !== firstStoreOrigin.firstStoreLongitude) fail("operator approval of Field-originated joining case did not bind financial terms and preserve the fixed store origin", JSON.stringify(fieldApproved));
storeIDs.add(String(fieldApproved.body.case.store.id));
const fieldRoleBeforeDisable = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(fieldActorID)}/roles/field`, { token: identityDshToken });
const fieldDisabled = await request(dshBase, "POST", `/dsh/fields/${encodeURIComponent(fieldActorID)}/identity-role`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-disable-${suffix}`, crypto.randomUUID(), fieldRoleBeforeDisable.body?.roleVersion), body: { enabled: false, reason: "تعليق Field واختبار إلغاء الجلسة" } });
const fieldAdmissionSuspended = await request(dshBase, "GET", `/dsh/fields/actors/${encodeURIComponent(fieldActorID)}/admission`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const revokedFieldSession = await request(dshBase, "GET", "/dsh/fields/me", { token: fieldAccessToken });
const fieldRoleAfterDisable = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(fieldActorID)}/roles/field`, { token: identityDshToken });
const fieldEnabled = await request(dshBase, "POST", `/dsh/fields/${encodeURIComponent(fieldActorID)}/identity-role`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-enable-${suffix}`, crypto.randomUUID(), fieldRoleAfterDisable.body?.roleVersion), body: { enabled: true, reason: "إعادة Field إلى الأهلية التشغيلية" } });
const fieldAdmissionRestored = await request(dshBase, "GET", `/dsh/fields/actors/${encodeURIComponent(fieldActorID)}/admission`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (fieldRoleBeforeDisable.status !== 200 || fieldDisabled.status !== 204 || fieldAdmissionSuspended.status !== 200 || fieldAdmissionSuspended.body?.admission?.state !== "suspended" || fieldDisabled.status !== 204 || fieldRoleAfterDisable.body?.enabled !== false || revokedFieldSession.status !== 401 || fieldEnabled.status !== 204 || fieldAdmissionRestored.status !== 200 || fieldAdmissionRestored.body?.admission?.state !== "eligible") fail("Field DSH/Identity suspend/restore lifecycle was not fail-closed and versioned", JSON.stringify({ fieldRoleBeforeDisable, fieldDisabled, fieldAdmissionSuspended, revokedFieldSession, fieldRoleAfterDisable, fieldEnabled, fieldAdmissionRestored }));
console.log("DSH_FIELD_ADMISSION_AND_SCOPED_JOINING=PASS");
const correctionPhone = `+96776${crypto.randomInt(1_000_000, 9_999_999)}`;
const correctionCreated = await request(dshBase, "POST", "/dsh/joining-cases", { token: dshToken, headers: serviceHeaders(actingOperatorID, `joining-correction-${suffix}`), body: { contactPhoneE164: correctionPhone, businessName: "Correction business", firstStoreName: "Correction store", serviceCityId: cityA, firstStoreVerticalId: verticalID, firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], ...firstStoreOrigin } });
if (correctionCreated.status !== 201 || correctionCreated.body?.case?.state !== "draft" || correctionCreated.body?.case?.origin !== "control_panel" || correctionCreated.body?.case?.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || correctionCreated.body?.case?.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude) fail("control-panel correction case creation did not preserve provenance or fixed store origin", JSON.stringify(correctionCreated));
const correctionCaseID = String(correctionCreated.body.case.id); caseIDs.add(correctionCaseID);
const correctionSubmitted = await request(dshBase, "POST", `/dsh/joining-cases/${correctionCaseID}/submit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `submit-correction-${suffix}`, crypto.randomUUID(), 1) });
if (correctionSubmitted.status !== 200 || correctionSubmitted.body?.case?.state !== "submitted" || !correctionSubmitted.body?.case?.partnerActorId) fail("correction joining case submission failed", JSON.stringify(correctionSubmitted));
const correctionActorID = String(correctionSubmitted.body.case.partnerActorId); actorIDs.add(correctionActorID);
const correctionAccessToken = await activatePartner(correctionPhone, `Corr${suffix.slice(0, 4)}`);
const needsCorrection = await request(dshBase, "POST", `/dsh/joining-cases/${correctionCaseID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `needs-correction-${suffix}`, crypto.randomUUID(), 2), body: { decision: "needs_correction", correctionReason: "صحح اسم المتجر قبل الاعتماد" } });
if (needsCorrection.status !== 200 || needsCorrection.body?.case?.state !== "needs_correction" || needsCorrection.body.case.version !== 3) fail("joining case correction review failed", JSON.stringify(needsCorrection));
const corrected = await request(dshBase, "POST", `/dsh/joining-cases/${correctionCaseID}/correct-and-resubmit`, { token: correctionAccessToken, headers: partnerHeaders(`correct-and-resubmit-${suffix}`, 3), body: { businessName: "Correction business fixed", firstStoreName: "Correction store fixed", serviceCityId: cityA, firstStoreVerticalId: verticalID, ...correctedStoreOrigin } });
if (corrected.status !== 200 || corrected.body?.case?.state !== "submitted" || corrected.body.case.version !== 4 || corrected.body.case.firstStoreVerticalId !== verticalID || corrected.body.case.firstStoreLatitude !== correctedStoreOrigin.firstStoreLatitude || corrected.body.case.firstStoreLongitude !== correctedStoreOrigin.firstStoreLongitude) fail("joining case correct-and-resubmit did not preserve the corrected store origin", JSON.stringify(corrected));
const correctionRoleBeforeDisable = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(correctionActorID)}/roles/partner`, { token: identityDshToken });
const correctionRoleDisable = await request(dshBase, "POST", `/dsh/partners/${encodeURIComponent(correctionActorID)}/identity-role`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-disable-${suffix}`, crypto.randomUUID(), correctionRoleBeforeDisable.body?.roleVersion), body: { enabled: false, reason: "اختبار تعليق شريك قبل إعادة التفعيل" } });
const correctionRoleAfterDisable = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(correctionActorID)}/roles/partner`, { token: identityDshToken });
const correctionRoleEnable = await request(dshBase, "POST", `/dsh/partners/${encodeURIComponent(correctionActorID)}/identity-role`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-enable-needs-correction-${suffix}`, crypto.randomUUID(), correctionRoleAfterDisable.body?.roleVersion), body: { enabled: true, reason: "إعادة تفعيل بعد تصحيح مطلوب" } });
const approvedAfterReenable = await request(dshBase, "POST", `/dsh/joining-cases/${correctionCaseID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `approve-reenable-${suffix}`, crypto.randomUUID(), 4), body: { decision: "approved", expectedTermsPolicyVersion: partnerFinancialTermsPolicy.policyVersion } });
if (correctionRoleBeforeDisable.status !== 200 || correctionRoleDisable.status !== 204 || correctionRoleAfterDisable.status !== 200 || correctionRoleEnable.status !== 204 || approvedAfterReenable.status !== 200 || approvedAfterReenable.body?.case?.state !== "approved" || approvedAfterReenable.body?.case?.financialProfileState !== "ACTIVE" || approvedAfterReenable.body?.case?.commissionRateBps !== 1500 || approvedAfterReenable.body?.case?.settlementPeriod !== "MONTHLY" || typeof approvedAfterReenable.body?.case?.financialProfileId !== "string" || approvedAfterReenable.body?.case?.firstStoreLatitude !== correctedStoreOrigin.firstStoreLatitude || approvedAfterReenable.body?.case?.firstStoreLongitude !== correctedStoreOrigin.firstStoreLongitude || approvedAfterReenable.body?.case?.store?.deliveryOrigin?.latitude !== correctedStoreOrigin.firstStoreLatitude || approvedAfterReenable.body?.case?.store?.deliveryOrigin?.longitude !== correctedStoreOrigin.firstStoreLongitude) fail("Partner re-enable did not honor the submitted joining lifecycle, financial terms, or corrected store origin", JSON.stringify({ correctionRoleBeforeDisable, correctionRoleDisable, correctionRoleAfterDisable, correctionRoleEnable, approvedAfterReenable }));
storeIDs.add(String(approvedAfterReenable.body.case.store.id));
const fieldCorrectionPhone = `+96777${crypto.randomInt(1_000_000, 9_999_999)}`;
const fieldCorrectionCreated = await request(dshBase, "POST", "/dsh/field/joining-cases", { token: secondFieldAccessToken, headers: { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": `field-correction-${suffix}` }, body: { contactPhoneE164: fieldCorrectionPhone, businessName: "Field correction business", firstStoreName: "Field correction store", serviceCityId: cityA, firstStoreVerticalId: verticalID, ...firstStoreOrigin } });
const fieldCorrectionCaseID = String(fieldCorrectionCreated.body?.case?.id || "");
if (fieldCorrectionCreated.status !== 201 || fieldCorrectionCreated.body?.case?.origin !== "field" || fieldCorrectionCreated.body?.case?.state !== "draft") fail("Field correction fixture creation did not preserve provenance", JSON.stringify(fieldCorrectionCreated));
caseIDs.add(fieldCorrectionCaseID);
const fieldCorrectionSubmitted = await request(dshBase, "POST", `/dsh/field/joining-cases/${fieldCorrectionCaseID}/submit`, { token: secondFieldAccessToken, headers: partnerHeaders(`field-correction-submit-${suffix}`, 1) });
const fieldNeedsCorrection = await request(dshBase, "POST", `/dsh/joining-cases/${fieldCorrectionCaseID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-needs-correction-${suffix}`, crypto.randomUUID(), 2), body: { decision: "needs_correction", correctionReason: "أكمل بيانات ملف الميداني" } });
const fieldCorrectionAsField = await request(dshBase, "POST", `/dsh/joining-cases/${fieldCorrectionCaseID}/correct-and-resubmit`, { token: secondFieldAccessToken, headers: partnerHeaders(`field-correction-as-field-${suffix}`, Number(fieldNeedsCorrection.body?.case?.version)), body: { businessName: "Field correction business fixed", firstStoreName: "Field correction store fixed", serviceCityId: cityA, firstStoreVerticalId: verticalID, ...correctedStoreOrigin } });
const fieldCorrectionReadback = await request(dshBase, "GET", `/dsh/field/joining-cases/${fieldCorrectionCaseID}`, { token: secondFieldAccessToken });
if (fieldCorrectionCreated.status !== 201 || fieldCorrectionSubmitted.status !== 200 || fieldNeedsCorrection.status !== 200 || fieldNeedsCorrection.body?.case?.state !== "needs_correction" || fieldCorrectionAsField.status !== 403 || fieldCorrectionReadback.status !== 200 || fieldCorrectionReadback.body?.case?.state !== "needs_correction" || fieldCorrectionReadback.body?.case?.version !== fieldNeedsCorrection.body?.case?.version || fieldCorrectionReadback.body?.case?.businessName !== fieldCorrectionCreated.body?.case?.businessName) fail("Field writer crossed the bound Partner correction boundary", JSON.stringify({ fieldCorrectionCreated, fieldCorrectionSubmitted, fieldNeedsCorrection, fieldCorrectionAsField, fieldCorrectionReadback }));
const fieldCorrectionPartnerActorID = String(fieldCorrectionSubmitted.body.case.partnerActorId || "");
if (!fieldCorrectionPartnerActorID) fail("Field correction submission did not expose its canonical partner actor", JSON.stringify(fieldCorrectionSubmitted));
actorIDs.add(fieldCorrectionPartnerActorID);
console.log("DSH_JOINING_CASE_VERTICAL=PASS");
console.log("DSH_JOINING_CASE_CORRECTION=PASS");

const runtimeCoffeeName = `Runtime Coffee ${suffix}`;
const productInput = { canonicalName: runtimeCoffeeName, verticalId: verticalID, scope: "SHARED", variantTitle: "عبوة 250 غ", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [childCategoryID], identifierType: "GTIN", identifierValue: `628100${suffix.replaceAll("-", "").slice(-7)}`, imageUri: "https://example.com/runtime-coffee.jpg" };
const productCategoryRead = await request(dshBase, "GET", `/dsh/catalog/categories?verticalId=${encodeURIComponent(verticalID)}`, { token: dshToken });
if (productCategoryRead.status !== 200 || !productCategoryRead.body?.categories?.some((category) => category.id === childCategoryID && category.verticalId === verticalID && category.active)) fail("catalog Product category was not active in its vertical at canonical readback", JSON.stringify({ verticalID, childCategoryID, productCategoryRead }));
const productCategorySQL = sql(`SELECT COALESCE((SELECT vertical_id || ':' || active::text FROM dsh.catalog_categories WHERE id='${sqlLiteral(childCategoryID)}'), 'missing')`);
if (productCategorySQL !== `${verticalID}:true`) fail("catalog Product category differs between canonical API and database readback", JSON.stringify({ verticalID, childCategoryID, productCategorySQL, productCategoryRead }));
const productKey = `product-${suffix}`;
const productCreate = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, productKey), body: productInput });
if (productCreate.status !== 201 || productCreate.body?.product?.version !== 1 || !productCreate.body?.product?.id) fail("catalog Product creation failed", JSON.stringify({ productInput, productCategoryRead, productCategorySQL, productCreate }));
const productID = String(productCreate.body.product.id); productIDs.add(productID);
const productRead = await request(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(runtimeCoffeeName)}&verticalId=${encodeURIComponent(verticalID)}&limit=50`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (productRead.status !== 200 || productRead.body?.products?.length !== 1 || productRead.body.products[0].variants?.length !== 1 || productRead.body.products[0].variants[0].identifiers?.[0]?.value !== productInput.identifierValue || !productRead.body.products[0].media?.some((media) => media.role === "primary" && media.uri === productInput.imageUri)) fail("catalog Product/Variant/media canonical readback failed", JSON.stringify(productRead));
const variantID = String(productRead.body.products[0].variants[0].id);
const attributeRule = await request(dshBase, "PUT", `/dsh/catalog/categories/${childCategoryID}/attribute-rules/${enumAttributeID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `attribute-rule-${suffix}`), body: { required: true, filterable: false, variantAxis: true, expectedVersion: 0, reason: "DSH runtime category attribute rule proof" } });
if (attributeRule.status !== 200 || !attributeRule.body?.rules?.some((item) => item.attributeId === enumAttributeID && item.required && item.variantAxis)) fail("required category Attribute rule failed", JSON.stringify(attributeRule));
console.log("DSH_TYPED_ATTRIBUTES=PASS");
const replacementMedia = { media: [{ uri: "https://example.com/runtime-coffee-updated.jpg", role: "primary", ordinal: 0 }, { uri: "https://example.com/runtime-coffee-gallery.jpg", role: "gallery", ordinal: 1 }] };
const mediaKey = `product-media-${suffix}`;
const productMediaReplaceHeaders = serviceHeaders(actingOperatorID, mediaKey, crypto.randomUUID(), 1);
const productMediaReplace = await request(dshBase, "PUT", `/dsh/catalog/products/${productID}/media`, { token: dshToken, headers: productMediaReplaceHeaders, body: replacementMedia });
const productMediaReplay = await request(dshBase, "PUT", `/dsh/catalog/products/${productID}/media`, { token: dshToken, headers: productMediaReplaceHeaders, body: replacementMedia });
const productMediaStale = await request(dshBase, "PUT", `/dsh/catalog/products/${productID}/media`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `product-media-stale-${suffix}`, crypto.randomUUID(), 1), body: replacementMedia });
const productMediaRead = await request(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(runtimeCoffeeName)}&verticalId=${encodeURIComponent(verticalID)}&limit=50`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const mediaReadback = productMediaRead.body?.products?.[0]?.media;
if (productMediaReplace.status !== 200 || productMediaReplace.body?.product?.version !== 2 || productMediaReplace.body?.product?.media?.length !== 2 || productMediaReplay.status !== 200 || productMediaReplay.body?.idempotentReplay !== true || productMediaReplay.body?.product?.version !== 2 || productMediaStale.status !== 409 || productMediaRead.status !== 200 || productMediaRead.body?.products?.[0]?.id !== productID || productMediaRead.body?.products?.[0]?.version !== 2 || JSON.stringify(mediaReadback) !== JSON.stringify(replacementMedia.media)) fail("catalog product media replacement, idempotency, or version guard failed", JSON.stringify({ productMediaReplace, productMediaReplay, productMediaStale, productMediaRead }));
console.log("DSH_CATALOG_MEDIA_MANAGEMENT=PASS");
const runtimePNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
function mediaUploadForm() {
  const form = new FormData();
  form.set("role", "primary");
  form.set("file", new Blob([runtimePNG], { type: "image/png" }), "runtime-product.png");
  return form;
}
const mediaUploadKey = `product-media-upload-${suffix}`;
const productMediaUpload = await request(dshBase, "POST", `/dsh/catalog/products/${productID}/media/upload`, { token: dshToken, headers: serviceHeaders(actingOperatorID, mediaUploadKey, crypto.randomUUID(), 2), rawBody: mediaUploadForm() });
const uploadedURI = productMediaUpload.body?.product?.media?.find((item) => item.role === "primary")?.uri;
const uploadedImageResponse = uploadedURI ? await fetch(uploadedURI, { headers: { Accept: "image/png" }, signal: AbortSignal.timeout(8_000) }) : null;
const productMediaUploadReplay = await request(dshBase, "POST", `/dsh/catalog/products/${productID}/media/upload`, { token: dshToken, headers: serviceHeaders(actingOperatorID, mediaUploadKey, crypto.randomUUID(), 2), rawBody: mediaUploadForm() });
if (productMediaUpload.status !== 201 || productMediaUpload.body?.product?.version !== 3 || typeof uploadedURI !== "string" || !uploadedURI.includes("/dsh/catalog/media/catalog/products/") || uploadedImageResponse?.status !== 200 || uploadedImageResponse.headers.get("content-type") !== "image/png" || Number((await uploadedImageResponse.arrayBuffer()).byteLength) !== runtimePNG.byteLength || productMediaUploadReplay.status !== 200 || productMediaUploadReplay.body?.idempotentReplay !== true || productMediaUploadReplay.body?.product?.version !== 3) fail("catalog product binary media upload, read proxy, or replay failed", JSON.stringify({ productMediaUpload, productMediaUploadReplay, uploadedURI, uploadedImageResponse: uploadedImageResponse?.status }));
console.log("DSH_CATALOG_MEDIA_UPLOAD=PASS");
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
const storeProductInput = { verticalId: storeLocalVerticalID, scope: "STORE_SCOPED", storeId: storeLocal.storeID, canonicalName: `Store Only ${suffix}`, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", identifierType: "SKU", identifierValue: `STORE-${suffix}`, imageUri: "https://example.com/store-only.jpg" };
const storeProduct = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/products`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-product-${suffix}`), body: storeProductInput });
if (storeProduct.status !== 201 || storeProduct.body?.product?.scope !== "STORE_SCOPED" || storeProduct.body.product.storeId !== storeLocal.storeID || !storeProduct.body.product.media?.some((media) => media.role === "primary" && media.uri === storeProductInput.imageUri)) fail("Store-scoped Product creation did not preserve owner scope or primary media", JSON.stringify(storeProduct));
const storeProductID = String(storeProduct.body.product.id); productIDs.add(storeProductID);
const crossStoreProduct = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/products`, { token: first.accessToken, headers: partnerHeaders(`cross-store-product-${suffix}`), body: storeProductInput });
const storeVariantID = `store-variant-${suffix}`;
const storeVariant = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/variants`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-variant-${suffix}`), body: { id: storeVariantID, title: "عبوة المتجر", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true, identifierType: "SKU", identifierValue: `STORE-VARIANT-${suffix}` } });
const storeLocalOffer = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/offers`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-local-offer-${suffix}`), body: discreteCreateOffer(storeVariantID, 1000) });
if (storeVariant.status !== 201 || storeVariant.body?.variant?.productId !== storeProductID || storeLocalOffer.status !== 201 || storeLocalOffer.body?.offer?.publicationState !== "draft") fail("store-local Product Variant or StoreOffer creation failed", JSON.stringify({ storeVariant, storeLocalOffer }));
const storeLocalOfferID = String(storeLocalOffer.body.offer.offerId); offerIDs.add(storeLocalOfferID);
const storeProductUpdate = await request(dshBase, "PATCH", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-product-update-${suffix}`, 1), body: { verticalId: storeLocalVerticalID, scope: "STORE_SCOPED", canonicalName: `Store Only Updated ${suffix}`, active: true } });
const storeProductStale = await request(dshBase, "PATCH", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-product-stale-${suffix}`, 1), body: { verticalId: storeLocalVerticalID, scope: "STORE_SCOPED", canonicalName: `Store Only Stale ${suffix}`, active: true } });
const storeVariantUpdate = await request(dshBase, "PATCH", `/dsh/stores/${storeLocal.storeID}/variants/${storeVariantID}`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-variant-update-${suffix}`, 1), body: { title: "عبوة المتجر محدثة", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true } });
if (crossStoreProduct.status !== 403 || storeVariant.status !== 201 || storeVariant.body?.variant?.productId !== storeProductID || storeProductUpdate.status !== 200 || storeProductUpdate.body?.product?.version !== 2 || storeProductStale.status !== 409 || storeVariantUpdate.status !== 200 || storeVariantUpdate.body?.variant?.version !== 2) fail("Store-scoped Product/Variant ownership or version boundary failed", JSON.stringify({ crossStoreProduct, storeVariant, storeProductUpdate, storeProductStale, storeVariantUpdate }));
const partnerImageBytes = fs.readFileSync(path.join(root, "tools/dev/fixtures/catalog/local-world-rice.png"));
const partnerMediaUploadForm = () => {
  const form = new FormData();
  form.set("role", "primary");
  form.set("file", new Blob([partnerImageBytes], { type: "image/png" }), "local-world-rice.png");
  return form;
};
const partnerMediaKey = `store-product-media-${suffix}`;
const crossStoreMediaUpload = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/media/upload`, { token: first.accessToken, headers: partnerHeaders(`cross-store-media-${suffix}`, 2), rawBody: partnerMediaUploadForm() });
const partnerMediaUpload = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/media/upload`, { token: storeLocal.accessToken, headers: partnerHeaders(partnerMediaKey, 2), rawBody: partnerMediaUploadForm() });
const partnerUploadedURI = partnerMediaUpload.body?.product?.media?.find((item) => item.role === "primary")?.uri;
const partnerUploadedImageResponse = partnerUploadedURI ? await fetch(partnerUploadedURI, { headers: { Accept: "image/png" }, signal: AbortSignal.timeout(8_000) }) : null;
const partnerMediaReplay = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/media/upload`, { token: storeLocal.accessToken, headers: partnerHeaders(partnerMediaKey, 2), rawBody: partnerMediaUploadForm() });
const partnerMediaStale = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/media/upload`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-product-media-stale-${suffix}`, 2), rawBody: partnerMediaUploadForm() });
const partnerGalleryMediaKey = `store-product-gallery-${suffix}`;
const partnerGalleryMediaUpload = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/media/upload`, { token: storeLocal.accessToken, headers: partnerHeaders(partnerGalleryMediaKey, 3), rawBody: (() => { const form = new FormData(); form.set("role", "gallery"); form.set("file", new Blob([partnerImageBytes], { type: "image/png" }), "local-world-rice-gallery.png"); return form; })() });
const partnerGalleryURI = partnerGalleryMediaUpload.body?.product?.media?.find((item) => item.role === "gallery")?.uri;
const partnerReplaceMedia = await request(dshBase, "PUT", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/media`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-product-gallery-remove-${suffix}`, 4), body: { media: [{ uri: partnerUploadedURI, role: "primary", ordinal: 0 }] } });
const partnerReplaceReplay = await request(dshBase, "PUT", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/media`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-product-gallery-remove-${suffix}`, 4), body: { media: [{ uri: partnerUploadedURI, role: "primary", ordinal: 0 }] } });
const crossStoreMediaReplace = await request(dshBase, "PUT", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/media`, { token: first.accessToken, headers: partnerHeaders(`cross-store-media-replace-${suffix}`, 5), body: { media: [{ uri: partnerUploadedURI, role: "primary", ordinal: 0 }] } });
const partnerReplaceStale = await request(dshBase, "PUT", `/dsh/stores/${storeLocal.storeID}/products/${storeProductID}/media`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-product-media-replace-stale-${suffix}`, 4), body: { media: [{ uri: partnerUploadedURI, role: "primary", ordinal: 0 }] } });
if (crossStoreMediaUpload.status !== 403 || partnerMediaUpload.status !== 201 || partnerMediaUpload.body?.product?.version !== 3 || typeof partnerUploadedURI !== "string" || !partnerUploadedURI.includes("/dsh/catalog/media/catalog/products/") || partnerUploadedImageResponse?.status !== 200 || partnerUploadedImageResponse.headers.get("content-type") !== "image/png" || !crypto.timingSafeEqual(crypto.createHash("sha256").update(Buffer.from(await partnerUploadedImageResponse.arrayBuffer())).digest(), crypto.createHash("sha256").update(partnerImageBytes).digest()) || partnerMediaReplay.status !== 200 || partnerMediaReplay.body?.idempotentReplay !== true || partnerMediaReplay.body?.product?.version !== 3 || partnerMediaStale.status !== 409 || partnerMediaStale.body?.error?.code !== "VERSION_CONFLICT" || partnerGalleryMediaUpload.status !== 201 || partnerGalleryMediaUpload.body?.product?.version !== 4 || typeof partnerGalleryURI !== "string" || partnerGalleryMediaUpload.body?.product?.media?.length !== 2 || partnerGalleryMediaUpload.body?.product?.media?.[1]?.role !== "gallery" || partnerReplaceMedia.status !== 200 || partnerReplaceMedia.body?.product?.version !== 5 || partnerReplaceMedia.body?.product?.media?.length !== 1 || partnerReplaceReplay.status !== 200 || partnerReplaceReplay.body?.idempotentReplay !== true || partnerReplaceReplay.body?.product?.version !== 5 || crossStoreMediaReplace.status !== 403 || partnerReplaceStale.status !== 409 || partnerReplaceStale.body?.error?.code !== "VERSION_CONFLICT") fail("partner store-scoped product media gallery, ownership, replay, replacement, or version guard failed", JSON.stringify({ crossStoreMediaUpload, partnerMediaUpload, partnerMediaReplay, partnerMediaStale, partnerGalleryMediaUpload, partnerReplaceMedia, partnerReplaceReplay, crossStoreMediaReplace, partnerReplaceStale, partnerUploadedURI, partnerGalleryURI, partnerUploadedImageResponse: partnerUploadedImageResponse?.status }));
console.log("DSH_PARTNER_PRODUCT_MEDIA_UPLOAD=PASS");
const productReplay = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, productKey), body: productInput });
if (productReplay.status !== 200 || productReplay.body?.idempotentReplay !== true || productReplay.body.product.id !== productID) fail("catalog Product replay failed", JSON.stringify(productReplay));
const duplicate = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, `product-duplicate-${suffix}`), body: { ...productInput, canonicalName: "Runtime Duplicate", variantAttributeValues: [{ attributeId: enumAttributeID, valueKind: "ENUM", enumValue: "Dark" }] } });
if (duplicate.status !== 409 || duplicate.body?.error?.code !== "DUPLICATE_IDENTIFIER") fail("duplicate Variant identifier was accepted", JSON.stringify(duplicate));
const partnerWrite = await request(dshBase, "POST", "/dsh/catalog/products", { token: first.accessToken, headers: partnerHeaders(`partner-product-${suffix}`), body: productInput });
if (partnerWrite.status !== 401) fail("partner reached the canonical Product writer", JSON.stringify(partnerWrite));
const partnerLookup = await request(dshBase, "GET", `/dsh/catalog/products?verticalId=${encodeURIComponent(verticalID)}&limit=50`, { token: first.accessToken });
if (partnerLookup.status !== 200 || !partnerLookup.body?.products?.some((item) => item.id === productID && item.variants?.some((variant) => variant.id === variantID))) fail("partner Product/Variant lookup failed", JSON.stringify(partnerLookup));
console.log("DSH_PRODUCT_VARIANT=PASS");

const variableProductInput = { canonicalName: `Variable Coffee ${suffix}`, verticalId: verticalID, scope: "SHARED", variantTitle: "وزن متغير", measurementKind: "VARIABLE_MEASURE", baseUnit: "GRAM", categoryIds: [childCategoryID], variantAttributeValues: [{ attributeId: enumAttributeID, valueKind: "ENUM", enumValue: "Dark" }], identifierType: "SKU", identifierValue: `VARIABLE-${suffix}`, imageUri: "https://example.com/variable-coffee.jpg" };
const variableProduct = await request(dshBase, "POST", "/dsh/catalog/products", { token: dshToken, headers: serviceHeaders(actingOperatorID, `variable-product-${suffix}`), body: variableProductInput });
if (variableProduct.status !== 201 || variableProduct.body?.product?.variants?.[0]?.measurementKind !== "VARIABLE_MEASURE") fail("VARIABLE_MEASURE Product creation failed", JSON.stringify(variableProduct));
const variableProductID = String(variableProduct.body.product.id); productIDs.add(variableProductID);
const variableVariantID = String(variableProduct.body.product.variants[0].id);
const variableOffer = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: first.accessToken, headers: partnerHeaders(`variable-offer-${suffix}`), body: variableCreateOffer(variableVariantID, 25) });
if (variableOffer.status !== 201 || variableOffer.body?.offer?.publicationState !== "draft") fail("VARIABLE_MEASURE StoreOffer creation failed", JSON.stringify(variableOffer));
const variableOfferID = String(variableOffer.body.offer.offerId); offerIDs.add(variableOfferID);
const variablePublish = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${variableOfferID}`, { token: first.accessToken, headers: partnerHeaders(`variable-publish-${suffix}`, 1), body: { priceMinor: 25, availability: true, publicationState: "published", quantityPolicy: "VARIABLE_MEASURE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 10000, quantityStepBaseUnits: 1, pricingBasis: "PER_MEASURE", pricingUnitBaseUnits: 1 } });
const variablePublic = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}`);
if (variablePublish.status !== 409 || variablePublish.body?.error?.code !== "PRODUCT_NOT_ELIGIBLE" || variablePublic.status !== 404) fail("VARIABLE_MEASURE remained publishable or customer-visible without final-quantity lifecycle", JSON.stringify({ variablePublish, variablePublic }));
console.log("DSH_VARIABLE_MEASURE_FAIL_CLOSED=PASS");

const offerKey = `offer-a-${suffix}`;
const offerCreate = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/offers`, { token: first.accessToken, headers: partnerHeaders(offerKey), body: discreteCreateOffer(variantID, 1250) });
if (offerCreate.status !== 201 || offerCreate.body?.offer?.publicationState !== "draft" || offerCreate.body?.offer?.variantId !== variantID) fail("StoreOffer creation failed", JSON.stringify(offerCreate));
const offerAID = String(offerCreate.body.offer.offerId); offerIDs.add(offerAID);
const missingRequiredAttributePublish = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`offer-missing-attribute-${suffix}`, 1), body: discreteOffer(1250, "published") });
const invalidEnumValue = await request(dshBase, "PUT", `/dsh/catalog/variants/${variantID}/attributes/${enumAttributeID}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID }, body: { valueKind: "ENUM", enumValue: "Light" } });
const validEnumValue = await request(dshBase, "PUT", `/dsh/catalog/variants/${variantID}/attributes/${enumAttributeID}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID }, body: { valueKind: "ENUM", enumValue: "Dark" } });
const variantAttributeRead = await collectCursorPages(dshBase, `/dsh/catalog/products?q=${encodeURIComponent(runtimeCoffeeName)}&verticalId=${encodeURIComponent(verticalID)}&limit=1`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } }, "products");
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
const sectionCreate = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/sections`, { token: storeLocal.accessToken, headers: partnerHeaders(`section-${suffix}`), body: { nameAr: `العروض ${suffix}`, nameEn: `Offers ${suffix}`, ordinal: 0, active: true } });
if (sectionCreate.status !== 201 || !sectionCreate.body?.section?.id) fail("Storefront section creation failed", JSON.stringify(sectionCreate));
const sectionID = String(sectionCreate.body.section.id); sectionIDs.add(sectionID);
const sectionAttach = await request(dshBase, "PUT", `/dsh/stores/${storeLocal.storeID}/sections/${sectionID}/offers/${storeLocalOfferID}`, { token: storeLocal.accessToken, headers: partnerHeaders(`section-attach-${suffix}`), body: { ordinal: 0 } });
if (sectionAttach.status !== 200 || !sectionAttach.body?.section?.offerIds?.includes(storeLocalOfferID)) fail("Storefront section offer attachment failed", JSON.stringify(sectionAttach));
const proposalID = `proposal-${suffix}`;
const proposalBody = { id: proposalID, verticalId: verticalID, categoryId: childCategoryID, proposedName: `Runtime Proposal ${suffix}`, proposedBrand: "Samrim", proposedVariantTitle: "الافتراضي", proposedMeasurementKind: "DISCRETE", proposedBaseUnit: "COUNT", proposedIdentifierType: "SKU", proposedIdentifierValue: `PROPOSAL-${suffix}`, proposedImageUri: "https://example.com/proposal.jpg" };
const proposalCreate = await request(dshBase, "POST", "/dsh/catalog/product-proposals", { token: first.accessToken, headers: partnerHeaders(`proposal-create-${suffix}`), body: proposalBody });
if (proposalCreate.status !== 201 || proposalCreate.body?.proposal?.state !== "draft" || proposalCreate.body.proposal.version !== 1 || proposalCreate.body.proposal.proposedImageUri !== proposalBody.proposedImageUri) fail("Product proposal creation failed", JSON.stringify(proposalCreate));
proposalIDs.add(proposalID);
const proposalOwnList = await collectCursorPages(dshBase, "/dsh/catalog/product-proposals?limit=1", { token: first.accessToken }, "proposals");
const proposalSubmit = await request(dshBase, "POST", `/dsh/catalog/product-proposals/${proposalID}/submit`, { token: first.accessToken, headers: partnerHeaders(`proposal-submit-${suffix}`, 1) });
const proposalCorrection = await request(dshBase, "POST", `/dsh/catalog/product-proposals/${proposalID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `proposal-correction-${suffix}`, crypto.randomUUID(), 2), body: { state: "needs_correction", reason: "صحح البيانات" } });
const proposalUpdateBody = { verticalId: proposalBody.verticalId, categoryId: proposalBody.categoryId, proposedName: `Runtime Proposal Corrected ${suffix}`, proposedBrand: proposalBody.proposedBrand, proposedVariantTitle: proposalBody.proposedVariantTitle, proposedMeasurementKind: proposalBody.proposedMeasurementKind, proposedBaseUnit: proposalBody.proposedBaseUnit, variantAttributeValues: [{ attributeId: enumAttributeID, valueKind: "ENUM", enumValue: "Dark" }], proposedIdentifierType: proposalBody.proposedIdentifierType, proposedIdentifierValue: proposalBody.proposedIdentifierValue, proposedImageUri: proposalBody.proposedImageUri };
const proposalUpdate = await request(dshBase, "PATCH", `/dsh/catalog/product-proposals/${proposalID}`, { token: first.accessToken, headers: partnerHeaders(`proposal-update-${suffix}`, 3), body: proposalUpdateBody });
const proposalResubmit = await request(dshBase, "POST", `/dsh/catalog/product-proposals/${proposalID}/submit`, { token: first.accessToken, headers: partnerHeaders(`proposal-resubmit-${suffix}`, 4) });
const proposalApprove = await request(dshBase, "POST", `/dsh/catalog/product-proposals/${proposalID}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `proposal-approve-${suffix}`, crypto.randomUUID(), 5), body: { state: "approved", reason: "" } });
const proposalProductID = `proposal_product_${proposalID}`;
productIDs.add(proposalProductID);
const proposalProductRead = await collectCursorPages(dshBase, `/dsh/catalog/products?q=${encodeURIComponent(proposalUpdateBody.proposedName)}&verticalId=${encodeURIComponent(verticalID)}&limit=1`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } }, "products");
const proposalReviewQueue = await collectCursorPages(dshBase, "/dsh/catalog/product-proposals/review-queue?state=approved&limit=1", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } }, "proposals");
if (proposalOwnList.status !== 200 || !proposalOwnList.body?.proposals?.some((item) => item.id === proposalID) || proposalSubmit.status !== 200 || proposalSubmit.body?.proposal?.state !== "submitted" || proposalCorrection.status !== 200 || proposalCorrection.body?.proposal?.state !== "needs_correction" || proposalUpdate.status !== 200 || proposalUpdate.body?.proposal?.state !== "draft" || proposalUpdate.body.proposal.version !== 4 || proposalUpdate.body.proposal.proposedImageUri !== proposalUpdateBody.proposedImageUri || proposalResubmit.status !== 200 || proposalResubmit.body?.proposal?.state !== "submitted" || proposalApprove.status !== 200 || proposalApprove.body?.proposal?.state !== "approved" || proposalApprove.body.proposal.version !== 6 || proposalProductRead.status !== 200 || !proposalProductRead.body?.products?.some((item) => item.id === proposalProductID && item.canonicalName === proposalUpdateBody.proposedName && item.media?.some((media) => media.role === "primary" && media.uri === proposalUpdateBody.proposedImageUri)) || proposalReviewQueue.status !== 200 || !proposalReviewQueue.body?.proposals?.some((item) => item.id === proposalID && item.state === "approved")) fail("Product proposal lifecycle and canonical adoption failed", JSON.stringify({ proposalOwnList, proposalSubmit, proposalCorrection, proposalUpdate, proposalResubmit, proposalApprove, proposalProductRead, proposalReviewQueue }));
const importRunID = `import-${suffix}`;
const importedName = `Runtime Imported ${suffix}`;
const importSourceSha256 = crypto.createHash("sha256").update(importRunID).digest("hex");
const importVariantAttributeValues = [{ attributeId: enumAttributeID, valueKind: "ENUM", enumValue: "Dark" }];
const importRows = [
  { rowNumber: 1, stableKey: `import-ready-${suffix}`, verticalId: verticalID, scope: "SHARED", canonicalName: importedName, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [childCategoryID], variantAttributeValues: importVariantAttributeValues, identifierType: "SKU", identifierValue: `IMPORTED-${suffix}` },
  { rowNumber: 2, stableKey: `import-conflict-${suffix}`, verticalId: verticalID, scope: "SHARED", canonicalName: `Conflicting ${suffix}`, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [childCategoryID], variantAttributeValues: importVariantAttributeValues, identifierType: "GTIN", identifierValue: productInput.identifierValue },
  { rowNumber: 3, stableKey: `import-ready-${suffix}`, verticalId: verticalID, scope: "SHARED", canonicalName: `Duplicate ${suffix}`, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [childCategoryID], variantAttributeValues: importVariantAttributeValues, identifierType: "SKU", identifierValue: `IMPORTED-DUP-${suffix}` },
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
const retryCategoryCreate = await request(dshBase, "POST", "/dsh/catalog/categories", { token: dshToken, headers: serviceHeaders(actingOperatorID, `import-retry-category-${suffix}`), body: { id: retryCategoryID, verticalId: verticalID, nameAr: `استرداد ${suffix}`, nameEn: `Recovery ${suffix}`, active: true, reason: "DSH runtime import recovery proof" } });
const retryCommitRecovered = await request(dshBase, "POST", `/dsh/catalog/imports/${retryRunID}/commit`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `import-retry-commit-${suffix}`), body: undefined });
const retryItem = retryCommitRecovered.body?.items?.find((item) => item.rowNumber === 1);
if (retryItem?.productId) productIDs.add(String(retryItem.productId));
if (retryPreview.status !== 201 || retryCommitFailed.status !== 200 || retryCommitFailed.body?.run?.state !== "rejected" || retryCommitFailed.body?.items?.[0]?.classification !== "FAILED" || retryCategoryCreate.status !== 201 || retryCommitRecovered.status !== 200 || retryCommitRecovered.body?.run?.state !== "committed" || retryItem?.classification !== "IMPORTED") fail("catalog import rejected-run recovery retry failed", JSON.stringify({ retryPreview, retryCommitFailed, retryCategoryCreate, retryCommitRecovered }));
console.log("DSH_CATALOG_IMPORT=PASS");
console.log("DSH_STORE_OFFER=PASS");
console.log("DSH_PROPOSAL_LIFECYCLE=PASS");

const defaultFieldCommissionPolicy = await request(dshBase, "POST", "/dsh/operator/field-commission-policies", { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-policy-default-${suffix}`), body: { scopeType: "DEFAULT", scopeId: "", rewardMinor: 5000, roundingUnitMinor: 50, expectedVersion: 0, reason: "DSH runtime default Field commission proof" } });
const verticalFieldCommissionPolicy = await request(dshBase, "POST", "/dsh/operator/field-commission-policies", { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-policy-vertical-${suffix}`), body: { scopeType: "VERTICAL", scopeId: verticalID, rewardMinor: 7500, roundingUnitMinor: 50, expectedVersion: 0, reason: "DSH runtime vertical Field commission proof" } });
if (defaultFieldCommissionPolicy.status !== 201 || defaultFieldCommissionPolicy.body?.policy?.scopeType !== "DEFAULT" || defaultFieldCommissionPolicy.body?.policy?.rewardMinor !== 5000 || verticalFieldCommissionPolicy.status !== 201 || verticalFieldCommissionPolicy.body?.policy?.scopeType !== "VERTICAL" || verticalFieldCommissionPolicy.body?.policy?.scopeId !== verticalID || verticalFieldCommissionPolicy.body?.policy?.rewardMinor !== 7500 || verticalFieldCommissionPolicy.body?.policy?.roundingUnitMinor !== 50) fail("Field commission policy activation did not preserve Finance-owned scope and rounding", JSON.stringify({ defaultFieldCommissionPolicy, verticalFieldCommissionPolicy }));
fieldCommissionPolicyIDs.add(String(defaultFieldCommissionPolicy.body.policy.id));
fieldCommissionPolicyIDs.add(String(verticalFieldCommissionPolicy.body.policy.id));
const verticalFieldCommissionPolicyRead = await request(dshBase, "GET", `/dsh/operator/field-commission-policies/${encodeURIComponent(verticalFieldCommissionPolicy.body.policy.id)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (verticalFieldCommissionPolicyRead.status !== 200 || verticalFieldCommissionPolicyRead.body?.policy?.id !== verticalFieldCommissionPolicy.body.policy.id || verticalFieldCommissionPolicyRead.body.policy?.state !== "ACTIVE") fail("Field commission policy readback did not return the active vertical policy", JSON.stringify({ verticalFieldCommissionPolicy, verticalFieldCommissionPolicyRead }));
console.log("DSH_FIELD_COMMISSION_POLICY=PASS");
const publishA = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-a-publish-${suffix}`, crypto.randomUUID(), 1), body: { state: "published" } });
const publishB = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-b-publish-${suffix}`, crypto.randomUUID(), 1), body: { state: "published" } });
if (publishA.status !== 200 || publishB.status !== 200) {
  const publicationReadback = {
    storeA: sql(`SELECT publication_state || ':' || version::text FROM dsh.stores WHERE id='${sqlLiteral(first.storeID)}'`),
    storeB: sql(`SELECT publication_state || ':' || version::text FROM dsh.stores WHERE id='${sqlLiteral(second.storeID)}'`),
    publicationRecords: sql(`SELECT (SELECT count(*) FROM dsh.store_publication_idempotency WHERE idempotency_key='store-a-publish-${sqlLiteral(suffix)}') || ':' || (SELECT count(*) FROM dsh.store_publication_audit WHERE idempotency_key='store-a-publish-${sqlLiteral(suffix)}') || '|' || (SELECT count(*) FROM dsh.store_publication_idempotency WHERE idempotency_key='store-b-publish-${sqlLiteral(suffix)}') || ':' || (SELECT count(*) FROM dsh.store_publication_audit WHERE idempotency_key='store-b-publish-${sqlLiteral(suffix)}')`),
    fieldCommissionOutbox: sql(`SELECT count(*) FROM dsh.field_commission_publication_outbox WHERE store_id IN ('${sqlLiteral(first.storeID)}','${sqlLiteral(second.storeID)}')`),
  };
  fail("Store publication failed after catalog readiness", JSON.stringify({ publishA, publishB, publicationReadback }));
}
const secondPickupModesKey = "store-b-fulfillment-modes-" + suffix;
const secondPickupModesPath = "/dsh/stores/" + encodeURIComponent(second.storeID) + "/fulfillment-modes";
const secondPickupModesBody = { fulfillmentModes: ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"] };
const secondPickupModesHeaders = serviceHeaders(actingOperatorID, secondPickupModesKey, crypto.randomUUID(), publishB.body.store.version);
const secondPickupModes = await request(dshBase, "POST", secondPickupModesPath, { token: dshToken, headers: secondPickupModesHeaders, body: secondPickupModesBody });
const secondPickupModesReplay = await request(dshBase, "POST", secondPickupModesPath, { token: dshToken, headers: secondPickupModesHeaders, body: secondPickupModesBody });
if (secondPickupModes.status !== 200 || secondPickupModes.body?.storeId !== second.storeID || secondPickupModes.body?.fulfillmentModes?.join(",") !== "BTHWANI_CAPTAIN,CUSTOMER_PICKUP" || secondPickupModes.body?.version !== publishB.body.store.version + 1 || secondPickupModesReplay.status !== 200 || secondPickupModesReplay.body?.idempotentReplay !== true || secondPickupModesReplay.body?.version !== secondPickupModes.body.version) fail("second store fulfillment modes did not enable pickup with a stable idempotent version", JSON.stringify({ secondPickupModes, secondPickupModesReplay, publishB }));
const fieldSummaryDeadline = Date.now() + 95_000;
let fieldFinancialSummary = null;
while (Date.now() < fieldSummaryDeadline) {
  const response = await request(dshBase, "GET", `/dsh/operator/fields/${encodeURIComponent(fieldActorID)}/financial-summary`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
  if (response.status === 200 && response.body?.summary?.earnedMinor === 7500 && response.body?.summary?.commissionMinor === 7500 && response.body?.summary?.storeCount === 1) {
    fieldFinancialSummary = response;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
const fieldEarningCount = sql(`SELECT count(*) FROM wlt.field_commission_earnings WHERE field_actor_id='${sqlLiteral(fieldActorID)}' AND store_id='${sqlLiteral(second.storeID)}'`);
if (!fieldFinancialSummary || fieldEarningCount !== "1") fail("Field commission was not posted exactly once after customer-visible publication", JSON.stringify({ fieldFinancialSummary, fieldEarningCount, publishB }));
const fieldHidden = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-b-hide-${suffix}`, crypto.randomUUID(), secondPickupModes.body.version), body: { state: "hidden" } });
const fieldPublicAfterHide = await request(dshBase, "GET", `/dsh/public/stores/${second.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}`);
const fieldRepublished = await request(dshBase, "POST", `/dsh/stores/${second.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-b-republish-${suffix}`, crypto.randomUUID(), fieldHidden.body.store.version), body: { state: "published" } });
const fieldSummaryAfterRepublish = await request(dshBase, "GET", `/dsh/operator/fields/${encodeURIComponent(fieldActorID)}/financial-summary`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const fieldEarningCountAfterRepublish = sql(`SELECT count(*) FROM wlt.field_commission_earnings WHERE field_actor_id='${sqlLiteral(fieldActorID)}' AND store_id='${sqlLiteral(second.storeID)}'`);
if (fieldHidden.status !== 200 || fieldPublicAfterHide.status !== 404 || fieldRepublished.status !== 200 || fieldSummaryAfterRepublish.status !== 200 || fieldSummaryAfterRepublish.body?.summary?.earnedMinor !== 7500 || fieldSummaryAfterRepublish.body?.summary?.storeCount !== 1 || fieldEarningCountAfterRepublish !== "1") fail("Field commission was reversed or duplicated across hide and republish", JSON.stringify({ fieldHidden, fieldPublicAfterHide, fieldRepublished, fieldSummaryAfterRepublish, fieldEarningCountAfterRepublish }));
console.log("DSH_FIELD_COMMISSION_PUBLICATION=PASS");
const publicCatalog = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}&categoryId=${encodeURIComponent(childCategoryID)}&q=${encodeURIComponent(productInput.canonicalName)}`);
const publicWrongCategory = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}&categoryId=${encodeURIComponent(categoryID)}`);
const publicWrongCity = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityB)}`);
const productMediaCleanup = await request(dshBase, "PUT", `/dsh/catalog/products/${productID}/media`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `product-media-upload-cleanup-${suffix}`, crypto.randomUUID(), 3), body: { media: [] } });
const uploadedImageAfterCleanup = uploadedURI ? await fetch(uploadedURI, { headers: { Accept: "image/png" }, signal: AbortSignal.timeout(8_000) }) : null;
const uploadedAssetState = sql(`SELECT state FROM dsh.catalog_media_assets WHERE product_id='${sqlLiteral(productID)}' ORDER BY created_at DESC LIMIT 1`);
if (publicCatalog.status !== 200 || publicCatalog.body?.offers?.length !== 1 || publicCatalog.body.offers[0].offerId !== offerAID || publicCatalog.body.offers[0].productName !== productInput.canonicalName || !publicCatalog.body.offers[0].media?.some((media) => media.role === "primary" && media.uri === uploadedURI) || !publicCatalog.body.offers[0].media?.some((media) => media.role === "gallery" && media.uri === "https://example.com/runtime-coffee-gallery.jpg") || publicWrongCategory.status !== 200 || publicWrongCategory.body?.offers?.length !== 0 || publicWrongCity.status !== 404 || productMediaCleanup.status !== 200 || productMediaCleanup.body?.product?.version !== 4 || productMediaCleanup.body?.product?.media?.length !== 0 || uploadedImageAfterCleanup?.status !== 404 || uploadedAssetState !== "deleted") fail("customer-visible catalog evaluator, media, city/category scope, or media cleanup failed", JSON.stringify({ publicCatalog, publicWrongCategory, publicWrongCity, productMediaCleanup, uploadedURI, uploadedAssetState, uploadedImageAfterCleanup: uploadedImageAfterCleanup?.status }));
const publicStores = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(cityA)}`);
if (publicStores.status !== 200 || !publicStores.body?.stores?.some((store) => store.id === first.storeID) || publicStores.body.stores.find((store) => store.id === first.storeID)?.partnerActorId) fail("public Store projection leaked or omitted the eligible store", JSON.stringify(publicStores));
console.log("DSH_CUSTOMER_VISIBLE_CATALOG=PASS");

const client = await createClientSession(clientPhone);
const favoriteEmpty = await request(dshBase, "GET", "/dsh/client/favorite-stores", { token: client.accessToken });
const favoriteAddKey = `favorite-add-${suffix}`;
const favoriteAdd = await request(dshBase, "PUT", `/dsh/client/favorite-stores/${encodeURIComponent(first.storeID)}`, { token: client.accessToken, headers: partnerHeaders(favoriteAddKey), body: undefined });
const favoriteAddReplay = await request(dshBase, "PUT", `/dsh/client/favorite-stores/${encodeURIComponent(first.storeID)}`, { token: client.accessToken, headers: partnerHeaders(favoriteAddKey), body: undefined });
const favoriteRead = await request(dshBase, "GET", "/dsh/client/favorite-stores", { token: client.accessToken });
const favoriteRemoveKey = `favorite-remove-${suffix}`;
const favoriteRemove = await request(dshBase, "DELETE", `/dsh/client/favorite-stores/${encodeURIComponent(first.storeID)}`, { token: client.accessToken, headers: partnerHeaders(favoriteRemoveKey), body: undefined });
const favoriteRemoveReplay = await request(dshBase, "DELETE", `/dsh/client/favorite-stores/${encodeURIComponent(first.storeID)}`, { token: client.accessToken, headers: partnerHeaders(favoriteRemoveKey), body: undefined });
const favoriteAfterRemove = await request(dshBase, "GET", "/dsh/client/favorite-stores", { token: client.accessToken });
const favoriteWrongRole = await request(dshBase, "GET", "/dsh/client/favorite-stores", { token: first.accessToken });
if (
  favoriteEmpty.status !== 200 || favoriteEmpty.body?.storeIds?.length !== 0 ||
  favoriteAdd.status !== 200 || favoriteAdd.body?.storeId !== first.storeID || favoriteAdd.body?.isFavorite !== true || favoriteAdd.body?.idempotentReplay === true ||
  favoriteAddReplay.status !== 200 || favoriteAddReplay.body?.idempotentReplay !== true || favoriteAddReplay.body?.isFavorite !== true ||
  favoriteRead.status !== 200 || !favoriteRead.body?.storeIds?.includes(first.storeID) ||
  favoriteRemove.status !== 200 || favoriteRemove.body?.isFavorite !== false || favoriteRemove.body?.idempotentReplay === true ||
  favoriteRemoveReplay.status !== 200 || favoriteRemoveReplay.body?.idempotentReplay !== true || favoriteRemoveReplay.body?.isFavorite !== false ||
  favoriteAfterRemove.status !== 200 || favoriteAfterRemove.body?.storeIds?.includes(first.storeID) ||
  favoriteWrongRole.status !== 403
) fail("client favorite store lifecycle/idempotency/role scope failed", JSON.stringify({ favoriteEmpty, favoriteAdd, favoriteAddReplay, favoriteRead, favoriteRemove, favoriteRemoveReplay, favoriteAfterRemove, favoriteWrongRole }));
console.log("DSH_CLIENT_FAVORITES=PASS");
const addressA = await request(dshBase, "POST", "/dsh/addresses", { token: client.accessToken, headers: partnerHeaders(`address-a-${suffix}`), body: { addressText: `عنوان أ ${suffix}`, latitude: 15.3694457, longitude: 44.1910064, serviceCityId: cityA } });
const addressB = await request(dshBase, "POST", "/dsh/addresses", { token: client.accessToken, headers: partnerHeaders(`address-b-${suffix}`), body: { addressText: `عنوان ب ${suffix}`, latitude: 15.3694458, longitude: 44.1910065, serviceCityId: cityB } });
if (addressA.status !== 201 || addressB.status !== 201) fail("serviceability address fixtures failed", JSON.stringify({ addressA, addressB }));
const addressAID = String(addressA.body.address.id), addressBID = String(addressB.body.address.id); addressIDs.add(addressAID); addressIDs.add(addressBID);
const storeOrigin = await request(dshBase, "GET", `/dsh/stores/${encodeURIComponent(first.storeID)}/delivery-origin`, { token: first.accessToken });
if (storeOrigin.status !== 200 || storeOrigin.body?.origin?.latitude !== firstStoreOrigin.firstStoreLatitude || storeOrigin.body?.origin?.longitude !== firstStoreOrigin.firstStoreLongitude) fail("Store delivery origin canonical readback failed", JSON.stringify(storeOrigin));
const serviceable = await request(dshBase, "POST", "/dsh/serviceability", { token: client.accessToken, body: { storeId: first.storeID, addressId: addressAID } });
const unserviceable = await request(dshBase, "POST", "/dsh/serviceability", { token: client.accessToken, body: { storeId: second.storeID, addressId: addressAID } });
if (serviceable.status !== 200 || serviceable.body?.status !== "SERVICEABLE" || unserviceable.status !== 200 || unserviceable.body?.status !== "UNSERVICEABLE") fail("city serviceability positive/negative proof failed", JSON.stringify({ serviceable, unserviceable }));
const wrongRole = await request(dshBase, "POST", "/dsh/serviceability", { token: first.accessToken, body: { storeId: first.storeID, addressId: addressAID } });
if (wrongRole.status !== 403) fail("serviceability accepted partner role", JSON.stringify(wrongRole));
console.log("DSH_SERVICEABILITY=PASS");

const renameBody = { canonicalName: "Runtime Coffee Renamed", verticalId: verticalID, scope: "SHARED", active: true };
const renamed = await request(dshBase, "PATCH", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `rename-${suffix}`, crypto.randomUUID(), 4), body: renameBody });
if (renamed.status !== 200 || renamed.body?.product?.version !== 5) fail("catalog Product versioned update failed", JSON.stringify(renamed));
const renamedCatalog = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}`);
if (renamedCatalog.status !== 200 || renamedCatalog.body?.offers?.[0]?.productName !== renameBody.canonicalName) fail("StoreOffer readback retained stale Product identity", JSON.stringify(renamedCatalog));
const disabled = await request(dshBase, "PATCH", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `disable-${suffix}`, crypto.randomUUID(), 5), body: { ...renameBody, active: false } });
if (disabled.status !== 200 || disabled.body?.product?.active !== false || disabled.body.product.version !== 6) fail("catalog Product disable failed", JSON.stringify(disabled));
const disabledPublic = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}`);
if (disabledPublic.status !== 404 || disabledPublic.body?.error?.code !== "NOT_FOUND") fail("disabled Product remained customer-visible", JSON.stringify(disabledPublic));
const disabledOfferPublish = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`disabled-offer-${suffix}`, 2), body: discreteOffer(1250, "published") });
if (disabledOfferPublish.status !== 409 || disabledOfferPublish.body?.error?.code !== "PRODUCT_NOT_ELIGIBLE") fail("disabled Product could be published", JSON.stringify(disabledOfferPublish));
const enabled = await request(dshBase, "PATCH", `/dsh/catalog/products/${productID}`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `enable-${suffix}`, crypto.randomUUID(), 6), body: renameBody });
if (enabled.status !== 200 || enabled.body?.product?.active !== true || enabled.body.product.version !== 7) fail("catalog Product re-enable failed", JSON.stringify(enabled));
const changedPrice = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`price-${suffix}`, 2), body: discreteOffer(2100, "published") });
if (changedPrice.status !== 200 || changedPrice.body?.offer?.priceMinor !== 2100 || changedPrice.body.offer.version !== 3) fail("StoreOffer price update failed", JSON.stringify(changedPrice));
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
const modifierGroupCreate = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/modifier-groups`, { token: storeLocal.accessToken, headers: partnerHeaders(`modifier-group-${suffix}`), body: { nameAr: `إضافات ${suffix}`, required: true, minSelections: 1, maxSelections: 1, active: true } });
if (modifierGroupCreate.status !== 201 || !modifierGroupCreate.body?.group?.id) fail("modifier group creation failed", JSON.stringify(modifierGroupCreate));
const modifierGroupID = String(modifierGroupCreate.body.group.id); modifierGroupIDs.add(modifierGroupID);
const modifierOptionCreate = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/modifier-groups/${modifierGroupID}/options`, { token: storeLocal.accessToken, headers: partnerHeaders(`modifier-option-${suffix}`), body: { nameAr: `حليب ${suffix}`, priceDeltaMinor: 300, availability: true, ordinal: 0 } });
if (modifierOptionCreate.status !== 201 || !modifierOptionCreate.body?.option?.id) fail("modifier option creation failed", JSON.stringify(modifierOptionCreate));
const modifierOptionID = String(modifierOptionCreate.body.option.id);
const storeLocalOfferPublished = await request(dshBase, "PATCH", `/dsh/stores/${storeLocal.storeID}/offers/${storeLocalOfferID}`, { token: storeLocal.accessToken, headers: partnerHeaders(`store-local-offer-publish-${suffix}`, 1), body: discreteOffer(1000, "published") });
const storeLocalPublished = await request(dshBase, "POST", `/dsh/stores/${storeLocal.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-local-publish-${suffix}`, crypto.randomUUID(), 1), body: { state: "published" } });
const storeLocalCartCreate = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(`store-local-cart-${suffix}`, 0), body: { storeId: storeLocal.storeID, storeOfferId: storeLocalOfferID, quantityBaseUnits: 1, selectedModifierOptionIds: [] } });
const storeLocalCartID = String(storeLocalCartCreate.body?.cart?.id || ""); if (storeLocalCartID) cartIDs.add(storeLocalCartID);
const modifierAttach = await request(dshBase, "PUT", `/dsh/stores/${storeLocal.storeID}/offers/${storeLocalOfferID}/modifier-groups/${modifierGroupID}`, { token: storeLocal.accessToken, headers: partnerHeaders(`modifier-attach-${suffix}`), body: { ordinal: 0 } });
const modifierOfferRead = await request(dshBase, "GET", `/dsh/stores/${storeLocal.storeID}/offers`, { token: storeLocal.accessToken });
if (modifierAttach.status !== 200 || !modifierOfferRead.body?.offers?.some((offer) => offer.offerId === storeLocalOfferID && offer.modifierGroups?.some((group) => group.id === modifierGroupID && group.options?.some((option) => option.id === modifierOptionID)))) fail("modifier offer attachment/readback failed", JSON.stringify({ modifierAttach, modifierOfferRead }));
const storeLocalPublicCatalog = await request(dshBase, "GET", `/dsh/public/stores/${storeLocal.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}`);
if (storeLocalOfferPublished.status !== 200 || storeLocalOfferPublished.body?.offer?.publicationState !== "published" || storeLocalPublished.status !== 200 || storeLocalPublished.body?.store?.publicationState !== "published" || storeLocalPublicCatalog.status !== 200 || !storeLocalPublicCatalog.body?.offers?.some((offer) => offer.offerId === storeLocalOfferID) || !storeLocalPublicCatalog.body?.sections?.some((section) => section.id === sectionID && section.offerIds?.includes(storeLocalOfferID))) fail("Store-local product, modifier and menu grouping were not read back together", JSON.stringify({ storeLocalOfferPublished, storeLocalPublished, storeLocalPublicCatalog }));

const missingFulfillmentModeCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`checkout-missing-fulfillment-mode-${suffix}`, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID } });
const unavailableFulfillmentModeCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`checkout-unavailable-fulfillment-mode-${suffix}`, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "PARTNER_CAPTAIN" } });
if (missingFulfillmentModeCheckout.status !== 400 || missingFulfillmentModeCheckout.body?.error?.code !== "INVALID_INPUT" || unavailableFulfillmentModeCheckout.status !== 409 || unavailableFulfillmentModeCheckout.body?.error?.code !== "FULFILLMENT_MODE_UNAVAILABLE") fail("checkout did not fail closed for missing or unavailable fulfillment intent", JSON.stringify({ missingFulfillmentModeCheckout, unavailableFulfillmentModeCheckout }));
const storeLocalMissingModifierCheckout = storeLocalCartID ? await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`store-local-checkout-missing-modifier-${suffix}`, 1), body: { cartId: storeLocalCartID, storeId: storeLocal.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } }) : null;
const storeLocalCartWithModifier = storeLocalCartID ? await request(dshBase, "PATCH", `/dsh/cart/lines/${encodeURIComponent(storeLocalCartCreate.body.cart.lines[0].id)}`, { token: client.accessToken, headers: partnerHeaders(`store-local-cart-modifier-${suffix}`, 1), body: { quantityBaseUnits: 1, selectedModifierOptionIds: [modifierOptionID] } }) : null;
const storeLocalModifierCheckout = storeLocalCartID ? await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`store-local-checkout-${suffix}`, 2), body: { cartId: storeLocalCartID, storeId: storeLocal.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } }) : null;
const storeLocalOrderID = String(storeLocalModifierCheckout?.body?.order?.id || ""); if (storeLocalOrderID) orderIDs.add(storeLocalOrderID);
const storeLocalCheckoutLineID = String(storeLocalModifierCheckout?.body?.order?.lines?.[0]?.id || "");
const storeLocalPaymentIntentID = String(storeLocalModifierCheckout?.body?.order?.paymentIntentId || ""); if (storeLocalPaymentIntentID) paymentIntentIDs.add(storeLocalPaymentIntentID);
if (storeLocalCartCreate.status !== 201 || storeLocalMissingModifierCheckout?.status !== 400 || storeLocalMissingModifierCheckout.body?.error?.code !== "INVALID_INPUT" || storeLocalCartWithModifier?.status !== 201 || storeLocalCartWithModifier.body?.cart?.version !== 2 || !storeLocalCartWithModifier.body.cart.lines[0]?.selectedModifierOptionIds?.includes(modifierOptionID) || storeLocalModifierCheckout?.status !== 201 || storeLocalModifierCheckout.body?.order?.lines?.[0]?.modifierAmountMinor !== 300 || !storeLocalModifierCheckout.body?.order?.lines?.[0]?.modifierSnapshots?.some((snapshot) => snapshot.optionId === modifierOptionID && snapshot.priceDeltaMinor === 300)) fail("Store-local required modifier selection and Order snapshot failed", JSON.stringify({ storeLocalCartCreate, storeLocalMissingModifierCheckout, storeLocalCartWithModifier, storeLocalModifierCheckout }));
const storeLocalModifierCancellation = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(storeLocalOrderID)}/cancel`, { token: client.accessToken, headers: partnerHeaders(`store-local-checkout-cancel-${suffix}`, 1) });
await waitForSQL(`SELECT state FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='PAYMENT_CANCEL' AND order_id='${sqlLiteral(storeLocalOrderID)}'`, "POSTED", "store-local modifier proof payment cancellation did not reconcile");
if (storeLocalModifierCancellation.status !== 201 || storeLocalModifierCancellation.body?.order?.state !== "CANCELLED") fail("store-local modifier proof order was not cancelled", JSON.stringify(storeLocalModifierCancellation));
const checkoutQuote = await request(dshBase, "POST", "/dsh/cart/quote", { token: client.accessToken, headers: { "X-Expected-Version": "2" }, body: { cartId: cartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } });
if (checkoutQuote.status !== 200 || checkoutQuote.body?.quote?.cartId !== cartID || checkoutQuote.body.quote.storeId !== first.storeID || checkoutQuote.body.quote.addressId !== addressAID || checkoutQuote.body.quote.fulfillmentMode !== "BTHWANI_CAPTAIN" || checkoutQuote.body.quote.cartVersion !== 2 || checkoutQuote.body.quote.subtotalMinor !== mainOrderSubtotal || checkoutQuote.body.quote.deliveryFeeMinor !== deliveryFeeMinor || checkoutQuote.body.quote.totalAmountMinor !== mainOrderTotal || checkoutQuote.body.quote.currency !== "YER" || typeof checkoutQuote.body.quote.deliveryPolicyVersion !== "string" || !checkoutQuote.body.quote.deliveryPolicyVersion || typeof checkoutQuote.body.quote.quotedAt !== "string") fail("checkout quote did not expose the canonical subtotal, WLT delivery fee, and expected total", JSON.stringify(checkoutQuote));
const cartUnserviceable = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`checkout-unserviceable-${suffix}`, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressBID, fulfillmentMode: "BTHWANI_CAPTAIN" } });
if (cartUnserviceable.status !== 409 || cartUnserviceable.body?.error?.code !== "UNSERVICEABLE") fail("cart checkout accepted an out-of-city address", JSON.stringify(cartUnserviceable));
const hiddenCartOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`cart-offer-hide-${suffix}`, 3), body: discreteOffer(2100, "hidden") });
if (hiddenCartOffer.status !== 200 || hiddenCartOffer.body?.offer?.publicationState !== "hidden" || hiddenCartOffer.body.offer.version !== 4) fail("cart offer failure fixture was not applied canonically", JSON.stringify(hiddenCartOffer));
const unavailableCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`checkout-offer-unavailable-${suffix}`, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } });
if (unavailableCheckout.status !== 409 || unavailableCheckout.body?.error?.code !== "UNSERVICEABLE") fail("checkout did not fail closed when the StoreOffer was hidden", JSON.stringify(unavailableCheckout));
const restoredCartOffer = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`cart-offer-restore-${suffix}`, 4), body: discreteOffer(2100, "published") });
if (restoredCartOffer.status !== 200 || restoredCartOffer.body?.offer?.publicationState !== "published" || restoredCartOffer.body.offer.version !== 5) fail("cart offer recovery failed", JSON.stringify(restoredCartOffer));
const checkoutKey = `checkout-${suffix}`;
const checkout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(checkoutKey, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } });
if (checkout.status !== 201 || checkout.body?.order?.state !== "CREATED" || checkout.body.order.version !== 1 || checkout.body.order.fulfillmentMode !== "BTHWANI_CAPTAIN" || checkout.body.order.totalAmountMinor !== mainOrderTotal || checkout.body.order.paymentMethod !== "CASH_ON_DELIVERY" || checkout.body.order.paymentState !== "REQUIRES_COLLECTION" || typeof checkout.body.order.paymentIntentId !== "string" || checkout.body.order.lines?.[0]?.requestedQuantityBaseUnits !== 2 || checkout.body.order.lines?.[0]?.unitPriceMinor !== 2100 || checkout.body.order.lines?.[0]?.modifierAmountMinor !== 0 || checkout.body.order.lines?.[0]?.modifierSnapshots?.length !== 0 || checkout.body.order.lines?.[0]?.attributeSnapshots?.length !== 3 || !checkout.body.order.lines?.[0]?.attributeSnapshots?.some((snapshot) => snapshot.attributeId === enumAttributeID && snapshot.valueKind === "ENUM" && snapshot.enumValue === "Dark")) fail("cart checkout did not create an immutable Order/payment snapshot", JSON.stringify(checkout));
const checkoutLineID = String(checkout.body.order.lines?.[0]?.id || "");
const orderID = String(checkout.body.order.id); orderIDs.add(orderID);

const promotionCode = `SAVE${suffix.replace(/[^A-Za-z0-9]/g, "").slice(-12).toUpperCase()}`;
const promotionCreate = await request(dshBase, "POST", "/dsh/operator/promotions", { token: dshToken, headers: serviceHeaders(actingOperatorID, `marketing-promotion-create-${suffix}`), body: { id: `promotion-${suffix}`, code: promotionCode, nameAr: `خصم تجريبي ${suffix}`, descriptionAr: "خصم على الطلب التجريبي", kind: "FIXED", valueMinor: 300, fundingSource: "MERCHANT", storeId: first.storeID, serviceCityId: cityA, startsAt: new Date(Date.now() - 60_000).toISOString() } });
if (promotionCreate.status !== 201 || promotionCreate.body?.promotion?.state !== "DRAFT" || promotionCreate.body.promotion.code !== promotionCode) fail("promotion draft creation failed", JSON.stringify(promotionCreate));
const promotionID = String(promotionCreate.body.promotion.id); promotionIDs.add(promotionID);
const promotionPublish = await request(dshBase, "POST", `/dsh/operator/promotions/${encodeURIComponent(promotionID)}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `marketing-promotion-publish-${suffix}`, crypto.randomUUID(), promotionCreate.body.promotion.version), body: { state: "PUBLISHED" } });
const promotionPublic = await request(dshBase, "GET", `/dsh/public/promotions?serviceCityId=${encodeURIComponent(cityA)}&storeId=${encodeURIComponent(first.storeID)}`);
if (promotionPublish.status !== 201 || promotionPublish.body?.promotion?.state !== "PUBLISHED" || promotionPublic.status !== 200 || !promotionPublic.body?.promotions?.some((item) => item.id === promotionID && item.code === promotionCode && item.state === "PUBLISHED")) fail("promotion publication/public readback failed", JSON.stringify({ promotionCreate, promotionPublish, promotionPublic }));
const contentCreate = await request(dshBase, "POST", "/dsh/operator/discovery-content", { token: dshToken, headers: serviceHeaders(actingOperatorID, `marketing-content-create-${suffix}`), body: { id: `content-${suffix}`, kind: "BANNER", titleAr: `اكتشاف ${suffix}`, bodyAr: "محتوى تجريبي منشور", targetType: "INFO", serviceCityId: cityA, startsAt: new Date(Date.now() - 60_000).toISOString(), ordinal: 0 } });
if (contentCreate.status !== 201 || contentCreate.body?.content?.state !== "DRAFT") fail("discovery content draft creation failed", JSON.stringify(contentCreate));
const contentID = String(contentCreate.body.content.id); contentIDs.add(contentID);
const contentPublish = await request(dshBase, "POST", `/dsh/operator/discovery-content/${encodeURIComponent(contentID)}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `marketing-content-publish-${suffix}`, crypto.randomUUID(), contentCreate.body.content.version), body: { state: "PUBLISHED" } });
const contentPublic = await request(dshBase, "GET", `/dsh/public/discovery-content?serviceCityId=${encodeURIComponent(cityA)}`);
if (contentPublish.status !== 201 || contentPublish.body?.content?.state !== "PUBLISHED" || contentPublic.status !== 200 || !contentPublic.body?.items?.some((item) => item.id === contentID && item.titleAr === `اكتشاف ${suffix}` && item.state === "PUBLISHED")) fail("discovery content publication/public readback failed", JSON.stringify({ contentCreate, contentPublish, contentPublic }));

const promotionCartCreate = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(`marketing-cart-${suffix}`, 0), body: { storeId: first.storeID, storeOfferId: offerAID, quantityBaseUnits: 1, selectedModifierOptionIds: [] } });
if (promotionCartCreate.status !== 201 || !promotionCartCreate.body?.cart?.id) fail("promotion checkout cart fixture failed", JSON.stringify(promotionCartCreate));
const promotionCartID = String(promotionCartCreate.body.cart.id); cartIDs.add(promotionCartID);
const promotionQuote = await request(dshBase, "POST", "/dsh/cart/quote", { token: client.accessToken, headers: { "X-Expected-Version": "1" }, body: { cartId: promotionCartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN", promotionCode } });
if (promotionQuote.status !== 200 || promotionQuote.body?.quote?.subtotalMinor !== 2100 || promotionQuote.body.quote.discountMinor !== 300 || promotionQuote.body.quote.promotionCode !== promotionCode || promotionQuote.body.quote.totalAmountMinor !== 1900) fail("promotion checkout quote did not apply the canonical discount", JSON.stringify(promotionQuote));
const promotionCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`marketing-checkout-${suffix}`, 1), body: { cartId: promotionCartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN", promotionCode } });
if (promotionCheckout.status !== 201 || promotionCheckout.body?.order?.subtotalAmountMinor !== 2100 || promotionCheckout.body.order.discountMinor !== 300 || promotionCheckout.body.order.promotionCode !== promotionCode || promotionCheckout.body.order.totalAmountMinor !== 1900) fail("promotion checkout did not snapshot the canonical discount", JSON.stringify(promotionCheckout));
const promotionOrderID = String(promotionCheckout.body.order.id); orderIDs.add(promotionOrderID);
const promotionPaymentIntentID = String(promotionCheckout.body.order.paymentIntentId); paymentIntentIDs.add(promotionPaymentIntentID);
const promotionPayment = await request(wltBase, "GET", `/wlt/v1/payment-intents/${encodeURIComponent(promotionPaymentIntentID)}`, { token: wltToken });
const promotionAllocationCount = sql(`SELECT count(*) FROM wlt.customer_payment_allocations WHERE order_id='${sqlLiteral(promotionOrderID)}' AND subtotal_minor=2100 AND discount_minor=300 AND customer_payable_minor=1900 AND cash_amount_minor=1900`);
const promotionRedemptionCount = sql(`SELECT count(*) FROM dsh.commerce_promotion_redemptions WHERE promotion_id='${sqlLiteral(promotionID)}' AND order_id='${sqlLiteral(promotionOrderID)}' AND discount_minor=300`);
const reusedPromotionCart = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(`marketing-reuse-cart-${suffix}`, 0), body: { storeId: first.storeID, storeOfferId: offerAID, quantityBaseUnits: 1, selectedModifierOptionIds: [] } });
if (reusedPromotionCart.status !== 201 || !reusedPromotionCart.body?.cart?.id) fail("promotion reuse cart fixture failed", JSON.stringify(reusedPromotionCart));
const reusedPromotionCartID = String(reusedPromotionCart.body.cart.id); cartIDs.add(reusedPromotionCartID);
const reusedPromotionQuote = await request(dshBase, "POST", "/dsh/cart/quote", { token: client.accessToken, headers: { "X-Expected-Version": "1" }, body: { cartId: reusedPromotionCartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN", promotionCode } });
const reusedPromotionFallbackCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`marketing-reuse-fallback-${suffix}`, 1), body: { cartId: reusedPromotionCartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } });
const reusedPromotionFallbackOrderID = String(reusedPromotionFallbackCheckout.body?.order?.id || "");
if (reusedPromotionFallbackOrderID) orderIDs.add(reusedPromotionFallbackOrderID);
const reusedPromotionFallbackPaymentID = String(reusedPromotionFallbackCheckout.body?.order?.paymentIntentId || "");
if (reusedPromotionFallbackPaymentID) paymentIntentIDs.add(reusedPromotionFallbackPaymentID);
const reusedPromotionFallbackCancellation = reusedPromotionFallbackOrderID ? await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(reusedPromotionFallbackOrderID)}/cancel`, { token: client.accessToken, headers: partnerHeaders(`marketing-reuse-fallback-cancel-${suffix}`, 1) }) : null;
if (reusedPromotionFallbackOrderID) await waitForSQL(`SELECT state FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='PAYMENT_CANCEL' AND order_id='${sqlLiteral(reusedPromotionFallbackOrderID)}'`, "POSTED", "promotion reuse fallback cancellation did not reconcile");
if (promotionPayment.status !== 200 || promotionPayment.body?.paymentIntent?.amountMinor !== 1900 || promotionAllocationCount !== "1" || promotionRedemptionCount !== "1" || reusedPromotionQuote.status !== 409 || reusedPromotionQuote.body?.error?.code !== "PROMOTION_UNAVAILABLE" || reusedPromotionFallbackCheckout.status !== 201 || reusedPromotionFallbackCancellation?.status !== 201 || reusedPromotionFallbackCancellation.body?.order?.state !== "CANCELLED") fail("promotion funding, redemption, or reuse boundary failed", JSON.stringify({ promotionCheckout, promotionPayment, promotionAllocationCount, promotionRedemptionCount, reusedPromotionQuote, reusedPromotionFallbackCheckout, reusedPromotionFallbackCancellation }));
const promotionCancellation = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(promotionOrderID)}/cancel`, { token: client.accessToken, headers: partnerHeaders(`marketing-cancel-${suffix}`, 1) });
await waitForSQL(`SELECT state FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='PAYMENT_CANCEL' AND order_id='${sqlLiteral(promotionOrderID)}'`, "POSTED", "promotion cancellation financial handoff did not reconcile");
if (promotionCancellation.status !== 201 || promotionCancellation.body?.order?.state !== "CANCELLED") fail("promotion cancellation did not release the temporary proof order", JSON.stringify(promotionCancellation));
console.log("DSH_PROMOTIONS_DISCOVERY=PASS");

const multiCartAResponse = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(`multi-store-cart-a-${suffix}`, 0), body: { storeId: first.storeID, storeOfferId: offerAID, quantityBaseUnits: 1, selectedModifierOptionIds: [] } });
const multiCartBResponse = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(`multi-store-cart-b-${suffix}`, 0), body: { storeId: second.storeID, storeOfferId: offerBID, quantityBaseUnits: 1, selectedModifierOptionIds: [] } });
if (multiCartAResponse.status !== 201 || multiCartBResponse.status !== 201 || !multiCartAResponse.body?.cart?.id || !multiCartBResponse.body?.cart?.id) fail("multi-store child cart fixtures failed", JSON.stringify({ multiCartAResponse, multiCartBResponse }));
const multiCartAID = String(multiCartAResponse.body.cart.id); const multiCartBID = String(multiCartBResponse.body.cart.id); cartIDs.add(multiCartAID); cartIDs.add(multiCartBID);
const multiCheckoutID = `multi-store-${suffix}`; const multiCheckoutKey = `multi-store-create-${suffix}`;
const multiCheckoutBody = { id: multiCheckoutID, children: [
  { cartId: multiCartAID, storeId: first.storeID, addressId: addressAID, cartVersion: multiCartAResponse.body.cart.version, fulfillmentMode: "BTHWANI_CAPTAIN" },
  { cartId: multiCartBID, storeId: second.storeID, addressId: addressAID, cartVersion: multiCartBResponse.body.cart.version, fulfillmentMode: "BTHWANI_CAPTAIN" },
] };
const multiCheckout = await request(dshBase, "POST", "/dsh/multi-store-checkouts", { token: client.accessToken, headers: partnerHeaders(multiCheckoutKey), body: multiCheckoutBody });
if (multiCheckout.body?.checkout?.id) multiStoreCheckoutIDs.add(String(multiCheckout.body.checkout.id));
const multiChildSuccess = multiCheckout.body?.checkout?.children?.find((child) => child.storeId === first.storeID);
const multiChildFailure = multiCheckout.body?.checkout?.children?.find((child) => child.storeId === second.storeID);
const multiChildOrderID = String(multiChildSuccess?.orderId || "");
if (multiChildOrderID) orderIDs.add(multiChildOrderID);
const multiChildPaymentID = multiChildOrderID ? String((await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(multiChildOrderID)}`, { token: client.accessToken })).body?.order?.paymentIntentId || "") : "";
if (multiChildPaymentID) paymentIntentIDs.add(multiChildPaymentID);
const multiCheckoutReplay = await request(dshBase, "POST", "/dsh/multi-store-checkouts", { token: client.accessToken, headers: partnerHeaders(multiCheckoutKey), body: multiCheckoutBody });
const multiCheckoutRead = await request(dshBase, "GET", `/dsh/multi-store-checkouts/${encodeURIComponent(multiCheckoutID)}`, { token: client.accessToken });
const multiChildReadbackCount = sql(`SELECT count(*) FROM dsh.commerce_multi_store_checkout_children c JOIN dsh.commerce_multi_store_checkouts p ON p.id=c.checkout_id WHERE p.id='${sqlLiteral(multiCheckoutID)}' AND c.state IN ('SUCCEEDED','FAILED') AND c.store_id IN ('${sqlLiteral(first.storeID)}','${sqlLiteral(second.storeID)}')`);
const multiChildAllocationCount = multiChildOrderID ? sql(`SELECT count(*) FROM wlt.customer_payment_allocations WHERE order_id='${sqlLiteral(multiChildOrderID)}'`) : "0";
if (multiCheckout.status !== 201 || multiCheckout.body?.checkout?.state !== "PARTIAL_FAILURE" || multiCheckout.body.checkout.successfulChildCount !== 1 || multiCheckout.body.checkout.failedChildCount !== 1 || multiChildSuccess?.state !== "SUCCEEDED" || multiChildFailure?.state !== "FAILED" || multiChildFailure?.failureCode !== "UNSERVICEABLE" || multiCheckoutReplay.status !== 200 || multiCheckoutReplay.body?.idempotentReplay !== true || multiCheckoutReplay.body.checkout.id !== multiCheckoutID || multiCheckoutRead.status !== 200 || multiCheckoutRead.body?.checkout?.state !== "PARTIAL_FAILURE" || multiChildReadbackCount !== "2" || multiChildAllocationCount !== "1") fail("multi-store checkout did not preserve independent child success/failure, idempotency, or WLT allocation", JSON.stringify({ multiCheckout, multiCheckoutReplay, multiCheckoutRead, multiChildReadbackCount, multiChildAllocationCount }));
const multiCancelKey = `multi-store-cancel-${suffix}`;
const multiCancel = await request(dshBase, "POST", `/dsh/multi-store-checkouts/${encodeURIComponent(multiCheckoutID)}/cancel`, { token: client.accessToken, headers: partnerHeaders(multiCancelKey, multiCheckout.body.checkout.version) });
await waitForSQL(`SELECT state FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='PAYMENT_CANCEL' AND order_id='${sqlLiteral(multiChildOrderID)}'`, "POSTED", "multi-store child payment cancellation did not reconcile");
const multiCancelReplay = await request(dshBase, "POST", `/dsh/multi-store-checkouts/${encodeURIComponent(multiCheckoutID)}/cancel`, { token: client.accessToken, headers: partnerHeaders(multiCancelKey, multiCheckout.body.checkout.version) });
const multiCancelRead = await request(dshBase, "GET", `/dsh/multi-store-checkouts/${encodeURIComponent(multiCheckoutID)}`, { token: client.accessToken });
const multiParentState = sql(`SELECT state || '|' || successful_child_count::text || '|' || failed_child_count::text FROM dsh.commerce_multi_store_checkouts WHERE id='${sqlLiteral(multiCheckoutID)}'`);
const multiChildState = sql(`SELECT string_agg(store_id || ':' || state, ',' ORDER BY child_index) FROM dsh.commerce_multi_store_checkout_children WHERE checkout_id='${sqlLiteral(multiCheckoutID)}'`);
if (multiCancel.status !== 201 || multiCancel.body?.checkout?.state !== "CANCELLED" || multiCancel.body.checkout.children?.find((child) => child.storeId === first.storeID)?.state !== "CANCELLED" || multiCancel.body.checkout.children?.find((child) => child.storeId === second.storeID)?.state !== "FAILED" || multiCancelReplay.status !== 200 || multiCancelReplay.body?.idempotentReplay !== true || multiCancelRead.status !== 200 || multiCancelRead.body?.checkout?.state !== "CANCELLED" || multiParentState !== "CANCELLED|1|1" || !multiChildState.includes(`${first.storeID}:CANCELLED`) || !multiChildState.includes(`${second.storeID}:FAILED`)) fail("multi-store parent cancellation or child outcome reconciliation failed", JSON.stringify({ multiCancel, multiCancelReplay, multiCancelRead, multiParentState, multiChildState }));
console.log("DSH_MULTI_STORE_CHECKOUT=PASS");

const pickupStoreOrigin = await request(dshBase, "GET", "/dsh/stores/" + encodeURIComponent(second.storeID) + "/delivery-origin", { token: second.accessToken });
const pickupCartRead = await request(dshBase, "GET", "/dsh/cart?storeId=" + encodeURIComponent(second.storeID), { token: client.accessToken });
if (pickupStoreOrigin.status !== 200 || !pickupStoreOrigin.body?.origin || pickupCartRead.status !== 200 || pickupCartRead.body?.cart?.id !== multiCartBID || pickupCartRead.body?.cart?.storeId !== second.storeID || !pickupCartRead.body?.cart?.lines?.some((line) => line.storeOfferId === offerBID)) fail("customer pickup origin or failed-delivery cart recovery fixture failed", JSON.stringify({ pickupStoreOrigin, pickupCartRead }));
const pickupCartID = String(pickupCartRead.body.cart.id);
cartIDs.add(pickupCartID);
const pickupCartVersion = pickupCartRead.body.cart.version;
const pickupQuote = await request(dshBase, "POST", "/dsh/cart/quote", { token: client.accessToken, headers: { "X-Expected-Version": String(pickupCartVersion) }, body: { cartId: pickupCartID, storeId: second.storeID, fulfillmentMode: "CUSTOMER_PICKUP" } });
if (pickupQuote.status !== 200 || pickupQuote.body?.quote?.fulfillmentMode !== "CUSTOMER_PICKUP" || pickupQuote.body.quote.subtotalMinor !== 1500 || pickupQuote.body.quote.deliveryFeeMinor !== 0 || pickupQuote.body.quote.totalAmountMinor !== 1500 || pickupQuote.body.quote.currency !== "YER") fail("pickup quote charged a delivery fee or diverged from the store product total", JSON.stringify(pickupQuote));
const pickupCheckoutKey = "pickup-checkout-" + suffix;
const pickupCheckoutHeaders = partnerHeaders(pickupCheckoutKey, pickupCartVersion);
const pickupCheckoutBody = { cartId: pickupCartID, storeId: second.storeID, fulfillmentMode: "CUSTOMER_PICKUP" };
const pickupCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: pickupCheckoutHeaders, body: pickupCheckoutBody });
if (pickupCheckout.status !== 201 || !pickupCheckout.body?.order?.id) fail("cash-at-store pickup checkout failed", JSON.stringify(pickupCheckout));
const pickupOrder = pickupCheckout.body.order;
const pickupOrderID = String(pickupOrder.id);
orderIDs.add(pickupOrderID);
const pickupPaymentIntentID = String(pickupOrder.paymentIntentId || "");
if (!pickupPaymentIntentID) fail("pickup checkout did not link a WLT payment intent", JSON.stringify(pickupCheckout));
paymentIntentIDs.add(pickupPaymentIntentID);
const pickupCheckoutReplay = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: pickupCheckoutHeaders, body: pickupCheckoutBody });
const pickupPaymentBeforeCollection = await request(wltBase, "GET", "/wlt/v1/payment-intents/" + encodeURIComponent(pickupPaymentIntentID), { token: wltToken });
const pickupInitialAllocation = pickupPaymentBeforeCollection.body?.paymentIntent?.customerPaymentAllocation;
if (pickupOrder.fulfillmentMode !== "CUSTOMER_PICKUP" || pickupOrder.paymentMethod !== "CASH_AT_STORE" || pickupOrder.paymentState !== "REQUIRES_COLLECTION" || pickupOrder.subtotalAmountMinor !== 1500 || pickupOrder.totalAmountMinor !== 1500 || pickupOrder.addressId || pickupOrder.addressText || pickupOrder.pickupLocation?.latitude !== pickupStoreOrigin.body.origin.latitude || pickupOrder.pickupLocation?.longitude !== pickupStoreOrigin.body.origin.longitude || pickupCheckoutReplay.status !== 200 || pickupCheckoutReplay.body?.idempotentReplay !== true || pickupCheckoutReplay.body?.order?.id !== pickupOrderID || pickupPaymentBeforeCollection.status !== 200 || pickupPaymentBeforeCollection.body?.paymentIntent?.state !== "REQUIRES_COLLECTION" || pickupPaymentBeforeCollection.body.paymentIntent.method !== "CASH_AT_STORE" || pickupPaymentBeforeCollection.body.paymentIntent.amountMinor !== 1500 || pickupInitialAllocation?.orderId !== pickupOrderID || pickupInitialAllocation?.currency !== "YER" || pickupInitialAllocation?.subtotalMinor !== 1500 || pickupInitialAllocation?.deliveryFeeMinor !== 0 || pickupInitialAllocation?.discountMinor !== 0 || pickupInitialAllocation?.internalBalanceAmountMinor !== 0 || pickupInitialAllocation?.cashAmountMinor !== 1500 || pickupInitialAllocation?.customerPayableMinor !== 1500 || pickupInitialAllocation?.policyVersion !== "cash-at-store-v1") fail("pickup checkout did not preserve no-address, zero-fee, cash-at-store WLT allocation semantics", JSON.stringify({ pickupCheckout, pickupCheckoutReplay, pickupPaymentBeforeCollection, pickupStoreOrigin }));
const pickupProofBeforeReady = await request(dshBase, "GET", "/dsh/orders/" + encodeURIComponent(pickupOrderID) + "/delivery-proof", { token: client.accessToken });
const partnerPickupProof = await request(dshBase, "GET", "/dsh/orders/" + encodeURIComponent(pickupOrderID) + "/delivery-proof", { token: second.accessToken });
if (pickupProofBeforeReady.status !== 200 || pickupProofBeforeReady.body?.orderId !== pickupOrderID || pickupProofBeforeReady.body?.proofType !== "STORE_PICKUP" || pickupProofBeforeReady.body?.state !== "PENDING" || pickupProofBeforeReady.body?.code != null || partnerPickupProof.status !== 403) fail("store pickup proof was disclosed before readiness or crossed the customer role boundary", JSON.stringify({ pickupProofStatus: pickupProofBeforeReady.status, proofType: pickupProofBeforeReady.body?.proofType, proofState: pickupProofBeforeReady.body?.state, codeDisclosed: pickupProofBeforeReady.body?.code != null, partnerStatus: partnerPickupProof.status }));

const pickupAccept = await request(dshBase, "POST", "/dsh/stores/" + second.storeID + "/orders/" + encodeURIComponent(pickupOrderID) + "/transition", { token: second.accessToken, headers: partnerHeaders("pickup-accept-" + suffix, 1), body: { state: "PARTNER_ACCEPTED" } });
const pickupPreparing = await request(dshBase, "POST", "/dsh/stores/" + second.storeID + "/orders/" + encodeURIComponent(pickupOrderID) + "/transition", { token: second.accessToken, headers: partnerHeaders("pickup-preparing-" + suffix, 2), body: { state: "PREPARING" } });
const pickupDispatchAttempt = await request(dshBase, "POST", "/dsh/stores/" + second.storeID + "/orders/" + encodeURIComponent(pickupOrderID) + "/transition", { token: second.accessToken, headers: partnerHeaders("pickup-dispatch-rejected-" + suffix, 3), body: { state: "READY_FOR_DISPATCH" } });
const pickupPreparingRead = await request(dshBase, "GET", "/dsh/orders/" + encodeURIComponent(pickupOrderID), { token: client.accessToken });
if (pickupAccept.status !== 200 || pickupAccept.body?.order?.state !== "PARTNER_ACCEPTED" || pickupPreparing.status !== 200 || pickupPreparing.body?.order?.state !== "PREPARING" || pickupDispatchAttempt.status !== 409 || pickupDispatchAttempt.body?.error?.code !== "VERSION_OR_STATE_CONFLICT" || pickupPreparingRead.status !== 200 || pickupPreparingRead.body?.order?.state !== "PREPARING" || pickupPreparingRead.body.order.version !== 3) fail("pickup order lifecycle allowed courier dispatch or failed the partner preparation steps", JSON.stringify({ pickupAccept, pickupPreparing, pickupDispatchAttempt, pickupPreparingRead }));
const pickupReady = await request(dshBase, "POST", "/dsh/stores/" + second.storeID + "/orders/" + encodeURIComponent(pickupOrderID) + "/transition", { token: second.accessToken, headers: partnerHeaders("pickup-ready-" + suffix, 3), body: { state: "READY_FOR_PICKUP" } });
if (pickupReady.status !== 200 || pickupReady.body?.order?.state !== "READY_FOR_PICKUP" || pickupReady.body.order.version !== 4) fail("partner could not mark the pickup order ready", JSON.stringify(pickupReady));
const pickupProof = await request(dshBase, "GET", "/dsh/orders/" + encodeURIComponent(pickupOrderID) + "/delivery-proof", { token: client.accessToken });
if (pickupProof.status !== 200 || pickupProof.body?.proofType !== "STORE_PICKUP" || pickupProof.body?.state !== "PENDING" || !/^[0-9]{6}$/.test(String(pickupProof.body?.code || ""))) fail("store pickup proof was not disclosed at READY_FOR_PICKUP", JSON.stringify({ status: pickupProof.status, proofType: pickupProof.body?.proofType, proofState: pickupProof.body?.state, codeDisclosed: Boolean(pickupProof.body?.code) }));
const pickupProtectedProof = sql("SELECT state || '|' || (code_ciphertext IS NOT NULL)::text || '|' || (code_verifier ~ '^[0-9a-f]{64}$')::text || '|' || (code_key_id IS NOT NULL)::text FROM dsh.commerce_order_delivery_proofs WHERE order_id='" + sqlLiteral(pickupOrderID) + "'");
if (pickupProtectedProof !== "PENDING|true|true|true") fail("pending store pickup proof was not protected at rest", pickupProtectedProof);
const pickupWrongCode = String((Number(pickupProof.body.code) + 1) % 1_000_000).padStart(6, "0");
const pickupWrongCompletion = await request(dshBase, "POST", "/dsh/stores/" + second.storeID + "/orders/" + encodeURIComponent(pickupOrderID) + "/transition", { token: second.accessToken, headers: partnerHeaders("pickup-wrong-code-" + suffix, 4), body: { state: "PICKED_UP", code: pickupWrongCode } });
const pickupAfterWrongCode = await request(dshBase, "GET", "/dsh/orders/" + encodeURIComponent(pickupOrderID), { token: client.accessToken });
if (pickupWrongCompletion.status !== 409 || pickupWrongCompletion.body?.error?.code !== "DELIVERY_PROOF_INVALID" || pickupAfterWrongCode.status !== 200 || pickupAfterWrongCode.body?.order?.state !== "READY_FOR_PICKUP" || pickupAfterWrongCode.body.order.version !== 4 || pickupAfterWrongCode.body.order.paymentState !== "REQUIRES_COLLECTION") fail("wrong customer pickup code did not fail closed without collecting cash", JSON.stringify({ pickupWrongCompletion, pickupAfterWrongCode }));
const pickupCompletionHeaders = partnerHeaders("pickup-complete-" + suffix, 4);
const pickupCompletionBody = { state: "PICKED_UP", code: String(pickupProof.body.code) };
const pickupCompletion = await request(dshBase, "POST", "/dsh/stores/" + second.storeID + "/orders/" + encodeURIComponent(pickupOrderID) + "/transition", { token: second.accessToken, headers: pickupCompletionHeaders, body: pickupCompletionBody });
const pickupCompletionReplay = await request(dshBase, "POST", "/dsh/stores/" + second.storeID + "/orders/" + encodeURIComponent(pickupOrderID) + "/transition", { token: second.accessToken, headers: pickupCompletionHeaders, body: pickupCompletionBody });
await waitForFinancialHandoff("STORE_PICKUP_COLLECTION", pickupOrderID, "store pickup collection financial handoff did not reconcile");
const pickupVerifiedProof = await request(dshBase, "GET", "/dsh/orders/" + encodeURIComponent(pickupOrderID) + "/delivery-proof", { token: client.accessToken });
const pickupVerifiedProofStorage = sql("SELECT state || '|' || (code_ciphertext IS NULL)::text || '|' || (code_verifier IS NULL)::text || '|' || (code_key_id IS NULL)::text FROM dsh.commerce_order_delivery_proofs WHERE order_id='" + sqlLiteral(pickupOrderID) + "'");
const pickupClientOrder = await request(dshBase, "GET", "/dsh/orders/" + encodeURIComponent(pickupOrderID), { token: client.accessToken });
const pickupPartnerOrder = await request(dshBase, "GET", "/dsh/stores/" + second.storeID + "/orders/" + encodeURIComponent(pickupOrderID), { token: second.accessToken });
if (pickupCompletion.status !== 200 || pickupCompletion.body?.order?.state !== "PICKED_UP" || pickupCompletion.body.order.version !== 5 || pickupCompletionReplay.status !== 200 || pickupCompletionReplay.body?.idempotentReplay !== true || pickupCompletionReplay.body?.order?.version !== 5 || pickupVerifiedProof.status !== 200 || pickupVerifiedProof.body?.proofType !== "STORE_PICKUP" || pickupVerifiedProof.body?.state !== "VERIFIED" || !pickupVerifiedProof.body?.verifiedAt || pickupClientOrder.status !== 200 || pickupClientOrder.body?.order?.state !== "PICKED_UP" || pickupClientOrder.body.order.paymentState !== "COLLECTED" || pickupPartnerOrder.status !== 200 || pickupPartnerOrder.body?.order?.state !== "PICKED_UP" || pickupPartnerOrder.body.order.paymentState !== "COLLECTED" || pickupVerifiedProofStorage !== "VERIFIED|true|true|true") fail("pickup completion, proof erasure, idempotency, or client/partner readback failed", JSON.stringify({ pickupCompletion, pickupCompletionReplay, pickupVerifiedProof, pickupVerifiedProofStorage, pickupClientOrder, pickupPartnerOrder }));
const pickupOutboxReadback = sql("SELECT effect_type || '|' || state || '|' || partner_actor_id || '|' || amount_minor::text FROM dsh.commerce_financial_handoff_outbox WHERE order_id='" + sqlLiteral(pickupOrderID) + "'");
const pickupDSHPaymentState = sql("SELECT payment_state FROM dsh.commerce_orders WHERE id='" + sqlLiteral(pickupOrderID) + "'");
const pickupPaymentCollected = await request(wltBase, "GET", "/wlt/v1/payment-intents/" + encodeURIComponent(pickupPaymentIntentID), { token: wltToken });
const pickupCollectedIntent = pickupPaymentCollected.body?.paymentIntent;
if (pickupOutboxReadback !== "STORE_PICKUP_COLLECTION|POSTED|" + second.actorID + "|1500" || pickupDSHPaymentState !== "COLLECTED" || pickupPaymentCollected.status !== 200 || pickupCollectedIntent?.state !== "COLLECTED" || pickupCollectedIntent.method !== "CASH_AT_STORE" || pickupCollectedIntent.amountMinor !== 1500 || pickupCollectedIntent.collectedAmountMinor !== 1500 || pickupCollectedIntent.collectedByActorId !== second.actorID) fail("pickup cash collection was not owned by the store Partner and reconciled from WLT to DSH", JSON.stringify({ pickupOutboxReadback, pickupDSHPaymentState, pickupPaymentCollected }));
const pickupCommissionJSON = sql("SELECT json_build_object('fulfillmentMode',fulfillment_mode,'partnerActorId',partner_actor_id,'paymentIntentId',payment_intent_id,'currency',currency,'grossProductMinor',gross_product_minor,'commissionMinor',commission_minor,'profileId',profile_id,'profileVersion',profile_version,'policyVersion',policy_version,'ledgerTransactionId',ledger_transaction_id)::text FROM wlt.partner_store_cash_commissions WHERE order_id='" + sqlLiteral(pickupOrderID) + "'");
if (!pickupCommissionJSON) fail("WLT did not create a store cash commission receivable", pickupOrderID);
const pickupCommission = JSON.parse(pickupCommissionJSON);
const pickupCommissionMinor = Number(pickupCommission.commissionMinor);
const pickupReceivableBeforeRemittance = sql("SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_minor ELSE -amount_minor END),0)::text FROM wlt.ledger_entries WHERE account_code='PARTNER_COMMISSION_RECEIVABLE' AND actor_type='partner' AND actor_id='" + sqlLiteral(second.actorID) + "'");
const pickupCommissionLedgerCount = sql("SELECT count(*) FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id WHERE t.source_type='PARTNER_STORE_CASH_COMMISSION' AND t.source_id='" + sqlLiteral(pickupOrderID) + "' AND ((e.account_code='PARTNER_COMMISSION_RECEIVABLE' AND e.actor_type='partner' AND e.actor_id='" + sqlLiteral(second.actorID) + "' AND e.direction='DEBIT' AND e.amount_minor=" + pickupCommissionMinor + ") OR (e.account_code='PLATFORM_COMMISSION_INCOME' AND e.direction='CREDIT' AND e.amount_minor=" + pickupCommissionMinor + "))");
if (pickupCommission.fulfillmentMode !== "CUSTOMER_PICKUP" || pickupCommission.partnerActorId !== second.actorID || pickupCommission.paymentIntentId !== pickupPaymentIntentID || pickupCommission.currency !== "YER" || pickupCommission.grossProductMinor !== 1500 || !pickupCommission.profileId || pickupCommission.profileVersion < 1 || !/^partner-store-mode-commission-v1;store=.+;mode=CUSTOMER_PICKUP;policy=\d+;rate-bps=\d+;profile=.+:\d+;settlement=(DAILY|WEEKLY|MONTHLY)$/.test(String(pickupCommission.policyVersion || "")) || !pickupCommission.ledgerTransactionId || pickupCommissionMinor <= 0 || pickupReceivableBeforeRemittance !== String(pickupCommissionMinor) || pickupCommissionLedgerCount !== "2") fail("WLT pickup commission did not create one balanced partner receivable while the store retained gross cash", JSON.stringify({ pickupCommission, pickupReceivableBeforeRemittance, pickupCommissionLedgerCount }));
const pickupOverpayment = await request(wltBase, "POST", "/wlt/v1/operator/partners/" + encodeURIComponent(second.actorID) + "/commission-remittances", { token: wltToken, headers: serviceHeaders(actingOperatorID, "pickup-overpay-" + suffix), body: { amountMinor: pickupCommissionMinor + 1, remittanceReference: "runtime-pickup-overpay-" + suffix, evidenceReference: "runtime-proof-pickup-overpay-" + suffix } });
const pickupReceivableAfterOverpayment = sql("SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_minor ELSE -amount_minor END),0)::text FROM wlt.ledger_entries WHERE account_code='PARTNER_COMMISSION_RECEIVABLE' AND actor_type='partner' AND actor_id='" + sqlLiteral(second.actorID) + "'");
if (pickupOverpayment.status !== 409 || pickupOverpayment.body?.error?.code !== "REMITTANCE_EXCEEDS_RECEIVABLE" || pickupReceivableAfterOverpayment !== String(pickupCommissionMinor)) fail("WLT accepted an overpayment or changed commission receivable on rejection", JSON.stringify({ pickupOverpayment, pickupReceivableAfterOverpayment }));
const pickupRemittanceKey = "pickup-remit-" + suffix;
const pickupRemittanceHeaders = serviceHeaders(actingOperatorID, pickupRemittanceKey);
const pickupRemittanceBody = { amountMinor: pickupCommissionMinor, remittanceReference: "runtime-pickup-remittance-" + suffix, evidenceReference: "runtime-proof-pickup-remittance-" + suffix };
const pickupRemittance = await request(wltBase, "POST", "/wlt/v1/operator/partners/" + encodeURIComponent(second.actorID) + "/commission-remittances", { token: wltToken, headers: pickupRemittanceHeaders, body: pickupRemittanceBody });
const pickupRemittanceID = String(pickupRemittance.body?.remittance?.id || "");
if (pickupRemittanceID) partnerCommissionRemittanceIDs.add(pickupRemittanceID);
const pickupRemittanceReplay = await request(wltBase, "POST", "/wlt/v1/operator/partners/" + encodeURIComponent(second.actorID) + "/commission-remittances", { token: wltToken, headers: pickupRemittanceHeaders, body: pickupRemittanceBody });
const pickupReceivableAfterRemittance = sql("SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_minor ELSE -amount_minor END),0)::text FROM wlt.ledger_entries WHERE account_code='PARTNER_COMMISSION_RECEIVABLE' AND actor_type='partner' AND actor_id='" + sqlLiteral(second.actorID) + "'");
const pickupRemittanceLedgerCount = pickupRemittanceID ? sql("SELECT count(*) FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id WHERE t.source_type='PARTNER_COMMISSION_REMITTANCE' AND t.source_id='" + sqlLiteral(pickupRemittanceID) + "' AND ((e.account_code='EXTERNAL_SETTLEMENT_CASH' AND e.direction='DEBIT' AND e.amount_minor=" + pickupCommissionMinor + ") OR (e.account_code='PARTNER_COMMISSION_RECEIVABLE' AND e.actor_type='partner' AND e.actor_id='" + sqlLiteral(second.actorID) + "' AND e.direction='CREDIT' AND e.amount_minor=" + pickupCommissionMinor + "))") : "0";
if (pickupRemittance.status !== 201 || pickupRemittance.body?.remittance?.partnerActorId !== second.actorID || pickupRemittance.body.remittance.amountMinor !== pickupCommissionMinor || pickupRemittance.body.remittance.currency !== "YER" || pickupRemittance.body.remittance.verifiedBy !== actingOperatorID || pickupRemittance.body.remittance.evidenceReference !== pickupRemittanceBody.evidenceReference || !pickupRemittance.body.remittance.verifiedAt || !pickupRemittanceID || pickupRemittanceReplay.status !== 200 || pickupRemittanceReplay.body?.idempotentReplay !== true || pickupRemittanceReplay.body?.remittance?.id !== pickupRemittanceID || pickupReceivableAfterRemittance !== "0" || pickupRemittanceLedgerCount !== "2") fail("verified WLT commission remittance did not clear the receivable exactly once", JSON.stringify({ pickupRemittance, pickupRemittanceReplay, pickupReceivableAfterRemittance, pickupRemittanceLedgerCount }));
console.log("DSH_STORE_PICKUP_CASH_SETTLEMENT=PASS");


expectSQL(`SELECT inventory_on_hand_base_units || '|' || inventory_reserved_base_units FROM dsh.catalog_store_offers WHERE id='${sqlLiteral(offerAID)}'`, "10|2", "quantity inventory was not reserved atomically at checkout");
const deliveryProofBeforeHandoff = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/delivery-proof`, { token: client.accessToken });
const partnerDeliveryProof = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/delivery-proof`, { token: first.accessToken });
if (deliveryProofBeforeHandoff.status !== 200 || deliveryProofBeforeHandoff.body?.orderId !== orderID || deliveryProofBeforeHandoff.body?.state !== "PENDING" || deliveryProofBeforeHandoff.body?.code != null || partnerDeliveryProof.status !== 403) fail("delivery proof was disclosed before captain custody or crossed the customer role boundary", JSON.stringify({ status: deliveryProofBeforeHandoff.status, proofState: deliveryProofBeforeHandoff.body?.state, codeDisclosed: deliveryProofBeforeHandoff.body?.code != null, partnerStatus: partnerDeliveryProof.status }));
let deliveryProofCode = "";
const paymentIntentID = String(checkout.body.order.paymentIntentId); paymentIntentIDs.add(paymentIntentID);
const linkedPaymentRead = await request(wltBase, "GET", `/wlt/v1/payment-intents/${encodeURIComponent(paymentIntentID)}`, { token: wltToken });
const linkedPaymentAuditCount = sql(`SELECT count(*) FROM dsh.commerce_order_payment_audit WHERE order_id='${sqlLiteral(orderID)}' AND event_type='payment_intent_linked' AND payment_intent_id='${sqlLiteral(paymentIntentID)}' AND amount_minor=${mainOrderTotal}`);
const linkedAllocation = linkedPaymentRead.body?.paymentIntent?.customerPaymentAllocation;
const linkedAllocationDBCount = sql(`SELECT count(*) FROM wlt.customer_payment_allocations WHERE order_id='${sqlLiteral(orderID)}' AND payment_intent_id='${sqlLiteral(paymentIntentID)}' AND currency='YER' AND subtotal_minor=${mainOrderSubtotal} AND delivery_fee_minor=${deliveryFeeMinor} AND discount_minor=0 AND internal_balance_amount_minor=0 AND cash_amount_minor=${mainOrderTotal} AND customer_payable_minor=${mainOrderTotal} AND policy_version LIKE 'cod-current-v2;delivery=%'`);
const linkedAllocationEventCount = sql(`SELECT count(*) FROM wlt.customer_payment_allocation_events WHERE payment_intent_id='${sqlLiteral(paymentIntentID)}' AND event_type='CUSTOMER_PAYMENT_ALLOCATION_CREATED'`);
if (linkedPaymentRead.status !== 200 || linkedPaymentRead.body?.paymentIntent?.state !== "REQUIRES_COLLECTION" || linkedPaymentRead.body.paymentIntent.amountMinor !== mainOrderTotal || linkedPaymentRead.body.paymentIntent.currency !== "YER" || linkedPaymentRead.body.paymentIntent.method !== "CASH_ON_DELIVERY" || linkedPaymentAuditCount !== "1" || linkedAllocation?.orderId !== orderID || linkedAllocation?.paymentIntentId !== paymentIntentID || linkedAllocation?.currency !== "YER" || linkedAllocation?.subtotalMinor !== mainOrderSubtotal || linkedAllocation?.deliveryFeeMinor !== deliveryFeeMinor || linkedAllocation?.discountMinor !== 0 || linkedAllocation?.internalBalanceAmountMinor !== 0 || linkedAllocation?.cashAmountMinor !== mainOrderTotal || linkedAllocation?.customerPayableMinor !== mainOrderTotal || !String(linkedAllocation?.policyVersion || "").startsWith("cod-current-v2;delivery=") || linkedAllocationDBCount !== "1" || linkedAllocationEventCount !== "1") fail("checkout did not link a canonical WLT customer payment allocation", JSON.stringify({ checkout, linkedPaymentRead, linkedPaymentAuditCount, linkedAllocationDBCount, linkedAllocationEventCount }));
console.log("DSH_PAYMENT_ALLOCATION=PASS");
expectSQL(`SELECT count(*) FROM dsh.commerce_order_line_modifier_snapshots WHERE order_line_id='${sqlLiteral(checkoutLineID)}'`, "0", "shared-catalog Order unexpectedly carries store-local modifier snapshots");
expectSQL(`SELECT count(*) FROM dsh.commerce_order_line_modifier_snapshots WHERE order_line_id='${sqlLiteral(storeLocalCheckoutLineID)}' AND option_id='${sqlLiteral(modifierOptionID)}' AND option_name_ar='حليب ${sqlLiteral(suffix)}'`, "1", "store-local Order modifier snapshot readback is not immutable canonical evidence");
expectSQL(`SELECT count(*) FROM dsh.commerce_order_line_attribute_snapshots WHERE order_line_id='${sqlLiteral(checkoutLineID)}'`, "3", "Order typed Attribute snapshot readback is incomplete");
const checkoutReplay = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(checkoutKey, 2), body: { cartId: cartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } });
if (checkoutReplay.status !== 200 || checkoutReplay.body?.idempotentReplay !== true || checkoutReplay.body.order.id !== orderID || checkoutReplay.body.order.version !== 1) fail("checkout idempotency replay failed", JSON.stringify(checkoutReplay));
const closedCart = await request(dshBase, "GET", `/dsh/cart?storeId=${encodeURIComponent(first.storeID)}`, { token: client.accessToken });
if (closedCart.status !== 404) fail("checked-out cart remained an open cart", JSON.stringify(closedCart));
const rejectedCartCreate = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(`payment-reject-cart-${suffix}`, 0), body: { storeId: first.storeID, storeOfferId: offerAID, quantityBaseUnits: 1, selectedModifierOptionIds: [] } });
if (rejectedCartCreate.status !== 201 || !rejectedCartCreate.body?.cart?.id) fail("payment rejection cart fixture failed", JSON.stringify(rejectedCartCreate));
const rejectedCartID = String(rejectedCartCreate.body.cart.id); cartIDs.add(rejectedCartID);
const rejectedCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`payment-reject-checkout-${suffix}`, 1), body: { cartId: rejectedCartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } });
if (rejectedCheckout.status !== 201 || rejectedCheckout.body?.order?.paymentState !== "REQUIRES_COLLECTION" || rejectedCheckout.body.order.totalAmountMinor !== singleOrderTotal || typeof rejectedCheckout.body.order.paymentIntentId !== "string") fail("payment rejection checkout fixture failed", JSON.stringify(rejectedCheckout));
const rejectedOrderID = String(rejectedCheckout.body.order.id); orderIDs.add(rejectedOrderID);
const rejectedPaymentIntentID = String(rejectedCheckout.body.order.paymentIntentId); paymentIntentIDs.add(rejectedPaymentIntentID);
const rejectedTransition = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/orders/${encodeURIComponent(rejectedOrderID)}/transition`, { token: first.accessToken, headers: partnerHeaders(`payment-reject-transition-${suffix}`, 1), body: { state: "REJECTED" } });
await waitForSQL(`SELECT state FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='PAYMENT_CANCEL' AND order_id='${sqlLiteral(rejectedOrderID)}' AND reason='partner_rejected'`, "POSTED", "partner rejection financial handoff did not reconcile");
expectSQL(`SELECT acting_actor_id FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='PAYMENT_CANCEL' AND order_id='${sqlLiteral(rejectedOrderID)}'`, first.actorID, "partner rejection financial handoff lost actor provenance");
const rejectedOrderRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(rejectedOrderID)}`, { token: client.accessToken });
const cancelledPaymentRead = await request(wltBase, "GET", `/wlt/v1/payment-intents/${encodeURIComponent(rejectedPaymentIntentID)}`, { token: wltToken });
const cancelledPaymentAuditCount = sql(`SELECT count(*) FROM dsh.commerce_order_payment_audit WHERE order_id='${sqlLiteral(rejectedOrderID)}' AND event_type='payment_cancelled' AND payment_intent_id='${sqlLiteral(rejectedPaymentIntentID)}' AND from_state='REQUIRES_COLLECTION' AND to_state='CANCELLED'`);
if (rejectedTransition.status !== 200 || rejectedTransition.body?.order?.state !== "REJECTED" || rejectedOrderRead.status !== 200 || rejectedOrderRead.body?.order?.paymentState !== "CANCELLED" || cancelledPaymentRead.status !== 200 || cancelledPaymentRead.body?.paymentIntent?.state !== "CANCELLED" || cancelledPaymentAuditCount !== "1") fail("partner rejection did not cancel the linked WLT intent and mirror it canonically", JSON.stringify({ rejectedTransition, rejectedOrderRead, cancelledPaymentRead, cancelledPaymentAuditCount }));
expectSQL(`SELECT inventory_on_hand_base_units || '|' || inventory_reserved_base_units FROM dsh.catalog_store_offers WHERE id='${sqlLiteral(offerAID)}'`, "10|2", "partner rejection did not release only its inventory reservation");
console.log("DSH_PAYMENT_REJECTION_CANCEL=PASS");
const clientCancelCartCreate = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(`client-cancel-cart-${suffix}`, 0), body: { storeId: first.storeID, storeOfferId: offerAID, quantityBaseUnits: 1, selectedModifierOptionIds: [] } });
if (clientCancelCartCreate.status !== 201 || !clientCancelCartCreate.body?.cart?.id) fail("client cancellation cart fixture failed", JSON.stringify(clientCancelCartCreate));
const clientCancelCartID = String(clientCancelCartCreate.body.cart.id); cartIDs.add(clientCancelCartID);
const clientCancelCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`client-cancel-checkout-${suffix}`, 1), body: { cartId: clientCancelCartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } });
if (clientCancelCheckout.status !== 201 || clientCancelCheckout.body?.order?.state !== "CREATED" || clientCancelCheckout.body.order.version !== 1 || clientCancelCheckout.body.order.paymentState !== "REQUIRES_COLLECTION") fail("client cancellation checkout fixture failed", JSON.stringify(clientCancelCheckout));
const clientCancelOrderID = String(clientCancelCheckout.body.order.id); orderIDs.add(clientCancelOrderID);
const clientCancelPaymentIntentID = String(clientCancelCheckout.body.order.paymentIntentId); paymentIntentIDs.add(clientCancelPaymentIntentID);
const clientCancelKey = `client-cancel-${suffix}`;
const clientCancellation = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(clientCancelOrderID)}/cancel`, { token: client.accessToken, headers: partnerHeaders(clientCancelKey, 1) });
const clientCancellationReplay = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(clientCancelOrderID)}/cancel`, { token: client.accessToken, headers: partnerHeaders(clientCancelKey, 1) });
await waitForSQL(`SELECT state FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='PAYMENT_CANCEL' AND order_id='${sqlLiteral(clientCancelOrderID)}' AND reason='client_cancelled'`, "POSTED", "client cancellation financial handoff did not reconcile");
expectSQL(`SELECT acting_actor_id FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='PAYMENT_CANCEL' AND order_id='${sqlLiteral(clientCancelOrderID)}'`, client.actorID, "client cancellation financial handoff lost actor provenance");
const clientCancelledRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(clientCancelOrderID)}`, { token: client.accessToken });
const partnerCancelledRead = await request(dshBase, "GET", `/dsh/stores/${encodeURIComponent(first.storeID)}/orders/${encodeURIComponent(clientCancelOrderID)}`, { token: first.accessToken });
const operatorCancelledRead = await request(dshBase, "GET", `/dsh/operator/operations/${encodeURIComponent(clientCancelOrderID)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const clientCancelledPaymentRead = await request(wltBase, "GET", `/wlt/v1/payment-intents/${encodeURIComponent(clientCancelPaymentIntentID)}`, { token: wltToken });
const clientCancelledOrderAuditCount = sql(`SELECT count(*) FROM dsh.commerce_order_audit WHERE order_id='${sqlLiteral(clientCancelOrderID)}' AND event_type='order_cancelled'`);
const clientCancelledPaymentAuditCount = sql(`SELECT count(*) FROM dsh.commerce_order_payment_audit WHERE order_id='${sqlLiteral(clientCancelOrderID)}' AND event_type='payment_cancelled' AND payment_intent_id='${sqlLiteral(clientCancelPaymentIntentID)}' AND from_state='REQUIRES_COLLECTION' AND to_state='CANCELLED'`);
if (clientCancellation.status !== 201 || clientCancellation.body?.order?.state !== "CANCELLED" || clientCancellation.body.order.version !== 2 || clientCancellationReplay.status !== 200 || clientCancellationReplay.body?.idempotentReplay !== true || clientCancellationReplay.body.order.version !== 2 || clientCancelledRead.status !== 200 || clientCancelledRead.body?.order?.state !== "CANCELLED" || clientCancelledRead.body.order.paymentState !== "CANCELLED" || partnerCancelledRead.status !== 200 || partnerCancelledRead.body?.order?.state !== "CANCELLED" || operatorCancelledRead.status !== 200 || operatorCancelledRead.body?.operation?.order?.state !== "CANCELLED" || clientCancelledPaymentRead.status !== 200 || clientCancelledPaymentRead.body?.paymentIntent?.state !== "CANCELLED" || clientCancelledOrderAuditCount !== "1" || clientCancelledPaymentAuditCount !== "1") fail("client Order cancellation did not close the DSH/WLT journey across surfaces", JSON.stringify({ clientCancellation, clientCancellationReplay, clientCancelledRead, partnerCancelledRead, operatorCancelledRead, clientCancelledPaymentRead, clientCancelledOrderAuditCount, clientCancelledPaymentAuditCount }));
expectSQL(`SELECT inventory_on_hand_base_units || '|' || inventory_reserved_base_units FROM dsh.catalog_store_offers WHERE id='${sqlLiteral(offerAID)}'`, "10|2", "client cancellation did not release its inventory reservation");
console.log("DSH_CLIENT_ORDER_CANCELLATION=PASS");
const clientOrders = await request(dshBase, "GET", "/dsh/orders?limit=10", { token: client.accessToken });
const clientOrderRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}`, { token: client.accessToken });
const partnerOrders = await request(dshBase, "GET", `/dsh/stores/${first.storeID}/orders?limit=10`, { token: first.accessToken });
const partnerOrderRead = await request(dshBase, "GET", `/dsh/stores/${first.storeID}/orders/${encodeURIComponent(orderID)}`, { token: first.accessToken });
const storeLocalClientOrderRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(storeLocalOrderID)}`, { token: client.accessToken });
const storeLocalPartnerOrderRead = await request(dshBase, "GET", `/dsh/stores/${storeLocal.storeID}/orders/${encodeURIComponent(storeLocalOrderID)}`, { token: storeLocal.accessToken });
if (clientOrders.status !== 200 || !clientOrders.body?.orders?.some((item) => item.id === orderID) || clientOrderRead.status !== 200 || clientOrderRead.body?.order?.id !== orderID || partnerOrders.status !== 200 || !partnerOrders.body?.orders?.some((item) => item.id === orderID) || partnerOrderRead.status !== 200 || partnerOrderRead.body?.order?.id !== orderID || !partnerOrderRead.body.order.lines?.[0]?.attributeSnapshots?.some((snapshot) => snapshot.attributeId === enumAttributeID && snapshot.enumValue === "Dark") || storeLocalClientOrderRead.status !== 200 || storeLocalPartnerOrderRead.status !== 200 || !storeLocalClientOrderRead.body?.order?.lines?.[0]?.modifierSnapshots?.some((snapshot) => snapshot.optionId === modifierOptionID && snapshot.priceDeltaMinor === 300) || !storeLocalPartnerOrderRead.body?.order?.lines?.[0]?.modifierSnapshots?.some((snapshot) => snapshot.optionId === modifierOptionID && snapshot.priceDeltaMinor === 300)) fail("client/partner Order readback boundary failed", JSON.stringify({ clientOrders, clientOrderRead, partnerOrders, partnerOrderRead, storeLocalClientOrderRead, storeLocalPartnerOrderRead }));
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
if (invalidTransition.status !== 409 || finalOrder.status !== 200 || finalOrder.body?.order?.state !== "READY_FOR_DISPATCH" || finalOrder.body.order.version !== 4 || finalOrder.body.order.paymentState !== "REQUIRES_COLLECTION" || finalOrder.body.order.lines?.[0]?.lineAmountMinor !== mainOrderSubtotal) fail("Order final readback or invalid transition guard failed", JSON.stringify({ invalidTransition, finalOrder }));
console.log("DSH_CART_CHECKOUT=PASS");
console.log("DSH_ORDER_READY_FOR_DISPATCH=PASS");

const captainPhone = `+96779${crypto.randomInt(1_000_000, 9_999_999)}`;
const captainAdmissionResponse = await request(dshBase, "POST", "/dsh/captains/admissions", { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-admit-${suffix}`), body: { contactPhoneE164: captainPhone } });
if (captainAdmissionResponse.status !== 201 || captainAdmissionResponse.body?.admission?.state !== "eligible" || !captainAdmissionResponse.body.admission.actorId) fail("Captain admission did not bind an eligible Identity actor", JSON.stringify(captainAdmissionResponse));
const captainAdmissionID = String(captainAdmissionResponse.body.admission.id);
const captainActorID = String(captainAdmissionResponse.body.admission.actorId);
captainAdmissionIDs.add(captainAdmissionID); actorIDs.add(captainActorID);
const captainAccessToken = await activateCaptain(captainPhone, `Capt${suffix.slice(0, 4)}`);
const captainOpeningFunding = await request(wltBase, "POST", `/wlt/v1/operator/captains/${encodeURIComponent(captainActorID)}/opening-funding`, { token: wltToken, headers: serviceHeaders(actingOperatorID, `captain-opening-funding-${suffix}`), body: { amountMinor: mainOrderTotal, fundingReason: "runtime proof COD opening collateral", evidenceReference: `captain-opening-funding-proof-${suffix}` } });
const captainOpeningFundingReplay = await request(wltBase, "POST", `/wlt/v1/operator/captains/${encodeURIComponent(captainActorID)}/opening-funding`, { token: wltToken, headers: serviceHeaders(actingOperatorID, `captain-opening-funding-${suffix}`), body: { amountMinor: mainOrderTotal, fundingReason: "runtime proof COD opening collateral", evidenceReference: `captain-opening-funding-proof-${suffix}` } });
if (captainOpeningFunding.status !== 201 || captainOpeningFunding.body?.funding?.captainActorId !== captainActorID || captainOpeningFunding.body?.funding?.amountMinor !== mainOrderTotal || captainOpeningFundingReplay.status !== 200 || captainOpeningFundingReplay.body?.idempotentReplay !== true || captainOpeningFundingReplay.body?.funding?.id !== captainOpeningFunding.body?.funding?.id) fail("Captain opening funding did not produce an idempotent WLT ledger-backed balance", JSON.stringify({ captainOpeningFunding, captainOpeningFundingReplay }));
captainFundingIDs.add(String(captainOpeningFunding.body.funding.id));
const captainWalletBeforeDispatch = await request(wltBase, "GET", `/wlt/v1/captains/${encodeURIComponent(captainActorID)}/wallet-state`, { token: wltToken });
if (captainWalletBeforeDispatch.status !== 200 || captainWalletBeforeDispatch.body?.state?.availableMinor !== mainOrderTotal || captainWalletBeforeDispatch.body?.state?.heldMinor !== 0) fail("Captain opening wallet readback was not canonical", JSON.stringify(captainWalletBeforeDispatch));
const captainSelf = await request(dshBase, "GET", "/dsh/captains/me", { token: captainAccessToken });
const captainAvailability = await request(dshBase, "POST", "/dsh/captains/me/availability", { token: captainAccessToken, headers: partnerHeaders(`captain-availability-${suffix}`, captainSelf.body?.admission?.version), body: { available: true } });
const partnerCaptainOffers = await request(dshBase, "GET", "/dsh/captains/me/offers", { token: first.accessToken });
if (captainSelf.status !== 200 || captainSelf.body?.admission?.actorId !== captainActorID || captainAvailability.status !== 200 || captainAvailability.body?.admission?.availabilityState !== "available" || partnerCaptainOffers.status !== 403) fail("Captain session or cross-role Captain read boundary failed", JSON.stringify({ captainSelf, captainAvailability, partnerCaptainOffers }));
const firstDispatchKey = `captain-dispatch-first-${suffix}`;
const firstDispatch = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/dispatch`, { token: dshToken, headers: serviceHeaders(actingOperatorID, firstDispatchKey) });
if (firstDispatch.status !== 201 || firstDispatch.body?.offer?.state !== "offered" || firstDispatch.body.offer.captainActorId !== captainActorID || firstDispatch.body.offer.storeName !== "Catalog Runtime A store" || firstDispatch.body.offer.customerAddressText !== `عنوان أ ${suffix}` || firstDispatch.body.offer.amountDueMinor !== mainOrderTotal || firstDispatch.body.offer.currency !== "YER" || firstDispatch.body.offer.paymentMethod !== "CASH_ON_DELIVERY" || firstDispatch.body.offer.paymentState !== "REQUIRES_COLLECTION") fail("Captain dispatch did not create an addressed offer with canonical order context", JSON.stringify(firstDispatch));
const firstCaptainOfferID = String(firstDispatch.body.offer.id); captainOfferIDs.add(firstCaptainOfferID);
const firstDispatchReplay = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/dispatch`, { token: dshToken, headers: serviceHeaders(actingOperatorID, firstDispatchKey) });
const captainOffersAfterDispatch = await request(dshBase, "GET", "/dsh/captains/me/offers", { token: captainAccessToken });
if (firstDispatchReplay.status !== 200 || firstDispatchReplay.body?.idempotentReplay !== true || firstDispatchReplay.body.offer.id !== firstCaptainOfferID || captainOffersAfterDispatch.status !== 200 || !captainOffersAfterDispatch.body?.offers?.some((offer) => offer.id === firstCaptainOfferID && offer.state === "offered" && offer.storeName === "Catalog Runtime A store" && offer.customerAddressText === `عنوان أ ${suffix}` && offer.amountDueMinor === mainOrderTotal && offer.paymentState === "REQUIRES_COLLECTION")) fail("Captain dispatch idempotent readback did not preserve canonical order context", JSON.stringify({ firstDispatchReplay, captainOffersAfterDispatch }));
const rejectKey = `captain-reject-${suffix}`;
const rejectedOffer = await request(dshBase, "POST", `/dsh/captains/me/offers/${encodeURIComponent(firstCaptainOfferID)}/respond`, { token: captainAccessToken, headers: partnerHeaders(rejectKey, 1), body: { decision: "reject" } });
const rejectedReplay = await request(dshBase, "POST", `/dsh/captains/me/offers/${encodeURIComponent(firstCaptainOfferID)}/respond`, { token: captainAccessToken, headers: partnerHeaders(rejectKey, 1), body: { decision: "reject" } });
await waitForSQL(`SELECT state FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='CAPTAIN_COD_RELEASE' AND order_id='${sqlLiteral(orderID)}' AND source_ref='${sqlLiteral(firstCaptainOfferID)}'`, "POSTED", "rejected offer COD release handoff did not reconcile");
expectSQL(`SELECT captain_actor_id || '|' || acting_actor_id FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='CAPTAIN_COD_RELEASE' AND order_id='${sqlLiteral(orderID)}' AND source_ref='${sqlLiteral(firstCaptainOfferID)}'`, `${captainActorID}|${captainActorID}`, "rejected offer release lost actor provenance");
if (rejectedOffer.status !== 200 || rejectedOffer.body?.offer?.state !== "rejected" || rejectedReplay.status !== 200 || rejectedReplay.body?.idempotentReplay !== true || rejectedReplay.body.offer.state !== "rejected") fail("Captain offer rejection or replay failed", JSON.stringify({ rejectedOffer, rejectedReplay }));
const secondDispatch = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/dispatch`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-dispatch-second-${suffix}`) });
if (secondDispatch.status !== 201 || secondDispatch.body?.offer?.state !== "offered" || secondDispatch.body.offer.captainActorId !== captainActorID) fail("Captain redispatch after rejection failed", JSON.stringify(secondDispatch));
const secondCaptainOfferID = String(secondDispatch.body.offer.id); captainOfferIDs.add(secondCaptainOfferID);
const acceptedCaptainOffer = await request(dshBase, "POST", `/dsh/captains/me/offers/${encodeURIComponent(secondCaptainOfferID)}/respond`, { token: captainAccessToken, headers: partnerHeaders(`captain-accept-${suffix}`, 1), body: { decision: "accept" } });
if (acceptedCaptainOffer.status !== 200 || acceptedCaptainOffer.body?.offer?.state !== "accepted" || acceptedCaptainOffer.body?.assignment?.state !== "assigned") fail("Captain offer acceptance did not create one assignment", JSON.stringify(acceptedCaptainOffer));
const captainAssignmentID = String(acceptedCaptainOffer.body.assignment.id); captainAssignmentIDs.add(captainAssignmentID);
const captainWalletAfterReserve = await request(wltBase, "GET", `/wlt/v1/captains/${encodeURIComponent(captainActorID)}/wallet-state`, { token: wltToken });
const captainReservationCount = sql(`SELECT count(*) FROM wlt.captain_cod_reservations WHERE order_id='${sqlLiteral(orderID)}' AND payment_intent_id='${sqlLiteral(paymentIntentID)}' AND captain_actor_id='${sqlLiteral(captainActorID)}' AND amount_minor=${mainOrderTotal} AND state='ACTIVE'`);
if (captainWalletAfterReserve.status !== 200 || captainWalletAfterReserve.body?.state?.availableMinor !== 0 || captainWalletAfterReserve.body?.state?.heldMinor !== mainOrderTotal || captainReservationCount !== "1") fail("Captain COD was not atomically reserved from the order allocation", JSON.stringify({ captainWalletAfterReserve, captainReservationCount }));
const secondCaptainPhone = `+96779${crypto.randomInt(1_000_000, 9_999_999)}`;
const secondCaptainAdmission = await request(dshBase, "POST", "/dsh/captains/admissions", { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-admit-second-${suffix}`), body: { contactPhoneE164: secondCaptainPhone } });
if (secondCaptainAdmission.status !== 201 || !secondCaptainAdmission.body?.admission?.actorId) fail("second Captain fixture failed", JSON.stringify(secondCaptainAdmission));
const secondCaptainAdmissionID = String(secondCaptainAdmission.body.admission.id);
const secondCaptainActorID = String(secondCaptainAdmission.body.admission.actorId);
captainAdmissionIDs.add(secondCaptainAdmissionID); actorIDs.add(secondCaptainActorID);
const secondCaptainAccessToken = await activateCaptain(secondCaptainPhone, `Capt${suffix.slice(0, 4)}`);
const secondCaptainFunding = await request(wltBase, "POST", `/wlt/v1/operator/captains/${encodeURIComponent(secondCaptainActorID)}/opening-funding`, { token: wltToken, headers: serviceHeaders(actingOperatorID, `captain-opening-funding-second-${suffix}`), body: { amountMinor: mainOrderTotal, fundingReason: "runtime proof reassignment COD collateral", evidenceReference: `captain-opening-funding-second-proof-${suffix}` } });
if (secondCaptainFunding.status !== 201 || secondCaptainFunding.body?.funding?.captainActorId !== secondCaptainActorID || secondCaptainFunding.body.funding.amountMinor !== mainOrderTotal) fail("second Captain funding failed", JSON.stringify(secondCaptainFunding));
captainFundingIDs.add(String(secondCaptainFunding.body.funding.id));
const secondCaptainSelf = await request(dshBase, "GET", "/dsh/captains/me", { token: secondCaptainAccessToken });
const secondCaptainAvailability = await request(dshBase, "POST", "/dsh/captains/me/availability", { token: secondCaptainAccessToken, headers: partnerHeaders(`captain-availability-second-${suffix}`, secondCaptainSelf.body?.admission?.version), body: { available: true } });
if (secondCaptainSelf.status !== 200 || secondCaptainAvailability.status !== 200 || secondCaptainAvailability.body?.admission?.availabilityState !== "available") fail("second Captain availability failed", JSON.stringify({ secondCaptainSelf, secondCaptainAvailability }));

const reassignKey = `captain-reassign-active-${suffix}`;
const reassigned = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/reassign`, { token: dshToken, headers: serviceHeaders(actingOperatorID, reassignKey) });
const reassignedReplay = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/reassign`, { token: dshToken, headers: serviceHeaders(actingOperatorID, reassignKey) });
if (reassigned.status !== 201 || reassigned.body?.offer?.state !== "offered" || reassigned.body.offer.captainActorId !== secondCaptainActorID || reassignedReplay.status !== 200 || reassignedReplay.body?.idempotentReplay !== true || reassignedReplay.body.offer.id !== reassigned.body.offer.id) fail("Captain reassignment did not produce one idempotent replacement offer", JSON.stringify({ reassigned, reassignedReplay }));
const reassignedOfferID = String(reassigned.body.offer.id); captainOfferIDs.add(reassignedOfferID);
await waitForSQL(`SELECT state FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='CAPTAIN_COD_RELEASE' AND order_id='${sqlLiteral(orderID)}' AND source_ref='${sqlLiteral(captainAssignmentID)}'`, "POSTED", "reassignment COD release handoff did not reconcile");
expectSQL(`SELECT captain_actor_id || '|' || acting_actor_id FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='CAPTAIN_COD_RELEASE' AND order_id='${sqlLiteral(orderID)}' AND source_ref='${sqlLiteral(captainAssignmentID)}'`, `${captainActorID}|${actingOperatorID}`, "reassignment COD release lost actor provenance");
expectSQL(`SELECT state FROM wlt.captain_cod_reservations WHERE order_id='${sqlLiteral(orderID)}' AND captain_actor_id='${sqlLiteral(captainActorID)}'`, "RELEASED", "reassignment did not release the previous Captain COD reservation");
const firstCaptainWalletAfterReassign = await request(wltBase, "GET", `/wlt/v1/captains/${encodeURIComponent(captainActorID)}/wallet-state`, { token: wltToken });
if (firstCaptainWalletAfterReassign.status !== 200 || firstCaptainWalletAfterReassign.body?.state?.availableMinor !== mainOrderTotal || firstCaptainWalletAfterReassign.body?.state?.heldMinor !== 0) fail("reassignment did not restore previous Captain collateral", JSON.stringify(firstCaptainWalletAfterReassign));

const reassignedAccepted = await request(dshBase, "POST", `/dsh/captains/me/offers/${encodeURIComponent(reassignedOfferID)}/respond`, { token: secondCaptainAccessToken, headers: partnerHeaders(`captain-accept-reassigned-${suffix}`, 1), body: { decision: "accept" } });
if (reassignedAccepted.status !== 200 || reassignedAccepted.body?.offer?.state !== "accepted" || reassignedAccepted.body?.assignment?.state !== "assigned" || reassignedAccepted.body.assignment.captainActorId !== secondCaptainActorID) fail("reassigned Captain did not accept the replacement offer", JSON.stringify(reassignedAccepted));
const activeCaptainActorID = secondCaptainActorID;
const activeCaptainAccessToken = secondCaptainAccessToken;
const activeCaptainAssignmentID = String(reassignedAccepted.body.assignment.id); captainAssignmentIDs.add(activeCaptainAssignmentID);
const activeCaptainWalletAfterReserve = await request(wltBase, "GET", `/wlt/v1/captains/${encodeURIComponent(activeCaptainActorID)}/wallet-state`, { token: wltToken });
const activeReservationCountAfterReassign = sql(`SELECT count(*) FROM wlt.captain_cod_reservations WHERE order_id='${sqlLiteral(orderID)}' AND payment_intent_id='${sqlLiteral(paymentIntentID)}' AND captain_actor_id='${sqlLiteral(activeCaptainActorID)}' AND amount_minor=${mainOrderTotal} AND state='ACTIVE'`);
if (activeCaptainWalletAfterReserve.status !== 200 || activeCaptainWalletAfterReserve.body?.state?.availableMinor !== 0 || activeCaptainWalletAfterReserve.body?.state?.heldMinor !== mainOrderTotal || activeReservationCountAfterReassign !== "1") fail("replacement Captain COD reservation was not canonical", JSON.stringify({ activeCaptainWalletAfterReserve, activeReservationCountAfterReassign }));

const captainDeliveryTask = await request(dshBase, "GET", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/delivery-task`, { token: activeCaptainAccessToken });
const wrongCaptainDeliveryTask = await request(dshBase, "GET", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/delivery-task`, { token: captainAccessToken });
const taskKeys = Object.keys(captainDeliveryTask.body?.task || {}).sort().join(",");
if (captainDeliveryTask.status !== 200 || captainDeliveryTask.body?.task?.assignmentId !== activeCaptainAssignmentID || captainDeliveryTask.body?.task?.storeId !== first.storeID || captainDeliveryTask.body?.task?.storeName !== "Catalog Runtime A store" || captainDeliveryTask.body?.task?.pickupOrigin?.latitude !== firstStoreOrigin.firstStoreLatitude || captainDeliveryTask.body?.task?.pickupOrigin?.longitude !== firstStoreOrigin.firstStoreLongitude || captainDeliveryTask.body?.task?.customerDestination?.latitude !== 15.369446 || captainDeliveryTask.body?.task?.orderState !== "CAPTAIN_ASSIGNED" || captainDeliveryTask.body?.task?.handoffState !== "pending" || captainDeliveryTask.body?.task?.deliveryState !== "assigned" || taskKeys.includes("clientActorId") || wrongCaptainDeliveryTask.status !== 404) fail("bounded Captain delivery task projection or actor boundary failed after reassignment", JSON.stringify({ captainDeliveryTask, wrongCaptainDeliveryTask }));
const pickupBeforeHandoff = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/pickup`, { token: activeCaptainAccessToken, headers: partnerHeaders(`captain-pickup-before-store-${suffix}`, 1), body: {} });
const storeAssignment = await request(dshBase, "GET", `/dsh/stores/${encodeURIComponent(first.storeID)}/orders/${encodeURIComponent(orderID)}/captain-assignment`, { token: first.accessToken });
if (pickupBeforeHandoff.status !== 409 || storeAssignment.status !== 200 || storeAssignment.body?.assignment?.id !== activeCaptainAssignmentID || storeAssignment.body.assignment.handoff.state !== "pending") fail("Store handoff boundary did not fail closed after reassignment", JSON.stringify({ pickupBeforeHandoff, storeAssignment }));
const confirmedHandoff = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(first.storeID)}/orders/${encodeURIComponent(orderID)}/handoff`, { token: first.accessToken, headers: partnerHeaders(`captain-handoff-${suffix}`, 1), body: { assignmentId: activeCaptainAssignmentID } });
if (confirmedHandoff.status !== 200 || confirmedHandoff.body?.assignment?.handoff?.state !== "store_confirmed") fail("Store Captain handoff confirmation failed", JSON.stringify(confirmedHandoff));
const confirmedHandoffReplay = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(first.storeID)}/orders/${encodeURIComponent(orderID)}/handoff`, { token: first.accessToken, headers: partnerHeaders(`captain-handoff-${suffix}`, 1), body: { assignmentId: activeCaptainAssignmentID } });
if (confirmedHandoffReplay.status !== 200 || confirmedHandoffReplay.body?.idempotentReplay !== true || confirmedHandoffReplay.body.assignment.handoff.state !== "store_confirmed") fail("Store Captain handoff replay failed", JSON.stringify(confirmedHandoffReplay));
const pickedUp = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/pickup`, { token: activeCaptainAccessToken, headers: partnerHeaders(`captain-pickup-${suffix}`, 2), body: {} });
const inCustodyOrder = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}`, { token: client.accessToken });
const deliveryProof = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/delivery-proof`, { token: client.accessToken });
const captainProtectedProof = sql(`SELECT state || '|' || (code_ciphertext IS NOT NULL)::text || '|' || (code_verifier ~ '^[0-9a-f]{64}$')::text || '|' || (code_key_id IS NOT NULL)::text FROM dsh.commerce_order_delivery_proofs WHERE order_id='${sqlLiteral(orderID)}'`);
if (pickedUp.status !== 200 || inCustodyOrder.status !== 200 || inCustodyOrder.body?.order?.state !== "IN_CUSTODY" || deliveryProof.status !== 200 || deliveryProof.body?.state !== "PENDING" || !/^[0-9]{6}$/.test(String(deliveryProof.body?.code || "")) || captainProtectedProof !== "PENDING|true|true|true") fail("delivery proof disclosure or pending at-rest protection failed", JSON.stringify({ pickupStatus: pickedUp.status, orderState: inCustodyOrder.body?.order?.state, proofStatus: deliveryProof.status, proofState: deliveryProof.body?.state, codeDisclosed: Boolean(deliveryProof.body?.code), atRestProtected: captainProtectedProof === "PENDING|true|true|true" }));
deliveryProofCode = String(deliveryProof.body.code);
const captainLocationKey = `captain-location-${suffix}`;
const locationHeaders = (key) => ({ "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": key });
const captainLocation = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/location`, { token: activeCaptainAccessToken, headers: locationHeaders(captainLocationKey), body: { latitude: 15.3701, longitude: 44.1911 } });
const captainLocationReplay = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/location`, { token: activeCaptainAccessToken, headers: locationHeaders(captainLocationKey), body: { latitude: 15.3701, longitude: 44.1911 } });
const wrongCaptainLocation = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/location`, { token: captainAccessToken, headers: locationHeaders(`captain-location-wrong-${suffix}`), body: { latitude: 15.3702, longitude: 44.1912 } });
const clientTracking = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/tracking`, { token: client.accessToken });
const failedDelivery = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/complete`, { token: activeCaptainAccessToken, headers: partnerHeaders(`captain-failed-${suffix}`, 2), body: { result: "delivery_failed" } });
const failedOrder = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}`, { token: client.accessToken });
const captainAfterFailure = await request(dshBase, "GET", "/dsh/captains/me", { token: activeCaptainAccessToken });
const captainWalletAfterFailure = await request(wltBase, "GET", `/wlt/v1/captains/${encodeURIComponent(activeCaptainActorID)}/wallet-state`, { token: wltToken });
const activeCaptainReservationCount = sql(`SELECT count(*) FROM wlt.captain_cod_reservations WHERE order_id='${sqlLiteral(orderID)}' AND state='ACTIVE'`);
if (captainWalletAfterFailure.status !== 200 || captainWalletAfterFailure.body?.state?.availableMinor !== 0 || captainWalletAfterFailure.body?.state?.heldMinor !== mainOrderTotal || activeCaptainReservationCount !== "1") fail("Captain COD authorization was not retained across recoverable delivery failure", JSON.stringify({ captainWalletAfterFailure, activeCaptainReservationCount }));
const recoveryKey = `captain-recover-${suffix}`;
const recovered = await request(dshBase, "POST", `/dsh/captains/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/recover`, { token: dshToken, headers: serviceHeaders(actingOperatorID, recoveryKey, crypto.randomUUID(), 3) });
const recoveredReplay = await request(dshBase, "POST", `/dsh/captains/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/recover`, { token: dshToken, headers: serviceHeaders(actingOperatorID, recoveryKey, crypto.randomUUID(), 3) });
const recoveredTask = await request(dshBase, "GET", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/delivery-task`, { token: activeCaptainAccessToken });
const reassignmentAfterFailure = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/reassign`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-reassign-after-failure-${suffix}`) });
const wrongCaptainCompletion = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/complete`, { token: captainAccessToken, headers: partnerHeaders(`captain-complete-wrong-owner-${suffix}`, 4), body: { result: "delivered", collectedAmountMinor: mainOrderTotal, deliveryProofCode } });
const paymentAfterWrongCaptain = await request(wltBase, "GET", `/wlt/v1/payment-intents/${encodeURIComponent(paymentIntentID)}`, { token: wltToken });
const wrongProof = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/complete`, { token: activeCaptainAccessToken, headers: partnerHeaders(`captain-complete-proof-wrong-${suffix}`, 4), body: { result: "delivered", collectedAmountMinor: mainOrderTotal, deliveryProofCode: "000000" } });
const paymentAfterWrongProof = await request(wltBase, "GET", `/wlt/v1/payment-intents/${encodeURIComponent(paymentIntentID)}`, { token: wltToken });
const wrongCollection = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/complete`, { token: activeCaptainAccessToken, headers: partnerHeaders(`captain-complete-wrong-${suffix}`, 4), body: { result: "delivered", collectedAmountMinor: mainOrderTotal - 1, deliveryProofCode } });
const completed = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/complete`, { token: activeCaptainAccessToken, headers: partnerHeaders(`captain-complete-${suffix}`, 4), body: { result: "delivered", collectedAmountMinor: mainOrderTotal, deliveryProofCode } });
const completedReplay = await request(dshBase, "POST", `/dsh/captains/me/assignments/${encodeURIComponent(activeCaptainAssignmentID)}/complete`, { token: activeCaptainAccessToken, headers: partnerHeaders(`captain-complete-${suffix}`, 4), body: { result: "delivered", collectedAmountMinor: mainOrderTotal, deliveryProofCode } });
await waitForSQL(`SELECT state FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='DELIVERY_SETTLEMENT' AND order_id='${sqlLiteral(orderID)}' AND source_ref='${sqlLiteral(activeCaptainAssignmentID)}'`, "POSTED", "delivery settlement financial handoff did not reconcile");
expectSQL(`SELECT captain_actor_id || '|' || partner_actor_id || '|' || acting_actor_id FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='DELIVERY_SETTLEMENT' AND order_id='${sqlLiteral(orderID)}'`, `${activeCaptainActorID}|${first.actorID}|${activeCaptainActorID}`, "delivery settlement financial handoff lost canonical actors");
const partnerFinancialSummary = await request(dshBase, "GET", "/dsh/partners/me/financial-summary", { token: first.accessToken });
const operatorPartnerFinancialSummary = await request(dshBase, "GET", `/dsh/operator/partners/${encodeURIComponent(first.actorID)}/financial-summary`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const partnerEarningRowCount = sql(`SELECT count(*) FROM wlt.partner_order_earnings WHERE order_id='${sqlLiteral(orderID)}' AND payment_intent_id='${sqlLiteral(paymentIntentID)}' AND partner_actor_id='${sqlLiteral(first.actorID)}' AND captain_actor_id='${sqlLiteral(activeCaptainActorID)}' AND gross_product_minor=${mainOrderSubtotal} AND delivery_fee_minor=${deliveryFeeMinor} AND commission_minor=650 AND partner_net_minor=3550`);
const partnerLedgerTransactionCount = sql(`SELECT count(*) FROM wlt.ledger_transactions WHERE source_type='ORDER_DELIVERED' AND source_id='${sqlLiteral(orderID)}' AND transaction_type='PARTNER_ORDER_EARNING_POSTED'`);
const partnerLedgerEntryBalance = sql(`SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_minor ELSE 0 END),0) || '|' || COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE 0 END),0) FROM wlt.ledger_entries WHERE transaction_id=(SELECT ledger_transaction_id FROM wlt.partner_order_earnings WHERE order_id='${sqlLiteral(orderID)}')`);
const partnerLedgerEntryCount = sql(`SELECT count(*) FROM wlt.ledger_entries WHERE transaction_id=(SELECT ledger_transaction_id FROM wlt.partner_order_earnings WHERE order_id='${sqlLiteral(orderID)}')`);
const deliveredOrder = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}`, { token: client.accessToken });
const verifiedDeliveryProof = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/delivery-proof`, { token: client.accessToken });
const verifiedDeliveryProofStorage = sql(`SELECT state || '|' || (code_ciphertext IS NULL)::text || '|' || (code_verifier IS NULL)::text || '|' || (code_key_id IS NULL)::text FROM dsh.commerce_order_delivery_proofs WHERE order_id='${sqlLiteral(orderID)}'`);
const completedTracking = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/tracking`, { token: client.accessToken });
const captainAfterDelivery = await request(dshBase, "GET", "/dsh/captains/me", { token: activeCaptainAccessToken });
const collectedPaymentRead = await request(wltBase, "GET", `/wlt/v1/payment-intents/${encodeURIComponent(paymentIntentID)}`, { token: wltToken });
const captainWalletAfterDelivery = await request(wltBase, "GET", `/wlt/v1/captains/${encodeURIComponent(activeCaptainActorID)}/wallet-state`, { token: wltToken });
const finalizedCaptainReservationCount = sql(`SELECT count(*) FROM wlt.captain_cod_reservations r WHERE r.order_id='${sqlLiteral(orderID)}' AND r.payment_intent_id='${sqlLiteral(paymentIntentID)}' AND r.captain_actor_id='${sqlLiteral(activeCaptainActorID)}' AND r.amount_minor=${mainOrderTotal} AND r.state='FINALIZED' AND EXISTS (SELECT 1 FROM wlt.captain_cod_reservation_events e WHERE e.reservation_id=r.id AND e.event_type='CAPTAIN_COD_FINALIZED')`);
const collectedPaymentAuditCount = sql(`SELECT count(*) FROM dsh.commerce_order_payment_audit WHERE order_id='${sqlLiteral(orderID)}' AND event_type='payment_collected' AND payment_intent_id='${sqlLiteral(paymentIntentID)}' AND from_state='REQUIRES_COLLECTION' AND to_state='COLLECTED' AND amount_minor=${mainOrderTotal}`);
const inventoryAtZero = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`inventory-zero-${suffix}`, 5), body: discreteStockOffer(1800, "published", true, 0) });
const inventoryPublicEmpty = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}`);
const inventoryRestored = await request(dshBase, "PATCH", `/dsh/stores/${first.storeID}/offers/${offerAID}`, { token: first.accessToken, headers: partnerHeaders(`inventory-restore-${suffix}`, 6), body: discreteStockOffer(1800, "published", true, 8) });
const inventoryPublicRestored = await request(dshBase, "GET", `/dsh/public/stores/${first.storeID}/catalog?serviceCityId=${encodeURIComponent(cityA)}`);
expectSQL(`SELECT inventory_on_hand_base_units || '|' || inventory_reserved_base_units FROM dsh.catalog_store_offers WHERE id='${sqlLiteral(offerAID)}'`, "8|0", "delivery did not consume reserved inventory");
if (wrongCaptainCompletion.status !== 409 || wrongCaptainCompletion.body?.error?.code !== "VERSION_OR_STATE_CONFLICT" || paymentAfterWrongCaptain.status !== 200 || paymentAfterWrongCaptain.body?.paymentIntent?.state !== "REQUIRES_COLLECTION") fail("a non-assigned Captain could reach COD collection before authorization", JSON.stringify({ status: wrongCaptainCompletion.status, error: wrongCaptainCompletion.body?.error?.code, paymentState: paymentAfterWrongCaptain.body?.paymentIntent?.state }));
if (wrongProof.status !== 409 || wrongProof.body?.error?.code !== "DELIVERY_PROOF_INVALID") fail("incorrect delivery proof was accepted", JSON.stringify(wrongProof));
if (paymentAfterWrongProof.status !== 200 || paymentAfterWrongProof.body?.paymentIntent?.state !== "REQUIRES_COLLECTION") fail("incorrect delivery proof mutated cash collection state", JSON.stringify(paymentAfterWrongProof));
if (verifiedDeliveryProof.status !== 200 || verifiedDeliveryProof.body?.state !== "VERIFIED" || verifiedDeliveryProof.body?.code !== undefined || verifiedDeliveryProofStorage !== "VERIFIED|true|true|true") fail("verified delivery proof readback exposed the customer code or retained protected material", JSON.stringify({ proofState: verifiedDeliveryProof.body?.state, codeDisclosed: verifiedDeliveryProof.body?.code !== undefined, atRestCleared: verifiedDeliveryProofStorage === "VERIFIED|true|true|true" }));
 if (pickedUp.status !== 200 || pickedUp.body?.assignment?.state !== "in_custody" || captainLocation.status !== 200 || captainLocation.body?.location?.latitude !== 15.3701 || captainLocation.body?.location?.longitude !== 44.1911 || captainLocationReplay.status !== 200 || captainLocationReplay.body?.idempotentReplay !== true || wrongCaptainLocation.status !== 404 || clientTracking.status !== 200 || clientTracking.body?.trackingState !== "LIVE" || clientTracking.body?.assignmentId !== activeCaptainAssignmentID || clientTracking.body?.captainLocation?.latitude !== 15.3701 || completedTracking.status !== 200 || completedTracking.body?.trackingState !== "COMPLETED" || completedTracking.body?.assignmentId !== null || completedTracking.body?.captainLocation !== null || failedDelivery.status !== 200 || failedDelivery.body?.assignment?.state !== "delivery_failed" || failedOrder.status !== 200 || failedOrder.body?.order?.state !== "DELIVERY_FAILED" || captainAfterFailure.status !== 200 || captainAfterFailure.body?.admission?.availabilityState !== "unavailable" || recovered.status !== 200 || recovered.body?.assignment?.state !== "in_custody" || recovered.body.assignment.captainActorId !== activeCaptainActorID || recoveredReplay.status !== 200 || recoveredReplay.body?.idempotentReplay !== true || recoveredReplay.body.assignment.version !== recovered.body.assignment.version || recoveredTask.status !== 200 || recoveredTask.body?.task?.deliveryState !== "in_custody" || reassignmentAfterFailure.status !== 409 || wrongCollection.status !== 409 || wrongCollection.body?.error?.code !== "AMOUNT_MISMATCH" || completed.status !== 200 || completed.body?.assignment?.state !== "delivered" || completedReplay.status !== 200 || completedReplay.body?.idempotentReplay !== true || deliveredOrder.status !== 200 || deliveredOrder.body?.order?.state !== "DELIVERED" || deliveredOrder.body.order.paymentMethod !== "CASH_ON_DELIVERY" || deliveredOrder.body.order.paymentState !== "COLLECTED" || collectedPaymentRead.status !== 200 || collectedPaymentRead.body?.paymentIntent?.state !== "COLLECTED" || collectedPaymentRead.body.paymentIntent.collectedAmountMinor !== mainOrderTotal || collectedPaymentAuditCount !== "1" || captainAfterDelivery.status !== 200 || captainAfterDelivery.body?.admission?.availabilityState !== "available" || captainWalletAfterDelivery.status !== 200 || captainWalletAfterDelivery.body?.state?.ledgerBalanceMinor !== mainOrderTotal + deliveryFeeMinor || captainWalletAfterDelivery.body?.state?.availableMinor !== deliveryFeeMinor || captainWalletAfterDelivery.body?.state?.heldMinor !== mainOrderTotal || finalizedCaptainReservationCount !== "1" || partnerFinancialSummary.status !== 200 || partnerFinancialSummary.body?.summary?.partnerActorId !== first.actorID || partnerFinancialSummary.body.summary.earnedMinor !== 3550 || partnerFinancialSummary.body.summary.commissionMinor !== 650 || partnerFinancialSummary.body.summary.orderCount !== 1 || partnerFinancialSummary.body.summary.settlementPeriod !== "MONTHLY" || operatorPartnerFinancialSummary.status !== 200 || operatorPartnerFinancialSummary.body?.summary?.earnedMinor !== 3550 || partnerEarningRowCount !== "1" || partnerLedgerTransactionCount !== "1" || partnerLedgerEntryBalance !== `${mainOrderTotal}|${mainOrderTotal}` || partnerLedgerEntryCount !== "4") fail("Captain custody, live location privacy, governed failure recovery, COD reserve/finalization, exact cash collection, partner earning derivation, or ledger/readback journey failed", JSON.stringify({ pickedUp, captainLocation, captainLocationReplay, wrongCaptainLocation, clientTracking, completedTracking, failedDelivery, failedOrder, captainAfterFailure, captainWalletAfterFailure, captainWalletAfterDelivery, finalizedCaptainReservationCount, recovered, recoveredReplay, recoveredTask, reassignmentAfterFailure, wrongCollection, completed, completedReplay, deliveredOrder, collectedPaymentRead, collectedPaymentAuditCount, captainAfterDelivery, partnerFinancialSummary, operatorPartnerFinancialSummary, partnerEarningRowCount, partnerLedgerTransactionCount, partnerLedgerEntryBalance, partnerLedgerEntryCount }));
if (inventoryAtZero.status !== 200 || inventoryAtZero.body?.offer?.inventoryOnHandBaseUnits !== 0 || inventoryPublicEmpty.status !== 404 || inventoryRestored.status !== 200 || inventoryRestored.body?.offer?.inventoryOnHandBaseUnits !== 8 || inventoryPublicRestored.status !== 200) fail("quantity inventory delivery consumption or customer visibility fail-closed lifecycle failed", JSON.stringify({ inventoryAtZero, inventoryPublicEmpty, inventoryRestored, inventoryPublicRestored }));
console.log("DSH_QUANTITY_INVENTORY=PASS");
const conversationClientKey = `order-conversation-client-${suffix}`;
const conversationClientMessage = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/conversation/messages`, { token: client.accessToken, headers: partnerHeaders(conversationClientKey), body: { body: `رسالة العميل ${suffix}` } });
const conversationClientReplay = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/conversation/messages`, { token: client.accessToken, headers: partnerHeaders(conversationClientKey), body: { body: `رسالة العميل ${suffix}` } });
const conversationClientConflict = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/conversation/messages`, { token: client.accessToken, headers: partnerHeaders(conversationClientKey), body: { body: "رسالة مختلفة" } });
const conversationPartnerBeforeRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/conversation?limit=100`, { token: first.accessToken });
const conversationPartnerRead = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/conversation/read`, { token: first.accessToken, headers: partnerHeaders(`order-conversation-partner-read-${suffix}`), body: { messageId: String(conversationClientMessage.body?.message?.id || "") } });
const conversationCaptainMessage = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/conversation/messages`, { token: activeCaptainAccessToken, headers: partnerHeaders(`order-conversation-captain-${suffix}`), body: { body: `تحديث الكابتن ${suffix}` } });
const conversationCaptainRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/conversation?limit=100`, { token: activeCaptainAccessToken });
const conversationCaptainReadState = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/conversation/read`, { token: activeCaptainAccessToken, headers: partnerHeaders(`order-conversation-captain-read-${suffix}`), body: { messageId: String(conversationCaptainMessage.body?.message?.id || "") } });
const conversationClientBeforeRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/conversation?limit=100`, { token: client.accessToken });
const conversationClientRead = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/conversation/read`, { token: client.accessToken, headers: partnerHeaders(`order-conversation-client-read-${suffix}`), body: { messageId: String(conversationCaptainMessage.body?.message?.id || "") } });
const conversationClientAfterRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/conversation?limit=100`, { token: client.accessToken });
const conversationMessageCount = sql(`SELECT count(*) FROM dsh.commerce_order_conversation_messages WHERE order_id='${sqlLiteral(orderID)}'`);
const conversationReadStateCount = sql(`SELECT count(*) FROM dsh.commerce_order_conversation_read_state WHERE message_id IN (SELECT id FROM dsh.commerce_order_conversation_messages WHERE order_id='${sqlLiteral(orderID)}')`);
if (conversationClientMessage.status !== 201 || conversationClientMessage.body?.message?.orderId !== orderID || conversationClientMessage.body.message.senderRole !== "client" || conversationClientMessage.body.message.body !== `رسالة العميل ${suffix}` || conversationClientReplay.status !== 200 || conversationClientReplay.body?.idempotentReplay !== true || conversationClientReplay.body.message.id !== conversationClientMessage.body.message.id || conversationClientConflict.status !== 409 || conversationClientConflict.body?.error?.code !== "IDEMPOTENCY_CONFLICT" || conversationPartnerBeforeRead.status !== 200 || !conversationPartnerBeforeRead.body?.messages?.some((message) => message.id === conversationClientMessage.body.message.id) || conversationPartnerBeforeRead.body.unreadCount !== 1 || conversationPartnerRead.status !== 200 || conversationPartnerRead.body?.messageId !== conversationClientMessage.body.message.id || conversationCaptainMessage.status !== 201 || conversationCaptainMessage.body?.message?.senderRole !== "captain" || conversationCaptainRead.status !== 200 || !conversationCaptainRead.body?.messages?.some((message) => message.id === conversationCaptainMessage.body.message.id && message.mine) || conversationCaptainReadState.status !== 200 || conversationClientBeforeRead.status !== 200 || conversationClientBeforeRead.body?.unreadCount !== 1 || conversationClientRead.status !== 200 || conversationClientRead.body?.messageId !== conversationCaptainMessage.body.message.id || conversationClientAfterRead.status !== 200 || conversationClientAfterRead.body?.unreadCount !== 0 || conversationMessageCount !== "2" || conversationReadStateCount !== "5") fail("order conversation role boundary, idempotency, or read-state journey failed", JSON.stringify({ conversationClientMessage, conversationClientReplay, conversationClientConflict, conversationPartnerBeforeRead, conversationPartnerRead, conversationCaptainMessage, conversationCaptainRead, conversationCaptainReadState, conversationClientBeforeRead, conversationClientRead, conversationClientAfterRead, conversationMessageCount, conversationReadStateCount }));
console.log("DSH_ORDER_CONVERSATION=PASS");
sql(`UPDATE dsh.commerce_orders SET updated_at=clock_timestamp()-interval '61 minutes' WHERE id='${sqlLiteral(orderID)}'`);
const conversationAfterGraceRead = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/conversation?limit=100`, { token: client.accessToken });
const conversationAfterGraceSend = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/conversation/messages`, { token: client.accessToken, headers: partnerHeaders(`order-conversation-after-grace-${suffix}`), body: { body: "بعد انتهاء المهلة" } });
if (conversationAfterGraceRead.status !== 200 || conversationAfterGraceRead.body?.canSend !== false || typeof conversationAfterGraceRead.body?.readOnlyAt !== "string" || Date.parse(conversationAfterGraceRead.body.readOnlyAt) > Date.now() || conversationAfterGraceSend.status !== 409 || conversationAfterGraceSend.body?.error?.code !== "ORDER_CONVERSATION_READ_ONLY") fail("order conversation grace-period closure was not enforced", JSON.stringify({ conversationAfterGraceRead, conversationAfterGraceSend }));
console.log("DSH_ORDER_CONVERSATION_GRACE=PASS");
console.log("WLT_PARTNER_ORDER_EARNING=PASS");
const destinationWalletIdentifier = `+96777000${crypto.randomInt(1000, 9999)}`;
const destinationCreate = await request(dshBase, "POST", `/dsh/operator/partner/${encodeURIComponent(first.actorID)}/official-wallet-destination`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-destination-${suffix}`), body: { providerKey: "official_wallet", walletIdentifier: destinationWalletIdentifier, beneficiaryName: "Catalog Runtime A business", changeReason: "runtime proof destination", verificationEvidenceReference: `destination-proof-${suffix}`, changeEvidenceReference: `destination-proof-${suffix}` } });
const destinationID = String(destinationCreate.body?.destination?.id || "");
if (destinationID) destinationIDs.add(destinationID);
const destinationVerify = await request(dshBase, "POST", `/dsh/operator/partner/${encodeURIComponent(first.actorID)}/official-wallet-destination/${encodeURIComponent(destinationID)}/verify`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-destination-verify-${suffix}`), body: { evidenceReference: `destination-proof-verified-${suffix}` } });
const destinationVerifyReplay = await request(dshBase, "POST", `/dsh/operator/partner/${encodeURIComponent(first.actorID)}/official-wallet-destination/${encodeURIComponent(destinationID)}/verify`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-destination-verify-${suffix}`), body: { evidenceReference: `destination-proof-verified-${suffix}` } });
const destinationActivate = await request(dshBase, "POST", `/dsh/operator/partner/${encodeURIComponent(first.actorID)}/official-wallet-destination/${encodeURIComponent(destinationID)}/activate`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-destination-activate-${suffix}`), body: {} });
const destinationActivateReplay = await request(dshBase, "POST", `/dsh/operator/partner/${encodeURIComponent(first.actorID)}/official-wallet-destination/${encodeURIComponent(destinationID)}/activate`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-destination-activate-${suffix}`), body: {} });
const ownPayoutStateBefore = await request(dshBase, "GET", "/dsh/me/payout-state", { token: first.accessToken });
const payoutOversized = await request(dshBase, "POST", "/dsh/me/payout-intents", { token: first.accessToken, headers: partnerHeaders(`partner-payout-over-${suffix}`), body: { amountMode: "SPECIFIED", amountMinor: 4000 } });
const payoutSpecifiedKey = `partner-payout-specified-${suffix}`;
const payoutSpecified = await request(dshBase, "POST", "/dsh/me/payout-intents", { token: first.accessToken, headers: partnerHeaders(payoutSpecifiedKey), body: { amountMode: "SPECIFIED", amountMinor: 1000 } });
const payoutSpecifiedID = String(payoutSpecified.body?.payout?.id || "");
if (payoutSpecifiedID) payoutIDs.add(payoutSpecifiedID);
const payoutSpecifiedReplay = await request(dshBase, "POST", "/dsh/me/payout-intents", { token: first.accessToken, headers: partnerHeaders(payoutSpecifiedKey), body: { amountMode: "SPECIFIED", amountMinor: 1000 } });
const ownPayoutStateAfterSpecified = await request(dshBase, "GET", "/dsh/me/payout-state", { token: first.accessToken });
const payoutFull = await request(dshBase, "POST", "/dsh/me/payout-intents", { token: first.accessToken, headers: partnerHeaders(`partner-payout-full-${suffix}`), body: { amountMode: "FULL_AVAILABLE" } });
const payoutFullID = String(payoutFull.body?.payout?.id || "");
if (payoutFullID) payoutIDs.add(payoutFullID);
const ownPayoutStateAfterFull = await request(dshBase, "GET", "/dsh/me/payout-state", { token: first.accessToken });
const operatorDestinationRead = await request(dshBase, "GET", `/dsh/operator/partner/${encodeURIComponent(first.actorID)}/official-wallet-destination`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const operatorPayoutState = await request(dshBase, "GET", `/dsh/operator/partner/${encodeURIComponent(first.actorID)}/payout-state`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
if (destinationCreate.status !== 201 || destinationCreate.body?.destination?.actorId !== first.actorID || destinationCreate.body.destination.status !== "CANDIDATE" || destinationCreate.body.destination.verificationStatus !== "PENDING_VERIFICATION" || destinationCreate.body.destination.walletIdentifierMasked === destinationWalletIdentifier || destinationVerify.status !== 200 || destinationVerify.body?.destination?.status !== "PENDING_APPROVAL" || destinationVerify.body.destination.verificationStatus !== "VERIFIED" || destinationVerifyReplay.status !== 200 || destinationVerifyReplay.body?.destination?.status !== "PENDING_APPROVAL" || destinationActivate.status !== 200 || destinationActivate.body?.destination?.status !== "ACTIVE_FOR_PAYOUT" || destinationActivate.body.destination.verificationStatus !== "VERIFIED" || destinationActivateReplay.status !== 200 || destinationActivateReplay.body?.destination?.status !== "ACTIVE_FOR_PAYOUT" || ownPayoutStateBefore.status !== 200 || ownPayoutStateBefore.body?.state?.eligibleAvailableMinor !== 3550 || ownPayoutStateBefore.body.state.heldMinor !== 0 || ownPayoutStateBefore.body.state.destination?.status !== "ACTIVE_FOR_PAYOUT" || payoutOversized.status !== 409 || payoutOversized.body?.error?.code !== "AMOUNT_EXCEEDS_ELIGIBLE_FUNDS" || payoutSpecified.status !== 201 || payoutSpecified.body?.payout?.status !== "HELD" || payoutSpecified.body.payout.resolvedAmountMinor !== 1000 || payoutSpecified.body.payout.destinationVersion !== 1 || payoutSpecifiedReplay.status !== 200 || payoutSpecifiedReplay.body?.idempotentReplay !== true || payoutSpecifiedReplay.body.payout.id !== payoutSpecifiedID || ownPayoutStateAfterSpecified.status !== 200 || ownPayoutStateAfterSpecified.body?.state?.eligibleAvailableMinor !== 2550 || ownPayoutStateAfterSpecified.body.state.heldMinor !== 1000 || payoutFull.status !== 201 || payoutFull.body?.payout?.status !== "HELD" || payoutFull.body.payout.amountMode !== "FULL_AVAILABLE" || payoutFull.body.payout.resolvedAmountMinor !== 2550 || ownPayoutStateAfterFull.status !== 200 || ownPayoutStateAfterFull.body?.state?.eligibleAvailableMinor !== 0 || ownPayoutStateAfterFull.body.state.heldMinor !== 3550 || ownPayoutStateAfterFull.body.state.latestPayout?.resolvedAmountMinor !== 2550 || operatorDestinationRead.status !== 200 || operatorDestinationRead.body?.destination?.id !== destinationID || operatorPayoutState.status !== 200 || operatorPayoutState.body?.state?.eligibleAvailableMinor !== 0 || operatorPayoutState.body.state.heldMinor !== 3550) fail("Finance-managed official-wallet destination, server-resolved payout intent, hold, and idempotency journey failed", JSON.stringify({ destinationCreate, destinationVerify, destinationVerifyReplay, destinationActivate, destinationActivateReplay, ownPayoutStateBefore, payoutOversized, payoutSpecified, payoutSpecifiedReplay, ownPayoutStateAfterSpecified, payoutFull, ownPayoutStateAfterFull, operatorDestinationRead, operatorPayoutState }));
console.log("WLT_PARTNER_PAYOUT_INTENT=PASS");
const payoutQueue = await request(dshBase, "GET", "/dsh/operator/payout-requests?status=HELD", { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const payoutPrepared = await request(dshBase, "POST", `/dsh/operator/payout-requests/${encodeURIComponent(payoutFullID)}/prepare`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-payout-prepare-${suffix}`), body: { reason: "runtime settlement preparation", evidenceReference: `payout-preparation-${suffix}` } });
const payoutSameOperatorApproval = await request(dshBase, "POST", `/dsh/operator/payout-requests/${encodeURIComponent(payoutFullID)}/approve`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-payout-same-operator-${suffix}`), body: { reason: "must be independently approved" } });
const payoutApproved = await request(dshBase, "POST", `/dsh/operator/payout-requests/${encodeURIComponent(payoutFullID)}/approve`, { token: dshToken, headers: serviceHeaders(checkerOperatorID, `partner-payout-approve-${suffix}`), body: { reason: "independent payout approval" } });
const settlementBatchCreated = await request(dshBase, "POST", "/dsh/operator/settlement-batches", { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-settlement-batch-${suffix}`), body: { payoutIds: [payoutFullID] } });
const settlementBatchID = String(settlementBatchCreated.body?.batch?.id || "");
if (settlementBatchID) settlementBatchIDs.add(settlementBatchID);
const settlementBatchApproved = await request(dshBase, "POST", `/dsh/operator/settlement-batches/${encodeURIComponent(settlementBatchID)}/approve`, { token: dshToken, headers: serviceHeaders(checkerOperatorID, `partner-settlement-batch-approve-${suffix}`), body: { reason: "independent batch approval" } });
const settlementBatchFrozen = await request(dshBase, "POST", `/dsh/operator/settlement-batches/${encodeURIComponent(settlementBatchID)}/freeze`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-settlement-batch-freeze-${suffix}`), body: { reason: "freeze approved execution snapshot" } });
const transferRecorded = await request(dshBase, "POST", `/dsh/operator/settlement-batches/${encodeURIComponent(settlementBatchID)}/transfers`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-transfer-record-${suffix}`), body: { payoutId: payoutFullID, externalTransferReference: `wallet-transfer-${suffix}`, evidenceReference: `wallet-receipt-${suffix}` } });
const transferID = String(transferRecorded.body?.transfer?.id || "");
const transferVerified = await request(dshBase, "POST", `/dsh/operator/transfers/${encodeURIComponent(transferID)}/verify`, { token: dshToken, headers: serviceHeaders(checkerOperatorID, `partner-transfer-verify-${suffix}`), body: { evidenceReference: `wallet-verified-${suffix}` } });
const transferReconciled = await request(dshBase, "POST", `/dsh/operator/transfers/${encodeURIComponent(transferID)}/reconcile`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `partner-transfer-reconcile-${suffix}`), body: { statementReference: `official-wallet-statement-${suffix}` } });
const settlementBatchRead = await request(dshBase, "GET", `/dsh/operator/settlement-batches/${encodeURIComponent(settlementBatchID)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const payoutCompletedRead = await request(dshBase, "GET", `/dsh/operator/payout-requests/${encodeURIComponent(payoutFullID)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const partnerPayoutStateCompleted = await request(dshBase, "GET", `/dsh/operator/partner/${encodeURIComponent(first.actorID)}/payout-state`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const payoutLedgerCount = sql(`SELECT count(*) FROM wlt.ledger_entries WHERE transaction_id=(SELECT ledger_transaction_id FROM wlt.payout_requests WHERE id='${sqlLiteral(payoutFullID)}')`);
const payoutLedgerAssetCount = sql(`SELECT count(*) FROM wlt.ledger_entries WHERE transaction_id=(SELECT ledger_transaction_id FROM wlt.payout_requests WHERE id='${sqlLiteral(payoutFullID)}') AND account_code='EXTERNAL_SETTLEMENT_CASH' AND account_class='asset' AND direction='CREDIT'`);
const payoutHoldFinalized = sql(`SELECT count(*) FROM wlt.payout_holds WHERE payout_id='${sqlLiteral(payoutFullID)}' AND status='FINALIZED'`);
if (payoutQueue.status !== 200 || !payoutQueue.body?.payouts?.some((item) => item.id === payoutFullID && item.status === "HELD") || payoutPrepared.status !== 200 || payoutPrepared.body?.payout?.status !== "PREPARED" || payoutSameOperatorApproval.status !== 403 || payoutSameOperatorApproval.body?.error?.code !== "SEPARATION_OF_DUTIES" || payoutApproved.status !== 200 || payoutApproved.body?.payout?.status !== "APPROVED" || settlementBatchCreated.status !== 201 || settlementBatchCreated.body?.batch?.status !== "PREPARED" || settlementBatchCreated.body.batch.rowCount !== 1 || settlementBatchCreated.body.batch.totalAmountMinor !== 2550 || settlementBatchApproved.status !== 200 || settlementBatchApproved.body?.batch?.status !== "APPROVED" || settlementBatchFrozen.status !== 200 || settlementBatchFrozen.body?.batch?.status !== "FROZEN" || transferRecorded.status !== 201 || transferRecorded.body?.transfer?.amountMinor !== 2550 || transferRecorded.body.transfer.executionStatus !== "EXECUTED" || transferVerified.status !== 200 || transferVerified.body?.transfer?.executionStatus !== "VERIFIED" || transferReconciled.status !== 200 || transferReconciled.body?.transfer?.executionStatus !== "RECONCILED" || settlementBatchRead.status !== 200 || settlementBatchRead.body?.batch?.status !== "COMPLETED" || payoutCompletedRead.status !== 200 || payoutCompletedRead.body?.payout?.status !== "COMPLETED" || !payoutCompletedRead.body.payout.ledgerTransactionId || partnerPayoutStateCompleted.status !== 200 || partnerPayoutStateCompleted.body?.state?.latestPayout?.status !== "COMPLETED" || payoutLedgerCount !== "2" || payoutLedgerAssetCount !== "1" || payoutHoldFinalized !== "1") fail("governed manual settlement lifecycle, separation of duties, reconciliation, or ledger finalization failed", JSON.stringify({ payoutQueue, payoutPrepared, payoutSameOperatorApproval, payoutApproved, settlementBatchCreated, settlementBatchApproved, settlementBatchFrozen, transferRecorded, transferVerified, transferReconciled, settlementBatchRead, payoutCompletedRead, partnerPayoutStateCompleted, payoutLedgerCount, payoutLedgerAssetCount, payoutHoldFinalized }));
console.log("WLT_MANUAL_SETTLEMENT=PASS");
const fieldPayoutPhone = `+96779${crypto.randomInt(1_000_000, 9_999_999)}`;
const fieldPayoutCase = await request(dshBase, "POST", "/dsh/field/joining-cases", { token: secondFieldAccessToken, headers: { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": `field-payout-case-${suffix}` }, body: { contactPhoneE164: fieldPayoutPhone, businessName: "Field payout business", firstStoreName: "Field payout store", serviceCityId: cityA, firstStoreVerticalId: verticalID, ...firstStoreOrigin } });
const fieldPayoutCaseID = String(fieldPayoutCase.body?.case?.id || "");
if (fieldPayoutCaseID) caseIDs.add(fieldPayoutCaseID);
const fieldPayoutSubmitted = await request(dshBase, "POST", `/dsh/field/joining-cases/${encodeURIComponent(fieldPayoutCaseID)}/submit`, { token: secondFieldAccessToken, headers: partnerHeaders(`field-payout-submit-${suffix}`, 1) });
const fieldPayoutApproved = await request(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(fieldPayoutCaseID)}/review`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-payout-approve-${suffix}`, crypto.randomUUID(), 2), body: { decision: "approved", expectedTermsPolicyVersion: partnerFinancialTermsPolicy.policyVersion } });
const fieldPayoutStoreID = String(fieldPayoutApproved.body?.case?.store?.id || "");
if (fieldPayoutStoreID) storeIDs.add(fieldPayoutStoreID);
const fieldPayoutPartnerActorID = String(fieldPayoutApproved.body?.case?.partnerActorId || "");
if (fieldPayoutPartnerActorID) actorIDs.add(fieldPayoutPartnerActorID);
const fieldPayoutPartnerAccessToken = await activatePartner(fieldPayoutPhone, `FPay${suffix.slice(0, 4)}`);
const fieldPayoutOffer = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(fieldPayoutStoreID)}/offers`, { token: fieldPayoutPartnerAccessToken, headers: partnerHeaders(`field-payout-offer-${suffix}`), body: discreteCreateOffer(variantID, 1250) });
const fieldPayoutOfferID = String(fieldPayoutOffer.body?.offer?.offerId || "");
if (fieldPayoutOfferID) offerIDs.add(fieldPayoutOfferID);
const fieldPayoutOfferPublished = await request(dshBase, "PATCH", `/dsh/stores/${encodeURIComponent(fieldPayoutStoreID)}/offers/${encodeURIComponent(fieldPayoutOfferID)}`, { token: fieldPayoutPartnerAccessToken, headers: partnerHeaders(`field-payout-offer-publish-${suffix}`, 1), body: discreteOffer(1250, "published") });
const fieldPayoutPublication = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(fieldPayoutStoreID)}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-payout-publish-${suffix}`, crypto.randomUUID(), 1), body: { state: "published" } });
const fieldPayoutSummaryDeadline = Date.now() + 95_000;
let fieldPayoutSummary = null;
while (Date.now() < fieldPayoutSummaryDeadline) {
  const response = await request(dshBase, "GET", `/dsh/operator/fields/${encodeURIComponent(secondFieldActorID)}/financial-summary`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
  if (response.status === 200 && response.body?.summary?.earnedMinor === 7500 && response.body?.summary?.commissionMinor === 7500 && response.body?.summary?.storeCount === 1) {
    fieldPayoutSummary = response;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
const fieldPayoutEarningCount = sql(`SELECT count(*) FROM wlt.field_commission_earnings WHERE field_actor_id='${sqlLiteral(secondFieldActorID)}' AND store_id='${sqlLiteral(fieldPayoutStoreID)}'`);
if (fieldPayoutCase.status !== 201 || fieldPayoutCase.body?.case?.origin !== "field" || fieldPayoutCase.body?.case?.state !== "draft" || fieldPayoutSubmitted.status !== 200 || fieldPayoutSubmitted.body?.case?.state !== "submitted" || fieldPayoutApproved.status !== 200 || fieldPayoutApproved.body?.case?.state !== "approved" || fieldPayoutPartnerActorID === "" || fieldPayoutOffer.status !== 201 || fieldPayoutOfferPublished.status !== 200 || fieldPayoutPublication.status !== 200 || !fieldPayoutSummary || fieldPayoutEarningCount !== "1") fail("Field payout proof fixture did not reach one customer-visible commission", JSON.stringify({ fieldPayoutCase, fieldPayoutSubmitted, fieldPayoutApproved, fieldPayoutOffer, fieldPayoutOfferPublished, fieldPayoutPublication, fieldPayoutSummary, fieldPayoutEarningCount }));
const fieldDestinationWalletIdentifier = `96777100${crypto.randomInt(1000, 9999)}`;
const fieldDestinationCreate = await request(dshBase, "POST", `/dsh/operator/field/${encodeURIComponent(secondFieldActorID)}/official-wallet-destination`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-destination-${suffix}`), body: { providerKey: "official_wallet", walletIdentifier: fieldDestinationWalletIdentifier, beneficiaryName: "Field runtime actor", changeReason: "runtime proof field destination", verificationEvidenceReference: `field-destination-proof-${suffix}`, changeEvidenceReference: `field-destination-proof-${suffix}` } });
const fieldDestinationID = String(fieldDestinationCreate.body?.destination?.id || "");
if (fieldDestinationID) destinationIDs.add(fieldDestinationID);
const fieldDestinationVerify = await request(dshBase, "POST", `/dsh/operator/field/${encodeURIComponent(secondFieldActorID)}/official-wallet-destination/${encodeURIComponent(fieldDestinationID)}/verify`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-destination-verify-${suffix}`), body: { evidenceReference: `field-destination-verified-${suffix}` } });
const fieldDestinationActivate = await request(dshBase, "POST", `/dsh/operator/field/${encodeURIComponent(secondFieldActorID)}/official-wallet-destination/${encodeURIComponent(fieldDestinationID)}/activate`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `field-destination-activate-${suffix}`), body: {} });
const fieldOwnPayoutState = await request(dshBase, "GET", "/dsh/me/payout-state", { token: secondFieldAccessToken });
const fieldPayoutKey = `field-payout-${suffix}`;
const fieldPayout = await request(dshBase, "POST", "/dsh/me/payout-intents", { token: secondFieldAccessToken, headers: partnerHeaders(fieldPayoutKey), body: { amountMode: "FULL_AVAILABLE" } });
const fieldPayoutID = String(fieldPayout.body?.payout?.id || "");
if (fieldPayoutID) payoutIDs.add(fieldPayoutID);
const fieldPayoutReplay = await request(dshBase, "POST", "/dsh/me/payout-intents", { token: secondFieldAccessToken, headers: partnerHeaders(fieldPayoutKey), body: { amountMode: "FULL_AVAILABLE" } });
const fieldOwnPayoutAfter = await request(dshBase, "GET", "/dsh/me/payout-state", { token: secondFieldAccessToken });
const fieldOperatorPayoutState = await request(dshBase, "GET", `/dsh/operator/field/${encodeURIComponent(secondFieldActorID)}/payout-state`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const captainDestinationWalletIdentifier = `96777200${crypto.randomInt(1000, 9999)}`;
const captainDestinationCreate = await request(dshBase, "POST", `/dsh/operator/captain/${encodeURIComponent(activeCaptainActorID)}/official-wallet-destination`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-destination-${suffix}`), body: { providerKey: "official_wallet", walletIdentifier: captainDestinationWalletIdentifier, beneficiaryName: "Captain runtime actor", changeReason: "runtime proof captain destination", verificationEvidenceReference: `captain-destination-proof-${suffix}`, changeEvidenceReference: `captain-destination-proof-${suffix}` } });
const captainDestinationID = String(captainDestinationCreate.body?.destination?.id || "");
if (captainDestinationID) destinationIDs.add(captainDestinationID);
const captainDestinationVerify = await request(dshBase, "POST", `/dsh/operator/captain/${encodeURIComponent(activeCaptainActorID)}/official-wallet-destination/${encodeURIComponent(captainDestinationID)}/verify`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-destination-verify-${suffix}`), body: { evidenceReference: `captain-destination-verified-${suffix}` } });
const captainDestinationActivate = await request(dshBase, "POST", `/dsh/operator/captain/${encodeURIComponent(activeCaptainActorID)}/official-wallet-destination/${encodeURIComponent(captainDestinationID)}/activate`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-destination-activate-${suffix}`), body: {} });
const captainOwnPayoutState = await request(dshBase, "GET", "/dsh/me/payout-state", { token: activeCaptainAccessToken });
const captainPayout = await request(dshBase, "POST", "/dsh/me/payout-intents", { token: activeCaptainAccessToken, headers: partnerHeaders(`captain-payout-${suffix}`), body: { amountMode: "FULL_AVAILABLE" } });
const captainPayoutID = String(captainPayout.body?.payout?.id || "");
if (captainPayoutID) payoutIDs.add(captainPayoutID);
const captainOwnPayoutAfter = await request(dshBase, "GET", "/dsh/me/payout-state", { token: activeCaptainAccessToken });
if (fieldDestinationCreate.status !== 201 || fieldDestinationCreate.body?.destination?.actorType !== "field" || fieldDestinationVerify.status !== 200 || fieldDestinationActivate.status !== 200 || fieldOwnPayoutState.status !== 200 || fieldOwnPayoutState.body?.state?.actorType !== "field" || fieldOwnPayoutState.body.state.actorId !== secondFieldActorID || fieldOwnPayoutState.body.state.eligibleAvailableMinor !== 7500 || fieldPayout.status !== 201 || fieldPayout.body?.payout?.actorType !== "field" || fieldPayout.body.payout.resolvedAmountMinor !== 7500 || fieldPayoutReplay.status !== 200 || fieldPayoutReplay.body?.idempotentReplay !== true || fieldOwnPayoutAfter.status !== 200 || fieldOwnPayoutAfter.body?.state?.eligibleAvailableMinor !== 0 || fieldOwnPayoutAfter.body.state.heldMinor !== 7500 || fieldOperatorPayoutState.status !== 200 || fieldOperatorPayoutState.body?.state?.actorType !== "field" || captainDestinationCreate.status !== 201 || captainDestinationCreate.body?.destination?.actorType !== "captain" || captainDestinationVerify.status !== 200 || captainDestinationActivate.status !== 200 || captainOwnPayoutState.status !== 200 || captainOwnPayoutState.body?.state?.actorType !== "captain" || captainOwnPayoutState.body.state.actorId !== activeCaptainActorID || captainOwnPayoutState.body.state.eligibleAvailableMinor !== deliveryFeeMinor || captainOwnPayoutState.body.state.heldMinor !== mainOrderTotal || captainPayout.status !== 201 || captainPayout.body?.payout?.actorType !== "captain" || captainPayout.body.payout.resolvedAmountMinor !== deliveryFeeMinor || captainOwnPayoutAfter.status !== 200 || captainOwnPayoutAfter.body?.state?.eligibleAvailableMinor !== 0 || captainOwnPayoutAfter.body.state.heldMinor !== mainOrderTotal + deliveryFeeMinor) fail("Unified beneficiary payout state, destination, hold, and role-boundary journey failed", JSON.stringify({ fieldDestinationCreate, fieldDestinationVerify, fieldDestinationActivate, fieldOwnPayoutState, fieldPayout, fieldPayoutReplay, fieldOwnPayoutAfter, fieldOperatorPayoutState, captainDestinationCreate, captainDestinationVerify, captainDestinationActivate, captainOwnPayoutState, captainPayout, captainOwnPayoutAfter }));
console.log("WLT_UNIFIED_BENEFICIARY_PAYOUT=PASS");
const locationAuditCount = sql(`SELECT count(*) FROM dsh.captain_location_audit WHERE order_id='${sqlLiteral(orderID)}'`);
const locationIdempotencyCount = sql(`SELECT count(*) FROM dsh.captain_location_mutation_idempotency WHERE order_id='${sqlLiteral(orderID)}'`);
if (locationAuditCount !== "1" || locationIdempotencyCount !== "1") fail("Captain live-location audit/idempotency readback is incomplete", JSON.stringify({ locationAuditCount, locationIdempotencyCount }));
console.log("DSH_LIVE_TRACKING=PASS");
console.log("DSH_PAYMENT_COLLECTION=PASS");
const cashLiabilityBeforeRemittance = await request(dshBase, "GET", "/dsh/captains/me/cash-liability", { token: activeCaptainAccessToken });
const remittanceKey = `cash-remittance-${suffix}`;
const remittanceReference = `vault-${suffix}`;
const createdRemittance = await request(dshBase, "POST", `/dsh/captains/me/cash-liability/${encodeURIComponent(paymentIntentID)}/remit`, { token: activeCaptainAccessToken, headers: partnerHeaders(remittanceKey, collectedPaymentRead.body?.paymentIntent?.version), body: { amountMinor: mainOrderTotal, remittanceReference } });
const remittanceReplay = await request(dshBase, "POST", `/dsh/captains/me/cash-liability/${encodeURIComponent(paymentIntentID)}/remit`, { token: activeCaptainAccessToken, headers: partnerHeaders(remittanceKey, collectedPaymentRead.body?.paymentIntent?.version), body: { amountMinor: mainOrderTotal, remittanceReference } });
const remittanceKeyConflict = await request(dshBase, "POST", `/dsh/captains/me/cash-liability/${encodeURIComponent(paymentIntentID)}/remit`, { token: activeCaptainAccessToken, headers: partnerHeaders(remittanceKey, collectedPaymentRead.body?.paymentIntent?.version), body: { amountMinor: mainOrderTotal, remittanceReference: "different-reference" } });
const duplicateRemittance = await request(dshBase, "POST", `/dsh/captains/me/cash-liability/${encodeURIComponent(paymentIntentID)}/remit`, { token: activeCaptainAccessToken, headers: partnerHeaders(`cash-remittance-duplicate-${suffix}`, collectedPaymentRead.body?.paymentIntent?.version), body: { amountMinor: mainOrderTotal, remittanceReference: "duplicate-reference" } });
const cashLiabilityAfterRemittance = await request(dshBase, "GET", "/dsh/captains/me/cash-liability", { token: activeCaptainAccessToken });
const remittanceAuditCount = sql(`SELECT count(*) FROM wlt.cash_remittance_events WHERE payment_intent_id='${sqlLiteral(paymentIntentID)}' AND event_type='CASH_REMITTED' AND idempotency_key='${sqlLiteral(remittanceKey)}' AND captain_actor_id='${sqlLiteral(activeCaptainActorID)}' AND amount_minor=${mainOrderTotal}`);
const remittanceRowCount = sql(`SELECT count(*) FROM wlt.cash_remittances WHERE payment_intent_id='${sqlLiteral(paymentIntentID)}' AND captain_actor_id='${sqlLiteral(activeCaptainActorID)}' AND amount_minor=${mainOrderTotal} AND remittance_reference='${sqlLiteral(remittanceReference)}'`);
const captainWalletAfterRemittance = await request(wltBase, "GET", `/wlt/v1/captains/${encodeURIComponent(activeCaptainActorID)}/wallet-state`, { token: wltToken });
const remittedCaptainReservationCount = sql(`SELECT count(*) FROM wlt.captain_cod_reservations WHERE order_id='${sqlLiteral(orderID)}' AND payment_intent_id='${sqlLiteral(paymentIntentID)}' AND captain_actor_id='${sqlLiteral(activeCaptainActorID)}' AND state='REMITTED' AND remitted_at IS NOT NULL`);
const remittanceLedgerTransactionCount = sql(`SELECT count(*) FROM wlt.ledger_transactions t JOIN wlt.cash_remittances r ON t.source_type='CASH_REMITTANCE' AND t.source_id=r.id WHERE r.payment_intent_id='${sqlLiteral(paymentIntentID)}' AND t.transaction_type='CAPTAIN_CASH_REMITTED'`);
const remittanceLedgerEntryBalance = sql(`SELECT COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction='DEBIT'),0) || '|' || COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction='CREDIT'),0) FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id JOIN wlt.cash_remittances r ON t.source_type='CASH_REMITTANCE' AND t.source_id=r.id WHERE r.payment_intent_id='${sqlLiteral(paymentIntentID)}'`);
const remittanceLedgerEntryCount = sql(`SELECT count(*) FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id JOIN wlt.cash_remittances r ON t.source_type='CASH_REMITTANCE' AND t.source_id=r.id WHERE r.payment_intent_id='${sqlLiteral(paymentIntentID)}'`);
const remittanceLedgerAccounts = sql(`SELECT string_agg(e.account_code || ':' || e.direction || ':' || e.amount_minor::text, ',' ORDER BY e.line_sequence) FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id JOIN wlt.cash_remittances r ON t.source_type='CASH_REMITTANCE' AND t.source_id=r.id WHERE r.payment_intent_id='${sqlLiteral(paymentIntentID)}'`);
if (cashLiabilityBeforeRemittance.status !== 200 || cashLiabilityBeforeRemittance.body?.items?.length !== 1 || cashLiabilityBeforeRemittance.body.items[0]?.paymentIntentId !== paymentIntentID || cashLiabilityBeforeRemittance.body.items[0]?.amountMinor !== mainOrderTotal || createdRemittance.status !== 200 || createdRemittance.body?.cashRemittance?.paymentIntentId !== paymentIntentID || createdRemittance.body.cashRemittance.captainActorId !== activeCaptainActorID || createdRemittance.body.cashRemittance.amountMinor !== mainOrderTotal || createdRemittance.body.cashRemittance.state !== "REMITTED" || createdRemittance.body.cashRemittance.remittanceReference !== remittanceReference || remittanceReplay.status !== 200 || remittanceReplay.body?.idempotentReplay !== true || remittanceReplay.body.cashRemittance.id !== createdRemittance.body.cashRemittance.id || remittanceKeyConflict.status !== 409 || remittanceKeyConflict.body?.error?.code !== "IDEMPOTENCY_CONFLICT" || duplicateRemittance.status !== 409 || duplicateRemittance.body?.error?.code !== "CASH_ALREADY_REMITTED" || cashLiabilityAfterRemittance.status !== 200 || cashLiabilityAfterRemittance.body?.items?.length !== 0 || cashLiabilityAfterRemittance.body?.totalAmountMinor !== 0 || remittanceAuditCount !== "1" || remittanceRowCount !== "1" || captainWalletAfterRemittance.status !== 200 || captainWalletAfterRemittance.body?.state?.ledgerBalanceMinor !== mainOrderTotal + deliveryFeeMinor || captainWalletAfterRemittance.body?.state?.heldMinor !== deliveryFeeMinor || captainWalletAfterRemittance.body?.state?.availableMinor !== mainOrderTotal || remittedCaptainReservationCount !== "1" || remittanceLedgerTransactionCount !== "1" || remittanceLedgerEntryBalance !== `${mainOrderTotal}|${mainOrderTotal}` || remittanceLedgerEntryCount !== "2" || remittanceLedgerAccounts !== `EXTERNAL_SETTLEMENT_CASH:DEBIT:${mainOrderTotal},CAPTAIN_CASH_RECEIVABLE:CREDIT:${mainOrderTotal}`) fail("Captain cash remittance did not close receivable and release only the COD exposure", JSON.stringify({ cashLiabilityBeforeRemittance, createdRemittance, remittanceReplay, remittanceKeyConflict, duplicateRemittance, cashLiabilityAfterRemittance, remittanceAuditCount, remittanceRowCount, captainWalletAfterRemittance, remittedCaptainReservationCount, remittanceLedgerTransactionCount, remittanceLedgerEntryBalance, remittanceLedgerEntryCount, remittanceLedgerAccounts }));
console.log("DSH_CASH_REMITTANCE=PASS");
const ratingBefore = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/rating`, { token: client.accessToken });
const partnerRatingBefore = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/rating`, { token: first.accessToken });
const ratingKey = `order-rating-${suffix}`;
const createdRating = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/rating`, { token: client.accessToken, headers: partnerHeaders(ratingKey, deliveredOrder.body?.order?.version), body: { rating: 5, review: `تجربة ممتازة ${suffix}` } });
const ratingReplay = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/rating`, { token: client.accessToken, headers: partnerHeaders(ratingKey, deliveredOrder.body?.order?.version), body: { rating: 5, review: `تجربة ممتازة ${suffix}` } });
const ratingKeyConflict = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/rating`, { token: client.accessToken, headers: partnerHeaders(ratingKey, deliveredOrder.body?.order?.version), body: { rating: 4, review: "تغيير غير مسموح" } });
const duplicateRating = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/rating`, { token: client.accessToken, headers: partnerHeaders(`order-rating-duplicate-${suffix}`, deliveredOrder.body?.order?.version), body: { rating: 4, review: "تقييم مكرر" } });
const clientRating = await request(dshBase, "GET", `/dsh/orders/${encodeURIComponent(orderID)}/rating`, { token: client.accessToken });
const partnerRating = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(orderID)}/rating`, { token: first.accessToken, headers: partnerHeaders(`partner-rating-${suffix}`, deliveredOrder.body?.order?.version), body: { rating: 5, review: "تجاوز ملكية" } });
const ratingAuditCount = sql(`SELECT count(*) FROM dsh.commerce_order_rating_audit WHERE order_id='${sqlLiteral(orderID)}' AND event_type='order_rated' AND idempotency_key='${sqlLiteral(ratingKey)}' AND rating=5`);
const ratingStoreReadCount = sql(`SELECT count(*) FROM dsh.commerce_order_ratings WHERE order_id='${sqlLiteral(orderID)}' AND client_actor_id='${sqlLiteral(client.actorID)}' AND store_id='${sqlLiteral(first.storeID)}' AND rating=5`);
if (ratingBefore.status !== 404 || partnerRatingBefore.status !== 403 || createdRating.status !== 201 || createdRating.body?.rating?.orderId !== orderID || createdRating.body.rating.storeId !== first.storeID || createdRating.body.rating.rating !== 5 || createdRating.body.rating.review !== `تجربة ممتازة ${suffix}` || ratingReplay.status !== 200 || ratingReplay.body?.idempotentReplay !== true || ratingReplay.body.rating.createdAt !== createdRating.body.rating.createdAt || ratingKeyConflict.status !== 409 || ratingKeyConflict.body?.error?.code !== "IDEMPOTENCY_CONFLICT" || duplicateRating.status !== 409 || duplicateRating.body?.error?.code !== "ORDER_RATING_EXISTS" || clientRating.status !== 200 || clientRating.body?.rating?.rating !== 5 || clientRating.body.rating.review !== `تجربة ممتازة ${suffix}` || partnerRating.status !== 403 || ratingAuditCount !== "1" || ratingStoreReadCount !== "1") fail("post-delivery order rating ownership, idempotency, or audit boundary failed", JSON.stringify({ ratingBefore, partnerRatingBefore, createdRating, ratingReplay, ratingKeyConflict, duplicateRating, clientRating, partnerRating, ratingAuditCount, ratingStoreReadCount }));
const publicStoresWithRating = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(cityA)}`);
const publicStoreWithRating = await request(dshBase, "GET", `/dsh/public/stores/${encodeURIComponent(first.storeID)}?serviceCityId=${encodeURIComponent(cityA)}`);
if (publicStoresWithRating.status !== 200 || !publicStoresWithRating.body?.stores?.some((store) => store.id === first.storeID && store.ratingCount === 1 && store.ratingAverage === 5) || publicStoreWithRating.status !== 200 || publicStoreWithRating.body?.id !== first.storeID || publicStoreWithRating.body?.ratingCount !== 1 || publicStoreWithRating.body?.ratingAverage !== 5) fail("public store rating aggregate readback failed", JSON.stringify({ publicStoresWithRating, publicStoreWithRating }));
console.log("DSH_PUBLIC_STORE_RATING=PASS");
console.log("DSH_ORDER_RATING=PASS");
const captainAuditCount = sql(`SELECT count(*) FROM dsh.captain_audit WHERE order_id='${sqlLiteral(orderID)}'`);
const captainOperationCount = sql(`SELECT count(*) FROM dsh.captain_operation_idempotency WHERE order_id='${sqlLiteral(orderID)}'`);
const captainAuditEventCounts = sql(`SELECT string_agg(event_type || ':' || event_count::text, ',' ORDER BY event_type) FROM (SELECT event_type, count(*) AS event_count FROM dsh.captain_audit WHERE order_id='${sqlLiteral(orderID)}' GROUP BY event_type) events`);
const captainOperationCounts = sql(`SELECT string_agg(operation || ':' || operation_count::text, ',' ORDER BY operation) FROM (SELECT operation, count(*) AS operation_count FROM dsh.captain_operation_idempotency WHERE order_id='${sqlLiteral(orderID)}' GROUP BY operation) operations`);
if (captainAuditCount !== "11" || captainOperationCount !== "11" || captainAuditEventCounts !== "captain_assignment_reassigned:1,captain_pickup_completed:1,delivery_completed:1,delivery_failed:1,delivery_recovered:1,dispatch_offer_accepted:2,dispatch_offer_created:2,dispatch_offer_rejected:1,store_handoff_confirmed:1" || captainOperationCounts !== "complete:2,dispatch:2,pickup:1,reassign:1,recover:1,respond_offer:3,store_confirm:1") fail("Captain audit/idempotency readback is incomplete", JSON.stringify({ captainAuditCount, captainOperationCount, captainAuditEventCounts, captainOperationCounts }));
console.log("DSH_CAPTAIN_DISPATCH_HANDOFF_DELIVERY=PASS");

const clientNotifications = await request(dshBase, "GET", "/dsh/notifications?limit=50", { token: client.accessToken });
const partnerNotifications = await request(dshBase, "GET", "/dsh/notifications?limit=50", { token: first.accessToken });
const captainNotifications = await request(dshBase, "GET", "/dsh/notifications?limit=50", { token: activeCaptainAccessToken });
const targetClientNotifications = clientNotifications.body?.notifications?.filter((item) => item.orderId === orderID) ?? [];
const targetPartnerNotifications = partnerNotifications.body?.notifications?.filter((item) => item.orderId === orderID) ?? [];
const targetCaptainNotifications = captainNotifications.body?.notifications?.filter((item) => item.orderId === orderID) ?? [];
const firstNotificationID = targetClientNotifications.find((item) => item.id.startsWith("order:"))?.id;
const initialClientUnread = clientNotifications.body?.unreadCount;
const markedNotification = firstNotificationID ? await request(dshBase, "POST", `/dsh/notifications/${encodeURIComponent(firstNotificationID)}/read`, { token: client.accessToken }) : null;
const clientNotificationsAfterRead = await request(dshBase, "GET", "/dsh/notifications?limit=50", { token: client.accessToken });
const crossActorRead = firstNotificationID ? await request(dshBase, "POST", `/dsh/notifications/${encodeURIComponent(firstNotificationID)}/read`, { token: activeCaptainAccessToken }) : null;
const clientNotificationKinds = targetClientNotifications.map((item) => item.kind).sort().join(",");
const partnerNotificationKinds = targetPartnerNotifications.map((item) => item.kind).sort().join(",");
const captainNotificationKinds = targetCaptainNotifications.map((item) => item.kind).sort().join(",");
if (clientNotifications.status !== 200 || targetClientNotifications.length !== 12 || clientNotificationKinds !== "CAPTAIN_ASSIGNED,CAPTAIN_ASSIGNED,DELIVERED,DELIVERY_FAILED,DELIVERY_RECOVERED,HANDOFF_CONFIRMED,ORDER_ACCEPTED,ORDER_CREATED,ORDER_PREPARING,ORDER_READY,PICKED_UP,REASSIGNED" || targetPartnerNotifications.length !== 12 || partnerNotificationKinds !== "CAPTAIN_ASSIGNED,CAPTAIN_ASSIGNED,DELIVERED,DELIVERY_FAILED,DELIVERY_RECOVERED,HANDOFF_CONFIRMED,ORDER_ACCEPTED,ORDER_CREATED,ORDER_PREPARING,ORDER_READY,PICKED_UP,REASSIGNED" || captainNotifications.status !== 200 || targetCaptainNotifications.length !== 7 || captainNotificationKinds !== "CAPTAIN_ASSIGNED,CAPTAIN_OFFER,DELIVERED,DELIVERY_FAILED,DELIVERY_RECOVERED,HANDOFF_CONFIRMED,PICKED_UP" || !Number.isInteger(initialClientUnread) || !firstNotificationID || markedNotification?.status !== 200 || markedNotification.body?.notificationId !== firstNotificationID || !markedNotification.body?.readAt || clientNotificationsAfterRead.status !== 200 || clientNotificationsAfterRead.body?.unreadCount !== initialClientUnread - 1 || !clientNotificationsAfterRead.body.notifications.some((item) => item.id === firstNotificationID && item.readAt) || crossActorRead?.status !== 404) fail("actor-scoped notification inbox or read-state boundary failed", JSON.stringify({ clientNotifications, partnerNotifications, captainNotifications, targetClientNotifications, targetPartnerNotifications, targetCaptainNotifications, clientNotificationKinds, partnerNotificationKinds, captainNotificationKinds, markedNotification, clientNotificationsAfterRead, crossActorRead }));
console.log("DSH_NOTIFICATIONS=PASS");


const expiryCartCreate = await request(dshBase, "POST", "/dsh/cart/lines", { token: client.accessToken, headers: partnerHeaders(`captain-expiry-cart-${suffix}`, 0), body: { storeId: first.storeID, storeOfferId: offerAID, quantityBaseUnits: 1, selectedModifierOptionIds: [] } });
if (expiryCartCreate.status !== 201 || !expiryCartCreate.body?.cart?.id) fail("Captain expiry order cart fixture failed", JSON.stringify(expiryCartCreate));
const expiryCartID = String(expiryCartCreate.body.cart.id); cartIDs.add(expiryCartID);
const expiryCheckout = await request(dshBase, "POST", "/dsh/cart/checkout", { token: client.accessToken, headers: partnerHeaders(`captain-expiry-checkout-${suffix}`, 1), body: { cartId: expiryCartID, storeId: first.storeID, addressId: addressAID, fulfillmentMode: "BTHWANI_CAPTAIN" } });
if (expiryCheckout.status !== 201 || !expiryCheckout.body?.order?.id) fail("Captain expiry order checkout fixture failed", JSON.stringify(expiryCheckout));
const expiryOrderID = String(expiryCheckout.body.order.id); orderIDs.add(expiryOrderID);
if (typeof expiryCheckout.body.order.paymentIntentId === "string") paymentIntentIDs.add(String(expiryCheckout.body.order.paymentIntentId));
for (const [next, expectedVersion] of [["PARTNER_ACCEPTED", 1], ["PREPARING", 2], ["READY_FOR_DISPATCH", 3]]) {
  const transition = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(first.storeID)}/orders/${encodeURIComponent(expiryOrderID)}/transition`, { token: first.accessToken, headers: partnerHeaders(`captain-expiry-transition-${next}-${suffix}`, expectedVersion), body: { state: next } });
  if (transition.status !== 200 || transition.body?.order?.state !== next) fail("Captain expiry order did not reach READY_FOR_DISPATCH", JSON.stringify({ next, transition }));
}
const firstCaptainBeforeExpiry = await request(dshBase, "GET", "/dsh/captains/me", { token: captainAccessToken });
const firstCaptainUnavailable = await request(dshBase, "POST", "/dsh/captains/me/availability", { token: captainAccessToken, headers: partnerHeaders(`captain-expiry-hide-first-${suffix}`, firstCaptainBeforeExpiry.body?.admission?.version), body: { available: false } });
const activeCaptainBeforeExpiry = await request(dshBase, "GET", "/dsh/captains/me", { token: activeCaptainAccessToken });
const activeCaptainUnavailable = await request(dshBase, "POST", "/dsh/captains/me/availability", { token: activeCaptainAccessToken, headers: partnerHeaders(`captain-expiry-hide-active-${suffix}`, activeCaptainBeforeExpiry.body?.admission?.version), body: { available: false } });
const expiryCaptainPhone = `+96779${crypto.randomInt(1_000_000, 9_999_999)}`;
const expiryCaptainAdmission = await request(dshBase, "POST", "/dsh/captains/admissions", { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-expiry-admit-${suffix}`), body: { contactPhoneE164: expiryCaptainPhone } });
if (expiryCaptainAdmission.status !== 201 || expiryCaptainAdmission.body?.admission?.state !== "eligible" || !expiryCaptainAdmission.body.admission.actorId) fail("Captain expiry actor admission failed", JSON.stringify({ firstCaptainBeforeExpiry, firstCaptainUnavailable, activeCaptainBeforeExpiry, activeCaptainUnavailable, expiryCaptainAdmission }));
const expiryCaptainAdmissionID = String(expiryCaptainAdmission.body.admission.id);
const expiryCaptainActorID = String(expiryCaptainAdmission.body.admission.actorId);
captainAdmissionIDs.add(expiryCaptainAdmissionID); actorIDs.add(expiryCaptainActorID);
const expiryCaptainAccessToken = await activateCaptain(expiryCaptainPhone, `ExpC${suffix.slice(0, 4)}`);
const expiryCaptainSelf = await request(dshBase, "GET", "/dsh/captains/me", { token: expiryCaptainAccessToken });
const expiryCaptainAvailable = await request(dshBase, "POST", "/dsh/captains/me/availability", { token: expiryCaptainAccessToken, headers: partnerHeaders(`captain-expiry-availability-${suffix}`, expiryCaptainSelf.body?.admission?.version), body: { available: true } });
if (firstCaptainBeforeExpiry.status !== 200 || firstCaptainUnavailable.status !== 200 || activeCaptainBeforeExpiry.status !== 200 || activeCaptainUnavailable.status !== 200 || expiryCaptainSelf.status !== 200 || expiryCaptainAvailable.status !== 200 || expiryCaptainAvailable.body?.admission?.availabilityState !== "available") fail("Captain expiry actor availability fixture was not isolated", JSON.stringify({ firstCaptainBeforeExpiry, firstCaptainUnavailable, activeCaptainBeforeExpiry, activeCaptainUnavailable, expiryCaptainSelf, expiryCaptainAvailable }));
const expiryDispatch = await request(dshBase, "POST", `/dsh/orders/${encodeURIComponent(expiryOrderID)}/dispatch`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `captain-expiry-dispatch-${suffix}`) });
if (expiryDispatch.status !== 201 || expiryDispatch.body?.offer?.state !== "offered" || expiryDispatch.body.offer.captainActorId !== expiryCaptainActorID) fail("Captain expiry offer fixture failed", JSON.stringify({ expiryDispatch, expiryCaptainActorID }));
const expiryOfferID = String(expiryDispatch.body.offer.id); captainOfferIDs.add(expiryOfferID);
  // Claim-specific database-time fault injection; not business-state setup.
  sql(`UPDATE dsh.captain_dispatch_offers SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${sqlLiteral(expiryOfferID)}'`);
const [expiredOfferRead, captainAfterExpiry, concurrentExpiryRead] = await Promise.all([
  request(dshBase, "GET", "/dsh/captains/me/offers", { token: expiryCaptainAccessToken }),
  request(dshBase, "GET", "/dsh/captains/me", { token: expiryCaptainAccessToken }),
  request(dshBase, "GET", "/dsh/captains/me/offers", { token: expiryCaptainAccessToken }),
]);
const expiredOfferRepeat = await request(dshBase, "GET", "/dsh/captains/me/offers", { token: expiryCaptainAccessToken });
const expiredOffer = await request(dshBase, "POST", `/dsh/captains/me/offers/${encodeURIComponent(expiryOfferID)}/respond`, { token: expiryCaptainAccessToken, headers: partnerHeaders(`captain-expiry-respond-${suffix}`, 1), body: { decision: "accept" } });
const expiredOfferReplay = await request(dshBase, "POST", `/dsh/captains/me/offers/${encodeURIComponent(expiryOfferID)}/respond`, { token: expiryCaptainAccessToken, headers: partnerHeaders(`captain-expiry-respond-${suffix}`, 1), body: { decision: "accept" } });
if (expiredOffer.status !== 409 || expiredOfferReplay.status !== 409 || expiredOfferRead.status !== 200 || !expiredOfferRead.body?.offers?.some((offer) => offer.id === expiryOfferID && offer.state === "expired") || concurrentExpiryRead.status !== 200 || expiredOfferRepeat.status !== 200 || expiredOfferRepeat.body?.offers?.some((offer) => offer.id === expiryOfferID && offer.state === "offered") || captainAfterExpiry.status !== 200 || captainAfterExpiry.body?.admission?.availabilityState !== "available" || sql(`SELECT count(*) FROM dsh.captain_audit WHERE event_type='dispatch_offer_expired' AND offer_id='${sqlLiteral(expiryOfferID)}'`) !== "1" || sql(`SELECT count(*) FROM dsh.captain_operation_idempotency WHERE idempotency_key='captain-expiry-respond-${suffix}'`) !== "1") fail("Captain offer expiry was not durable and idempotent", JSON.stringify({ expiredOffer, expiredOfferReplay, expiredOfferRead, concurrentExpiryRead, expiredOfferRepeat, captainAfterExpiry }));
console.log("DSH_CAPTAIN_OFFER_REJECT_EXPIRY=PASS");

const captainRoleBeforeDisable = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(activeCaptainActorID)}/roles/captain`, { token: identityDshToken });
const captainDisableKey = `captain-disable-${suffix}`;
const captainDisabled = await request(dshBase, "POST", `/dsh/captains/${encodeURIComponent(activeCaptainActorID)}/identity-role`, { token: dshToken, headers: serviceHeaders(actingOperatorID, captainDisableKey, crypto.randomUUID(), captainRoleBeforeDisable.body?.roleVersion), body: { enabled: false, reason: "تعليق Captain واختبار تحرير العمل" } });
const captainAdmissionSuspended = await request(dshBase, "GET", `/dsh/captains/actors/${encodeURIComponent(activeCaptainActorID)}/admission`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const captainDisabledReplay = await request(dshBase, "POST", `/dsh/captains/${encodeURIComponent(activeCaptainActorID)}/identity-role`, { token: dshToken, headers: serviceHeaders(actingOperatorID, captainDisableKey, crypto.randomUUID(), captainRoleBeforeDisable.body?.roleVersion), body: { enabled: false, reason: "تعليق Captain واختبار تحرير العمل" } });
const captainRoleAfterDisable = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(activeCaptainActorID)}/roles/captain`, { token: identityDshToken });
const revokedCaptainSession = await request(dshBase, "GET", "/dsh/captains/me", { token: activeCaptainAccessToken });
const captainEnableKey = `captain-enable-${suffix}`;
const captainEnabled = await request(dshBase, "POST", `/dsh/captains/${encodeURIComponent(activeCaptainActorID)}/identity-role`, { token: dshToken, headers: serviceHeaders(actingOperatorID, captainEnableKey, crypto.randomUUID(), captainRoleAfterDisable.body?.roleVersion), body: { enabled: true, reason: "إعادة Captain إلى الأهلية التشغيلية" } });
const captainAdmissionRestored = await request(dshBase, "GET", `/dsh/captains/actors/${encodeURIComponent(activeCaptainActorID)}/admission`, { token: dshToken, headers: { "X-Acting-Actor-ID": actingOperatorID } });
const captainEnabledReplay = await request(dshBase, "POST", `/dsh/captains/${encodeURIComponent(activeCaptainActorID)}/identity-role`, { token: dshToken, headers: serviceHeaders(actingOperatorID, captainEnableKey, crypto.randomUUID(), captainRoleAfterDisable.body?.roleVersion), body: { enabled: true, reason: "إعادة Captain إلى الأهلية التشغيلية" } });
if (captainRoleBeforeDisable.status !== 200 || captainDisabled.status !== 204 || captainAdmissionSuspended.status !== 200 || captainAdmissionSuspended.body?.admission?.state !== "suspended" || captainAdmissionSuspended.body.admission.availabilityState !== "unavailable" || captainDisabledReplay.status !== 204 || captainRoleAfterDisable.body?.enabled !== false || revokedCaptainSession.status !== 401 || captainEnabled.status !== 204 || captainAdmissionRestored.status !== 200 || captainAdmissionRestored.body?.admission?.state !== "eligible" || captainAdmissionRestored.body.admission.availabilityState !== "unavailable" || captainEnabledReplay.status !== 204) fail("Captain DSH/Identity access transition was not atomic enough, idempotent, or fail-closed", JSON.stringify({ captainRoleBeforeDisable, captainDisabled, captainAdmissionSuspended, captainDisabledReplay, captainRoleAfterDisable, revokedCaptainSession, captainEnabled, captainAdmissionRestored, captainEnabledReplay }));
console.log("DSH_CAPTAIN_ACCESS_SUSPEND_RESTORE=PASS");

const hiddenA = await request(dshBase, "POST", `/dsh/stores/${first.storeID}/publication`, { token: dshToken, headers: serviceHeaders(actingOperatorID, `store-a-hide-${suffix}`, crypto.randomUUID(), 2), body: { state: "hidden" } });
if (hiddenA.status !== 200) fail("Store hide failed", JSON.stringify(hiddenA));
const afterHideA = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(cityA)}`);
const afterHideB = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(cityB)}`);
if (afterHideA.status !== 200 || afterHideA.body?.stores?.some((store) => store.id === first.storeID) || afterHideB.status !== 200 || !afterHideB.body?.stores?.some((store) => store.id === second.storeID)) fail("Store publication visibility scope failed", JSON.stringify({ afterHideA, afterHideB }));
console.log("DSH_CATALOG_CROSS_STORE_READBACK=PASS");

let outageFailure = "";
const identityContainerID = compose("ps", "-aq", "identity").trim();
try {
  if (!identityContainerID) throw new Error("identity container is not present");
  execFileSync("docker", ["stop", identityContainerID], { cwd: root, encoding: "utf8" });
  const unavailable = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(cityB)}`, { timeoutMs: 15_000, allowNetworkError: true });
  if (unavailable.status !== 502 || unavailable.body?.error?.code !== "IDENTITY_UNAVAILABLE") outageFailure = `Identity outage did not fail closed: ${JSON.stringify(unavailable)}`;
} finally {
  if (!identityContainerID) {
    outageFailure ||= "Identity restart failed: identity container is not present";
  } else {
    try { execFileSync("docker", ["start", identityContainerID], { cwd: root, encoding: "utf8" }); }
    catch (error) { outageFailure ||= `Identity restart failed: ${String(error?.message || error)}`; }
  }
}
if (outageFailure) fail(outageFailure);
await waitForIdentityReady();
console.log("DSH_IDENTITY_FAILURE_RECOVERY=PASS");
console.log("DSH_RUNTIME=PASS");
process.exit(0);
