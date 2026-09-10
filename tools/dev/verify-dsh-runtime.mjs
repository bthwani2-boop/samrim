import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const envArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envPath = envArg ? path.resolve(repoRoot, envArg.split("=")[1]) : path.resolve(repoRoot, "infra/local/compose/.env");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env[key] = value;
  }
  return env;
}

const fileEnv = loadEnv(envPath);
const env = { ...fileEnv, ...process.env };

const dshBase = env.DSH_BASE_URL || env.DSH_API_BASE_URL;
if (!dshBase) {
  console.error("DSH_API_BASE_URL or DSH_BASE_URL is required in the canonical environment");
  process.exit(1);
}
const dshToken = env.DSH_PLATFORM_CONTROL_SERVICE_TOKEN || env.DSH_SERVICE_TOKEN || env.IDENTITY_DSH_SERVICE_TOKEN;

if (!dshToken) {
  console.error("DSH_PLATFORM_CONTROL_SERVICE_TOKEN or DSH_SERVICE_TOKEN is required to verify DSH runtime boundary");
  process.exit(1);
}

const identityPort = env.SAMRIM_IDENTITY_PORT;
const identityBase = identityPort ? `http://127.0.0.1:${identityPort}` : null;
const identityBootstrapToken = env.IDENTITY_PLATFORM_BOOTSTRAP_SECRET;
const challengeSecret = env.IDENTITY_CHALLENGE_HMAC_SECRET;
const composeFile = path.join(repoRoot, "infra/local/compose/compose.yaml");
const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envPath, "-f", composeFile];

function compose(...args) {
  return execFileSync("docker", [...composeArgs, ...args], { encoding: "utf8" });
}

function sql(query) {
  return compose("exec", "-T", "postgres", "psql", "-U", env.SAMRIM_POSTGRES_USER, "-d", env.SAMRIM_POSTGRES_DB, "-Atc", query).trim();
}

async function identityRequest(method, pathname, options = {}) {
  if (!identityBase) fail("SAMRIM_IDENTITY_PORT is required for DSH boundary proof");
  const response = await fetch(identityBase + pathname, {
    method,
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return { status: response.status, body };
}

function codeFor(challengeId, purpose) {
  const digest = crypto.createHmac("sha256", challengeSecret)
    .update(challengeId).update(Buffer.from([0])).update(purpose).update(Buffer.from([0])).update("challenge-code").digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function fail(msg) {
  console.error("FAIL: " + msg);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function request(method, relPath, options = {}) {
  const url = new URL(relPath, dshBase);
  const headers = { ...options.headers };
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }
  let body = undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, headers: res.headers, body: json };
}

async function expect(method, relPath, expectedStatus, options = {}) {
  const res = await request(method, relPath, options);
  if (res.status !== expectedStatus) {
    fail(`${method} ${relPath} expected ${expectedStatus}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function waitForDshReadiness() {
  let lastStatus = "unavailable";
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await request("GET", "/dsh/readiness");
      lastStatus = `${response.status}: ${JSON.stringify(response.body)}`;
      if (response.status === 200 && response.body?.status === "ok" && response.body?.service === "dsh") {
        return;
      }
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(`DSH readiness did not recover after restart: ${lastStatus}`);
}

const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const testPhone = "+96771" + Math.floor(1000000 + Math.random() * 9000000);
let actingAdminId = sql("SELECT COALESCE(platform_owner_actor_id, '') FROM identity_bootstrap_state WHERE id=1");
if (!actingAdminId) {
  const owner = await identityRequest("POST", "/internal/bootstrap/platform-owner", {
    token: identityBootstrapToken,
    body: { phoneE164: "+9677" + Math.floor(10000000 + Math.random() * 89999999), password: "Bootstrap-" + suffix + "-Strong-Password" },
  });
  if (owner.status !== 201) fail("platform owner bootstrap failed: " + JSON.stringify(owner.body));
  actingAdminId = owner.body.actorId;
}

console.log("1. Verifying DSH health and readiness...");
const health = await expect("GET", "/dsh/health", 200);
assert(health.status === "ok" && health.service === "dsh", "health status invalid");

const readiness = await expect("GET", "/dsh/readiness", 200);
assert(readiness.status === "ok" && readiness.service === "dsh", "readiness status invalid");
assert(actingAdminId.startsWith("act_"), "platform owner actor id is invalid");

console.log("2. Verifying DSH authentication boundary...");
await expect("POST", "/dsh/managed-roles/provision", 401, {
  body: { phoneE164: testPhone, role: "captain" },
});

console.log("3. Verifying DSH human attribution fail-closed invariants...");
await expect("POST", "/dsh/managed-roles/provision", 400, {
  token: dshToken,
  body: { phoneE164: testPhone, role: "captain" },
});

console.log("4. Provisioning managed role via DSH product boundary...");
const provisioned = await expect("POST", "/dsh/managed-roles/provision", 201, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingAdminId },
  body: { phoneE164: testPhone, role: "captain" },
});
assert(provisioned.actorId, "provisioned role missing actorId");
assert(provisioned.role === "captain", "provisioned role mismatch");
assert(typeof provisioned.actorVersion === "number" && provisioned.actorVersion >= 1, "provisioned role missing actorVersion");
assert(typeof provisioned.roleVersion === "number" && provisioned.roleVersion >= 1, "provisioned role missing roleVersion");

console.log("5. Verifying the J2.1 partner bootstrap authorization and transaction...");
const partnerPhone = "+96772" + Math.floor(1000000 + Math.random() * 9000000);
const partner = await expect("POST", "/dsh/managed-roles/provision", 201, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingAdminId },
  body: { phoneE164: partnerPhone, role: "partner" },
});
assert(partner.actorId && partner.role === "partner", "partner actor was not provisioned");
const partnerChallenge = await identityRequest("POST", "/auth/managed/activation/request", {
  body: { phone: partnerPhone, role: "partner" },
});
assert(partnerChallenge.status === 201 && partnerChallenge.body?.challengeId, "partner activation challenge was not issued");
const partnerPair = await identityRequest("POST", "/auth/managed/activate", {
  body: {
    phone: partnerPhone,
    role: "partner",
    verificationCode: codeFor(partnerChallenge.body.challengeId, "managed_activate"),
    password: "Partner-" + suffix + "-Strong-Password",
    deviceFingerprint: "device-partner-" + suffix,
  },
});
assert(partnerPair.status === 200 && partnerPair.body?.accessToken, "partner session was not created");
const bootstrapKey = "j21-" + suffix + "-idempotency";
const bootstrapHeaders = {
  "X-Acting-Actor-ID": actingAdminId,
  "X-Correlation-ID": "correlation-" + suffix,
  "Idempotency-Key": bootstrapKey,
};
await expect("POST", "/dsh/partner-bootstrap", 401, {
  headers: bootstrapHeaders,
  body: { partnerActorId: partner.actorId, storeName: "متجر J2.1" },
});
await expect("POST", "/dsh/partner-bootstrap", 403, {
  token: dshToken,
  headers: { ...bootstrapHeaders, "X-Acting-Actor-ID": "act_forged_actor_" + suffix },
  body: { partnerActorId: partner.actorId, storeName: "متجر J2.1" },
});
const createdBootstrap = await expect("POST", "/dsh/partner-bootstrap", 201, {
  token: dshToken,
  headers: bootstrapHeaders,
  body: { partnerActorId: partner.actorId, storeName: "متجر J2.1" },
});
assert(createdBootstrap.idempotentReplay === false, "new bootstrap was marked as replay");
assert(createdBootstrap.partnerOrganization?.ownerActorId === partner.actorId, "organization owner readback mismatch");
assert(createdBootstrap.firstStore?.partnerOrganizationId === createdBootstrap.partnerOrganization.id, "first store organization link mismatch");
assert(createdBootstrap.firstStore?.name === "متجر J2.1", "first store name readback mismatch");
const operatorReadback = await expect("GET", "/dsh/partner-bootstrap/" + encodeURIComponent(partner.actorId), 200, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingAdminId },
});
assert(operatorReadback.firstStore.id === createdBootstrap.firstStore.id, "operator canonical readback mismatch");
const replayedBootstrap = await expect("POST", "/dsh/partner-bootstrap", 200, {
  token: dshToken,
  headers: bootstrapHeaders,
  body: { partnerActorId: partner.actorId, storeName: "متجر J2.1" },
});
assert(replayedBootstrap.idempotentReplay === true, "idempotent replay was not marked");
assert(replayedBootstrap.firstStore.id === createdBootstrap.firstStore.id, "idempotent replay created a duplicate store");
await expect("POST", "/dsh/partner-bootstrap", 409, {
  token: dshToken,
  headers: bootstrapHeaders,
  body: { partnerActorId: partner.actorId, storeName: "متجر مختلف" },
});
await expect("POST", "/dsh/partner-bootstrap", 404, {
  token: dshToken,
  headers: { ...bootstrapHeaders, "Idempotency-Key": "j21-missing-" + suffix },
  body: { partnerActorId: "act_missing_partner_" + suffix, storeName: "متجر مفقود" },
});
const persistedCount = Number(sql("SELECT count(*) FROM dsh.partner_bootstrap_audit WHERE idempotency_key='" + bootstrapKey.replaceAll("'", "''") + "'"));
assert(persistedCount === 1, "bootstrap audit was not persisted exactly once");
const selfReadback = await expect("GET", "/dsh/partner-bootstrap/self", 200, {
  headers: { Authorization: "Bearer " + partnerPair.body.accessToken },
});
assert(selfReadback.partnerOrganization.ownerActorId === partner.actorId, "partner self readback owner mismatch");
assert(selfReadback.firstStore.id === createdBootstrap.firstStore.id, "partner self readback store mismatch");

console.log("5. Restarting DSH and proving canonical bootstrap persistence...");
compose("restart", "dsh");
await waitForDshReadiness();
const restartedReadback = await expect("GET", "/dsh/partner-bootstrap/self", 200, {
  headers: { Authorization: "Bearer " + partnerPair.body.accessToken },
});
assert(restartedReadback.partnerOrganization.id === createdBootstrap.partnerOrganization.id, "restart organization readback mismatch");
assert(restartedReadback.firstStore.id === createdBootstrap.firstStore.id, "restart store readback mismatch");
console.log("DSH_BOOTSTRAP_RESTART_PERSISTENCE=PASS");

console.log("6. Querying managed role status via DSH...");
const roleStatus = await expect(
  "GET",
  `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(testPhone)}&role=captain`,
  200,
  { token: dshToken },
);
assert(roleStatus.actorId === provisioned.actorId, "status actorId mismatch");
assert(typeof roleStatus.roleVersion === "number" && roleStatus.roleVersion >= 1, "status roleVersion invalid");
const currentVersion = roleStatus.roleVersion;

console.log("6. Verifying DSH role lifecycle OCC concurrency invariants...");
await expect("POST", "/dsh/managed-roles/disable", 400, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingAdminId },
  body: { phoneE164: testPhone, role: "captain", reason: "testing missing version" },
});

await expect("POST", "/dsh/managed-roles/disable", 409, {
  token: dshToken,
  headers: {
    "X-Acting-Actor-ID": actingAdminId,
    "X-Expected-Version": String(currentVersion + 999),
  },
  body: { phoneE164: testPhone, role: "captain", reason: "testing conflict" },
});

await expect("POST", "/dsh/managed-roles/disable", 400, {
  token: dshToken,
  headers: { "X-Expected-Version": String(currentVersion) },
  body: { phoneE164: testPhone, role: "captain", reason: "testing missing actor" },
});

console.log("7. Disabling managed role via DSH...");
await expect("POST", "/dsh/managed-roles/disable", 204, {
  token: dshToken,
  headers: {
    "X-Acting-Actor-ID": actingAdminId,
    "X-Expected-Version": String(currentVersion),
  },
  body: { phoneE164: testPhone, role: "captain", reason: "operational freeze test" },
});

const disabledStatus = await expect(
  "GET",
  `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(testPhone)}&role=captain`,
  200,
  { token: dshToken },
);
assert(disabledStatus.enabled === false, "role was not disabled");
assert(disabledStatus.roleVersion === currentVersion + 1, "role version did not increment on disable");

console.log("8. Enabling managed role via DSH...");
await expect("POST", "/dsh/managed-roles/enable", 204, {
  token: dshToken,
  headers: {
    "X-Acting-Actor-ID": actingAdminId,
    "X-Expected-Version": String(disabledStatus.roleVersion),
  },
  body: { phoneE164: testPhone, role: "captain", reason: "operational unfreeze test" },
});

const enabledStatus = await expect(
  "GET",
  `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(testPhone)}&role=captain`,
  200,
  { token: dshToken },
);
assert(enabledStatus.enabled === true, "role was not re-enabled");

console.log("9. Authorizing reenrollment via DSH...");
await expect("POST", "/dsh/managed-roles/reenrollment", 400, {
  token: dshToken,
  body: { phoneE164: testPhone, role: "captain" },
});

await expect("POST", "/dsh/managed-roles/reenrollment", 204, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingAdminId },
  body: { phoneE164: testPhone, role: "captain" },
});

console.log("DSH_MANAGED_ACCESS_RUNTIME=PASS");
console.log("DSH_HUMAN_ATTRIBUTION_ENFORCED=PASS");
console.log("DSH_OCC_VERSION_ENFORCED=PASS");
console.log("DSH_PRODUCT_BOUNDARY_VERIFIED=PASS");
