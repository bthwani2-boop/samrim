import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const testPhone = "+96771" + Math.floor(1000000 + Math.random() * 9000000);
const actingAdminId = "act_dsh_boundary_admin_" + suffix;

console.log("1. Verifying DSH health and readiness...");
const health = await expect("GET", "/dsh/health", 200);
assert(health.status === "ok" && health.service === "dsh", "health status invalid");

const readiness = await expect("GET", "/dsh/readiness", 200);
assert(readiness.status === "ok" && readiness.service === "dsh", "readiness status invalid");

console.log("2. Verifying DSH authentication boundary...");
await expect("POST", "/dsh/managed-roles/provision", 401, {
  body: { phoneE164: testPhone, role: "captain" },
});

console.log("3. Verifying DSH human attribution fail-closed invariants...");
// Missing X-Acting-Actor-ID must return 400
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

console.log("5. Querying managed role status via DSH...");
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
// Missing X-Expected-Version must return 400
await expect("POST", "/dsh/managed-roles/disable", 400, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingAdminId },
  body: { phoneE164: testPhone, role: "captain", reason: "testing missing version" },
});

// Stale X-Expected-Version must return 409
await expect("POST", "/dsh/managed-roles/disable", 409, {
  token: dshToken,
  headers: {
    "X-Acting-Actor-ID": actingAdminId,
    "X-Expected-Version": String(currentVersion + 999),
  },
  body: { phoneE164: testPhone, role: "captain", reason: "testing conflict" },
});

// Missing X-Acting-Actor-ID on disable must return 400
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

// Readback after disable
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

// Readback after enable
const enabledStatus = await expect(
  "GET",
  `/dsh/managed-roles/status?phoneE164=${encodeURIComponent(testPhone)}&role=captain`,
  200,
  { token: dshToken },
);
assert(enabledStatus.enabled === true, "role was not re-enabled");

console.log("9. Authorizing reenrollment via DSH...");
// Missing acting actor on reenrollment must return 400
await expect("POST", "/dsh/managed-roles/reenrollment", 400, {
  token: dshToken,
  body: { phoneE164: testPhone, role: "captain" },
});

// Valid reenrollment
await expect("POST", "/dsh/managed-roles/reenrollment", 204, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": actingAdminId },
  body: { phoneE164: testPhone, role: "captain" },
});

console.log("DSH_MANAGED_ACCESS_RUNTIME=PASS");
console.log("DSH_HUMAN_ATTRIBUTION_ENFORCED=PASS");
console.log("DSH_OCC_VERSION_ENFORCED=PASS");
console.log("DSH_PRODUCT_BOUNDARY_VERIFIED=PASS");
