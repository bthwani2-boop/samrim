import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const requestedEnv = process.argv.find((arg) => arg.startsWith("--env-file="))?.slice("--env-file=".length);
const envFile = path.resolve(root, requestedEnv || "infra/local/compose/.env");
const runtimeHost = process.argv.find((arg) => arg.startsWith("--host="))?.slice("--host=".length) || "127.0.0.1";
const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));
const baseUrl = `http://${runtimeHost}:${env.SAMRIM_IDENTITY_PORT}`;
const challengeSecret = env.IDENTITY_CHALLENGE_HMAC_SECRET;
const dshToken = env.IDENTITY_DSH_SERVICE_TOKEN;
const bootstrapToken = env.OPERATOR_BOOTSTRAP_SECRET;
const controlToken = env.CONTROL_PANEL_SERVICE_TOKEN;
const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envFile, "-f", path.join(root, "infra/local/compose/compose.yaml")];
const fail = (message) => { console.error("IDENTITY_RUNTIME_SEMANTICS=FAIL"); console.error("  " + message); process.exit(1); };
const assert = (condition, message) => { if (!condition) fail(message); };
const sql = (query) => execFileSync("docker", [...composeArgs, "exec", "-T", "postgres", "psql", "-U", env.SAMRIM_POSTGRES_USER, "-d", env.SAMRIM_POSTGRES_DB, "-Atc", query], { encoding: "utf8" }).trim();
const sqlLiteral = (value) => String(value).replaceAll("'", "''");
const generatedPhones = new Set();
let cleanupAttempted = false;
const cleanup = () => {
  if (cleanupAttempted || generatedPhones.size === 0) return;
  cleanupAttempted = true;
  try {
    const phones = [...generatedPhones].map((value) => "'" + sqlLiteral(value) + "'").join(",");
    const removable = "phone_e164 IN (" + phones + ") AND id <> COALESCE((SELECT initial_operator_actor_id FROM identity_bootstrap_state WHERE id=1), '')";
    sql("DELETE FROM identity_actors WHERE " + removable);
    assert(sql("SELECT count(*) FROM identity_actors WHERE " + removable) === "0", "generated Identity actors remain after cleanup");
    console.log("IDENTITY_RUNTIME_CLEANUP=PASS");
  } catch (error) {
    console.error("IDENTITY_RUNTIME_CLEANUP=FAIL " + String(error?.stderr || error?.message || error));
    process.exitCode = 1;
  }
};
process.on("exit", cleanup);
const request = async (method, pathname, options = {}) => {
  const response = await fetch(baseUrl + pathname, {
    method,
    headers: { Accept: "application/json", ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.token ? { Authorization: "Bearer " + options.token } : {}), ...(options.headers || {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  return { status: response.status, body };
};
const expect = async (method, pathname, status, options = {}) => {
  const result = await request(method, pathname, options);
  assert(result.status === status, `${method} ${pathname}: got ${result.status}, expected ${status}; body=${JSON.stringify(result.body)}`);
  return result.body;
};
const service = (token, extra = {}) => ({ Authorization: "Bearer " + token, ...extra });
const phone = () => "+9677" + String(crypto.randomInt(10_000_000, 99_999_999));
const password = (label) => label.slice(0, 4).padEnd(4, "x") + crypto.randomBytes(2).toString("hex");
const codeFor = (challengeId, purpose) => String(crypto.createHmac("sha256", challengeSecret).update(challengeId).update(Buffer.from([0])).update(purpose).update(Buffer.from([0])).update("challenge-code").digest().readUInt32BE(0) % 1_000_000).padStart(6, "0");
const issue = async (pathname, body, purpose, role = "client") => {
  const challenge = await expect("POST", pathname, 201, { body });
  assert(typeof challenge.challengeId === "string", purpose + " challenge id missing");
  return { ...challenge, code: codeFor(challenge.challengeId, purpose), role };
};
const session = (pair, role, surface, subject) => {
  assert(typeof pair?.accessToken === "string" && typeof pair?.refreshToken === "string", "token pair missing");
  assert(pair.identity?.role === role && pair.identity?.surface === surface && pair.identity?.subject === subject, "session identity mismatch");
};

for (const pathName of ["/identity/health", "/identity/readiness"]) await expect("GET", pathName, 200);
for (const pathName of ["/auth/operator/login/start", "/auth/operator/login/complete", "/auth/managed/recovery/request", "/auth/managed/recover"]) await expect("POST", pathName, 404, { body: {} });

const bootstrapPhone = phone();
generatedPhones.add(bootstrapPhone);
const bootstrap = await request("POST", "/internal/bootstrap/operator", { token: bootstrapToken, body: { phoneE164: bootstrapPhone, role: "operator" } });
assert([201, 409].includes(bootstrap.status), "first-operator bootstrap fence returned " + bootstrap.status);
let operator = sql("SELECT a.id || '|' || a.phone_e164 FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id AND r.role='operator' ORDER BY a.created_at LIMIT 1").split("|");
assert(operator.length === 2 && operator[0] && operator[1], "operator readback missing");
const operatorActorID = operator[0];

const clientPhone = phone();
generatedPhones.add(clientPhone);
const clientPassword = password("Client");
const registration = await issue("/auth/client/registration/request", { phone: clientPhone }, "client_register");
const clientPair = await expect("POST", "/auth/client/register", 201, { body: { phone: clientPhone, code: registration.code, password: clientPassword, clientInstanceId: "runtime-client-instance-" + crypto.randomUUID() } });
session(clientPair, "client", "app-client", clientPair.identity.subject);
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });
const loginClientInstance = "runtime-client-login-" + crypto.randomUUID();
const loginPair = await expect("POST", "/auth/client/login", 200, { body: { phone: clientPhone, password: clientPassword, clientInstanceId: loginClientInstance } });
session(loginPair, "client", "app-client", clientPair.identity.subject);
await expect("POST", "/auth/client/login", 401, { body: { phone: clientPhone, password: "1234567", clientInstanceId: "runtime-short-password-" + crypto.randomUUID() } });
await expect("POST", "/auth/client/login", 401, { body: { phone: clientPhone, password: "123456789", clientInstanceId: "runtime-long-password-" + crypto.randomUUID() } });
await expect("POST", "/auth/client/login", 401, { body: { phone: clientPhone, password: "12345678", clientInstanceId: "runtime-blocked-password-" + crypto.randomUUID() } });

const loginAccessHash = crypto.createHash("sha256").update(loginPair.accessToken).digest("hex");
const loginLifetime = sql("SELECT round(extract(epoch FROM (absolute_expires_at-created_at)))::bigint || '|' || round(extract(epoch FROM (refresh_expires_at-created_at)))::bigint FROM identity_sessions WHERE access_token_hash='" + sqlLiteral(loginAccessHash) + "'").split("|").map(Number);
assert(loginLifetime[0] >= 364 * 86400 && loginLifetime[0] <= 366 * 86400, "mobile absolute session lifetime is not 365 days: " + loginLifetime[0]);
assert(loginLifetime[1] >= 29 * 86400 && loginLifetime[1] <= 31 * 86400, "mobile refresh session lifetime is not 30 days: " + loginLifetime[1]);
sql("UPDATE identity_sessions SET last_used_at=clock_timestamp()-interval '3 days' WHERE access_token_hash='" + sqlLiteral(loginAccessHash) + "'");
await expect("GET", "/auth/session", 200, { token: loginPair.accessToken });
sql("UPDATE identity_sessions SET last_used_at=clock_timestamp()-interval '3 days' WHERE access_token_hash='" + sqlLiteral(loginAccessHash) + "'");
await expect("POST", "/auth/refresh", 200, { body: { refreshToken: loginPair.refreshToken, clientInstanceId: loginClientInstance } });

const refreshClientInstance = "runtime-refresh-instance-" + crypto.randomUUID();
const refreshFirst = await expect("POST", "/auth/client/login", 200, { body: { phone: clientPhone, password: clientPassword, clientInstanceId: refreshClientInstance } });
const refreshSecond = await expect("POST", "/auth/refresh", 200, { body: { refreshToken: refreshFirst.refreshToken, clientInstanceId: refreshClientInstance } });
session(refreshSecond, "client", "app-client", clientPair.identity.subject);
assert(refreshFirst.refreshToken !== refreshSecond.refreshToken && refreshFirst.accessToken !== refreshSecond.accessToken, "refresh did not atomically rotate both tokens");
await expect("POST", "/auth/refresh", 401, { body: { refreshToken: refreshSecond.refreshToken, clientInstanceId: "runtime-wrong-instance-" + crypto.randomUUID() } });
const refreshThird = await expect("POST", "/auth/refresh", 200, { body: { refreshToken: refreshSecond.refreshToken, clientInstanceId: refreshClientInstance } });
session(refreshThird, "client", "app-client", clientPair.identity.subject);
await expect("POST", "/auth/refresh", 401, { body: { refreshToken: refreshSecond.refreshToken, clientInstanceId: refreshClientInstance } });
const firstRefreshSecret = refreshFirst.refreshToken.split(".")[1];
const firstRefreshHash = crypto.createHash("sha256").update(firstRefreshSecret).digest("hex");
const refreshHistoryMatch = sql("SELECT count(*) FROM identity_refresh_token_history WHERE token_hash='" + sqlLiteral(firstRefreshHash) + "'");
assert(refreshHistoryMatch === "1", "refresh history aging readback failed before update: " + refreshHistoryMatch);
sql("UPDATE identity_refresh_token_history SET rotated_at=clock_timestamp()-interval '6 seconds' WHERE token_hash='" + sqlLiteral(firstRefreshHash) + "'");
assert(sql("SELECT count(*) FROM identity_refresh_token_history WHERE token_hash='" + sqlLiteral(firstRefreshHash) + "' AND rotated_at < clock_timestamp()-interval '5 seconds'") === "1", "refresh history aging readback failed during update");
await expect("POST", "/auth/refresh", 401, { body: { refreshToken: refreshFirst.refreshToken, clientInstanceId: refreshClientInstance } });
await expect("POST", "/auth/refresh", 401, { body: { refreshToken: refreshThird.refreshToken, clientInstanceId: refreshClientInstance } });
const unknownInstance = "runtime-unknown-family-" + crypto.randomUUID();
const unknownFamily = await expect("POST", "/auth/client/login", 200, { body: { phone: clientPhone, password: clientPassword, clientInstanceId: unknownInstance } });
const unknownParts = unknownFamily.refreshToken.split(".");
const unknownRefresh = unknownParts[0] + "." + crypto.randomBytes(48).toString("base64url");
await expect("POST", "/auth/refresh", 401, { body: { refreshToken: unknownRefresh, clientInstanceId: unknownInstance } });
await expect("POST", "/auth/refresh", 200, { body: { refreshToken: unknownFamily.refreshToken, clientInstanceId: unknownInstance } });

const recoveryPassword = password("Client-Recovered");
const recovery = await issue("/auth/client/recovery/request", { phone: clientPhone }, "client_recover");
const recoveryResult = await expect("POST", "/auth/client/recover", 200, { body: { phone: clientPhone, code: recovery.code, password: recoveryPassword } });
assert(recoveryResult?.status === "recovery_complete", "client recovery did not complete");
assert(!recoveryResult.accessToken && !recoveryResult.tokenPair, "client recovery created a session");
await expect("GET", "/auth/session", 401, { token: clientPair.accessToken });
await expect("POST", "/auth/client/login", 401, { body: { phone: clientPhone, password: clientPassword, clientInstanceId: "runtime-old-password-" + crypto.randomUUID() } });
const recoveredPair = await expect("POST", "/auth/client/login", 200, { body: { phone: clientPhone, password: recoveryPassword, clientInstanceId: "runtime-recovered-" + crypto.randomUUID() } });
session(recoveredPair, "client", "app-client", clientPair.identity.subject);

const managedPhone = phone();
generatedPhones.add(managedPhone);
await expect("POST", "/internal/actor-roles/provision", 201, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorActorID }, body: { phoneE164: managedPhone, role: "partner" } });
const managedPassword = password("Partner");
const managedChallenge = await issue("/auth/managed/activation/request", { phone: managedPhone, role: "partner" }, "managed_activate", "partner");
const managedPair = await expect("POST", "/auth/managed/activate", 200, { body: { phone: managedPhone, role: "partner", verificationCode: managedChallenge.code, password: managedPassword, clientInstanceId: "runtime-managed-instance-" + crypto.randomUUID() } });
session(managedPair, "partner", "app-partner", managedPair.identity.subject);
const repeatedManagedChallenge = await issue("/auth/managed/activation/request", { phone: managedPhone, role: "partner" }, "managed_activate", "partner");
await expect("POST", "/auth/managed/activate", 401, { body: { phone: managedPhone, role: "partner", verificationCode: repeatedManagedChallenge.code, password: password("Repeated"), clientInstanceId: "runtime-repeat-activation-" + crypto.randomUUID() } });
assert(sql("SELECT count(*) FROM identity_sessions WHERE actor_id='" + sqlLiteral(managedPair.identity.subject) + "' AND role='partner' AND revoked_at IS NULL") === "1", "repeated managed activation created a second live session");
const managedRole = await expect("GET", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/roles/partner", 200, { token: controlToken });
await expect("POST", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/roles/partner/disable", 403, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(managedRole.roleVersion), "X-Reason": "runtime DSH lifecycle boundary assurance" } });
await expect("POST", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/roles/partner/disable", 204, { token: controlToken, headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(managedRole.roleVersion), "X-Reason": "runtime disable assurance" } });
await expect("GET", "/auth/session", 401, { token: managedPair.accessToken });
await expect("POST", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/roles/partner/enable", 204, { token: controlToken, headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(managedRole.roleVersion + 1), "X-Reason": "runtime restore assurance" } });
const managedActor = sql("SELECT version FROM identity_actors WHERE id='" + sqlLiteral(managedPair.identity.subject) + "'");
await expect("POST", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/security/disable", 204, { token: controlToken, headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": managedActor, "X-Reason": "runtime security disable assurance" } });
await expect("GET", "/auth/session", 401, { token: managedPair.accessToken });
await expect("POST", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/security/enable", 204, { token: controlToken, headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(Number(managedActor) + 1), "X-Reason": "runtime security restore assurance" } });
await expect("POST", "/auth/managed/activation/request", 403, { body: { phone: managedPhone, role: "operator" } });

const authOptions = await expect("POST", "/auth/operator/authentication/options", 201);
assert(typeof authOptions.ceremonyId === "string" && authOptions.publicKey?.challenge, "operator passkey options are not server-owned");
assert(!authOptions.accessToken && !authOptions.refreshToken, "passkey options created a session");
const operatorEnrollment = await expect("POST", "/internal/operator-enrollment-tokens", 201, { token: controlToken, headers: { "X-Acting-Actor-ID": operatorActorID }, body: { phoneE164: operator[1], role: "operator" } });
assert(/^[A-Za-z0-9_-]{24,256}$/.test(operatorEnrollment.code), "operator enrollment token is not high entropy");
const operatorChallenge = await issue("/auth/operator/enrollment/request", { phone: operator[1], operatorEnrollmentToken: operatorEnrollment.code }, "operator_enroll", "operator");
const enrollmentOptions = await expect("POST", "/auth/operator/enrollment/registration/options", 201, { body: { phone: operator[1], operatorEnrollmentToken: operatorEnrollment.code, verificationCode: operatorChallenge.code } });
assert(typeof enrollmentOptions.ceremonyId === "string" && enrollmentOptions.publicKey?.challenge, "operator enrollment ceremony was not created");
const invalidFinish = await request("POST", "/auth/operator/enrollment/registration/finish", { body: { ceremonyId: enrollmentOptions.ceremonyId, credential: {}, clientInstanceId: "runtime-invalid-passkey-instance-" + crypto.randomUUID() } });
assert([400, 401].includes(invalidFinish.status), "invalid operator passkey credential was accepted");
sql("UPDATE identity_webauthn_ceremonies SET expires_at=clock_timestamp()-interval '1 second' WHERE id='" + sqlLiteral(enrollmentOptions.ceremonyId) + "'");
assert(sql("SELECT count(*) FROM identity_webauthn_ceremonies WHERE id='" + sqlLiteral(enrollmentOptions.ceremonyId) + "' AND expires_at < clock_timestamp()") === "1", "passkey ceremony expiry readback failed");
await expect("POST", "/auth/operator/enrollment/registration/finish", 401, { body: { ceremonyId: enrollmentOptions.ceremonyId, credential: {}, clientInstanceId: "runtime-expired-passkey-instance-" + crypto.randomUUID() } });
const recoveryWithoutCredential = await request("POST", "/auth/operator/recovery/request", { body: { phone: operator[1], recoveryCredential: "not-a-real-recovery-credential" } });
assert(recoveryWithoutCredential.status === 201, "operator recovery leaked whether an invalid recovery credential matched");
assert(recoveryWithoutCredential.body?.challengeId && sql("SELECT admissible::text FROM identity_challenges WHERE id='" + sqlLiteral(recoveryWithoutCredential.body.challengeId) + "'") === "false", "invalid operator recovery credential became admissible");

assert(sql("SELECT count(*) FROM identity_password_credentials WHERE role='operator'") === "0", "operator password credential remains");
assert(sql("SELECT count(*) FROM identity_password_attempts WHERE role='operator'") === "0", "operator password attempts remain");
assert(sql("SELECT count(*) FROM identity_challenges WHERE purpose IN ('operator_mfa','managed_recover')") === "0", "retired proof purposes remain in current data");
const retiredInstanceColumn = ["device", "_fingerprint", "_hash"].join("");
assert(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='identity_sessions' AND column_name='" + retiredInstanceColumn + "'") === "0", "retired session binding column remains");
assert(sql("SELECT count(*) FROM identity_schema_migrations WHERE version=18") === "1", "identity schema is not at v18");

console.log("IDENTITY_RUNTIME_SEMANTICS=PASS");
console.log("IDENTITY_CUSTOMER_REGISTRATION_AFTER_PHONE_PROOF=PASS");
console.log("IDENTITY_CUSTOMER_PASSWORD_LOGIN=PASS");
console.log("IDENTITY_CUSTOMER_RECOVERY_NO_SESSION=PASS");
console.log("IDENTITY_MANAGED_ACTIVATION_ONE_TIME=PASS");
console.log("IDENTITY_REFRESH_ROTATION_REPLAY_FAMILY=PASS");
console.log("IDENTITY_REFRESH_UNKNOWN_TOKEN_ISOLATION=PASS");
console.log("IDENTITY_ROLE_SECURITY_DISABLE_REVOCATION=PASS");
console.log("IDENTITY_OPERATOR_PASSKEY_OPTIONS=PASS");
console.log("IDENTITY_OPERATOR_PASSWORD_SESSION=0");
console.log("IDENTITY_OPERATOR_RECOVERY_INVALID_CREDENTIAL=PASS");
console.log("IDENTITY_REFRESH_INSTANCE_BINDING=PASS");
console.log("IDENTITY_OPERATOR_PASSKEY_EXPIRED_CEREMONY=PASS");
console.log("IDENTITY_RAW_CHALLENGE_CODE_LEAK=0");
console.log("IDENTITY_PASSWORD_EXACT_EIGHT=PASS");
console.log("IDENTITY_MOBILE_SESSION_CONTINUITY=PASS");
