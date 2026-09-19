import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { readMailpitCode } from "./mailpit-challenge.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const action = process.argv[2] ?? "--status";
const envPath = path.join(root, "infra/local/compose/.env");
const composePath = path.join(root, "infra/local/compose/compose.yaml");
const secretRoot = process.env.BTHWANI_SECRETS_ROOT?.trim() || "C:\\BTHWANI-Secrets\\samrim";
const locatorPath = path.join(secretRoot, "local-world", "world.json");
const controlSessionStatePath = path.join(secretRoot, "control-playwright", "storage-state.json");

const WORLD = Object.freeze({
  operatorPhone: "+967755500006",
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
  try {
    url = new URL(raw);
  } catch {
    fail(`${name} is not a URL`);
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) fail(`${name} is not a local HTTP target`);
  return raw.replace(/\/+$/, "");
}

const env = readEnv();
localUrl(required(env, "IDENTITY_API_BASE_URL"), "IDENTITY_API_BASE_URL");
localUrl(required(env, "DSH_API_BASE_URL"), "DSH_API_BASE_URL");
const controlOrigin = localUrl(required(env, "CONTROL_PANEL_PUBLIC_ORIGIN"), "CONTROL_PANEL_PUBLIC_ORIGIN");
const dshToken = required(env, "CONTROL_PANEL_SERVICE_TOKEN");
const identityDshToken = required(env, "IDENTITY_DSH_SERVICE_TOKEN");
const bootstrapToken = required(env, "OPERATOR_BOOTSTRAP_SECRET");
required(env, "SAMRIM_MAILPIT_WEB_PORT");
if (env.BTHWANI_ENV !== "development") fail("BTHWANI_ENV must be development");
if (env.IDENTITY_CHALLENGE_DELIVERY_MODE !== "mailpit") fail("challenge delivery is not the controlled local Mailpit sink");
if (!String(env.IDENTITY_WEBAUTHN_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).includes(controlOrigin)) fail("WebAuthn allowed origin does not match the local Control Panel origin");
if (dshToken.length < 24 || identityDshToken.length < 24 || bootstrapToken.length < 24) fail("canonical local secrets are too weak");

const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", composePath];
const requiredRunningServices = action === "--ensure-operator"
  ? ["postgres", "mailpit", "identity", "dsh", "control"]
  : ["postgres", "mailpit", "identity", "dsh", "control", "metro-client", "metro-partner", "metro-captain", "metro-field"];
let identityBase = "";
let dshBase = "";
let mailpitPort = "";

function runtimeGuard() {
  let running;
  try {
    running = execFileSync("docker", [...composeArgs, "ps", "--status", "running", "--services"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    fail("canonical Docker runtime is unavailable", error instanceof Error ? error.message : String(error));
  }
  const missing = requiredRunningServices.filter((service) => !running.includes(service));
  if (missing.length) fail("canonical Docker runtime is incomplete", missing.join(","));
  console.log(`LOCAL_WORLD_SAFETY_GUARD=PASS mode=${action === "--status" ? "read-only" : "mutation"} environment=development runtime=canonical-local database=canonical-local delivery=mailpit external_effects=blocked`);
}

function publishedPort(service, containerPort) {
  let published;
  try {
    published = execFileSync("docker", [...composeArgs, "port", service, String(containerPort)], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    fail(`canonical Docker port readback failed for ${service}`, error instanceof Error ? error.message : String(error));
  }
  const match = published.match(/:(\d+)\s*$/);
  if (!match) fail(`canonical Docker port readback is invalid for ${service}`, published);
  return match[1];
}

async function request(base, method, pathname, options = {}) {
  let response;
  try {
    response = await fetch(new URL(pathname, base), {
      method,
      headers: { Accept: "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers ?? {}), ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    fail("canonical local HTTP request failed", error instanceof Error ? error.message : String(error));
  }
  const raw = await response.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
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

function passwordFor(role) {
  const seed = "samrim-local-world-password-v1";
  return `W${crypto.createHash("sha256").update(`${seed}:${role}`).digest("hex").slice(0, 6)}!`;
}

function loadState() {
  if (!fs.existsSync(locatorPath)) return { version: 2, actors: {}, entities: {} };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(locatorPath, "utf8"));
  } catch {
    fail("external world locator is unreadable; discard/rebuild it explicitly");
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) fail("external world locator has an invalid shape");
  const serialized = JSON.stringify(state);
  if (/(accessToken|refreshToken|password|otp|recoveryCredential|credential|serviceToken|databaseCredential)/i.test(serialized)) fail("external world locator contains forbidden credential material");
  return state;
}

function saveState(state) {
  fs.mkdirSync(path.dirname(locatorPath), { recursive: true });
  const tempPath = `${locatorPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify({ ...state, version: 2 }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(tempPath, locatorPath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* preserve the original failure */ }
    fail("external world locator could not be atomically updated", error instanceof Error ? error.message : String(error));
  }
}

function saveControlSessionState(state) {
  fs.mkdirSync(path.dirname(controlSessionStatePath), { recursive: true });
  const tempPath = `${controlSessionStatePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(state)}\n`;
  fs.writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(tempPath, controlSessionStatePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* preserve the original failure */ }
    fail("reusable Control session state could not be atomically updated", error instanceof Error ? error.message : String(error));
  }
  try {
    if (fs.readFileSync(controlSessionStatePath, "utf8") !== serialized) throw new Error("readback mismatch");
  } catch (error) {
    fail("reusable Control session state readback failed", error instanceof Error ? error.message : String(error));
  }
}

async function collectCursorPages(loadPage, itemKey, description) {
  const items = [];
  const seenCursors = new Set();
  let cursor = "";
  for (;;) {
    const page = await loadPage(cursor);
    items.push(...(Array.isArray(page?.[itemKey]) ? page[itemKey] : []));
    const nextCursor = page?.nextCursor ? String(page.nextCursor) : "";
    if (!nextCursor) return items;
    if (seenCursors.has(nextCursor)) fail(`cursor pagination repeated for ${description}`);
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

async function searchRoles(role, phone = "", token = role === "client" ? dshToken : identityDshToken) {
  return collectCursorPages(
    (cursor) => expect(identityBase, "GET", `/internal/actor-roles/search?role=${encodeURIComponent(role)}${phone ? `&q=${encodeURIComponent(phone)}` : ""}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, 200, { token }),
    "items",
    `Identity role search role=${role}`,
  );
}

async function listJoiningCases(token, operatorID) {
  return collectCursorPages(
    (cursor) => expect(dshBase, "GET", `/dsh/joining-cases?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, 200, { token, headers: { "X-Acting-Actor-ID": operatorID } }),
    "cases",
    "DSH joining-case search",
  );
}

async function readRole(role, actorID, token = role === "client" ? dshToken : identityDshToken) {
  return request(identityBase, "GET", `/internal/actors/${encodeURIComponent(actorID)}/roles/${encodeURIComponent(role)}`, { token });
}

function uniqueOrFail(items, description) {
  if (items.length > 1) fail(`ambiguous canonical baseline component: ${description}`);
  return items[0] ?? null;
}

async function waitForMailpitCode(phone, purpose) {
  try {
    return await readMailpitCode({ port: mailpitPort, phone, purpose });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function activateOperatorWithPasskey(phone, enrollmentToken, actorID) {
  let chromium;
  try {
    ({ chromium } = createRequire(path.join(root, "apps/control-panel/package.json"))("@playwright/test"));
  } catch (error) {
    fail("canonical Control Panel Playwright dependency is unavailable", error instanceof Error ? error.message : String(error));
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ar-YE" });
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(controlOrigin, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "تفعيل حساب موظف" }).click();
    await page.getByLabel("رقم الهاتف").fill(phone);
    await page.getByLabel("دعوة التفعيل عالية الأمان").fill(enrollmentToken);
    await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
    const code = await waitForMailpitCode(phone, "operator_enroll");
    await page.getByLabel("رمز إثبات الهاتف").fill(code);
    await page.getByRole("button", { name: "إثبات الهاتف وتسجيل مفتاح المرور" }).click();
    const recoveryHeading = page.getByRole("heading", { name: "احفظ هذا الاعتماد الآن" });
    try {
      await page.waitForFunction(() => {
        const heading = document.querySelector("#recovery-credential-title");
        const alert = document.querySelector('[role="alert"]');
        const visible = (element) => Boolean(element && (element instanceof HTMLElement) && element.offsetParent !== null);
        return visible(heading) || visible(alert);
      }, undefined, { timeout: 90_000 });
    } catch (error) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const detail = bodyText.replace(/\s+/g, " ").trim().slice(-4_000);
      throw new Error(`${error instanceof Error ? error.message : String(error)} url=${page.url()} body=${detail}`);
    }
    if (!(await recoveryHeading.isVisible())) {
      const message = await page.getByRole("alert").innerText().catch(() => "unknown Control Panel enrollment error");
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const detail = bodyText.replace(/\s+/g, " ").trim().slice(-4_000);
      throw new Error(`Control Panel operator enrollment failed: ${message} url=${page.url()} body=${detail}`);
    }
    await page.getByRole("button", { name: "حفظت الاعتماد وفتح لوحة التحكم" }).click();
    await page.waitForURL(/\/workspace$/, { timeout: 15_000 });
    const session = await page.evaluate(async () => {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      return { status: response.status, body: await response.json().catch(() => null) };
    });
    if (session.status !== 200 || session.body?.identity?.subject !== actorID || session.body?.identity?.role !== "operator" || session.body?.identity?.surface !== "control-panel") fail("canonical first-operator passkey session readback failed");
    saveControlSessionState(await context.storageState());
  } finally {
    await context.close();
    await browser.close();
  }
}

async function bootstrapOperator(state) {
  const operators = await searchRoles("operator", "");
  const existing = operators.find((item) => item.enabled && item.securityEnabled && item.activatedAt) ?? operators[0] ?? null;
  let actorID = existing?.actorId ?? "";
  let phone = existing?.phoneE164 ?? WORLD.operatorPhone;
  let enrollmentToken = "";
  if (!existing) {
    const bootstrapped = await expect(identityBase, "POST", "/internal/bootstrap/operator", 201, { token: bootstrapToken, body: { phoneE164: WORLD.operatorPhone, role: "operator" } });
    actorID = String(bootstrapped.role?.actorId ?? "");
    phone = WORLD.operatorPhone;
    enrollmentToken = String(bootstrapped.enrollmentToken?.code ?? "");
  } else if (!existing.enabled || !existing.securityEnabled) {
    fail("canonical operator baseline is disabled or security-disabled; refusing to bypass its owner");
  } else if (!existing.activatedAt) {
    const token = await expect(identityBase, "POST", "/internal/operator-enrollment-tokens", 201, { token: bootstrapToken, body: { phoneE164: phone, role: "operator" } });
    enrollmentToken = String(token.code ?? "");
  }
  if (!actorID || !phone) fail("canonical operator bootstrap did not return an actor identity");
  if (enrollmentToken) await activateOperatorWithPasskey(phone, enrollmentToken, actorID);
  const activated = await expect(identityBase, "GET", `/internal/actors/${encodeURIComponent(actorID)}/roles/operator`, 200, { token: identityDshToken });
  if (!activated.enabled || !activated.securityEnabled || !activated.activatedAt) fail("operator is not fully activated through the canonical passkey path");
  state.actors.operator = { actorId: actorID, phone };
  return actorID;
}

async function activateOrLogin(role, phone, actorID, operatorID) {
  const password = passwordFor(role);
  const logged = await request(identityBase, "POST", "/auth/managed/login", { body: { phone, role, password, clientInstanceId: `local-world-${role}` } });
  if (logged.status === 200) return logged.body;
  if (logged.status === 429 || logged.status >= 500) fail(`${role} login failed with a transient Identity response; refusing activation or reenrollment`, JSON.stringify(logged.body));
  if (logged.status !== 401) fail(`${role} login failed with an unclassified Identity response; refusing activation or reenrollment`, JSON.stringify(logged.body));
  if (!actorID) fail(`${role} login failed without a canonical actor; refusing activation or reenrollment`);

  const current = await readRole(role, actorID);
  if (current.status !== 200 || !current.body) fail(`${role} login failure could not be classified from canonical Identity state`, JSON.stringify(current.body));
  const roleView = current.body;
  if (!roleView.enabled || !roleView.securityEnabled) fail(`${role} login failed because the canonical role or Identity security is disabled; refusing bypass`, JSON.stringify(roleView));

  if (roleView.activatedAt && role === "field") {
    fail(`${role} login failed for an activated role; Field credential recovery is owned by the DSH workflow`, JSON.stringify(roleView));
  }

  if (roleView.activatedAt && role !== "field") {
    const reenroll = await request(identityBase, "POST", `/internal/actors/${encodeURIComponent(actorID)}/roles/${role}/reenrollment`, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID, "X-Correlation-ID": crypto.randomUUID() } });
    if (reenroll.status !== 204) fail(`${role} reenrollment was not authorized`, JSON.stringify(reenroll.body));
  }
  await expect(identityBase, "POST", "/auth/managed/activation/request", 201, { body: { phone, role } });
  const activation = await request(identityBase, "POST", "/auth/managed/activate", { body: { phone, role, verificationCode: await waitForMailpitCode(phone, "managed_activate"), password, clientInstanceId: `local-world-${role}` } });
  if (activation.status !== 200) fail(`${role} activation failed`, JSON.stringify(activation.body));
  return activation.body;
}

async function ensureCity(operatorID, state) {
  const list = await expect(dshBase, "GET", "/dsh/service-cities?includeInactive=true", 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  const matches = (list.cities ?? []).filter((item) => item.displayNameAr === WORLD.cityNameAr);
  let city = uniqueOrFail(matches, "service city");
  if (!city) city = (await expect(dshBase, "POST", "/dsh/service-cities", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { displayNameAr: WORLD.cityNameAr, active: true } })).city;
  else if (!city.active) city = (await expect(dshBase, "PATCH", `/dsh/service-cities/${encodeURIComponent(city.id)}`, 200, { token: dshToken, headers: mutationHeaders(operatorID, city.version), body: { displayNameAr: city.displayNameAr, active: true } })).city;
  state.entities.cityId = city.id;
  return city.id;
}

async function ensureVertical(operatorID, state) {
  const list = await expect(dshBase, "GET", "/dsh/catalog/verticals", 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  const matches = (list.verticals ?? []).filter((item) => item.nameAr === WORLD.verticalNameAr);
  let vertical = uniqueOrFail(matches, "commerce vertical");
  if (!vertical) vertical = (await expect(dshBase, "POST", "/dsh/catalog/verticals", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { nameAr: WORLD.verticalNameAr, nameEn: WORLD.verticalNameEn, active: true } })).vertical;
  if (!vertical.active) fail("canonical commerce vertical is inactive");
  state.entities.verticalId = vertical.id;
  return vertical.id;
}

async function ensureCategory(operatorID, state) {
  const list = await expect(dshBase, "GET", `/dsh/catalog/categories?verticalId=${encodeURIComponent(state.entities.verticalId)}`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  const matches = (list.categories ?? []).filter((item) => item.nameAr === WORLD.categoryNameAr);
  let category = uniqueOrFail(matches, "catalog category");
  if (!category) category = (await expect(dshBase, "POST", "/dsh/catalog/categories", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { verticalId: state.entities.verticalId, nameAr: WORLD.categoryNameAr, nameEn: WORLD.categoryNameEn, active: true } })).category;
  if (!category.active || category.verticalId !== state.entities.verticalId) fail("canonical catalog category is not valid for the selected vertical");
  state.entities.categoryId = category.id;
  return category.id;
}

async function ensurePartner(operatorID, state) {
  let role = uniqueOrFail(await searchRoles("partner", WORLD.partnerPhone), "partner actor");
  const cases = await listJoiningCases(dshToken, operatorID);
  const summaries = cases.filter((item) => item.contactPhoneE164 === WORLD.partnerPhone);
  let summary = uniqueOrFail(summaries, "partner joining case");
  let view = summary ? await expect(dshBase, "GET", `/dsh/joining-cases/${encodeURIComponent(summary.id)}`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } }) : null;
  if (view?.case) summary = view.case;
  if (!summary) {
    summary = (await expect(dshBase, "POST", "/dsh/joining-cases", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { contactPhoneE164: WORLD.partnerPhone, businessName: WORLD.businessName, firstStoreName: WORLD.storeName, serviceCityId: state.entities.cityId, firstStoreVerticalId: state.entities.verticalId } })).case;
    view = { case: summary };
  }
  if (summary.serviceCityId !== state.entities.cityId || summary.firstStoreVerticalId !== state.entities.verticalId) fail("canonical partner joining case points at a different baseline");
  if (summary.state === "draft") {
    summary = (await expect(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(summary.id)}/submit`, 200, { token: dshToken, headers: mutationHeaders(operatorID, summary.version) })).case;
    view = { case: summary };
  }
  if (!summary.partnerActorId) fail("joining case owner did not provision the partner role");
  role = role ?? await expect(identityBase, "GET", `/internal/actors/${encodeURIComponent(summary.partnerActorId)}/roles/partner`, 200, { token: identityDshToken });
  if (role.actorId !== summary.partnerActorId) fail("joining case partner binding does not match Identity");
  const partner = await activateOrLogin("partner", WORLD.partnerPhone, summary.partnerActorId, operatorID);
  if (summary.state === "submitted") {
    summary = (await expect(dshBase, "POST", `/dsh/joining-cases/${encodeURIComponent(summary.id)}/review`, 200, { token: dshToken, headers: mutationHeaders(operatorID, summary.version), body: { decision: "approved" } })).case;
    view = { case: summary };
  } else if (summary.state !== "approved") {
    fail(`partner joining case is not convergable from state=${summary.state}`);
  }
  if (!view?.case?.store?.id) view = await expect(dshBase, "GET", `/dsh/joining-cases/${encodeURIComponent(summary.id)}`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  if (!view.case.store || view.case.store.partnerActorId !== partner.identity.subject) fail("approved joining case has no canonical partner-owned store");
  state.actors.partner = { actorId: partner.identity.subject, phone: WORLD.partnerPhone };
  state.entities.joiningCaseId = view.case.id;
  state.entities.storeId = view.case.store.id;
  return partner;
}

async function ensureCaptain(operatorID, state) {
  const role = uniqueOrFail(await searchRoles("captain", WORLD.captainPhone), "captain actor");
  let actorID = role?.actorId ?? "";
  if (!actorID) {
    const admission = await expect(dshBase, "POST", "/dsh/captains/admissions", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { contactPhoneE164: WORLD.captainPhone } });
    actorID = admission.admission.actorId;
    state.entities.captainAdmissionId = admission.admission.id;
  } else {
    const admission = await expect(dshBase, "GET", `/dsh/captains/actors/${encodeURIComponent(actorID)}/admission`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
    state.entities.captainAdmissionId = admission.admission.id;
  }
  const captain = await activateOrLogin("captain", WORLD.captainPhone, actorID, operatorID);
  state.actors.captain = { actorId: captain.identity.subject, phone: WORLD.captainPhone };
  const own = await expect(dshBase, "GET", "/dsh/captains/me", 200, { token: captain.accessToken });
  if (own.admission?.availabilityState !== "unavailable") await expect(dshBase, "POST", "/dsh/captains/me/availability", 200, { token: captain.accessToken, headers: userHeaders("local-world-captain-availability", own.admission.version), body: { available: false } });
  return captain;
}

async function ensureField(operatorID, state) {
  const role = uniqueOrFail(await searchRoles("field", WORLD.fieldPhone), "field actor");
  let actorID = role?.actorId ?? "";
  if (!actorID) {
    const admission = await expect(dshBase, "POST", "/dsh/fields/admissions", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { contactPhoneE164: WORLD.fieldPhone } });
    actorID = admission.admission.actorId;
    state.entities.fieldAdmissionId = admission.admission.id;
  } else {
    const admission = await expect(dshBase, "GET", `/dsh/fields/actors/${encodeURIComponent(actorID)}/admission`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
    state.entities.fieldAdmissionId = admission.admission.id;
  }
  const field = await activateOrLogin("field", WORLD.fieldPhone, actorID, operatorID);
  state.actors.field = { actorId: field.identity.subject, phone: WORLD.fieldPhone };
  return field;
}

async function ensureClient(state) {
  const role = uniqueOrFail(await searchRoles("client", WORLD.clientPhone), "client actor");
  let client;
  if (!role) {
    await expect(identityBase, "POST", "/auth/client/registration/request", 201, { body: { phone: WORLD.clientPhone } });
    client = await expect(identityBase, "POST", "/auth/client/register", 201, { body: { phone: WORLD.clientPhone, code: await waitForMailpitCode(WORLD.clientPhone, "client_register"), password: passwordFor("client"), clientInstanceId: "local-world-client" } });
  } else {
    const logged = await request(identityBase, "POST", "/auth/client/login", { body: { phone: WORLD.clientPhone, password: passwordFor("client"), clientInstanceId: "local-world-client" } });
    client = logged.body;
    if (logged.status === 200) {
      state.actors.client = { actorId: client.identity.subject, phone: WORLD.clientPhone };
      return client;
    }
    if (logged.status === 429 || logged.status >= 500) fail("client login failed with a transient Identity response; refusing recovery", JSON.stringify(logged.body));
    if (logged.status !== 401) fail("client login failed with an unclassified Identity response; refusing recovery", JSON.stringify(logged.body));

    const current = await readRole("client", role.actorId);
    if (current.status !== 200 || !current.body) fail("client login failure could not be classified from canonical Identity state", JSON.stringify(current.body));
    if (!current.body.enabled || !current.body.securityEnabled) fail("client login failed because the canonical role or Identity security is disabled; refusing recovery", JSON.stringify(current.body));
    if (!current.body.credentialVersion) fail("client login failed without a canonical credential state that authorizes recovery", JSON.stringify(current.body));

    await expect(identityBase, "POST", "/auth/client/recovery/request", 201, { body: { phone: WORLD.clientPhone } });
    await expect(identityBase, "POST", "/auth/client/recover", 200, { body: { phone: WORLD.clientPhone, code: await waitForMailpitCode(WORLD.clientPhone, "client_recover"), password: passwordFor("client") } });
    client = await expect(identityBase, "POST", "/auth/client/login", 200, { body: { phone: WORLD.clientPhone, password: passwordFor("client"), clientInstanceId: "local-world-client" } });
  }
  state.actors.client = { actorId: client.identity.subject, phone: WORLD.clientPhone };
  return client;
}

async function ensureProduct(operatorID, partner, state) {
  const products = await expect(dshBase, "GET", `/dsh/catalog/products?q=${encodeURIComponent(WORLD.productName)}&verticalId=${encodeURIComponent(state.entities.verticalId)}&limit=50`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  const matches = (products.products ?? []).filter((item) => item.canonicalName === WORLD.productName);
  let product = uniqueOrFail(matches, "catalog product");
  if (!product) product = (await expect(dshBase, "POST", "/dsh/catalog/products", 201, { token: dshToken, headers: mutationHeaders(operatorID), body: { canonicalName: WORLD.productName, verticalId: state.entities.verticalId, scope: "SHARED", variantTitle: WORLD.productVariantTitle, measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [state.entities.categoryId], identifierType: "SKU", identifierValue: "LOCAL-WORLD-RICE-1KG", imageUri: "https://localhost.invalid/local-world-rice.jpg" } })).product;
  const variant = product.variants?.[0];
  if (!variant?.id || product.verticalId !== state.entities.verticalId) fail("product canonical readback is not bound to the selected vertical");
  state.entities.productId = product.id;
  state.entities.variantId = variant.id;
  const offers = await expect(dshBase, "GET", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/offers`, 200, { token: partner.accessToken });
  const offerMatches = (offers.offers ?? []).filter((item) => item.variantId === variant.id);
  let offer = uniqueOrFail(offerMatches, "store offer");
  if (!offer) offer = (await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/offers`, 201, { token: partner.accessToken, headers: userHeaders("local-world-offer-create"), body: { variantId: variant.id, priceMinor: 1250, quantityPolicy: "DISCRETE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 1000, quantityStepBaseUnits: 1, pricingBasis: "PER_UNIT", pricingUnitBaseUnits: 1 } })).offer;
  if (offer.publicationState !== "published" || !offer.availability) offer = (await expect(dshBase, "PATCH", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/offers/${encodeURIComponent(offer.offerId)}`, 200, { token: partner.accessToken, headers: userHeaders("local-world-offer-publish", offer.version), body: { priceMinor: 1250, availability: true, publicationState: "published", quantityPolicy: "DISCRETE", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 1000, quantityStepBaseUnits: 1, pricingBasis: "PER_UNIT", pricingUnitBaseUnits: 1 } })).offer;
  state.entities.offerId = offer.offerId;
}

async function ensureStorePublication(operatorID, state) {
  const publication = await expect(dshBase, "GET", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/publication`, 200, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } });
  if (publication.store?.publicationState !== "published") await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/publication`, 200, { token: dshToken, headers: { ...mutationHeaders(operatorID, publication.store.version), "X-Expected-Version": String(publication.store.version) }, body: { state: "published" } });
}

async function readStatus(state) {
  if (!state?.actors?.operator?.actorId || !state?.actors?.client?.actorId || !state?.actors?.partner?.actorId || !state?.actors?.captain?.actorId || !state?.actors?.field?.actorId || !state?.entities?.cityId || !state?.entities?.verticalId || !state?.entities?.categoryId || !state?.entities?.joiningCaseId || !state?.entities?.storeId || !state?.entities?.captainAdmissionId || !state?.entities?.fieldAdmissionId || !state?.entities?.productId || !state?.entities?.variantId || !state?.entities?.offerId) return { ready: false, reason: "locator-incomplete" };
  const operatorID = state.actors.operator.actorId;
  const [operatorRole, clientRole, partnerRole, captainRole, fieldRole, cities, verticals, categories, joining, publication, captainAdmission, fieldAdmission, stores, catalog] = await Promise.all([
    readRole("operator", operatorID),
    readRole("client", state.actors.client.actorId),
    readRole("partner", state.actors.partner.actorId),
    readRole("captain", state.actors.captain.actorId),
    readRole("field", state.actors.field.actorId),
    request(dshBase, "GET", "/dsh/service-cities?includeInactive=true", { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } }),
    request(dshBase, "GET", "/dsh/catalog/verticals", { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } }),
    request(dshBase, "GET", `/dsh/catalog/categories?verticalId=${encodeURIComponent(state.entities.verticalId)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } }),
    request(dshBase, "GET", `/dsh/joining-cases/${encodeURIComponent(state.entities.joiningCaseId)}`, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } }),
    request(dshBase, "GET", `/dsh/stores/${encodeURIComponent(state.entities.storeId)}/publication`, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } }),
    request(dshBase, "GET", `/dsh/captains/actors/${encodeURIComponent(state.actors.captain.actorId)}/admission`, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } }),
    request(dshBase, "GET", `/dsh/fields/actors/${encodeURIComponent(state.actors.field.actorId)}/admission`, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorID } }),
    request(dshBase, "GET", `/dsh/public/stores?serviceCityId=${encodeURIComponent(state.entities.cityId)}`),
    request(dshBase, "GET", `/dsh/public/stores/${encodeURIComponent(state.entities.storeId)}/catalog?serviceCityId=${encodeURIComponent(state.entities.cityId)}`),
  ]);
  const roleReady = (result, role, actorID) => result.status === 200 && result.body?.role === role && result.body.actorId === actorID && result.body.enabled && result.body.securityEnabled && (role === "client" ? result.body.credentialVersion > 0 : Boolean(result.body.activatedAt));
  const city = cities.body?.cities?.find((item) => item.id === state.entities.cityId);
  const vertical = verticals.body?.verticals?.find((item) => item.id === state.entities.verticalId);
  const category = categories.body?.categories?.find((item) => item.id === state.entities.categoryId);
  const joiningCase = joining.body?.case;
  const store = publication.body?.store;
  const captain = captainAdmission.body?.admission;
  const field = fieldAdmission.body?.admission;
  const publicStore = stores.body?.stores?.find((item) => item.id === state.entities.storeId);
  const offer = (catalog.body?.offers ?? []).find((item) => item.offerId === state.entities.offerId);
  const checks = {
    operatorRole: roleReady(operatorRole, "operator", operatorID),
    clientRole: roleReady(clientRole, "client", state.actors.client.actorId),
    partnerRole: roleReady(partnerRole, "partner", state.actors.partner.actorId),
    captainRole: roleReady(captainRole, "captain", state.actors.captain.actorId),
    fieldRole: roleReady(fieldRole, "field", state.actors.field.actorId),
    city: cities.status === 200 && city?.active && city.displayNameAr === WORLD.cityNameAr,
    vertical: verticals.status === 200 && vertical?.active && vertical.nameAr === WORLD.verticalNameAr,
    category: categories.status === 200 && category?.active && category.verticalId === state.entities.verticalId,
    joiningCase: joining.status === 200 && joiningCase?.state === "approved" && joiningCase.partnerActorId === state.actors.partner.actorId && joiningCase.serviceCityId === state.entities.cityId && joiningCase.firstStoreVerticalId === state.entities.verticalId && joiningCase.store?.id === state.entities.storeId && joiningCase.store.partnerActorId === state.actors.partner.actorId,
    publication: publication.status === 200 && store?.id === state.entities.storeId && store.partnerActorId === state.actors.partner.actorId && store.serviceCityId === state.entities.cityId && store.primaryVerticalId === state.entities.verticalId && store.publicationState === "published" && store.publicationReadiness?.ready,
    captainAdmission: captainAdmission.status === 200 && captain?.actorId === state.actors.captain.actorId && captain.state === "eligible" && captain.availabilityState === "unavailable",
    fieldAdmission: fieldAdmission.status === 200 && field?.actorId === state.actors.field.actorId && field.state === "eligible",
    publicStore: stores.status === 200 && publicStore?.id === state.entities.storeId && publicStore.primaryVerticalId === state.entities.verticalId,
    catalog: catalog.status === 200 && catalog.body?.storeId === state.entities.storeId && catalog.body?.verticalId === state.entities.verticalId && offer?.offerId === state.entities.offerId && offer.variantId === state.entities.variantId && offer.productId === state.entities.productId && offer.productActive && offer.variantActive && offer.availability && offer.publicationState === "published",
  };
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { ready: failedChecks.length === 0, reason: failedChecks.length === 0 ? "complete-canonical-readback" : `baseline-not-proven:${failedChecks.join(",")}` };
}

async function main() {
  if (!["--ensure", "--ensure-operator", "--status"].includes(action)) fail("unsupported action; use --ensure, --ensure-operator, or --status");
  runtimeGuard();
  identityBase = `http://127.0.0.1:${publishedPort("identity", 8082)}`;
  dshBase = `http://127.0.0.1:${publishedPort("dsh", 8080)}`;
  mailpitPort = publishedPort("mailpit", 8025);
  for (const endpoint of ["/identity/health", "/identity/readiness"]) if ((await request(identityBase, "GET", endpoint)).status !== 200) fail("Identity is not ready");
  for (const endpoint of ["/dsh/health", "/dsh/readiness"]) if ((await request(dshBase, "GET", endpoint)).status !== 200) fail("DSH is not ready");
  const state = loadState();
  if (action === "--ensure-operator") {
    const operatorID = await bootstrapOperator(state);
    console.log(`WORLD_OPERATOR_ENSURE=PASS actor=${operatorID} canonical=control-panel-passkey`);
    return;
  }
  const current = await readStatus(state);
  if (action === "--status") {
    if (!current.ready) {
      console.log(`WORLD_STATUS=NOT_READY reason=${current.reason} read_only=1 complete_baseline=1`);
      process.exitCode = 1;
      return;
    }
    console.log("WORLD_STATUS=PASS read_only=1 complete_baseline=1 synthetic=1 canonical_readback=1");
    return;
  }
  if (current.ready) {
    console.log("WORLD_ENSURE=REUSE baseline=complete-clean-proven-canonical");
    console.log("WORLD_STATUS=PASS read_only=1 complete_baseline=1 synthetic=1 canonical_readback=1");
    return;
  }
  const operatorID = await bootstrapOperator(state);
  state.entities.cityId = await ensureCity(operatorID, state);
  state.entities.verticalId = await ensureVertical(operatorID, state);
  state.entities.categoryId = await ensureCategory(operatorID, state);
  const partner = await ensurePartner(operatorID, state);
  await ensureCaptain(operatorID, state);
  await ensureField(operatorID, state);
  await ensureClient(state);
  await ensureProduct(operatorID, partner, state);
  await ensureStorePublication(operatorID, state);
  const final = await readStatus(state);
  if (!final.ready) fail("world owner completed canonical mutations but complete final readback is not ready", final.reason);
  saveState(state);
  console.log("WORLD_ENSURE=PASS created_or_reused=canonical-owner-paths");
  console.log("WORLD_STATUS=PASS read_only=1 complete_baseline=1 synthetic=1 canonical_readback=1");
}

await main();
