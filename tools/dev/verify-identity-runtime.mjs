import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const requestedEnv = process.argv.find((arg) => arg.startsWith("--env-file="))?.slice("--env-file=".length);
const defaultEnv = fs.existsSync(path.join(root, "infra/local/compose/.env"))
  ? "infra/local/compose/.env"
  : "infra/local/compose/.env.example";
const envFile = path.resolve(root, requestedEnv || defaultEnv);
const runtimeRequestTimeoutMs = 30_000;

function fail(message) {
  console.error("IDENTITY_RUNTIME_SEMANTICS=FAIL");
  console.error("  " + message);
  process.exit(1);
}

function parseEnv(file) {
  if (!fs.existsSync(file)) fail("environment file missing: " + file);
  const result = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

const env = parseEnv(envFile);
const port = env.SAMRIM_IDENTITY_PORT || "18082";
const baseUrl = "http://127.0.0.1:" + port;
const challengeSecret = env.IDENTITY_CHALLENGE_HMAC_SECRET;
const dshToken = env.IDENTITY_DSH_SERVICE_TOKEN;
const platformToken = env.IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN;

for (const [name, value, minimum] of [
  ["IDENTITY_CHALLENGE_HMAC_SECRET", challengeSecret, 32],
  ["IDENTITY_DSH_SERVICE_TOKEN", dshToken, 24],
  ["IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN", platformToken, 24],
]) {
  if (typeof value !== "string" || value.length < minimum) fail(name + " is not configured strongly enough");
}
if (dshToken === platformToken) fail("internal service tokens must be distinct");

const suffix = crypto.randomBytes(5).toString("hex");
let phoneCounter = crypto.randomInt(10_000_000, 80_000_000);
function phone() {
  phoneCounter += 1;
  return "+9677" + String(phoneCounter).padStart(8, "0").slice(-8);
}

function codeFor(challengeId, purpose) {
  const digest = crypto
    .createHmac("sha256", challengeSecret)
    .update(challengeId)
    .update(Buffer.from([0]))
    .update(purpose)
    .update(Buffer.from([0]))
    .update("challenge-code")
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

async function request(method, pathname, options = {}) {
  const response = await fetch(baseUrl + pathname, {
    method,
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
      ...(options.headers || {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(runtimeRequestTimeoutMs),
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return { status: response.status, body, raw };
}

async function expect(method, pathname, expectedStatus, options = {}) {
  const response = await request(method, pathname, options);
  if (response.status !== expectedStatus) {
    fail(method + " " + pathname + " returned " + response.status +
      ", expected " + expectedStatus + "; body=" + JSON.stringify(response.body));
  }
  return response.body;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function service(token, extra = {}) {
  return { Authorization: "Bearer " + token, ...extra };
}

function assertSession(pair, role, surface, actorId) {
  assert(pair && typeof pair === "object", "token pair missing");
  assert(typeof pair.accessToken === "string" && pair.accessToken.length >= 20, "access token missing");
  assert(typeof pair.refreshToken === "string" && pair.refreshToken.length >= 20, "refresh token missing");
  assert(pair.identity?.role === role, "session role mismatch: expected " + role);
  assert(pair.identity?.surface === surface, "session surface mismatch: expected " + surface);
  if (actorId) assert(pair.identity?.subject === actorId, "session actor mismatch");
  for (const forbidden of ["roles", "permissions", "operatorContextId", "surfaceAccess"]) {
    assert(!(forbidden in pair.identity), "session leaked " + forbidden);
  }
}

async function requestChallenge(pathname, body, purpose) {
  const challenge = await expect("POST", pathname, 201, { body });
  assert(typeof challenge.challengeId === "string" && challenge.challengeId.length > 10, "challenge id missing");
  const code = codeFor(challenge.challengeId, purpose);
  assert(!JSON.stringify(challenge).includes(code), "raw verification code leaked in public challenge");
  return { challenge, code };
}

console.log("Identity runtime candidate: " + baseUrl);
await expect("GET", "/identity/health", 200);
await expect("GET", "/identity/readiness", 200);

// Retired universal OTP/login routes are unreachable.
await expect("POST", "/auth/otp/request", 404, { body: { phone: phone(), role: "client" } });
await expect("POST", "/auth/activate", 404, { body: {} });
await expect("POST", "/auth/login", 404, { body: {} });

// Customer registration proves phone before actor/credential creation.
const sharedPhone = phone();
const customerPassword = "Client-" + suffix + "-Strong-Password";
const registration = await requestChallenge(
  "/auth/client/registration/request",
  { phone: sharedPhone },
  "client_register",
);
const clientPair = await expect("POST", "/auth/client/register", 201, {
  body: {
    phone: sharedPhone,
    code: registration.code,
    password: customerPassword,
    deviceFingerprint: "device-client-" + suffix,
  },
});
const actorId = clientPair.identity.subject;
assert(/^act_/.test(actorId), "actor_id is not neutral");
assertSession(clientPair, "client", "app-client", actorId);

// Normal customer authentication is phone + password and does not require another challenge.
const clientLogin = await expect("POST", "/auth/client/login", 200, {
  body: { phone: sharedPhone, password: customerPassword, deviceFingerprint: "device-client-login-" + suffix },
});
assertSession(clientLogin, "client", "app-client", actorId);

// Duplicate registration is non-enumerating at request time but cannot overwrite the client credential.
const duplicateRegistration = await requestChallenge(
  "/auth/client/registration/request",
  { phone: sharedPhone },
  "client_register",
);
await expect("POST", "/auth/client/register", 401, {
  body: {
    phone: sharedPhone,
    code: duplicateRegistration.code,
    password: "Different-" + suffix + "-Password",
    deviceFingerprint: "device-client-duplicate-" + suffix,
  },
});

// DSH adds managed roles to the same actor without authoring actor_id or credentials.
const captain = await expect("POST", "/internal/actor-roles/provision", 201, {
  headers: service(dshToken),
  body: { phoneE164: sharedPhone, role: "captain" },
});
assert(captain.actorId === actorId, "captain provisioning created a second actor");
assert(captain.activatedAt === undefined, "captain role should not be pre-activated");
await expect("POST", "/internal/actor-roles/provision", 400, {
  headers: service(dshToken),
  body: { phoneE164: phone(), role: "captain", password: "Not-Allowed-" + suffix + "-Password" },
});
await expect("POST", "/internal/actor-roles/provision", 400, {
  headers: service(dshToken),
  body: { actorId: "attacker-selected", phoneE164: phone(), role: "captain" },
});
await expect("POST", "/internal/actor-roles/provision", 400, {
  headers: service(dshToken),
  body: { phoneE164: phone(), role: "captain", username: "retired-identifier" },
});
await expect("POST", "/internal/actor-roles/provision", 403, {
  headers: service(platformToken),
  body: { phoneE164: phone(), role: "captain" },
});

// Managed activation is one-time and produces a role-scoped device-bound session.
const captainChallenge = await requestChallenge(
  "/auth/managed/activation/request",
  { phone: sharedPhone, role: "captain" },
  "managed_activate",
);
const captainPair = await expect("POST", "/auth/managed/activate", 200, {
  body: {
    phone: sharedPhone,
    role: "captain",
    code: captainChallenge.code,
    deviceFingerprint: "device-captain-" + suffix,
  },
});
assertSession(captainPair, "captain", "app-captain", actorId);
const captainRead = await expect(
  "GET",
  "/internal/actors/" + encodeURIComponent(actorId) + "/roles/captain",
  200,
  { headers: service(dshToken) },
);
assert(typeof captainRead.activatedAt === "string", "managed activation was not durably recorded");

// Operator provisioning is a separate role-scoped credential on the same actor.
const operatorPassword = "Operator-" + suffix + "-Strong-Password";
const operator = await expect("POST", "/internal/actor-roles/provision", 201, {
  headers: service(platformToken),
  body: { phoneE164: sharedPhone, role: "operator", password: operatorPassword },
});
assert(operator.actorId === actorId, "operator provisioning created a second actor");
await expect("POST", "/internal/actor-roles/provision", 403, {
  headers: service(dshToken, { "X-Service-Caller": "platform-control" }),
  body: { phoneE164: phone(), role: "operator", password: operatorPassword },
});

// Password proof alone returns only a challenge; second factor is required to create an operator session.
const operatorStart = await requestChallenge(
  "/auth/operator/login/start",
  { phone: sharedPhone, password: operatorPassword },
  "operator_mfa",
);
assert(!("accessToken" in operatorStart.challenge), "operator password proof returned a session");
const operatorPair = await expect("POST", "/auth/operator/login/complete", 200, {
  body: {
    phone: sharedPhone,
    code: operatorStart.code,
    deviceFingerprint: "device-operator-" + suffix,
  },
});
assertSession(operatorPair, "operator", "control-panel", actorId);

// A wrong/unknown operator password receives a decoy-shaped start response and cannot complete.
const unknownOperatorPhone = phone();
const decoyOperator = await requestChallenge(
  "/auth/operator/login/start",
  { phone: unknownOperatorPhone, password: "Wrong-" + suffix + "-Password" },
  "operator_mfa",
);
await expect("POST", "/auth/operator/login/complete", 401, {
  body: {
    phone: unknownOperatorPhone,
    code: decoyOperator.code,
    deviceFingerprint: "device-decoy-operator-" + suffix,
  },
});

// Managed activation cannot be repeated as ordinary login.
const repeatedCaptain = await requestChallenge(
  "/auth/managed/activation/request",
  { phone: sharedPhone, role: "captain" },
  "managed_activate",
);
await expect("POST", "/auth/managed/activate", 401, {
  body: {
    phone: sharedPhone,
    role: "captain",
    code: repeatedCaptain.code,
    deviceFingerprint: "device-captain-repeated-" + suffix,
  },
});

// Explicit DSH re-enrollment is the only path that reopens managed activation.
await expect(
  "POST",
  "/internal/actors/" + encodeURIComponent(actorId) + "/roles/captain/reenrollment",
  403,
  { headers: service(platformToken) },
);
await expect(
  "POST",
  "/internal/actors/" + encodeURIComponent(actorId) + "/roles/captain/reenrollment",
  204,
  { headers: service(dshToken, { "X-Correlation-ID": "captain-reenroll-" + suffix }) },
);
await expect("GET", "/auth/session", 401, { token: captainPair.accessToken });
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });
await expect("GET", "/auth/session", 200, { token: operatorPair.accessToken });

const reactivation = await requestChallenge(
  "/auth/managed/activation/request",
  { phone: sharedPhone, role: "captain" },
  "managed_activate",
);
const reactivatedCaptain = await expect("POST", "/auth/managed/activate", 200, {
  body: {
    phone: sharedPhone,
    role: "captain",
    code: reactivation.code,
    deviceFingerprint: "device-captain-reenrolled-" + suffix,
  },
});
assertSession(reactivatedCaptain, "captain", "app-captain", actorId);

// Client recovery is a distinct phone-proof path and revokes only client sessions.
const recoveryPhone = phone();
const recoveryOldPassword = "Recovery-" + suffix + "-Old-Password";
const recoveryRegistration = await requestChallenge(
  "/auth/client/registration/request",
  { phone: recoveryPhone },
  "client_register",
);
const recoveryOriginal = await expect("POST", "/auth/client/register", 201, {
  body: {
    phone: recoveryPhone,
    code: recoveryRegistration.code,
    password: recoveryOldPassword,
    deviceFingerprint: "device-recovery-old-" + suffix,
  },
});
const recovery = await requestChallenge(
  "/auth/client/recovery/request",
  { phone: recoveryPhone },
  "client_recover",
);
const recoveryNewPassword = "Recovery-" + suffix + "-New-Password";
const recoveryPair = await expect("POST", "/auth/client/recover", 200, {
  body: {
    phone: recoveryPhone,
    code: recovery.code,
    password: recoveryNewPassword,
    deviceFingerprint: "device-recovery-new-" + suffix,
  },
});
assertSession(recoveryPair, "client", "app-client", recoveryOriginal.identity.subject);
await expect("GET", "/auth/session", 401, { token: recoveryOriginal.accessToken });
await expect("POST", "/auth/client/login", 401, {
  body: {
    phone: recoveryPhone,
    password: recoveryOldPassword,
    deviceFingerprint: "device-recovery-old-login-" + suffix,
  },
});
await expect("POST", "/auth/client/login", 200, {
  body: {
    phone: recoveryPhone,
    password: recoveryNewPassword,
    deviceFingerprint: "device-recovery-login-" + suffix,
  },
});

// Unknown managed-role requests are non-enumerating but their decoy proof cannot grant a role/session.
const unknownCaptainPhone = phone();
const unknownCaptain = await requestChallenge(
  "/auth/managed/activation/request",
  { phone: unknownCaptainPhone, role: "captain" },
  "managed_activate",
);
await expect("POST", "/auth/managed/activate", 401, {
  body: {
    phone: unknownCaptainPhone,
    role: "captain",
    code: unknownCaptain.code,
    deviceFingerprint: "device-unknown-captain-" + suffix,
  },
});

// Challenge attempt locking is exact.
const lockedPhone = phone();
const locked = await requestChallenge(
  "/auth/client/registration/request",
  { phone: lockedPhone },
  "client_register",
);
const wrongCode = locked.code === "000000" ? "000001" : "000000";
for (let attempt = 0; attempt < 5; attempt++) {
  await expect("POST", "/auth/client/register", 401, {
    body: {
      phone: lockedPhone,
      code: wrongCode,
      password: "Locked-" + suffix + "-Password",
      deviceFingerprint: "device-locked-" + suffix,
    },
  });
}
await expect("POST", "/auth/client/register", 401, {
  body: {
    phone: lockedPhone,
    code: locked.code,
    password: "Locked-" + suffix + "-Password",
    deviceFingerprint: "device-locked-" + suffix,
  },
});

// Refresh remains device-bound, rotates atomically, and detects historical replay.
const refreshPair = await expect("POST", "/auth/client/login", 200, {
  body: { phone: sharedPhone, password: customerPassword, deviceFingerprint: "device-refresh-" + suffix },
});
await expect("POST", "/auth/refresh", 401, {
  body: { refreshToken: refreshPair.refreshToken, deviceFingerprint: "wrong-device-" + suffix },
});
await expect("GET", "/auth/session", 200, { token: refreshPair.accessToken });
const randomRefresh = refreshPair.identity.sessionId + "." + crypto.randomBytes(48).toString("base64url");
await expect("POST", "/auth/refresh", 401, {
  body: { refreshToken: randomRefresh, deviceFingerprint: "device-refresh-" + suffix },
});
await expect("GET", "/auth/session", 200, { token: refreshPair.accessToken });
const rotated = await expect("POST", "/auth/refresh", 200, {
  body: { refreshToken: refreshPair.refreshToken, deviceFingerprint: "device-refresh-" + suffix },
});
assert(rotated.refreshToken !== refreshPair.refreshToken, "refresh token did not rotate");
await expect("POST", "/auth/refresh", 401, {
  body: { refreshToken: refreshPair.refreshToken, deviceFingerprint: "device-refresh-" + suffix },
});
await expect("GET", "/auth/session", 401, { token: rotated.accessToken });

// Operator password reset revokes only operator sessions and keeps other roles alive.
const newOperatorPassword = operatorPassword + "-Reset";
await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/operator-password/reset", 204, {
  headers: service(platformToken, { "X-Correlation-ID": "operator-reset-" + suffix }),
  body: { password: newOperatorPassword },
});
await expect("GET", "/auth/session", 401, { token: operatorPair.accessToken });
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });
await expect("GET", "/auth/session", 200, { token: reactivatedCaptain.accessToken });

// Role disable stays scoped.
await expect(
  "POST",
  "/internal/actors/" + encodeURIComponent(actorId) + "/roles/captain/disable",
  204,
  { headers: service(dshToken) },
);
await expect("GET", "/auth/session", 401, { token: reactivatedCaptain.accessToken });
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });
await expect(
  "POST",
  "/internal/actors/" + encodeURIComponent(actorId) + "/roles/captain/enable",
  204,
  { headers: service(dshToken) },
);

// Identity-wide security disable remains distinct and invalidates every remaining role session.
const operatorAfterResetStart = await requestChallenge(
  "/auth/operator/login/start",
  { phone: sharedPhone, password: newOperatorPassword },
  "operator_mfa",
);
const operatorAfterReset = await expect("POST", "/auth/operator/login/complete", 200, {
  body: {
    phone: sharedPhone,
    code: operatorAfterResetStart.code,
    deviceFingerprint: "device-operator-reset-" + suffix,
  },
});
await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/security/disable", 403, {
  headers: service(dshToken),
});
await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/security/disable", 204, {
  headers: service(platformToken),
});
await expect("GET", "/auth/session", 401, { token: clientPair.accessToken });
await expect("GET", "/auth/session", 401, { token: operatorAfterReset.accessToken });
await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/security/enable", 204, {
  headers: service(platformToken),
});
await expect("POST", "/auth/client/login", 200, {
  body: { phone: sharedPhone, password: customerPassword, deviceFingerprint: "device-post-security-" + suffix },
});

console.log("IDENTITY_RUNTIME_SEMANTICS=PASS");
console.log("IDENTITY_SINGLE_ACTOR_MULTI_ROLE=PASS");
console.log("IDENTITY_CUSTOMER_REGISTRATION_AFTER_PHONE_PROOF=PASS");
console.log("IDENTITY_CUSTOMER_PASSWORD_LOGIN=PASS");
console.log("IDENTITY_CUSTOMER_RECOVERY_ROLE_SCOPED=PASS");
console.log("IDENTITY_MANAGED_ACTIVATION_ONE_TIME=PASS");
console.log("IDENTITY_MANAGED_REENROLLMENT_GOVERNED=PASS");
console.log("IDENTITY_OPERATOR_MFA_REQUIRED=PASS");
console.log("IDENTITY_OPERATOR_PASSWORD_ONLY_SESSION=0");
console.log("IDENTITY_CHALLENGE_DECOY_NON_GRANT=PASS");
console.log("IDENTITY_ROLE_SCOPED_REVOCATION=PASS");
console.log("IDENTITY_GLOBAL_SECURITY_DISABLE=PASS");
console.log("IDENTITY_REFRESH_DEVICE_BINDING=PASS");
console.log("IDENTITY_REFRESH_REPLAY_COMPROMISE=PASS");
console.log("IDENTITY_RAW_CHALLENGE_CODE_LEAK=0");
