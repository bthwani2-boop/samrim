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
const workforceToken = env.IDENTITY_WORKFORCE_SERVICE_TOKEN;
const dshToken = env.IDENTITY_DSH_SERVICE_TOKEN;
const platformToken = env.IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN;

for (const [name, value, minimum] of [
  ["IDENTITY_ACTIVATION_HMAC_SECRET", activationSecret, 32],
  ["IDENTITY_WORKFORCE_SERVICE_TOKEN", workforceToken, 24],
  ["IDENTITY_DSH_SERVICE_TOKEN", dshToken, 24],
  ["IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN", platformToken, 24],
]) {
  if (typeof value !== "string" || value.length < minimum) fail(name + " is not configured strongly enough");
}

const suffix = crypto.randomBytes(5).toString("hex");
let phoneCounter = crypto.randomInt(10_000_000, 90_000_000);
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
  const value = digest.readUInt32BE(0) % 1_000_000;
  return String(value).padStart(6, "0");
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
    fail(
      method +
        " " +
        pathname +
        " returned " +
        response.status +
        ", expected " +
        expectedStatus +
        "; body=" +
        JSON.stringify(response.body),
    );
  }
  return response.body;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertSurface(pair, role, surface) {
  assert(pair && typeof pair === "object", "token pair is missing");
  assert(typeof pair.accessToken === "string" && pair.accessToken.length >= 20, "access token missing");
  assert(typeof pair.refreshToken === "string" && pair.refreshToken.length >= 20, "refresh token missing");
  assert(pair.identity?.authState === "ACTIVE", "identity authState is not ACTIVE");
  assert(pair.identity?.sessionSurface === surface, "session surface mismatch for " + role);
  assert(pair.identity?.surfaceAccess?.[surface] === true, "surfaceAccess missing " + surface);
  assert(Array.isArray(pair.identity?.roles) && pair.identity.roles.includes(role), "role missing " + role);
}

function serviceHeaders(caller, token, operatorContextId, extra = {}) {
  return {
    Authorization: "Bearer " + token,
    "X-Service-Caller": caller,
    "X-Operator-Context-ID": operatorContextId,
    ...extra,
  };
}

console.log("Identity runtime candidate: " + baseUrl);

await expect("GET", "/identity/health", 200);
await expect("GET", "/identity/readiness", 200);

// Public client enrollment is client-only and cannot inject trusted context.
const clientPhone = phone();
await expect("POST", "/auth/otp/request", 400, {
  body: { phone: clientPhone, actorType: "client", operatorContextId: "attacker-context" },
});
await expect("POST", "/auth/otp/request", 403, {
  body: { phone: clientPhone, actorType: "partner" },
});

const clientChallenge = await expect("POST", "/auth/otp/request", 201, {
  body: { phone: clientPhone, actorType: "client" },
});
const clientCode = codeFor(clientChallenge.activationId);
assert(!JSON.stringify(clientChallenge).includes(clientCode), "raw activation code leaked in challenge response");

const clientDevice = "device-client-" + suffix;
const clientPair = await expect("POST", "/auth/activate", 200, {
  body: {
    phone: clientPhone,
    actorType: "client",
    code: clientCode,
    deviceFingerprint: clientDevice,
  },
});
assertSurface(clientPair, "client", "app-client");
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });

// A random refresh token must not be able to compromise/revoke a known session.
const randomRefresh =
  clientPair.identity.sessionId + "." + crypto.randomBytes(48).toString("base64url");
await expect("POST", "/auth/refresh", 401, {
  body: { refreshToken: randomRefresh, deviceFingerprint: clientDevice },
});
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });

// Valid refresh rotates. Reuse of the known rotated token compromises the session family.
const rotatedPair = await expect("POST", "/auth/refresh", 200, {
  body: { refreshToken: clientPair.refreshToken, deviceFingerprint: clientDevice },
});
assertSurface(rotatedPair, "client", "app-client");
assert(rotatedPair.refreshToken !== clientPair.refreshToken, "refresh token did not rotate");
await expect("POST", "/auth/refresh", 401, {
  body: { refreshToken: clientPair.refreshToken, deviceFingerprint: clientDevice },
});
await expect("GET", "/auth/session", 401, { token: rotatedPair.accessToken });

// Five bad activation attempts lock the challenge; correct code cannot revive it.
const lockedPhone = phone();
const lockedChallenge = await expect("POST", "/auth/otp/request", 201, {
  body: { phone: lockedPhone, actorType: "client" },
});
const lockedCode = codeFor(lockedChallenge.activationId);
const wrongCode = lockedCode === "000000" ? "000001" : "000000";
for (let attempt = 0; attempt < 5; attempt++) {
  await expect("POST", "/auth/activate", 401, {
    body: {
      phone: lockedPhone,
      actorType: "client",
      code: wrongCode,
      deviceFingerprint: "device-lock-" + suffix,
    },
  });
}
await expect("POST", "/auth/activate", 401, {
  body: {
    phone: lockedPhone,
    actorType: "client",
    code: lockedCode,
    deviceFingerprint: "device-lock-" + suffix,
  },
});

// Workforce can provision only captain/field and cannot read across operator context.
const workforceContext = "workforce-" + suffix;
const captainPhone = phone();
const captainRequest = {
  username: "captain." + suffix,
  phoneE164: captainPhone,
  role: "captain",
};
const captain = await expect("POST", "/internal/actors/provision", 201, {
  headers: serviceHeaders("workforce", workforceToken, workforceContext),
  body: captainRequest,
});
const captainRetry = await expect("POST", "/internal/actors/provision", 200, {
  headers: serviceHeaders("workforce", workforceToken, workforceContext),
  body: captainRequest,
});
assert(captainRetry.actorId === captain.actorId, "trusted provisioning retry changed actor identity");

await expect("POST", "/internal/actors/provision", 409, {
  headers: serviceHeaders("workforce", workforceToken, workforceContext),
  body: { ...captainRequest, role: "field" },
});
await expect("POST", "/internal/actors/provision", 403, {
  headers: serviceHeaders("workforce", workforceToken, workforceContext),
  body: { username: "partner.bad." + suffix, phoneE164: phone(), role: "partner" },
});
await expect("GET", "/internal/actors/" + encodeURIComponent(captain.actorId), 404, {
  headers: serviceHeaders("workforce", workforceToken, "other-" + suffix),
});

const activationHeaders = serviceHeaders("workforce", workforceToken, workforceContext, {
  "Idempotency-Key": "captain-activation-" + suffix,
  "X-Correlation-ID": "corr-" + suffix,
});
const captainChallenge = await expect(
  "POST",
  "/internal/actors/" + encodeURIComponent(captain.actorId) + "/activations",
  201,
  {
    headers: activationHeaders,
    body: { expectedActorType: "captain" },
  },
);
const captainChallengeRetry = await expect(
  "POST",
  "/internal/actors/" + encodeURIComponent(captain.actorId) + "/activations",
  201,
  {
    headers: activationHeaders,
    body: { expectedActorType: "captain" },
  },
);
assert(
  captainChallengeRetry.activationId === captainChallenge.activationId,
  "activation idempotency retry changed challenge identity",
);
const captainCode = codeFor(captainChallenge.activationId);
assert(!JSON.stringify(captainChallenge).includes(captainCode), "governed activation response leaked raw code");

await expect("POST", "/auth/activate", 401, {
  body: {
    phone: captainPhone,
    actorType: "field",
    code: captainCode,
    deviceFingerprint: "device-captain-" + suffix,
  },
});
const captainPair = await expect("POST", "/auth/activate", 200, {
  body: {
    phone: captainPhone,
    actorType: "captain",
    code: captainCode,
    deviceFingerprint: "device-captain-" + suffix,
  },
});
assertSurface(captainPair, "captain", "app-captain");
await expect(
  "POST",
  "/internal/actors/" + encodeURIComponent(captain.actorId) + "/suspend",
  204,
  { headers: serviceHeaders("workforce", workforceToken, workforceContext) },
);
await expect("GET", "/auth/session", 401, { token: captainPair.accessToken });

// DSH is partner-only.
const dshContext = "dsh-" + suffix;
const partner = await expect("POST", "/internal/actors/provision", 201, {
  headers: serviceHeaders("dsh", dshToken, dshContext),
  body: { username: "partner." + suffix, phoneE164: phone(), role: "partner" },
});
assert(partner.roles?.includes("partner"), "DSH partner provisioning did not return partner role");
await expect("POST", "/internal/actors/provision", 403, {
  headers: serviceHeaders("dsh", dshToken, dshContext),
  body: { username: "captain.bad." + suffix, phoneE164: phone(), role: "captain" },
});

// Platform-control provisions password operators. Exact retries are credential-exact.
const operatorContext = "control-" + suffix;
const operatorUsername = "operator." + suffix;
const operatorPassword = "Strong-Operator-" + suffix + "-Password";
const operatorBody = {
  username: operatorUsername,
  phoneE164: phone(),
  role: "operator",
  password: operatorPassword,
};
const operator = await expect("POST", "/internal/actors/provision", 201, {
  headers: serviceHeaders("platform-control", platformToken, operatorContext),
  body: operatorBody,
});
const operatorRetry = await expect("POST", "/internal/actors/provision", 200, {
  headers: serviceHeaders("platform-control", platformToken, operatorContext),
  body: operatorBody,
});
assert(operatorRetry.actorId === operator.actorId, "operator provisioning retry changed actor");
await expect("POST", "/internal/actors/provision", 409, {
  headers: serviceHeaders("platform-control", platformToken, operatorContext),
  body: { ...operatorBody, password: operatorPassword + "-changed" },
});

await expect(
  "POST",
  "/internal/actors/" + encodeURIComponent(operator.actorId) + "/reactivate",
  409,
  { headers: serviceHeaders("platform-control", platformToken, operatorContext) },
);

const operatorChallenge = await expect(
  "POST",
  "/internal/actors/" + encodeURIComponent(operator.actorId) + "/activations",
  201,
  {
    headers: serviceHeaders("platform-control", platformToken, operatorContext, {
      "Idempotency-Key": "operator-activation-" + suffix,
      "X-Correlation-ID": "operator-corr-" + suffix,
    }),
    body: { expectedActorType: "operator" },
  },
);
const operatorCode = codeFor(operatorChallenge.activationId);
const activatedOperatorPair = await expect("POST", "/auth/activate", 200, {
  body: {
    phone: operatorBody.phoneE164,
    actorType: "operator",
    code: operatorCode,
    deviceFingerprint: "device-operator-activation-" + suffix,
  },
});
assertSurface(activatedOperatorPair, "operator", "control-panel");
await expect("POST", "/auth/logout", 204, { token: activatedOperatorPair.accessToken });

const operatorPair = await expect("POST", "/auth/login", 200, {
  body: {
    username: operatorUsername,
    password: operatorPassword,
    deviceFingerprint: "device-operator-login-" + suffix,
  },
});
assertSurface(operatorPair, "operator", "control-panel");
await expect("POST", "/auth/logout", 204, { token: operatorPair.accessToken });
await expect("GET", "/auth/session", 401, { token: operatorPair.accessToken });

// Unauthenticated callers never cross the internal boundary.
await expect("POST", "/internal/actors/provision", 401, {
  headers: {
    "X-Service-Caller": "workforce",
    "X-Operator-Context-ID": workforceContext,
  },
  body: { username: "noauth." + suffix, phoneE164: phone(), role: "captain" },
});

console.log("IDENTITY_RUNTIME_SEMANTICS=PASS");
console.log("IDENTITY_PUBLIC_CLIENT_ACTIVATION=PASS");
console.log("IDENTITY_ACTIVATION_ATTEMPT_LOCK=PASS");
console.log("IDENTITY_REFRESH_RANDOM_DOS_RESISTANCE=PASS");
console.log("IDENTITY_REFRESH_REPLAY_COMPROMISE=PASS");
console.log("IDENTITY_WORKFORCE_BOUNDARY=PASS");
console.log("IDENTITY_DSH_BOUNDARY=PASS");
console.log("IDENTITY_OPERATOR_SESSION=PASS");
console.log("IDENTITY_CROSS_CONTEXT_ISOLATION=PASS");
console.log("IDENTITY_RAW_ACTIVATION_CODE_LEAK=0");
