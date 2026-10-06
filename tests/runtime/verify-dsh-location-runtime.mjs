import { resolveTrustedExecutable } from "./runtime-proof/trusted-executables.mjs";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { captureMailpitMessageIds, readMailpitCode } from "./mailpit-challenge.mjs";
import { challengeSourceHeaders } from "./runtime-proof/challenge-source.mjs";
import { assertCanonicalDshMigrationHistory, canonicalDshMigrationHistoryQuery, readCanonicalDshMigrationNames } from "./runtime-proof/canonical-dsh-migration-history.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const dshMigrationDirectory = path.resolve(root, "services/dsh/backend/internal/storage/postgres/migrations");
const dshMigrationNames = readCanonicalDshMigrationNames(dshMigrationDirectory);
const envArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envPath = envArg ? path.resolve(root, envArg.slice("--env-file=".length)) : path.resolve(root, "infra/local/.env");
if (process.env.CI !== "true" || process.env.BTHWANI_IDENTITY_PROOF_SCOPE !== "disposable-ci") {
  throw new Error("Location Core runtime proof requires disposable CI state because it creates persistent business records");
}

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
const dshBase = (process.env.DSH_API_BASE_URL?.trim() || required(env, "DSH_API_BASE_URL")).replace(/\/+$/, "");
const identityBase = (process.env.IDENTITY_API_BASE_URL?.trim() || required(env, "IDENTITY_API_BASE_URL")).replace(/\/+$/, "");
const identityDshToken = required(env, "IDENTITY_DSH_SERVICE_TOKEN");
const controlPanelToken = required(env, "CONTROL_PANEL_SERVICE_TOKEN");
const bootstrapToken = required(env, "OPERATOR_BOOTSTRAP_SECRET");
const mailpitPort = process.env.SAMRIM_MAILPIT_WEB_PORT?.trim() || required(env, "SAMRIM_MAILPIT_WEB_PORT");
const composeProject = process.env.SAMRIM_RUNTIME_COMPOSE_PROJECT?.trim() || "samrim-local";
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(composeProject)) throw new Error("runtime compose project name is invalid");
const composeArgs = ["compose", "--project-name", composeProject, "--env-file", envPath, "-f", path.join(root, "infra/local/compose/compose.yaml")];
const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
const clientPhone = `+96778${crypto.randomInt(1_000_000, 9_999_999)}`;
const partnerPhone = `+96776${crypto.randomInt(1_000_000, 9_999_999)}`;
const foreignPartnerPhone = `+96777${crypto.randomInt(1_000_000, 9_999_999)}`;
let partnerStoreID = "";
let foreignStoreID = "";
let serviceCityID = "";
let clientActorID = "";
let verticalID = "";
let commercialStoreTypeID = "";
const firstStoreOrigin = { firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006 };

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function sql(query) {
  // SQL is limited to schema/readback assertions and claim-specific fault injection.
  return execFileSync(resolveTrustedExecutable("docker"), [...composeArgs, "exec", "-T", "postgres", "psql", "-U", required(env, "SAMRIM_POSTGRES_USER"), "-d", required(env, "SAMRIM_POSTGRES_DB"), "-Atc", query], { cwd: root, encoding: "utf8" }).trim();
}

async function request(base, method, pathname, options = {}) {
  const requestBody = options.rawBody === undefined ? options.body === undefined ? undefined : JSON.stringify(options.body) : options.rawBody;
  const response = await fetch(new URL(pathname, base), {
    method,
    headers: { Accept: "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}), ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(requestBody === undefined ? {} : { body: requestBody }),
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
  const challenge = await expect(identityBase, "POST", pathname, 201, { body, headers: challengeSourceHeaders(body.phone) });
  if (typeof challenge?.challengeId !== "string") throw new Error(`${pathname}: challenge id missing`);
  return { ...challenge, code: await readMailpitCode({ port: mailpitPort, phone: body.phone, purpose, excludeMessageIds: previousMessageIds }) };
}

function userHeaders(key, expectedVersion) {
  return { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}

function serviceHeaders(actingActorID, expectedVersion) {
  return { "X-Acting-Actor-ID": actingActorID, "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID(), ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}

async function createClientSession(phone, instance) {
  const challenge = await issueChallenge("/auth/client/registration/request", { phone }, "client_register");
  const pair = await expect(identityBase, "POST", "/auth/client/register", 201, { body: { phone, code: challenge.code, password: `Loca${crypto.randomBytes(2).toString("hex")}`, clientInstanceId: instance } });
  if (pair.identity?.role !== "client" || pair.identity?.surface !== "app-client") throw new Error("client fixture session identity is not app-client");
  clientActorID = String(pair.identity.subject);
  return pair;
}

async function createPartnerSession(operatorID, phone, instance) {
  const provisioned = await request(identityBase, "POST", "/internal/actor-roles/provision", { token: identityDshToken, headers: { "X-Acting-Actor-ID": operatorID, "X-Correlation-ID": crypto.randomUUID() }, body: { phoneE164: phone, role: "partner" } });
  const actorID = String(provisioned.body.actorId);
  if (![200, 201].includes(provisioned.status) || !actorID || actorID === "undefined") throw new Error(`partner fixture provisioning failed: ${JSON.stringify(provisioned.body)}`);
  const challenge = await issueChallenge("/auth/managed/activation/request", { phone, role: "partner" }, "managed_activate");
  const pairResponse = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role: "partner", verificationCode: challenge.code, password: `Part${crypto.randomBytes(2).toString("hex")}`, clientInstanceId: instance } });
  if (pairResponse.status !== 200) throw new Error(`partner activation failed status=${pairResponse.status} body=${JSON.stringify(pairResponse.body)}`);
  const pair = pairResponse.body;
  if (pair.identity?.subject !== actorID || pair.identity?.role !== "partner" || pair.identity?.surface !== "app-partner") throw new Error("partner fixture session identity is not app-partner");
  return { actorID, pair };
}

async function ensureCommissionDefault(operatorID) {
  const endpoint = `/dsh/operator/commercial-store-types/${encodeURIComponent(commercialStoreTypeID)}/commission-defaults`;
  const read = async () => request(dshBase, "GET", endpoint, { token: controlPanelToken, headers: { "X-Acting-Actor-ID": operatorID } });
  const current = await read();
  if (current.status !== 200 || current.body?.commercialStoreTypeId !== commercialStoreTypeID || !Array.isArray(current.body?.defaults)) throw new Error(`commercial store type commission default read failed: ${JSON.stringify(current)}`);
  const existing = current.body.defaults.find((item) => item.fulfillmentMode === "BTHWANI_CAPTAIN");
  if (existing) {
    if (existing.commercialStoreTypeId !== commercialStoreTypeID || existing.fulfillmentMode !== "BTHWANI_CAPTAIN" || existing.suggestedCommissionRateBps !== 1500 || !Number.isInteger(existing.defaultVersion) || existing.defaultVersion < 1) throw new Error(`commercial store type commission suggestion is invalid: ${JSON.stringify(existing)}`);
    return existing;
  }

  const created = await request(dshBase, "POST", endpoint, {
    token: controlPanelToken,
    headers: serviceHeaders(operatorID),
    body: { fulfillmentMode: "BTHWANI_CAPTAIN", suggestedCommissionRateBps: 1500, expectedDefaultVersion: 0, reason: "Location Core disposable runtime proof negotiation suggestion" },
  });
  const readback = await read();
  const suggestedDefault = readback.body?.defaults?.find((item) => item.fulfillmentMode === "BTHWANI_CAPTAIN");
  if (created.status !== 200 || created.body?.default?.commercialStoreTypeId !== commercialStoreTypeID || created.body?.default?.fulfillmentMode !== "BTHWANI_CAPTAIN" || created.body?.default?.suggestedCommissionRateBps !== 1500 || created.body?.default?.defaultVersion !== 1 || readback.status !== 200 || suggestedDefault?.commercialStoreTypeId !== commercialStoreTypeID || suggestedDefault?.fulfillmentMode !== "BTHWANI_CAPTAIN" || suggestedDefault?.suggestedCommissionRateBps !== 1500 || suggestedDefault?.defaultVersion !== 1) throw new Error(`canonical Store Type commission suggestion setup/readback failed: ${JSON.stringify({ created, readback })}`);
  return suggestedDefault;
}

async function createApprovedPartner(operatorID, phone, name, serviceCityId) {
  const created = await expect(dshBase, "POST", "/dsh/joining-cases", 201, {
    token: controlPanelToken,
    headers: serviceHeaders(operatorID),
    body: {
      contactPhoneE164: phone,
      ownerFullName: `${name} owner`,
      businessName: `${name} business`,
      firstStoreName: `${name} store`,
      walletProviderKey: "provider-yemen",
      firstStoreAddress: `${name} street, building 1`,
      firstStoreWorkingHours: { intervals: [{ dayOfWeek: 1, opensAt: "08:00", closesAt: "16:00", closesNextDay: false }] },
      firstStoreProofType: "COMMERCIAL_REGISTRATION",
      firstStoreProofNumber: `CR-${suffix}-${phone.slice(-4)}`,
      serviceCityId,
      firstStoreVerticalId: verticalID,
      firstStoreCommercialTypeId: commercialStoreTypeID,
      firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"],
      ...firstStoreOrigin,
    },
  });
  if (created?.case?.state !== "draft" || created.case.firstStoreVerticalId !== verticalID || created.case.firstStoreCommercialTypeId !== commercialStoreTypeID || created.case.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || created.case.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude) throw new Error("location joining case create readback failed");
  const caseID = String(created.case.id);
  const runtimePNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const casePath = `/dsh/operator/joining-cases/${encodeURIComponent(caseID)}`;
  const upload = async (pathname, expectedVersion, form) => request(dshBase, "POST", pathname, {
    token: controlPanelToken,
    headers: serviceHeaders(operatorID, expectedVersion),
    rawBody: form,
  });
  const proofForm = new FormData();
  proofForm.set("file", new Blob([runtimePNG], { type: "image/png" }), "location-proof.png");
  const proofImage = await upload(`${casePath}/proof-image`, Number(created.case.version), proofForm);
  if (proofImage.status !== 201 || proofImage.body?.case?.version !== Number(created.case.version) + 1 || proofImage.body?.case?.firstStoreProofImageUploaded !== true) throw new Error(`location joining case proof upload failed: ${JSON.stringify(proofImage)}`);
  const storeImageForm = new FormData();
  storeImageForm.set("creator", "DSH Location Core runtime proof fixture generator");
  storeImageForm.set("sourceDescription", "One-pixel PNG generated for the isolated DSH Location Core runtime proof");
  storeImageForm.set("rightsStatement", "Generated solely for this disposable runtime proof and permitted for its test");
  storeImageForm.set("rightsAttested", "true");
  storeImageForm.set("file", new Blob([runtimePNG], { type: "image/png" }), "location-store.png");
  const storeImage = await upload(`${casePath}/store-image`, Number(proofImage.body.case.version), storeImageForm);
  if (storeImage.status !== 201 || storeImage.body?.case?.version !== Number(proofImage.body.case.version) + 1) throw new Error(`location joining case store image upload failed: ${JSON.stringify(storeImage)}`);
  const mediaReadback = await request(dshBase, "GET", `/dsh/joining-cases/${encodeURIComponent(caseID)}`, { token: controlPanelToken, headers: { "X-Acting-Actor-ID": operatorID } });
  if (mediaReadback.status !== 200 || mediaReadback.body?.case?.version !== storeImage.body.case.version || !mediaReadback.body?.case?.storeProfileImage) throw new Error(`location joining case evidence readback failed: ${JSON.stringify(mediaReadback)}`);
  const evidenceVersion = Number(mediaReadback.body.case.version);
  const submitted = await expect(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(caseID)}/submit`, 200, {
    token: controlPanelToken,
    headers: serviceHeaders(operatorID, evidenceVersion),
  });
  if (submitted?.case?.state !== "submitted" || !submitted.case.partnerActorId) throw new Error("location joining case submit readback failed");
  const fixture = await createPartnerSession(operatorID, phone, `location-partner-${suffix}-${name.replace(/[^A-Za-z0-9._:-]/g, "-")}`);
  if (fixture.actorID !== String(submitted.case.partnerActorId)) throw new Error("location joining case actor binding drifted");
  await ensureCommissionDefault(operatorID);
  const terms = await expect(dshBase, "GET", "/dsh/operator/partner-financial-terms-policy", 200, { token: controlPanelToken, headers: { "X-Acting-Actor-ID": operatorID } });
  if (terms?.policy?.state !== "ACTIVE" || terms.policy.settlementPeriod !== "MONTHLY" || typeof terms.policy.policyVersion !== "string" || !terms.policy.policyVersion.startsWith("partner-financial-terms:v")) throw new Error(`active partner financial terms policy is invalid: ${JSON.stringify(terms)}`);
  const approved = await expect(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(caseID)}/review`, 200, {
    token: controlPanelToken,
    headers: serviceHeaders(operatorID, Number(submitted.case.version)),
    body: { decision: "approved", expectedTermsPolicyVersion: terms.policy.policyVersion },
  });
  if (approved?.case?.state !== "approved" || approved.case.financialProfileState !== "ACTIVE" || approved.case.settlementPeriod !== "MONTHLY" || typeof approved.case.financialProfileId !== "string" || !approved.case.store?.id || approved.case.firstStoreCommercialTypeId !== commercialStoreTypeID || approved.case.store.commercialStoreTypeId !== commercialStoreTypeID || approved.case.firstStoreLatitude !== firstStoreOrigin.firstStoreLatitude || approved.case.firstStoreLongitude !== firstStoreOrigin.firstStoreLongitude || approved.case.store.deliveryOrigin?.latitude !== firstStoreOrigin.firstStoreLatitude || approved.case.store.deliveryOrigin?.longitude !== firstStoreOrigin.firstStoreLongitude) throw new Error("location joining case approval did not bind financial terms, commercial type, or store origin");
  return { ...fixture, caseID, storeID: String(approved.case.store.id) };
}

let exitCode = 1;
try {
  const schema = sql("SELECT count(*) FROM dsh.schema_migrations");
  assertCanonicalDshMigrationHistory(dshMigrationNames, schema, sql(canonicalDshMigrationHistoryQuery(dshMigrationNames)));
  if (sql("SELECT name FROM dsh.schema_migrations WHERE version=10") !== "010_central_catalog_refoundation.sql") throw new Error("Catalog refoundation migration is not canonical");
  if (sql("SELECT name FROM dsh.schema_migrations WHERE version=20") !== "020_field_standing_admission_and_joining_scope.sql") throw new Error("Field standing admission migration is not canonical");
  if (sql("SELECT name FROM dsh.schema_migrations WHERE version=21") !== "021_joining_case_store_origin.sql") throw new Error("Joining-case store-origin migration is not canonical");
  if (sql("SELECT name FROM dsh.schema_migrations WHERE version=33") !== "033_partner_financial_terms_binding.sql") throw new Error("Partner financial terms migration is not canonical");
  for (const [table, column] of [["delivery_address_mutation_idempotency", "result_version"], ["delivery_address_audit", "address_text"], ["delivery_address_audit", "latitude"], ["delivery_address_audit", "longitude"], ["store_origin_mutation_idempotency", "result_version"], ["store_origin_mutation_idempotency", "result_latitude"], ["store_origin_mutation_idempotency", "result_longitude"], ["store_origin_mutation_idempotency", "result_updated_at"], ["store_origin_audit", "latitude"], ["store_origin_audit", "longitude"]]) {
    if (sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema='dsh' AND table_name='${table}' AND column_name='${column}'`) !== "0") throw new Error(`Location Core precise/dead column remains: dsh.${table}.${column}`);
  }

  let operatorID = sql("SELECT r.actor_id FROM identity_actor_roles r JOIN identity_actors a ON a.id=r.actor_id JOIN identity_operator_permissions p ON p.actor_id=r.actor_id AND p.permission='platform_policies' AND p.enabled JOIN identity_bootstrap_state b ON b.id=1 WHERE r.role='operator' AND r.enabled AND a.security_enabled AND r.activated_at IS NOT NULL ORDER BY (r.actor_id=b.initial_operator_actor_id) DESC, r.activated_at DESC, r.actor_id LIMIT 1");
  if (!operatorID) {
    const bootstrap = await request(identityBase, "POST", "/internal/bootstrap/operator", { token: bootstrapToken, body: { phoneE164: `+96775${crypto.randomInt(1_000_000, 9_999_999)}`, role: "operator" } });
    if (![201, 409].includes(bootstrap.status)) throw new Error(`operator bootstrap failed: ${JSON.stringify(bootstrap.body)}`);
    operatorID = sql("SELECT COALESCE(initial_operator_actor_id,'') FROM identity_bootstrap_state WHERE id=1");
  }
  if (!operatorID) throw new Error("Location Core runtime operator fixture is unavailable");
  const platformPoliciesAccess = await request(identityBase, "GET", `/internal/operators/${encodeURIComponent(operatorID)}/permissions/platform_policies`, { token: identityDshToken });
  if (platformPoliciesAccess.status !== 200 || platformPoliciesAccess.body?.actorId !== operatorID || platformPoliciesAccess.body?.permission !== "platform_policies" || platformPoliciesAccess.body?.enabled !== true) throw new Error("Location Core runtime operator lacks Platform Policies permission");

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
    body: { nameAr: `متاجر المواقع ${Date.now()}`, nameEn: `Location Stores ${suffix}`, active: true, reason: "DSH Location Core runtime vertical" },
  });
  if (!verticalCreated?.vertical?.id) throw new Error("location vertical canonical create failed");
  verticalID = String(verticalCreated.vertical.id);

  const commercialStoreTypeCreated = await expect(dshBase, "POST", "/dsh/catalog/commercial-store-types", 201, {
    token: controlPanelToken,
    headers: serviceHeaders(operatorID),
    body: { verticalId: verticalID, nameAr: `نوع متجر المواقع ${suffix}`, nameEn: `Location Store Type ${suffix}`, active: true, reason: "DSH Location Core runtime joining case" },
  });
  if (!commercialStoreTypeCreated?.storeType?.id || commercialStoreTypeCreated.storeType.verticalId !== verticalID || !commercialStoreTypeCreated.storeType.active) throw new Error("location commercial store type canonical create failed");
  commercialStoreTypeID = String(commercialStoreTypeCreated.storeType.id);
  const commercialStoreTypeRead = await expect(dshBase, "GET", `/dsh/catalog/commercial-store-types?verticalId=${encodeURIComponent(verticalID)}`, 200, { token: controlPanelToken, headers: { "X-Acting-Actor-ID": operatorID } });
  if (!commercialStoreTypeRead.storeTypes?.some((item) => item.id === commercialStoreTypeID && item.active)) throw new Error("location commercial store type readback failed");

  const client = await createClientSession(clientPhone, `location-client-${suffix}`);
  const partnerFixture = await createApprovedPartner(operatorID, partnerPhone, "Location Runtime", serviceCityID);
  const foreignPartnerFixture = await createApprovedPartner(operatorID, foreignPartnerPhone, "Foreign Location Runtime", serviceCityID);
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

  const origin = await expect(dshBase, "GET", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, 200, { token: partnerFixture.pair.accessToken });
  if (origin.origin?.latitude !== firstStoreOrigin.firstStoreLatitude || origin.origin?.longitude !== firstStoreOrigin.firstStoreLongitude || origin.originVersion !== 1 || Object.hasOwn(origin, "storeVersion")) throw new Error(`partner origin canonical readback failed: ${JSON.stringify(origin)}`);
  let storeReadback = sql(`SELECT version || '|' || delivery_origin_version FROM dsh.stores WHERE id='${sqlLiteral(partnerStoreID)}'`);
  if (storeReadback !== "1|1") throw new Error(`canonical joining approval changed Store version unexpectedly: ${storeReadback}`);

  const publicationAttempt = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/publication`, { token: controlPanelToken, headers: { ...userHeaders(`location-publication-${suffix}`, 1), ...serviceHeaders(operatorID) }, body: { state: "published" } });
  if (publicationAttempt.status !== 409 || publicationAttempt.body?.error?.code !== "READINESS_BLOCKED") throw new Error(`publication readiness gate did not fail closed: ${JSON.stringify(publicationAttempt)}`);
  storeReadback = sql(`SELECT version || '|' || delivery_origin_version FROM dsh.stores WHERE id='${sqlLiteral(partnerStoreID)}'`);
  if (storeReadback !== "1|1") throw new Error(`blocked publication changed Store or origin version: ${storeReadback}`);
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

  for (let index = 0; index < 51; index += 1) {
    const body = { addressText: `عنوان runtime pagination ${index}، صنعاء`, latitude: 15 + index / 1000, longitude: 44 + index / 1000, serviceCityId: serviceCityID };
    const createdPageAddress = await expect(dshBase, "POST", "/dsh/addresses", 201, { token: client.accessToken, headers: userHeaders(`location-page-${suffix}-${index}`), body });
    if (createdPageAddress.address?.version !== 1) throw new Error(`runtime pagination seed ${index} was not created canonically`);
  }
  const pageIDs = new Set();
  let cursor = "";
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
  if (addressCount !== "55" || originCount !== "0") throw new Error(`audit readback contains losing Store-origin writer residue: addresses=${addressCount} origins=${originCount}`);
  console.log(`DSH_SCHEMA_CANONICAL_HISTORY=PASS migrations=${dshMigrationNames.length}`);
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
}

process.exit(exitCode);
