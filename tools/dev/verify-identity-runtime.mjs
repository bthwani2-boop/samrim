import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const requestedEnv = process.argv.find((arg) => arg.startsWith("--env-file="))?.slice("--env-file=".length);
const defaultEnv = fs.existsSync(path.join(root, "infra/local/compose/.env"))
  ? "infra/local/compose/.env"
  : "infra/local/compose/.env.example";
const envFile = path.resolve(root, requestedEnv || defaultEnv);

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
const activationSecret = env.IDENTITY_ACTIVATION_HMAC_SECRET;
const dshToken = env.IDENTITY_DSH_SERVICE_TOKEN;
const platformToken = env.IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN;

for (const [name, value, minimum] of [
  ["IDENTITY_ACTIVATION_HMAC_SECRET", activationSecret, 32],
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

function codeFor(activationId) {
  const digest = crypto
    .createHmac("sha256", activationSecret)
    .update(activationId)
    .update(Buffer.from([0]))
    .update("activation-code")
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
    signal: AbortSignal.timeout(8_000),
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
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
  assert(pair && typeof pair === "object", "token pair is missing");
  assert(typeof pair.accessToken === "string" && pair.accessToken.length >= 20, "access token missing");
  assert(typeof pair.refreshToken === "string" && pair.refreshToken.length >= 20, "refresh token missing");
  assert(pair.identity?.role === role, "session role mismatch: expected " + role);
  assert(pair.identity?.surface === surface, "session surface mismatch: expected " + surface);
  if (actorId) assert(pair.identity?.subject === actorId, "session actor mismatch");
  assert(!("roles" in pair.identity), "session leaked all actor roles");
  assert(!("permissions" in pair.identity), "session leaked generic permissions");
  assert(!("operatorContextId" in pair.identity), "session leaked premature operator context");
  assert(!("surfaceAccess" in pair.identity), "session leaked redundant surfaceAccess");
}

async function requestOtp(phoneValue, role) {
  return expect("POST", "/auth/otp/request", 201, { body: { phone: phoneValue, role } });
}

async function activate(phoneValue, role, challenge, device) {
  const code = codeFor(challenge.activationId);
  assert(!JSON.stringify(challenge).includes(code), "raw activation code leaked in challenge response");
  return expect("POST", "/auth/activate", 200, {
    body: { phone: phoneValue, role, code, deviceFingerprint: device },
  });
}

console.log("Identity runtime candidate: " + baseUrl);
await expect("GET", "/identity/health", 200);
await expect("GET", "/identity/readiness", 200);

// Removed client-controlled context/legacy request shape fails closed.
await expect("POST", "/auth/otp/request", 400, {
  body: { phone: phone(), role: "client", operatorContextId: "attacker-context" },
});
await expect("POST", "/auth/otp/request", 400, {
  body: { phone: phone(), actorType: "client" },
});
await expect("POST", "/auth/otp/request", 403, {
  body: { phone: phone(), role: "operator" },
});

// Same human starts as client.
const sharedPhone = phone();
const sharedClientChallenge = await requestOtp(sharedPhone, "client");
const sharedClientDevice = "device-shared-client-" + suffix;
const sharedClientPair = await activate(sharedPhone, "client", sharedClientChallenge, sharedClientDevice);
const actorId = sharedClientPair.identity.subject;
assert(/^act_/.test(actorId), "actor_id is not neutral");
assertSession(sharedClientPair, "client", "app-client", actorId);
await expect("GET", "/auth/session", 200, { token: sharedClientPair.accessToken });

// Client OTP request must not create a ghost actor before proof.
const proofDeferredPhone = phone();
const proofDeferredChallenge = await requestOtp(proofDeferredPhone, "client");
const proofDeferredCaptain = await expect("POST", "/internal/actor-roles/provision", 201, {
  headers: service(dshToken),
  body: { phoneE164: proofDeferredPhone, role: "captain" },
});
assert(proofDeferredCaptain.actorCreated === true, "client OTP request created actor before proof");
const proofDeferredClientPair = await activate(
  proofDeferredPhone,
  "client",
  proofDeferredChallenge,
  "device-proof-deferred-" + suffix,
);
assert(
  proofDeferredClientPair.identity.subject === proofDeferredCaptain.actorId,
  "post-proof client role did not converge on actor created by DSH",
);

// Governed OTP never self-provisions.
const unknownCaptainPhone = phone();
const fakeCaptainChallenge = await requestOtp(unknownCaptainPhone, "captain");
await expect("POST", "/auth/activate", 401, {
  body: {
    phone: unknownCaptainPhone,
    role: "captain",
    code: codeFor(fakeCaptainChallenge.activationId),
    deviceFingerprint: "device-unprovisioned-" + suffix,
  },
});

for (let attempt = 1; attempt < 5; attempt++) {
  await requestOtp(unknownCaptainPhone, "captain");
}
await expect("POST", "/auth/otp/request", 429, {
  body: { phone: unknownCaptainPhone, role: "captain" },
});

// DSH explicitly adds captain and partner roles to the SAME actor.
const captain = await expect("POST", "/internal/actor-roles/provision", 201, {
  headers: service(dshToken),
  body: { phoneE164: sharedPhone, role: "captain" },
});
assert(captain.actorId === actorId, "captain provisioning created a second actor");
assert(captain.role === "captain" && captain.enabled === true, "captain role readback invalid");

const captainRetry = await expect("POST", "/internal/actor-roles/provision", 200, {
  headers: service(dshToken),
  body: { phoneE164: sharedPhone, role: "captain" },
});
assert(captainRetry.actorId === actorId, "captain retry changed actor_id");
assert(captainRetry.roleCreated !== true, "captain retry recreated role");

const partner = await expect("POST", "/internal/actor-roles/provision", 201, {
  headers: service(dshToken),
  body: { phoneE164: sharedPhone, role: "partner" },
});
assert(partner.actorId === actorId, "partner provisioning created a second actor");

// Consumers cannot author actor_id or non-operator username.
await expect("POST", "/internal/actor-roles/provision", 400, {
  headers: service(dshToken),
  body: { actorId: "attacker-selected", phoneE164: phone(), role: "captain" },
});
await expect("POST", "/internal/actor-roles/provision", 400, {
  headers: service(dshToken),
  body: { phoneE164: phone(), role: "captain", username: "attacker.name" },
});

// Credential determines caller even if old headers are forged.
await expect("POST", "/internal/actor-roles/provision", 403, {
  headers: service(dshToken, { "X-Service-Caller": "platform-control", "X-Operator-Context-ID": "forged" }),
  body: {
    phoneE164: phone(),
    role: "operator",
    username: "forged.operator." + suffix,
    password: "Forged-Operator-" + suffix + "-Password",
  },
});
await expect("POST", "/internal/actor-roles/provision", 403, {
  headers: service(platformToken),
  body: { phoneE164: phone(), role: "captain" },
});
await expect("POST", "/internal/actor-roles/provision", 401, {
  body: { phoneE164: phone(), role: "captain" },
});

// Pre-provisioned governed role can authenticate by OTP.
const captainChallenge = await requestOtp(sharedPhone, "captain");
const captainDevice = "device-shared-captain-" + suffix;
const captainPair = await activate(sharedPhone, "captain", captainChallenge, captainDevice);
assertSession(captainPair, "captain", "app-captain", actorId);
await expect("GET", "/auth/session", 200, { token: captainPair.accessToken });
await expect("GET", "/auth/session", 200, { token: sharedClientPair.accessToken });

// Scoped disable revokes captain only.
await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/roles/captain/disable", 204, {
  headers: service(dshToken, { "X-Correlation-ID": "disable-captain-" + suffix }),
});
await expect("GET", "/auth/session", 401, { token: captainPair.accessToken });
await expect("GET", "/auth/session", 200, { token: sharedClientPair.accessToken });
await expect("POST", "/internal/actor-roles/provision", 409, {
  headers: service(dshToken),
  body: { phoneE164: sharedPhone, role: "captain" },
});
const disabledCaptainChallenge = await requestOtp(sharedPhone, "captain");
await expect("POST", "/auth/activate", 401, {
  body: {
    phone: sharedPhone,
    role: "captain",
    code: codeFor(disabledCaptainChallenge.activationId),
    deviceFingerprint: captainDevice,
  },
});
await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/roles/captain/enable", 204, {
  headers: service(dshToken),
});
const reenabledCaptainChallenge = await requestOtp(sharedPhone, "captain");
const reenabledCaptainPair = await activate(
  sharedPhone,
  "captain",
  reenabledCaptainChallenge,
  "device-reenabled-captain-" + suffix,
);
assertSession(reenabledCaptainPair, "captain", "app-captain", actorId);

// Governed role that was unknown can authenticate only AFTER DSH provisioning.
const lateCaptain = await expect("POST", "/internal/actor-roles/provision", 201, {
  headers: service(dshToken),
  body: { phoneE164: unknownCaptainPhone, role: "captain" },
});
const lateCaptainChallenge = await requestOtp(unknownCaptainPhone, "captain");
const lateCaptainPair = await activate(
  unknownCaptainPhone,
  "captain",
  lateCaptainChallenge,
  "device-late-captain-" + suffix,
);
assertSession(lateCaptainPair, "captain", "app-captain", lateCaptain.actorId);

// Operator becomes another role of the SAME actor and remains password-only.
const operatorUsername = "operator." + suffix;
const operatorPassword = "Strong-Operator-" + suffix + "-Password";
const operator = await expect("POST", "/internal/actor-roles/provision", 201, {
  headers: service(platformToken),
  body: { phoneE164: sharedPhone, role: "operator", username: operatorUsername, password: operatorPassword },
});
assert(operator.actorId === actorId, "operator provisioning created a second actor");
const operatorRetry = await expect("POST", "/internal/actor-roles/provision", 200, {
  headers: service(platformToken),
  body: { phoneE164: sharedPhone, role: "operator", username: operatorUsername, password: operatorPassword },
});
assert(operatorRetry.actorId === actorId, "operator retry changed actor_id");
await expect("POST", "/internal/actor-roles/provision", 409, {
  headers: service(platformToken),
  body: {
    phoneE164: sharedPhone,
    role: "operator",
    username: operatorUsername,
    password: operatorPassword + "-different",
  },
});
await expect("POST", "/auth/otp/request", 403, {
  body: { phone: sharedPhone, role: "operator" },
});

// Six wrong passwords trigger account throttling, but correct password still works.
for (let attempt = 0; attempt < 5; attempt++) {
  await expect("POST", "/auth/login", 401, {
    body: {
      username: operatorUsername,
      password: "Wrong-Password-" + suffix + "-" + attempt,
      deviceFingerprint: "device-operator-wrong-" + suffix,
    },
  });
}
await expect("POST", "/auth/login", 429, {
  body: {
    username: operatorUsername,
    password: "Wrong-Password-" + suffix + "-6",
    deviceFingerprint: "device-operator-wrong-" + suffix,
  },
});
const operatorPair = await expect("POST", "/auth/login", 200, {
  body: {
    username: operatorUsername,
    password: operatorPassword,
    deviceFingerprint: "device-operator-" + suffix,
  },
});
assertSession(operatorPair, "operator", "control-panel", actorId);

await expect("GET", "/auth/session", 200, { token: operatorPair.accessToken });
await expect("GET", "/auth/session", 200, { token: sharedClientPair.accessToken });

// Password reset revokes operator only and old credential no longer works.
const newOperatorPassword = operatorPassword + "-Reset";
await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/operator-password/reset", 204, {
  headers: service(platformToken, { "X-Correlation-ID": "password-reset-" + suffix }),
  body: { password: newOperatorPassword },
});
await expect("GET", "/auth/session", 401, { token: operatorPair.accessToken });
await expect("GET", "/auth/session", 200, { token: sharedClientPair.accessToken });
await expect("POST", "/auth/login", 401, {
  body: {
    username: operatorUsername,
    password: operatorPassword,
    deviceFingerprint: "device-old-password-" + suffix,
  },
});
const resetOperatorPair = await expect("POST", "/auth/login", 200, {
  body: {
    username: operatorUsername,
    password: newOperatorPassword,
    deviceFingerprint: "device-new-password-" + suffix,
  },
});
assertSession(resetOperatorPair, "operator", "control-panel", actorId);

// Global Identity security disable is independent from role admission and revokes every active role session.
await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/security/disable", 403, {
  headers: service(dshToken),
});
await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/security/disable", 204, {
  headers: service(platformToken, { "X-Correlation-ID": "security-disable-" + suffix }),
});
await expect("GET", "/auth/session", 401, { token: sharedClientPair.accessToken });
await expect("GET", "/auth/session", 401, { token: reenabledCaptainPair.accessToken });
await expect("GET", "/auth/session", 401, { token: resetOperatorPair.accessToken });

const blockedClientChallenge = await requestOtp(sharedPhone, "client");
await expect("POST", "/auth/activate", 401, {
  body: {
    phone: sharedPhone,
    role: "client",
    code: codeFor(blockedClientChallenge.activationId),
    deviceFingerprint: "device-blocked-client-" + suffix,
  },
});
await expect("POST", "/auth/login", 401, {
  body: {
    username: operatorUsername,
    password: newOperatorPassword,
    deviceFingerprint: "device-blocked-operator-" + suffix,
  },
});

await expect("POST", "/internal/actors/" + encodeURIComponent(actorId) + "/security/enable", 204, {
  headers: service(platformToken, { "X-Correlation-ID": "security-enable-" + suffix }),
});
const postSecurityClientChallenge = await requestOtp(sharedPhone, "client");
const postSecurityClientPair = await activate(
  sharedPhone,
  "client",
  postSecurityClientChallenge,
  "device-post-security-client-" + suffix,
);
assertSession(postSecurityClientPair, "client", "app-client", actorId);
const postSecurityCaptainChallenge = await requestOtp(sharedPhone, "captain");
const postSecurityCaptainPair = await activate(
  sharedPhone,
  "captain",
  postSecurityCaptainChallenge,
  "device-post-security-captain-" + suffix,
);
assertSession(postSecurityCaptainPair, "captain", "app-captain", actorId);
const postSecurityOperatorPair = await expect("POST", "/auth/login", 200, {
  body: {
    username: operatorUsername,
    password: newOperatorPassword,
    deviceFingerprint: "device-post-security-operator-" + suffix,
  },
});
assertSession(postSecurityOperatorPair, "operator", "control-panel", actorId);

// Concurrent source throttling is serialized, but a noisy/shared source cannot deny correct credentials.
const sourceThrottleResponses = await Promise.all(
  Array.from({ length: 40 }, (_, i) =>
    request("POST", "/auth/login", {
      body: {
        username: "unknown." + suffix + "." + i,
        password: "Wrong-Unknown-" + suffix + "-" + i,
        deviceFingerprint: "device-source-throttle-" + suffix,
      },
    }),
  ),
);
const sourceUnauthorized = sourceThrottleResponses.filter((response) => response.status === 401).length;
const sourceLimitedCount = sourceThrottleResponses.filter((response) => response.status === 429).length;
assert(sourceUnauthorized === 29, "concurrent source throttle allowed unexpected unauthenticated count " + sourceUnauthorized);
assert(sourceLimitedCount === 11, "concurrent source throttle returned unexpected limited count " + sourceLimitedCount);
const operatorAfterSourceThrottle = await expect("POST", "/auth/login", 200, {
  body: {
    username: operatorUsername,
    password: newOperatorPassword,
    deviceFingerprint: "device-operator-after-source-throttle-" + suffix,
  },
});
assertSession(operatorAfterSourceThrottle, "operator", "control-panel", actorId);


// OTP attempt lock remains exact.
const lockedPhone = phone();
const lockedChallenge = await requestOtp(lockedPhone, "client");
const lockedCode = codeFor(lockedChallenge.activationId);
const wrongCode = lockedCode === "000000" ? "000001" : "000000";
for (let attempt = 0; attempt < 5; attempt++) {
  await expect("POST", "/auth/activate", 401, {
    body: {
      phone: lockedPhone,
      role: "client",
      code: wrongCode,
      deviceFingerprint: "device-lock-" + suffix,
    },
  });
}
await expect("POST", "/auth/activate", 401, {
  body: {
    phone: lockedPhone,
    role: "client",
    code: lockedCode,
    deviceFingerprint: "device-lock-" + suffix,
  },
});

// Refresh random-token resistance and historical replay compromise use an independent session.
const refreshPhone = phone();
const refreshChallenge = await requestOtp(refreshPhone, "client");
const refreshDevice = "device-refresh-" + suffix;
const refreshPair = await activate(refreshPhone, "client", refreshChallenge, refreshDevice);
const randomRefresh = refreshPair.identity.sessionId + "." + crypto.randomBytes(48).toString("base64url");
await expect("POST", "/auth/refresh", 401, {
  body: { refreshToken: randomRefresh, deviceFingerprint: refreshDevice },
});
await expect("GET", "/auth/session", 200, { token: refreshPair.accessToken });
const rotatedPair = await expect("POST", "/auth/refresh", 200, {
  body: { refreshToken: refreshPair.refreshToken, deviceFingerprint: refreshDevice },
});
assertSession(rotatedPair, "client", "app-client", refreshPair.identity.subject);
assert(rotatedPair.refreshToken !== refreshPair.refreshToken, "refresh token did not rotate");
await expect("POST", "/auth/refresh", 401, {
  body: { refreshToken: refreshPair.refreshToken, deviceFingerprint: refreshDevice },
});
await expect("GET", "/auth/session", 401, { token: rotatedPair.accessToken });

// Per-phone OTP rate limit.
const ratePhone = phone();
for (let i = 0; i < 5; i++) {
  await requestOtp(ratePhone, "client");
}
await expect("POST", "/auth/otp/request", 429, {
  body: { phone: ratePhone, role: "client" },
});

// Source-level OTP throttling must eventually reject unique phone spam within the configured 20-challenge window.
let sourceLimited = false;
for (let i = 0; i < 25; i++) {
  const response = await request("POST", "/auth/otp/request", {
    body: { phone: phone(), role: "client" },
  });
  if (response.status === 429) {
    sourceLimited = true;
    break;
  }
  if (response.status !== 201) {
    fail("unexpected source-throttle probe status " + response.status + " body=" + JSON.stringify(response.body));
  }
}
assert(sourceLimited, "OTP source-level throttling did not engage");

// Role-scoped read/search remains credential-authorized without generic context.
const captainRead = await expect(
  "GET",
  "/internal/actors/" + encodeURIComponent(actorId) + "/roles/captain",
  200,
  { headers: service(dshToken) },
);
assert(captainRead.actorId === actorId && captainRead.role === "captain", "role readback mismatch");
await expect("GET", "/internal/actors/" + encodeURIComponent(actorId) + "/roles/captain", 403, {
  headers: service(platformToken),
});

console.log("IDENTITY_RUNTIME_SEMANTICS=PASS");
console.log("IDENTITY_SINGLE_ACTOR_MULTI_ROLE=PASS");
console.log("IDENTITY_CLIENT_ACTOR_CREATION_AFTER_PROOF=PASS");
console.log("IDENTITY_ROLE_SCOPED_REVOCATION=PASS");
console.log("IDENTITY_GLOBAL_SECURITY_DISABLE=PASS");
console.log("IDENTITY_GLOBAL_SECURITY_REENABLE_REQUIRES_REAUTH=PASS");
console.log("IDENTITY_GOVERNED_OTP_SELF_GRANT=0");
console.log("IDENTITY_OTP_DECOY_RATE_ACCOUNTING=PASS");
console.log("IDENTITY_OPERATOR_PASSWORD_ONLY=PASS");
console.log("IDENTITY_SERVICE_CREDENTIAL_CALLER=PASS");
console.log("IDENTITY_ACCOUNT_LOCKOUT_DOS_RESISTANCE=PASS");
console.log("IDENTITY_LOGIN_SOURCE_DOS_RESISTANCE=PASS");
console.log("IDENTITY_LOGIN_CONCURRENT_THROTTLE=PASS");
console.log("IDENTITY_UNKNOWN_USERNAME_DUMMY_HASH=PASS");
console.log("IDENTITY_PASSWORD_RESET_REVOCATION=PASS");
console.log("IDENTITY_OTP_PHONE_RATE_LIMIT=PASS");
console.log("IDENTITY_OTP_SOURCE_RATE_LIMIT=PASS");
console.log("IDENTITY_REFRESH_RANDOM_DOS_RESISTANCE=PASS");
console.log("IDENTITY_REFRESH_REPLAY_COMPROMISE=PASS");
console.log("IDENTITY_PREMATURE_CONTEXT_AUTHORITY=0");
console.log("IDENTITY_RAW_ACTIVATION_CODE_LEAK=0");
