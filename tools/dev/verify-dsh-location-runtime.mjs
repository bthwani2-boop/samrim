import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
const bootstrapToken = required(env, "OPERATOR_BOOTSTRAP_SECRET");
const challengeSecret = required(env, "IDENTITY_CHALLENGE_HMAC_SECRET");
const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", path.join(root, "infra/local/compose/compose.yaml")];
const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
const partnerPhone = "+96776" + crypto.randomInt(1_000_000, 9_999_999);
const clientPhone = "+96778" + crypto.randomInt(1_000_000, 9_999_999);
const partnerStoreID = `store_location_runtime_${suffix}`;
const actorIDs = new Set();
let addressID = "";

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function sql(query) {
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

function codeFor(challengeID, purpose) {
  return String(crypto.createHmac("sha256", challengeSecret).update(challengeID).update(Buffer.from([0])).update(purpose).update(Buffer.from([0])).update("challenge-code").digest().readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

async function issueChallenge(pathname, body, purpose) {
  const challenge = await expect(identityBase, "POST", pathname, 201, { body });
  if (typeof challenge?.challengeId !== "string") throw new Error(`${pathname}: challenge id missing`);
  return { ...challenge, code: codeFor(challenge.challengeId, purpose) };
}

function userHeaders(key, expectedVersion) {
  return { "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": key, ...(expectedVersion === undefined ? {} : { "X-Expected-Version": String(expectedVersion) }) };
}

async function createClientSession() {
  const password = `Loca${crypto.randomBytes(2).toString("hex")}`;
  const challenge = await issueChallenge("/auth/client/registration/request", { phone: clientPhone }, "client_register");
  const pair = await expect(identityBase, "POST", "/auth/client/register", 201, { body: { phone: clientPhone, code: challenge.code, password, clientInstanceId: `location-client-${suffix}` } });
  if (pair.identity?.role !== "client" || pair.identity?.surface !== "app-client") throw new Error("client fixture session identity is not app-client");
  actorIDs.add(String(pair.identity.subject));
  return pair;
}

async function createPartnerSession(operatorID) {
  const provisioned = await request(identityBase, "POST", "/internal/actor-roles/provision", { token: identityDshToken, headers: { "X-Acting-Actor-ID": operatorID, "X-Correlation-ID": crypto.randomUUID() }, body: { phoneE164: partnerPhone, role: "partner" } });
  if (provisioned.status !== 201 || typeof provisioned.body?.actorId !== "string") throw new Error(`partner fixture provisioning failed: ${JSON.stringify(provisioned.body)}`);
  const actorID = String(provisioned.body.actorId);
  actorIDs.add(actorID);
  const challenge = await issueChallenge("/auth/managed/activation/request", { phone: partnerPhone, role: "partner" }, "managed_activate");
  const pair = await expect(identityBase, "POST", "/auth/managed/activate", 200, { body: { phone: partnerPhone, role: "partner", verificationCode: challenge.code, password: `Part${crypto.randomBytes(2).toString("hex")}`, clientInstanceId: `location-partner-${suffix}` } });
  if (pair.identity?.subject !== actorID || pair.identity?.role !== "partner" || pair.identity?.surface !== "app-partner") throw new Error("partner fixture session identity is not app-partner");
  return pair;
}

function cleanup() {
  try {
    const locationSchemaExists = sql("SELECT to_regclass('dsh.delivery_addresses') IS NOT NULL");
    if (locationSchemaExists === "t" && addressID) {
      const address = sqlLiteral(addressID);
      sql(`DELETE FROM dsh.delivery_address_audit WHERE address_id='${address}'`);
      sql(`DELETE FROM dsh.delivery_address_mutation_idempotency WHERE address_id='${address}'`);
      sql(`DELETE FROM dsh.delivery_addresses WHERE id='${address}'`);
    }
    if (locationSchemaExists === "t") {
      const store = sqlLiteral(partnerStoreID);
      sql(`DELETE FROM dsh.store_origin_audit WHERE store_id='${store}'`);
      sql(`DELETE FROM dsh.store_origin_mutation_idempotency WHERE store_id='${store}'`);
      sql(`DELETE FROM dsh.stores WHERE id='${store}'`);
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
  if (schema !== "7") throw new Error(`DSH schema history is not v7: ${schema}`);
  if (sql("SELECT name FROM dsh.schema_migrations WHERE version=7") !== "007_location_core.sql") throw new Error("Location Core migration readback is not canonical");

  let operatorID = sql("SELECT COALESCE(initial_operator_actor_id,'') FROM identity_bootstrap_state WHERE id=1");
  if (!operatorID) {
    const bootstrap = await request(identityBase, "POST", "/internal/bootstrap/operator", { token: bootstrapToken, body: { phoneE164: "+96775" + crypto.randomInt(1_000_000, 9_999_999), role: "operator" } });
    if (![201, 409].includes(bootstrap.status)) throw new Error(`operator bootstrap failed: ${JSON.stringify(bootstrap.body)}`);
    operatorID = sql("SELECT COALESCE(initial_operator_actor_id,'') FROM identity_bootstrap_state WHERE id=1");
  }
  if (!operatorID) throw new Error("Location Core runtime operator fixture is unavailable");

  const client = await createClientSession();
  const partner = await createPartnerSession(operatorID);
  sql(`INSERT INTO dsh.stores(id, partner_actor_id, name) VALUES('${sqlLiteral(partnerStoreID)}','${sqlLiteral(partner.identity.subject)}','Location Runtime Store')`);

  const empty = await expect(dshBase, "GET", "/dsh/addresses", 200, { token: client.accessToken });
  if (!Array.isArray(empty?.addresses) || empty.addresses.length !== 0) throw new Error("client address empty readback is not empty");
  const createBody = { addressText: "شارع location runtime، صنعاء", latitude: 15.3694457, longitude: 44.1910064 };
  const createKey = `location-address-create-${suffix}`;
  const created = await expect(dshBase, "POST", "/dsh/addresses", 201, { token: client.accessToken, headers: userHeaders(createKey), body: createBody });
  if (created?.idempotentReplay || created?.address?.version !== 1) throw new Error(`client address create readback failed: ${JSON.stringify(created)}`);
  addressID = String(created.address.id);
  const createReplay = await expect(dshBase, "POST", "/dsh/addresses", 200, { token: client.accessToken, headers: userHeaders(createKey), body: createBody });
  if (createReplay?.idempotentReplay !== true || createReplay.address.id !== addressID) throw new Error("client address idempotency replay failed");
  const createConflict = await request(dshBase, "POST", "/dsh/addresses", { token: client.accessToken, headers: userHeaders(createKey), body: { ...createBody, addressText: "عنوان مختلف" } });
  if (createConflict.status !== 409 || createConflict.body?.error?.code !== "IDEMPOTENCY_CONFLICT") throw new Error(`client address idempotency conflict failed: ${JSON.stringify(createConflict)}`);
  const readAddress = await expect(dshBase, "GET", `/dsh/addresses/${encodeURIComponent(addressID)}`, 200, { token: client.accessToken });
  if (readAddress.address?.id !== addressID || readAddress.address?.version !== 1) throw new Error("client address canonical readback failed");
  const updated = await expect(dshBase, "POST", `/dsh/addresses/${encodeURIComponent(addressID)}`, 200, { token: client.accessToken, headers: userHeaders(`location-address-update-${suffix}`, 1), body: { addressText: "شارع location runtime، صنعاء، مبنى 5", latitude: 15.369446, longitude: 44.191006 } });
  if (updated.address?.version !== 2) throw new Error("client address update version readback failed");
  const staleAddress = await request(dshBase, "POST", `/dsh/addresses/${encodeURIComponent(addressID)}`, { token: client.accessToken, headers: userHeaders(`location-address-stale-${suffix}`, 1), body: { addressText: "عنوان stale", latitude: 15.3, longitude: 44.1 } });
  if (staleAddress.status !== 409 || staleAddress.body?.error?.code !== "VERSION_CONFLICT") throw new Error(`client address stale write was accepted: ${JSON.stringify(staleAddress)}`);
  const addressConcurrent = await Promise.all([0, 1].map((index) => request(dshBase, "POST", `/dsh/addresses/${encodeURIComponent(addressID)}`, { token: client.accessToken, headers: userHeaders(`location-address-concurrent-${suffix}-${index}`, 2), body: { addressText: `عنوان concurrent ${index}`, latitude: 15.5 + index / 100, longitude: 44.3 + index / 100 } })));
  if (addressConcurrent.filter((result) => result.status === 200).length !== 1 || addressConcurrent.filter((result) => result.status === 409 && result.body?.error?.code === "VERSION_CONFLICT").length !== 1) throw new Error(`client address concurrency was not serialized: ${JSON.stringify(addressConcurrent)}`);

  const emptyOrigin = await expect(dshBase, "GET", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, 200, { token: partner.accessToken });
  if (emptyOrigin.origin !== null || emptyOrigin.storeVersion !== 1) throw new Error(`partner origin empty readback failed: ${JSON.stringify(emptyOrigin)}`);
  const originBody = { latitude: 15.369446, longitude: 44.191006 };
  const origin = await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, 200, { token: partner.accessToken, headers: userHeaders(`location-origin-set-${suffix}`, 1), body: originBody });
  if (origin.origin?.latitude !== 15.369446 || origin.storeVersion !== 2) throw new Error(`partner origin write readback failed: ${JSON.stringify(origin)}`);
  const originReplay = await expect(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, 200, { token: partner.accessToken, headers: userHeaders(`location-origin-set-${suffix}`, 1), body: originBody });
  if (originReplay.idempotentReplay !== true || originReplay.storeVersion !== 2) throw new Error("partner origin idempotency replay failed");
  const originStale = await request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, { token: partner.accessToken, headers: userHeaders(`location-origin-stale-${suffix}`, 1), body: { latitude: 15.4, longitude: 44.2 } });
  if (originStale.status !== 409 || originStale.body?.error?.code !== "VERSION_CONFLICT") throw new Error(`partner origin stale write was accepted: ${JSON.stringify(originStale)}`);
  const originConcurrent = await Promise.all([0, 1].map((index) => request(dshBase, "POST", `/dsh/stores/${encodeURIComponent(partnerStoreID)}/delivery-origin`, { token: partner.accessToken, headers: userHeaders(`location-origin-concurrent-${suffix}-${index}`, 2), body: { latitude: 15.6 + index / 100, longitude: 44.4 + index / 100 } })));
  if (originConcurrent.filter((result) => result.status === 200).length !== 1 || originConcurrent.filter((result) => result.status === 409 && result.body?.error?.code === "VERSION_CONFLICT").length !== 1) throw new Error(`partner origin concurrency was not serialized: ${JSON.stringify(originConcurrent)}`);

  const dbAddress = sql(`SELECT version || '|' || address_text FROM dsh.delivery_addresses WHERE id='${sqlLiteral(addressID)}' AND client_actor_id='${sqlLiteral(client.identity.subject)}'`);
  const dbOrigin = sql(`SELECT version || '|' || delivery_origin_latitude::text || '|' || delivery_origin_longitude::text FROM dsh.stores WHERE id='${sqlLiteral(partnerStoreID)}' AND partner_actor_id='${sqlLiteral(partner.identity.subject)}'`);
  if (!dbAddress.startsWith("3|")) throw new Error(`client address DB readback is not version 3: ${dbAddress}`);
  if (!dbOrigin.startsWith("3|")) throw new Error(`Store origin DB readback is not version 3: ${dbOrigin}`);
  if (sql(`SELECT count(*) FROM dsh.delivery_address_audit WHERE address_id='${sqlLiteral(addressID)}'`) !== "3") throw new Error("client address audit readback is not exactly one row per successful mutation");
  if (sql(`SELECT count(*) FROM dsh.store_origin_audit WHERE store_id='${sqlLiteral(partnerStoreID)}'`) !== "2") throw new Error("Store origin audit readback is not exactly one row per successful mutation");

  console.log("DSH_SCHEMA_V7=PASS");
  console.log("LOCATION_CORE_RUNTIME=PASS");
  console.log("LOCATION_CORE_CLIENT_API=PASS");
  console.log("LOCATION_CORE_PARTNER_API=PASS");
  console.log("LOCATION_CORE_IDEMPOTENCY=PASS");
  console.log("LOCATION_CORE_VERSION_CONCURRENCY=PASS");
  console.log("LOCATION_CORE_DB_READBACK=PASS");
  exitCode = 0;
} catch (error) {
  console.error(`LOCATION_CORE_RUNTIME=FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  cleanup();
}

process.exit(exitCode);
