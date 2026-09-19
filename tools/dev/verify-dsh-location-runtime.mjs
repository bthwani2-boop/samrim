import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { captureMailpitMessageIds, readMailpitCode } from "./mailpit-challenge.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const envArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envPath = envArg ? path.resolve(root, envArg.slice("--env-file=".length)) : path.resolve(root, "infra/local/compose/.env");

function readEnv(file) {
  if (!fs.existsSync(file)) throw new Error(`canonical runtime env file missing: ${file}`);
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).map((line) => {
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`malformed canonical runtime env line: ${line}`);
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`required canonical runtime value missing: ${name}`);
  return value;
}

const env = readEnv(envPath);
const dshBase = required(env, "DSH_API_BASE_URL").replace(/\/+$/, "");
const identityBase = required(env, "IDENTITY_API_BASE_URL").replace(/\/+$/, "");
const identityDshToken = required(env, "IDENTITY_DSH_SERVICE_TOKEN");
const controlPanelToken = required(env, "CONTROL_PANEL_SERVICE_TOKEN");
const bootstrapToken = required(env, "OPERATOR_BOOTSTRAP_SECRET");
const mailpitPort = required(env, "SAMRIM_MAILPIT_WEB_PORT");
const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", path.join(root, "infra/local/compose/compose.yaml")];
const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
const clientPhone = `+96778${crypto.randomInt(1_000_000, 9_999_999)}`;
const partnerPhone = `+96776${crypto.randomInt(1_000_000, 9_999_999)}`;
const foreignPartnerPhone = `+96777${crypto.randomInt(1_000_000, 9_999_999)}`;
let partnerStoreID = "";
let foreignStoreID = "";
let serviceCityID = "";
const actorIDs = new Set();
const caseIDs = new Set();
let clientActorID = "";
let partnerActorID = "";
let foreignPartnerActorID = "";
let verticalID = "";

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function sql(query) {
  // Readback is allowed for schema/contract assertions. DELETE statements below
  // are bounded cleanup of IDs captured by this run, never business fixture setup.
  return execFileSync("docker", [...composeArgs, "exec", "-T", "postgres", "psql", "-U", required(env, "SAMRIM_POSTGRES_USER"), "-d", required(env, "SAMRIM_POSTGRES_DB"), "-Atc", query], { cwd: root, encoding: "utf8" }).trim();
}

async function request(base, method, pathname, options = {}) {
  const response = await fetch(new URL(pathname, base), {
    method,
    headers: { Accept: "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}), ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return { status: response.status, body };
}

async function expect(base, method, pathname, status, options = {}) {
  const result = await request(base, method, pathname, options);
  if (result.status !== status) throw new Error(`${method} ${pathname}: got ${result.status}, expected ${status}; body=${JSON.stringify(result.body)}`);
  return result.body;
}

async function issueChallenge(pathname, body, purpose) {
  const previousMessageIds = await captureMailpitMessageIds({ port: mailpitPort, phone: body.phone, purpose });
  const challenge = await expect(identityBase, "POST", pathname, 201, { body });
  if (typeof challenge?.challengeId !== "string") throw new Error(`${pathname}: challenge id missing`);
  return { ...challenge, code: await readMailpitCode({ port: mailpitPort, phone: body.phone, purpose, excludeMessageIds: previousMessageIds }) };
}

function userHeaders(key, expectedVersion) {
  return { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}

function serviceHeaders(actingActorID) {
  return { "X-Acting-Actor-ID": actingActorID, "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID() };
}

async function createClientSession(phone, instance) {
  const challenge = await issueChallenge("/auth/client/registration/request", { phone }, "client_register");
  const pair = await expect(identityBase, "POST", "/auth/client/register", 201, { body: { phone, code: challenge.code, password: `Loca${crypto.randomBytes(2).toString("hex")}`, clientInstanceId: instance } });
  if (pair.identity?.role !== "client" || pair.identity?.surface !== "app-client") throw new Error("client fixture session identity is not app-client");
  actorIDs.add(String(pair.identity.subject));
  clientActorID = String(pair.identity.subject);
  return pair;
}

async function createPartnerSession(operatorID, phone, instance) {
  const provisioned = await request(identityBase, "POST", "/internal/actor-roles/provision", { token: identityDshToken, headers: { "X-Acting-Actor-ID": operatorID, "X-Correlation-ID": crypto.randomUUID() }, body: { phoneE164: phone, role: "partner" } });
  const actorID = String(provisioned.body.actorId);
  if (actorID && actorID !== "undefined") actorIDs.add(actorID);
  if (![200, 201].includes(provisioned.status) || !actorID || actorID === "undefined") throw new Error(`partner fixture provisioning failed: ${JSON.stringify(provisioned.body)}`);
  const challenge = await issueChallenge("/auth/managed/activation/request", { phone, role: "partner" }, "managed_activate");
  const pairResponse = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role: "partner", verificationCode: challenge.code, password: `Part${crypto.randomBytes(2).toString("hex")}`, clientInstanceId: instance } });
  if (pairResponse.status !== 200) throw new Error(`partner activation failed status=${pairResponse.status} body=${JSON.stringify(pairResponse.body)}`);
  const pair = pairResponse.body;
  if (pair.identity?.subject !== actorID || pair.identity?.role !== "partner" || pair.identity?.surface !== "app-partner") throw new Error("partner fixture session identity is not app-partner");
  return { actorID, pair };
}

async function createApprovedPartner(operatorID, phone, name, serviceCityId) {
  const created = await expect(dshBase, "POST", "/dsh/joining-cases", 201, {
    token: controlPanelToken,
    headers: serviceHeaders(operatorID),
    body: { contactPhoneE164: phone, businessName: `${name} business`, firstStoreName: `${name} store`, serviceCityId, firstStoreVerticalId: verticalID },
  });
  if (created?.case?.state !== "draft" || created.case.firstStoreVerticalId !== verticalID) throw new Error("location joining case create readback failed");
  const caseID = String(created.case.id);
  caseIDs.add(caseID);
  const submitted = await expect(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(caseID)}/submit`, 200, {
    token: controlPanelToken,
    headers: { ...serviceHeaders(operatorID), "X-Expected-Version": "1" },
  });
  if (submitted?.case?.state !== "submitted" || !submitted.case.partnerActorId) throw new Error("location joining case submit readback failed");
  const fixture = await createPartnerSession(operatorID, phone, `location-partner-${suffix}-${name.replace(/[^A-Za-z0-9._:-]/g, "-")}`);
  if (fixture.actorID !== String(submitted.case.partnerActorId)) throw new Error("location joining case actor binding drifted");
  const approved = await expect(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(caseID)}/review`, 200, {
    token: controlPanelToken,
    headers: { ...serviceHeaders(operatorID), "X-Expected-Version": "2" },
    body: { decision: "approved" },
  });
  if (approved?.case?.state !== "approved" || !approved.case.store?.id) throw new Error("location joining case approval readback failed");
  return { ...fixture, caseID, storeID: String(approved.case.store.id) };
}

function cleanup() {
  // Cleanup is intentionally scoped to this verifier's freshly created actors,
  // cases, stores, city and addresses; it must preserve the reusable local world.
  try {
    const locationSchemaExists = sql("SELECT to_regclass('dsh.delivery_addresses') IS NOT NULL");
    if (locationSchemaExists === "t" && clientActorID) {
      const actor = sqlLiteral(clientActorID);
      sql(`DELETE FROM dsh.delivery_address_audit WHERE client_actor_id='${actor}'`);
      sql(`DELETE FROM dsh.delivery_address_mutation_idempotency WHERE client_actor_id='${actor}'`);
      sql(`DELETE FROM dsh.delivery_addresses WHERE client_actor_id='${actor}'`);
    }
    if (locationSchemaExists === "t") {
      for (const caseID of caseIDs) {
        const value = sqlLiteral(caseID);
        sql(`DELETE FROM dsh.joining_case_audit WHERE case_id='${value}'`);
        sql(`DELETE FROM dsh.joining_case_mutation_idempotency WHERE case_id='${value}'`);
        sql(`DELETE FROM dsh.joining_cases WHERE id='${value}'`);
      }
      const stores = `'${sqlLiteral(partnerStoreID)}','${sqlLiteral(foreignStoreID)}'`;
      sql(`DELETE FROM dsh.store_origin_audit WHERE store_id IN (${stores})`);
      sql(`DELETE FROM dsh.store_origin_mutation_idempotency WHERE store_id IN (${stores})`);
      sql(`DELETE FROM dsh.store_publication_audit WHERE store_id IN (${stores})`);
      sql(`DELETE FROM dsh.store_publication_idempotency WHERE store_id IN (${stores})`);
      sql(`DELETE FROM dsh.stores WHERE id IN (${stores})`);
    }
    if (verticalID) {
      const vertical = sqlLiteral(verticalID);
      sql(`DELETE FROM dsh.catalog_registry_mutation_idempotency WHERE entity_id='${vertical}'`);
      sql(`DELETE FROM dsh.commerce_verticals WHERE id='${vertical}'`);
    }
    if (locationSchemaExists === "t") {
      const city = sqlLiteral(serviceCityID);
      sql(`DELETE FROM dsh.service_city_audit WHERE city_id='${city}'`);
      sql(`DELETE FROM dsh.service_city_mutation_idempotency WHERE city_id='${city}'`);
      sql(`DELETE FROM dsh.service_cities WHERE id='${city}'`);
    }
    for (const actorID of actorIDs) sql(`DELETE FROM identity_actors WHERE id='${sqlLiteral(actorID)}'`);
    console.log("LOCATION_CORE_RUNTIME_CLEANUP=PASS");
  } catch (error) {
    console.error(`LOCATION_CORE_RUNTIME_CLEANUP=FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
}

let exitCode = 1;
try {
  const schema = sql("SELECT count(*) FROM dsh.schema_migrations");
  if (schema !== "20") throw new Error(`DSH schema history is not v20: ${schema}`);
  if (sql("SELECT name FROM dsh.schema_migrations WHERE version=10") !== "010_central_catalog_refoundation.sql") throw new Error("Catalog refoundation migration is not canonical");
  if (sql("SELECT name FROM dsh.schema_migrations WHERE version=20") !== "020_field_standing_admission_and_joining_scope.sql") throw new Error("Field standing admission migration is not canonical");
  for (const [table, column] of [["delivery_address_mutation_idempotency", "result_version"], ["delivery_address_audit", "address_text"], ["delivery_address_audit", "latitude"], ["delivery_address_audit", "longitude"], ["store_origin_mutation_idempotency", "result_version"], ["store_origin_mutation_idempotency", "result_latitude"], ["store_origin_mutation_idempotency", "result_longitude"], ["store_origin_mutation_idempotency", "result_updated_at"], ["store_origin_audit", "latitude"], ["store_origin_audit", "longitude"]]) {
    if (sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema='dsh' AND table_name='${table}' AND column_name='${column}'`) !== "0") throw new Error(`Location Core precise/dead column remains: dsh.${table}.${column}`);
  }

  let operatorID = sql("SELECT actor_id FROM identity_actor_roles WHERE role='operator' AND enabled AND activated_at IS NOT NULL ORDER BY activated_at DESC, actor_id LIMIT 1");
  if (!operatorID) {
    const bootstrap = await request(identityBase, "POST", "/internal/bootstrap/operator", { token: bootstrapToken, body: { phoneE164: `+96775${crypto.randomInt(1_000_000, 9_999_999)}`, role: "operator" } });
    if (![201, 409].includes(bootstrap.status)) throw new Error(`operator bootstrap failed: ${JSON.stringify(bootstrap.body)}`);
    operatorID = sql("SELECT COALESCE(initial_operator_actor_id,'') FROM identity_bootstrap_state WHERE id=1");
  }
  if (!operatorID) throw new Error("Location Core runtime operator fixture is unavailable");

  const cityCreated = await expect(dshBase, "POST", "/dsh/service-cities", 201, {
    token: controlPanelToken,
    headers: serviceHeaders(operatorID),
    body: { displayNameAr: `مدينة اختبار المواقع ${Date.now()}`, active: true },
  });
  if (!cityCreated?.city?.id) throw new Error("location service city canonical create failed");
  serviceCityID = String(cityCreated.city.id);

  const verticalCreated = await expect(dshBase, "POST", "/dsh/catalog/verticals", 201, {
    token: controlPanelToken,
    headers: serviceHeaders(operatorID),
    body: { nameAr: `متاجر المواقع ${Date.now()}`, nameEn: `Location Stores ${suffix}`, active: true },
  });
  if (!verticalCreated?.vertical?.id) throw new Error("location vertical canonical create failed");
  verticalID = String(verticalCreated.vertical.id);

  const client = await createClientSession(clientPhone, `location-client-${suffix}`);
  const partnerFixture = await createApprovedPartner(operatorID, partnerPhone, "Location Runtime", serviceCityID);
  const foreignPartnerFixture = await createApprovedPartner(operatorID, foreignPartnerPhone, "Foreign Location Runtime", serviceCityID);
  partnerActorID = partnerFixture.actorID;
  foreignPartnerActorID = foreignPartnerFixture.actorID;
  partnerStoreID = partnerFixture.storeID;
  foreignStoreID = foreignPartnerFixture.storeID;

  const empty = await expect(dshBase, "GET", "/dsh/addresses?limit=10", 200, { token: client.accessToken });
  if (!Array.isArray(empty?.addresses) || empty.addresses.length !== 0 || empty.nextCursor !== "") throw new Error("client address empty readback is not canonical");
  const createBody = { addressText: "شارع location runtime، صنعاء", latitude: 15.3694457, longitude: 44.1910064, serviceCityId: serviceCityID };
  const createKey = `location-address-create-${suffix}`;
  const created = await expect(dshBase, "POST", "/dsh/addresses", 201, { token: client.accessToken, headers: userHeaders(createKey), body: createBody });
  if (created?.idempotentReplay || created?.address?.version !== 1) throw new Error(`client address create readback failed: ${JSON.stringify(created)}`);
  const addressID = String(created.address.id);
  const createReplay = await expect(dshBase, "POST", "/dsh/addresses", 200, { token: client.accessToken, headers: userHeaders(createKey), body: createBody });
  if (createReplay?.idempotentReplay !== true || createReplay.address.id !== addressID || createReplay.address.version !== 1) throw new Error("client address idempotency replay failed");
  const createConflict = await request(dshBase, "POST", "/dsh/addresses", { token: client.accessToken, headers: userHeaders(createKey), body: { ...createBody, addressText: "عنوان مختلف" } });
  if (createConflict.status !== 409 || createConflict.body?.error?.code !== "IDEMPOTENCY_CONFLICT") throw new Error(`client address idempotency conflict failed: ${JSON.stringify(createConflict)}`);
  const readAddress = await expect(dshBase, "GET", `/dsh/addresses/${encodeURIComponent(addressID)}`, 200, { token: client.accessToken });
  if (readAddress.address?.id !== addressID || readAddress.address?.version !== 1) throw new Error("client address canonical readback failed");
  const updated = await expect(dshBase, "POST", `/dsh/addresses/${encodeURIComponent(addressID)}`, 200, { token: client.accessToken, headers: userHeaders(`location-address-update-${suffix}-1`, 1), body: { addressText: "شارع location runtime، صنعاء، مبنى 5", latitude: 15.369446, longitude: 44.191006, serviceCityId: serviceCityID } });
  if (updated.address?.version !== 2) throw new Error("client address update version readback failed");
  const delayedCreateReplay = await expect(dshBase, "POST", "/dsh/addresses", 200, { token: client.accessToken, headers: userHeaders(createKey), body: createBody });
  if (delayedCreateReplay.address?.version !== 2 || delayedCreateReplay.address.addressText !== updated.address.addressText) throw new Error("delayed create replay did not reread current address");
  const updatedAgain = await expect(dshBase, "POST", `/dsh/addresses/${encodeURIComponent(addressID)}`, 200, { token: client.accessToken, headers: userHeaders(`location-address-update-${suffix}-2`, 2), body: { addressText: "شارع location runtime، صنعاء، مبنى 6", latitude: 15.369447, longitude: 44.191007, serviceCityId: serviceCityID } });
  const delayedUpdateReplay = await expect(dshBase, "POST", `/dsh/addresses/${encodeURIComponent(addressID)}`, 200, { token: client.accessToken, headers: userHeaders(`location-address-update-${suffix}-1`, 1), body: { addressText: "شارع location runtime، صنعاء، مبنى 5", latitude: 15.369446, longitude: 44.191006, serviceCityId: serviceCityID } });
  if (updatedAgain.address?.version !== 3 || delayedUpdateReplay.address?.version !== 3 || delayedUpdateReplay.address.addressText !== updatedAgain.address.addressText) throw new Error("delayed update replay did not reread current address");
  const staleAddress = await request(dshBase, "POST", `/dsh/addresses/${encodeURIComponent(addressID)}`, { token: client.accessToken, headers: userHeaders(`location-address-stale-${suffix}`, 1), body: { addressText: "عنوان stale", latitude: 15.3, longitude: 44.1, serviceCityId: serviceCityID } });
  if (staleAddress.status !== 409 || staleAddress.body?.error?.code !== "VERSION_CONFLICT") throw new Error(`client address stale write was accepted: ${JSON.stringify(staleAddress)}`);
  const addressConcurrent = await Promise.all([0, 1].map((index) => request(dshBase, "POST", `/dsh/addresses/${encodeURIComponent(addressID)}`, { token: client.accessToken, headers: userHeaders(`location-address-concurrent-${suffix}-${index}`, 3), body: { addressText: `عنوان concurrent ${index}`, latitude: 15.5 + index / 100, longitude: 44.3 + index / 100, serviceCityId: serviceCityID } })));
  if (addressConcurrent.filter((result) => result.status === 200).length !== 1 || addressConcurrent.filter((result) => result.status === 409 && result.body?.error?.code === "VERSION_CONFLICT").length !== 1) throw new Error(`client address concurrency was not serialized: ${JSON.stringify(addressConcurrent)}`);

  const emptyOrigin = await expect(dshBase, "GET", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, 200, { token: partnerFixture.pair.accessToken });
  if (emptyOrigin.origin !== null || emptyOrigin.originVersion !== 0 || Object.hasOwn(emptyOrigin, "storeVersion")) throw new Error(`partner origin empty readback failed: ${JSON.stringify(emptyOrigin)}`);
  const originBody = { latitude: 15.369446, longitude: 44.191006 };
  const originKey = `location-origin-set-${suffix}`;
  const origin = await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, 200, { token: partnerFixture.pair.accessToken, headers: userHeaders(originKey, 0), body: originBody });
  if (origin.origin?.latitude !== 15.369446 || origin.originVersion !== 1) throw new Error(`partner origin write readback failed: ${JSON.stringify(origin)}`);
  let storeReadback = sql(`SELECT version || '|' || delivery_origin_version FROM dsh.stores WHERE id='${sqlLiteral(partnerStoreID)}'`);
  if (storeReadback !== "1|1") throw new Error(`origin write changed Store version: ${storeReadback}`);
  const originReplay = await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, 200, { token: partnerFixture.pair.accessToken, headers: userHeaders(originKey, 0), body: originBody });
  if (originReplay.idempotentReplay !== true || originReplay.originVersion !== 1) throw new Error("partner origin idempotency replay failed");
  const originSecond = await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, 200, { token: partnerFixture.pair.accessToken, headers: userHeaders(`location-origin-update-${suffix}`, 1), body: { latitude: 15.4, longitude: 44.2 } });
  const delayedOriginReplay = await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, 200, { token: partnerFixture.pair.accessToken, headers: userHeaders(originKey, 0), body: originBody });
  if (originSecond.originVersion !== 2 || delayedOriginReplay.originVersion !== 2 || delayedOriginReplay.origin.latitude !== originSecond.origin.latitude) throw new Error("delayed origin replay did not reread current origin");
  const originStale = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, { token: partnerFixture.pair.accessToken, headers: userHeaders(`location-origin-stale-${suffix}`, 1), body: { latitude: 15.4, longitude: 44.2 } });
  if (originStale.status !== 409 || originStale.body?.error?.code !== "VERSION_CONFLICT") throw new Error(`partner origin stale write was accepted: ${JSON.stringify(originStale)}`);
  const originConcurrent = await Promise.all([0, 1].map((index) => request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, { token: partnerFixture.pair.accessToken, headers: userHeaders(`location-origin-concurrent-${suffix}-${index}`, 2), body: { latitude: 15.6 + index / 100, longitude: 44.4 + index / 100 } })));
  if (originConcurrent.filter((result) => result.status === 200).length !== 1 || originConcurrent.filter((result) => result.status === 409 && result.body?.error?.code === "VERSION_CONFLICT").length !== 1) throw new Error(`origin concurrency was not serialized: ${JSON.stringify(originConcurrent)}`);
  storeReadback = sql(`SELECT version || '|' || delivery_origin_version FROM dsh.stores WHERE id='${sqlLiteral(partnerStoreID)}'`);
  if (!storeReadback.startsWith("1|3")) throw new Error(`origin DB readback is not independent from Store publication version: ${storeReadback}`);

  const publicationAttempt = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/publication`, { token: controlPanelToken, headers: { ...userHeaders(`location-publication-${suffix}`, 1), ...serviceHeaders(operatorID) }, body: { state: "published" } });
  if (publicationAttempt.status !== 409 || publicationAttempt.body?.error?.code !== "READINESS_BLOCKED") throw new Error(`publication readiness gate did not fail closed: ${JSON.stringify(publicationAttempt)}`);
  storeReadback = sql(`SELECT version || '|' || delivery_origin_version FROM dsh.stores WHERE id='${sqlLiteral(partnerStoreID)}'`);
  if (storeReadback !== "1|3") throw new Error(`blocked publication changed Store or origin version: ${storeReadback}`);
  console.log("LOCATION_CORE_PUBLICATION_READINESS_GATE=PASS");

  const wrongRoleAddress = await request(dshBase, "GET", `/dsh/addresses/${encodeURIComponent(addressID)}`, { token: partnerFixture.pair.accessToken });
  if (wrongRoleAddress.status !== 403) throw new Error(`wrong-role address read returned ${wrongRoleAddress.status}`);
  const unauthAddress = await request(dshBase, "GET", `/dsh/addresses/${encodeURIComponent(addressID)}`);
  if (unauthAddress.status !== 401) throw new Error(`unauthenticated address read returned ${unauthAddress.status}`);
  const unknownAddress = await request(dshBase, "GET", "/dsh/addresses/unknown-location-address", { token: client.accessToken });
  if (unknownAddress.status !== 404) throw new Error(`unknown address read returned ${unknownAddress.status}`);
  const wrongRoleOrigin = await request(dshBase, "GET", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, { token: client.accessToken });
  if (wrongRoleOrigin.status !== 403) throw new Error(`wrong-role origin read returned ${wrongRoleOrigin.status}`);
  const unauthOrigin = await request(dshBase, "GET", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`);
  if (unauthOrigin.status !== 401) throw new Error(`unauthenticated origin read returned ${unauthOrigin.status}`);
  const foreignOrigin = await request(dshBase, "GET", `/dsh/stores/${encodeURIComponent(foreignStoreID)}/delivery-origin`, { token: partnerFixture.pair.accessToken });
  const unknownOrigin = await request(dshBase, "GET", "/dsh/stores/unknown-location-store/delivery-origin", { token: partnerFixture.pair.accessToken });
  if (foreignOrigin.status !== 404 || unknownOrigin.status !== 404 || foreignOrigin.body?.error?.code !== unknownOrigin.body?.error?.code) throw new Error(`foreign and unknown Store origin reads are distinguishable: foreign=${JSON.stringify(foreignOrigin)} unknown=${JSON.stringify(unknownOrigin)}`);
  const foreignWrite = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(foreignStoreID)}/delivery-origin`, { token: partnerFixture.pair.accessToken, headers: userHeaders(`location-foreign-write-${suffix}`, 0), body: originBody });
  const unknownWrite = await request(dshBase, "POST", "/dsh/stores/unknown-location-store/delivery-origin", { token: partnerFixture.pair.accessToken, headers: userHeaders(`location-unknown-write-${suffix}`, 0), body: originBody });
  if (foreignWrite.status !== 404 || unknownWrite.status !== 404 || foreignWrite.body?.error?.code !== unknownWrite.body?.error?.code) throw new Error("foreign and unknown Store origin writes are distinguishable");

  for (let index = 0; index < 51; index += 1) {
    const body = { addressText: `عنوان runtime pagination ${index}، صنعاء`, latitude: 15 + index / 1000, longitude: 44 + index / 1000, serviceCityId: serviceCityID };
    const createdPageAddress = await expect(dshBase, "POST", "/dsh/addresses", 201, { token: client.accessToken, headers: userHeaders(`location-page-${suffix}-${index}`), body });
    if (createdPageAddress.address?.version !== 1) throw new Error(`runtime pagination seed ${index} was not created canonically`);
  }
  const pageIDs = new Set();
  let cursor = "";
  pageIDs.clear();
  cursor = "";
  for (let page = 0; page < 10; page += 1) {
    const pageResult = await expect(dshBase, "GET", `/dsh/addresses?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, 200, { token: client.accessToken });
    if (!Array.isArray(pageResult.addresses) || pageResult.addresses.length > 10) throw new Error(`bounded address page ${page} is invalid`);
    for (const address of pageResult.addresses) {
      if (pageIDs.has(address.id)) throw new Error(`bounded address pagination repeated ${address.id}`);
      pageIDs.add(address.id);
    }
    if (!pageResult.nextCursor) break;
    cursor = pageResult.nextCursor;
    if (page === 9) throw new Error("bounded address pagination did not terminate");
  }
  if (pageIDs.size < 52) throw new Error(`bounded address pagination lost records: ${pageIDs.size}`);
  const malformedCursor = await request(dshBase, "GET", "/dsh/addresses?cursor=not-a-valid-cursor", { token: client.accessToken });
  if (malformedCursor.status !== 400) throw new Error(`malformed address cursor returned ${malformedCursor.status}`);

  const addressCount = sql(`SELECT count(*) FROM dsh.delivery_address_audit WHERE client_actor_id='${sqlLiteral(clientActorID)}'`);
  const originCount = sql(`SELECT count(*) FROM dsh.store_origin_audit WHERE store_id='${sqlLiteral(partnerStoreID)}'`);
  if (addressCount !== "55" || originCount !== "3") throw new Error(`audit readback is not one row per successful mutation: addresses=${addressCount} origins=${originCount}`);
  console.log("DSH_SCHEMA_V20=PASS");
  console.log("LOCATION_CORE_RUNTIME=PASS");
  console.log("LOCATION_CORE_CLIENT_API=PASS");
  console.log("LOCATION_CORE_PARTNER_API=PASS");
  console.log("LOCATION_CORE_IDEMPOTENCY=PASS");
  console.log("LOCATION_CORE_VERSION_CONCURRENCY=PASS");
  console.log("LOCATION_CORE_PAGINATION=PASS");
  console.log("LOCATION_CORE_AUTHORIZATION=PASS");
  console.log("LOCATION_CORE_DB_READBACK=PASS");
  exitCode = 0;
} catch (error) {
  console.error(`LOCATION_CORE_RUNTIME=FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  cleanup();
}

process.exit(exitCode);
