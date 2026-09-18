import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const action = process.argv[2] ?? "--status";
const envPath = path.join(root, "infra/local/compose/.env");
const composePath = path.join(root, "infra/local/compose/compose.yaml");
const secretRoot = process.env.BTHWANI_SECRETS_ROOT?.trim() || "C:\\BTHWANI-Secrets\\samrim";
const locatorPath = path.join(secretRoot, "local-world", "world.json");

const WORLD = Object.freeze({
  abandonedOperatorPhone: "+967755500001",
  clientPhone: "+967755500002",
  partnerPhone: "+967755500003",
  captainPhone: "+967755500004",
  fieldPhone: "+967755500005",
  cityNameAr: "صنعاء",
  verticalNameAr: "بقالات وسوبرماركت",
  verticalNameEn: "Grocery and Supermarket",
  categoryNameAr: "أساسيات البقالة",
  categoryNameEn: "Grocery Essentials",
  businessName: "متجر العالم المحلي",
  storeName: "متجر العالم المحلي",
  productName: "أرز العالم المحلي",
  productVariantTitle: "عبوة 1 كجم",
  addressText: "شارع العالم المحلي، صنعاء",
  latitude: 15.3694457,
  longitude: 44.1910064,
});

function fail(message, detail = "") {
  console.error(`LOCAL_WORLD_MUTATION=REFUSED ${message}${detail ? ` detail=${detail}` : ""}`);
  process.exit(1);
}

function readEnv() {
  if (!fs.existsSync(envPath)) fail("canonical environment file is missing");
  const values = {};
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail("canonical environment line is malformed");
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) fail(`required canonical environment value is missing: ${name}`);
  return value;
}

function localUrl(raw, name) {
  let url;
  try { url = new URL(raw); } catch { fail(`${name} is not a URL`); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) fail(`${name} is not a local HTTP target`);
  return raw.replace(/\/+$/, "");
}

const env = readEnv();
const identityBase = localUrl(required(env, "IDENTITY_API_BASE_URL"), "IDENTITY_API_BASE_URL");
const dshBase = localUrl(required(env, "DSH_API_BASE_URL"), "DSH_API_BASE_URL");
const controlOrigin = localUrl(required(env, "CONTROL_PANEL_PUBLIC_ORIGIN"), "CONTROL_PANEL_PUBLIC_ORIGIN");
const dshToken = required(env, "CONTROL_PANEL_SERVICE_TOKEN");
const identityDshToken = required(env, "IDENTITY_DSH_SERVICE_TOKEN");
const challengeSecret = required(env, "IDENTITY_CHALLENGE_HMAC_SECRET");
if (env.BTHWANI_ENV !== "development") fail("BTHWANI_ENV must be development");
if (env.IDENTITY_CHALLENGE_DELIVERY_MODE !== "mailpit") fail("challenge delivery is not the controlled local Mailpit sink");
if (dshToken.length < 24 || identityDshToken.length < 24 || challengeSecret.length < 32) fail("canonical local secrets are too weak");

const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", composePath];
const requiredRunningServices = ["postgres", "mailpit", "identity", "dsh", "control", "metro-client", "metro-partner", "metro-captain", "metro-field"];

function sqlRead(query) {
  if (!/^\s*select\b/i.test(query) || /\b(insert|update|delete|truncate|drop|alter|create)\b/i.test(query)) fail("world readback attempted a non-read SQL statement");
  try {
    return execFileSync("docker", [...composeArgs, "exec", "-T", "postgres", "psql", "-U", required(env, "SAMRIM_POSTGRES_USER"), "-d", required(env, "SAMRIM_POSTGRES_DB"), "-Atc", query], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    fail("canonical database readback failed", error instanceof Error ? error.message : String(error));
  }
}

function runtimeGuard() {
  let running;
  try {
    running = execFileSync("docker", [...composeArgs, "ps", "--status", "running", "--services"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    fail("canonical Docker runtime is unavailable", error instanceof Error ? error.message : String(error));
  }
  const missing = requiredRunningServices.filter((service) => !running.includes(service));
  if (missing.length) fail("canonical Docker runtime is incomplete", missing.join(","));
  if (action === "--status") return;
  if (controlOrigin.includes("staging") || identityBase.includes("staging") || dshBase.includes("staging")) fail("production or staging target detected");
  console.log("LOCAL_WORLD_SAFETY_GUARD=PASS environment=development runtime=canonical-local database=canonical-local delivery=mailpit external_effects=blocked");
}

async function request(base, method, pathname, options = {}) {
  let response;
  try {
    response = await fetch(new URL(pathname, base), {
      method,
      headers: { Accept: "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers ?? {}), ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
  } catch (error) {
    fail("canonical local HTTP request failed", error instanceof Error ? error.message : String(error));
  }
  const raw = await response.text();
  let body = null;
  if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
  return { status: response.status, body };
}

async function expect(base, method, pathname, status, options = {}) {
  const result = await request(base, method, pathname, options);
  if (result.status !== status) fail(`${method} ${pathname} returned ${result.status}, expected ${status}`, JSON.stringify(result.body));
  return result.body;
}

function mutationHeaders(actingActorID, expectedVersion) {
  return { "X-Acting-Actor-ID": actingActorID, "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID(), ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}
function userHeaders(key, expectedVersion) {
  return { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}
function challengeCode(challengeID, purpose) {
  return String(crypto.createHmac("sha256", challengeSecret).update(challengeID).update(Buffer.from([0])).update(purpose).update(Buffer.from([0])).update("challenge-code").digest().readUInt32BE(0) % 1_000_000).padStart(6, "0");
}
function passwordFor(role) {
  return `W${crypto.createHmac("sha256", challengeSecret).update(`world:${role}`).digest("hex").slice(0, 6)}!`;
}

function loadState() {
  if (!fs.existsSync(locatorPath)) return { version: 1, actors: {}, entities: {} };
  try { return JSON.parse(fs.readFileSync(locatorPath, "utf8")); } catch { fail("external world locator is unreadable; discard/rebuild it explicitly"); }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(locatorPath), { recursive: true });
  fs.writeFileSync(locatorPath, JSON.stringify(state, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

async function searchRole(role, phone) {
  const token = role === "client" ? dshToken : identityDshToken;
  const body = await expect(identityBase, "GET", `/internal/actor-roles/search?role=${encodeURIComponent(role)}&q=${encodeURIComponent(phone)}&limit=25`, 200, { token });
  return body.items?.[0] ?? null;
}

async function bootstrapOperator(state) {
  const actorID = sqlRead("SELECT actor_id FROM identity_actor_roles WHERE role='operator' AND enabled AND activated_at IS NOT NULL ORDER BY activated_at DESC, actor_id LIMIT 1");
  if (!actorID) fail("no active canonical control operator baseline; refusing to create an unactivated operator");

  const residue = await searchRole("operator", WORLD.abandonedOperatorPhone);
  if (residue?.actorId && residue.actorId !== actorID) {
    const role = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(residue.actorId)}/roles/operator`, { token: dshToken });
    if (role.status === 200 && role.body?.enabled !== false && !role.body?.activatedAt) {
      const disabled = await request(identityBase, "POST", `/internal/actors/${encodeURIComponent(residue.actorId)}/roles/operator/disable`, { token: dshToken, headers: { ...mutationHeaders(actorID, role.body.version), "X-Reason": "local-world-unactivated-bootstrap-cleanup" } });
      if (disabled.status !== 204) fail("canonical cleanup of unactivated synthetic operator residue failed", JSON.stringify(disabled.body));
    }
  }
  state.actors.operator = { actorId: actorID, reused: true };
  return actorID;
}

async function activateOrLogin(role, phone, actorID, operatorID) {
  const password = passwordFor(role);
  const logged = await request(identityBase, "POST", "/auth/managed/login", { body: { phone, role, password, clientInstanceId: `local-world-${role}` } });
  if (logged.status === 200) return logged.body;
  if (actorID && role !== "field") {
    const reenroll = await request(identityBase, "POST", `/internal/actors/${encodeURIComponent(actorID)}/roles/${role}/reenrollment`, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID, "X-Correlation-ID": crypto.randomUUID() } });
    if (reenroll.status !== 204) fail(`${role} reenrollment was not authorized`, JSON.stringify(reenroll.body));
  }
  const challenge = await expect(identityBase, "POST", "/auth/managed/activation/request", 201, { body: { phone, role } });
  const activation = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role, verificationCode: challengeCode(challenge.challengeId, "managed_activate"), password, clientInstanceId: `local-world-${role}` } });
  if (activation.status !== 200) fail(`${role} activation failed`, JSON.stringify(activation.body));
  return activation.body;
}

async function ensureCity(operatorID, state) {
  const list = await expect(dshBase, "GET", "/dsh/service-cities?includeInactive=true", 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  let city = list.cities?.find((item) => item.displayNameAr === WORLD.cityNameAr);
  if (!city) city = (await expect(dshBase, "POST", "/dsh/service-cities", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { displayNameAr: WORLD.cityNameAr, active: true } })).city;
  else if (!city.active) city = (await expect(dshBase, "PATCH", `/dsh/service-cities/${encodeURIComponent(city.id)}`, 200, { token: dshToken, headers: mutationHeaders(operatorID, city.version), body: { displayNameAr: city.displayNameAr, active: true } })).city;
  state.entities.cityId = city.id;
  return city.id;
}

async function ensureVertical(operatorID, state) {
  const list = await expect(dshBase, "GET", "/dsh/catalog/verticals", 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  let vertical = list.verticals?.find((item) => item.nameAr === WORLD.verticalNameAr);
  if (!vertical) vertical = (await expect(dshBase, "POST", "/dsh/catalog/verticals", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { nameAr: WORLD.verticalNameAr, nameEn: WORLD.verticalNameEn, active: true } })).vertical;
  state.entities.verticalId = vertical.id;
  return vertical.id;
}

async function ensureCategory(operatorID, state) {
  const list = await expect(dshBase, "GET", `/dsh/catalog/categories?verticalId=${encodeURIComponent(state.entities.verticalId)}`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  let category = list.categories?.find((item) => item.nameAr === WORLD.categoryNameAr);
  if (!category) category = (await expect(dshBase, "POST", "/dsh/catalog/categories", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { verticalId: state.entities.verticalId, nameAr: WORLD.categoryNameAr, nameEn: WORLD.categoryNameEn, active: true } })).category;
  state.entities.categoryId = category.id;
  return category.id;
}

async function ensurePartner(operatorID, state) {
  let role = await searchRole("partner", WORLD.partnerPhone);
  let actorID = role?.actorId ?? "";
  let cases = await expect(dshBase, "GET", "/dsh/joining-cases?limit=25", 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  let summary = cases.cases?.find((item) => item.contactPhoneE164 === WORLD.partnerPhone);
  let view = summary ? await expect(dshBase, "GET", `/dsh/joining-cases/${encodeURIComponent(summary.id)}`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } }) : null;
  if (!view?.case || view.case.state !== "approved") {
    if (!actorID) {
      const provisioned = await request(identityBase, "POST", "/internal/actor-roles/provision", { token: identityDshToken, headers: { "X-Acting-Actor-ID": operatorID, "X-Correlation-ID": crypto.randomUUID() }, body: { phoneE164: WORLD.partnerPhone, role: "partner" } });
      if (![200, 201, 409].includes(provisioned.status)) fail("partner role provisioning failed", JSON.stringify(provisioned.body));
      actorID = String(provisioned.body?.actorId || (await searchRole("partner", WORLD.partnerPhone))?.actorId || "");
    }
    if (!summary) {
      const created = await expect(dshBase, "POST", "/dsh/joining-cases", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { contactPhoneE164: WORLD.partnerPhone, businessName: WORLD.businessName, firstStoreName: WORLD.storeName, serviceCityId: state.entities.cityId, firstStoreVerticalId: state.entities.verticalId } });
      summary = created.case;
    }
    if (summary.state === "draft") summary = (await expect(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(summary.id)}/submit`, 200, { token: dshToken, headers: mutationHeaders(operatorID, 1) })).case;
    const activated = await activateOrLogin("partner", WORLD.partnerPhone, actorID, operatorID);
    actorID = activated.identity.subject;
    const expected = summary.version;
    view = await expect(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(summary.id)}/review`, 200, { token: dshToken, headers: mutationHeaders(operatorID, expected), body: { decision: "approved" } });
  }
  if (!view?.case?.store?.id) view = await expect(dshBase, "GET", `/dsh/joining-cases/${encodeURIComponent(summary.id)}`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  const partner = await activateOrLogin("partner", WORLD.partnerPhone, actorID || view.case.partnerActorId, operatorID);
  state.actors.partner = { actorId: partner.identity.subject, phone: WORLD.partnerPhone };
  state.entities.joiningCaseId = view.case.id;
  state.entities.storeId = view.case.store.id;
  return partner;
}

async function ensureCaptain(operatorID, state) {
  let role = await searchRole("captain", WORLD.captainPhone);
  let actorID = role?.actorId ?? "";
  if (!actorID) {
    const admission = await expect(dshBase, "POST", "/dsh/captains/admissions", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { contactPhoneE164: WORLD.captainPhone } });
    actorID = admission.admission.actorId;
    state.entities.captainAdmissionId = admission.admission.id;
  }
  const captain = await activateOrLogin("captain", WORLD.captainPhone, actorID, operatorID);
  state.actors.captain = { actorId: captain.identity.subject, phone: WORLD.captainPhone };
  const own = await expect(dshBase, "GET", "/dsh/captains/me", 200, { token: captain.accessToken });
  // Keep the reusable baseline role valid but not dispatch-reserved. Scenario
  // verifiers create and own their fresh transactional Captain availability.
  if (own.admission?.availabilityState !== "unavailable") await expect(dshBase, "POST", "/dsh/captains/me/availability", 200, { token: captain.accessToken, headers: userHeaders("local-world-captain-availability", own.admission.version), body: { available: false } });
  return captain;
}

async function ensureField(operatorID, state) {
  let role = await searchRole("field", WORLD.fieldPhone);
  let actorID = role?.actorId ?? "";
  if (!actorID) {
    const admission = await expect(dshBase, "POST", "/dsh/fields/admissions", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { contactPhoneE164: WORLD.fieldPhone } });
    actorID = admission.admission.actorId;
    state.entities.fieldAdmissionId = admission.admission.id;
  }
  const field = await activateOrLogin("field", WORLD.fieldPhone, actorID, operatorID);
  state.actors.field = { actorId: field.identity.subject, phone: WORLD.fieldPhone };
  return field;
}

async function ensureClient(state) {
  let role = await searchRole("client", WORLD.clientPhone);
  let client;
  if (!role) {
    const challenge = await expect(identityBase, "POST", "/auth/client/registration/request", 201, { body: { phone: WORLD.clientPhone } });
    client = await expect(identityBase, "POST", "/auth/client/register", 201, { body: { phone: WORLD.clientPhone, code: challengeCode(challenge.challengeId, "client_register"), password: passwordFor("client"), clientInstanceId: "local-world-client" } });
  } else {
    const logged = await request(identityBase, "POST", "/auth/client/login", { body: { phone: WORLD.clientPhone, password: passwordFor("client"), clientInstanceId: "local-world-client" } });
    client = logged.body;
    if (logged.status !== 200) {
      const challenge = await expect(identityBase, "POST", "/auth/client/recovery/request", 201, { body: { phone: WORLD.clientPhone } });
      await expect(identityBase, "POST", "/auth/client/recover", 200, { body: { phone: WORLD.clientPhone, code: challengeCode(challenge.challengeId, "client_recover"), password: passwordFor("client") } });
      client = await expect(identityBase, "POST", "/auth/client/login", 200, { body: { phone: WORLD.clientPhone, password: passwordFor("client"), clientInstanceId: "local-world-client" } });
    }
  }
  state.actors.client = { actorId: client.identity.subject, phone: WORLD.clientPhone };
  return client;
}

async function ensureProduct(operatorID, partner, state) {
  const products = await expect(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(WORLD.productName)}&verticalId=${encodeURIComponent(state.entities.verticalId)}&limit=50`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  let product = products.products?.find((item) => item.canonicalName === WORLD.productName);
  if (!product) product = (await expect(dshBase, "POST", "/dsh/catalog/products", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { canonicalName: WORLD.productName, verticalId: state.entities.verticalId, scope: "SHARED", variantTitle: WORLD.productVariantTitle, measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [state.entities.categoryId], identifierType: "SKU", identifierValue: "LOCAL-WORLD-RICE-1KG", imageUri: "https://localhost.invalid/local-world-rice.jpg" } })).product;
  const variant = product.variants?.[0];
  if (!variant?.id) fail("product canonical readback has no variant");
  state.entities.productId = product.id;
  state.entities.variantId = variant.id;
  const offers = await expect(dshBase, "GET", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/offers`, 200, { token: partner.accessToken });
  let offer = offers.offers?.find((item) => item.variantId === variant.id);
  if (!offer) offer = (await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/offers`, 201, { token: partner.accessToken, headers: userHeaders("local-world-offer-create"), body: { variantId: variant.id, priceMinor: 1250, quantityPolicy: "DISCRETE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 1000, quantityStepBaseUnits: 1, pricingBasis: "PER_UNIT", pricingUnitBaseUnits: 1 } })).offer;
  if (offer.publicationState !== "published") offer = (await expect(dshBase, "PATCH", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/offers/${encodeURIComponent(offer.offerId)}`, 200, { token: partner.accessToken, headers: userHeaders("local-world-offer-publish", offer.version), body: { priceMinor: 1250, availability: true, publicationState: "published", quantityPolicy: "DISCRETE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 1000, quantityStepBaseUnits: 1, pricingBasis: "PER_UNIT", pricingUnitBaseUnits: 1 } })).offer;
  state.entities.offerId = offer.offerId;
}

async function ensureLocationAndPublication(operatorID, client, partner, state) {
  const origin = await expect(dshBase, "GET", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/delivery-origin`, 200, { token: partner.accessToken });
  if (origin.origin === null) await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/delivery-origin`, 200, { token: partner.accessToken, headers: userHeaders("local-world-origin", 0), body: { latitude: WORLD.latitude, longitude: WORLD.longitude } });
  const addresses = await expect(dshBase, "GET", "/dsh/addresses?limit=50", 200, { token: client.accessToken });
  let address = addresses.addresses?.find((item) => item.addressText === WORLD.addressText && item.serviceCityId === state.entities.cityId);
  if (!address) address = (await expect(dshBase, "POST", "/dsh/addresses", 201, { token: client.accessToken, headers: userHeaders("local-world-address"), body: { addressText: WORLD.addressText, latitude: WORLD.latitude, longitude: WORLD.longitude, serviceCityId: state.entities.cityId } })).address;
  state.entities.addressId = address.id;
  const publication = await expect(dshBase, "GET", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/publication`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  if (publication.store?.publicationState !== "published") await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/publication`, 200, { token: dshToken, headers: { ...mutationHeaders(operatorID, publication.store.version), "X-Expected-Version": String(publication.store.version) }, body: { state: "published" } });
}

async function readStatus(state) {
  if (!state.entities?.cityId || !state.entities?.storeId || !state.actors?.operator?.actorId) return { ready: false, reason: "locator-incomplete" };
  const operatorID = state.actors.operator.actorId;
  const role = await request(identityBase, "GET", `/internal/actors/${encodeURIComponent(operatorID)}/roles/operator`, { token: dshToken });
  const cities = await request(dshBase, "GET", "/dsh/public/service-cities", {});
  const verticals = await request(dshBase, "GET", "/dsh/catalog/verticals", {});
  const stores = await request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(state.entities.cityId)}`, {});
  const catalog = await request(dshBase, "GET", `/dsh/public/stores/${encodeURIComponent(state.entities.storeId)}/catalog?serviceCityId=${encodeURIComponent(state.entities.cityId)}`, {});
  const ready = role.status === 200 && role.body?.enabled !== false && cities.status === 200 && cities.body?.cities?.some((item) => item.id === state.entities.cityId && item.active && item.displayNameAr === WORLD.cityNameAr) && verticals.status === 200 && verticals.body?.verticals?.some((item) => item.id === state.entities.verticalId && item.active && item.nameAr === WORLD.verticalNameAr) && stores.status === 200 && stores.body?.stores?.some((item) => item.id === state.entities.storeId) && catalog.status === 200;
  return { ready, reason: ready ? "canonical-readback" : "baseline-not-proven" };
}

async function main() {
  if (!['--ensure', '--status'].includes(action)) fail("unsupported action; use --ensure or --status");
  runtimeGuard();
  for (const endpoint of ["/identity/health", "/identity/readiness"]) if ((await request(identityBase, "GET", endpoint)).status !== 200) fail("Identity is not ready");
  for (const endpoint of ["/dsh/health", "/dsh/readiness"]) if ((await request(dshBase, "GET", endpoint)).status !== 200) fail("DSH is not ready");
  const state = loadState();
  const current = await readStatus(state);
  if (action === "--status") {
    if (!current.ready) { console.log(`WORLD_STATUS=NOT_READY reason=${current.reason} read_only=1`); process.exitCode = 1; return; }
    console.log("WORLD_STATUS=PASS read_only=1 synthetic=1 canonical_readback=1");
    return;
  }
  if (current.ready) {
    const operatorID = state.actors.operator.actorId;
    await ensureCaptain(operatorID, state);
    saveState(state);
    console.log("WORLD_ENSURE=REUSE baseline=clean-proven-canonical");
    console.log("WORLD_STATUS=PASS read_only=1 synthetic=1 canonical_readback=1");
    return;
  }
  const operatorID = await bootstrapOperator(state);
  state.entities.cityId = await ensureCity(operatorID, state);
  state.entities.verticalId = await ensureVertical(operatorID, state);
  state.entities.categoryId = await ensureCategory(operatorID, state);
  const partner = await ensurePartner(operatorID, state);
  const captain = await ensureCaptain(operatorID, state);
  await ensureField(operatorID, state);
  const client = await ensureClient(state);
  await ensureProduct(operatorID, partner, state);
  await ensureLocationAndPublication(operatorID, client, partner, state);
  saveState(state);
  const final = await readStatus(state);
  if (!final.ready) fail("world owner completed mutations but canonical final readback is not ready");
  void captain;
  console.log("WORLD_ENSURE=PASS created_or_reused=canonical-owner-paths");
  console.log("WORLD_STATUS=PASS read_only=1 synthetic=1 canonical_readback=1");
}

await main();
