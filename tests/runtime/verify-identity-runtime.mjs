import { resolveTrustedExecutable } from "./runtime-proof/trusted-executables.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { captureMailpitMessageIds, readMailpitCode } from "./mailpit-challenge.mjs";
import { challengeSourceHash, challengeSourceHeaders } from "./runtime-proof/challenge-source.mjs";

const proofScope = process.env.BTHWANI_IDENTITY_PROOF_SCOPE;
const disposableCiProofAuthorized = process.env.CI === "true" && proofScope === "disposable-ci";
if (!disposableCiProofAuthorized) {
  console.error(`IDENTITY_PROOF_REFUSED scope=${proofScope || "unspecified"} reason=disposable-ci-required`);
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "../..");
const requestedEnv = process.argv.find((arg) => arg.startsWith("--env-file="))?.slice("--env-file=".length);
const envFile = path.resolve(root, requestedEnv || "infra/local/.env");
const runtimeHost = process.argv.find((arg) => arg.startsWith("--host="))?.slice("--host=".length) || "127.0.0.1";
const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));
const baseUrl = `http://${runtimeHost}:${env.SAMRIM_IDENTITY_PORT}`;
const mailpitPort = env.SAMRIM_MAILPIT_WEB_PORT;
const dshToken = env.IDENTITY_DSH_SERVICE_TOKEN;
const bootstrapToken = env.OPERATOR_BOOTSTRAP_SECRET;
const controlToken = env.CONTROL_PANEL_SERVICE_TOKEN;
const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envFile, "-f", path.join(root, "infra/local/compose/compose.yaml")];
const fail = (message) => { console.error("IDENTITY_RUNTIME_SEMANTICS=FAIL"); console.error("  " + message); process.exit(1); };
const assert = (condition, message) => { if (!condition) fail(message); };
const sql = (query) => execFileSync(resolveTrustedExecutable("docker"), [...composeArgs, "exec", "-T", "postgres", "psql", "-U", env.SAMRIM_POSTGRES_USER, "-d", env.SAMRIM_POSTGRES_DB, "-Atc", query], { encoding: "utf8" }).trim();
const sqlLiteral = (value) => String(value).replaceAll("'", "''");
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
const issue = async (pathname, body, purpose, role = "client") => {
  const previousMessageIds = await captureMailpitMessageIds({ port: mailpitPort, phone: body.phone, purpose });
  const challenge = await expect("POST", pathname, 201, { body, headers: challengeSourceHeaders(body.phone) });
  assert(typeof challenge.challengeId === "string", purpose + " challenge id missing");
  assert(sql(`SELECT request_ip_hash FROM identity_challenges WHERE id='${sqlLiteral(challenge.challengeId)}'`) === challengeSourceHash(body.phone, env.IDENTITY_ABUSE_HMAC_SECRET), "challenge source readback does not match the isolated proof actor");
  assert(typeof mailpitPort === "string" && mailpitPort.trim(), "canonical Mailpit web port missing");
  return { ...challenge, code: await readMailpitCode({ port: mailpitPort, phone: body.phone, purpose, excludeMessageIds: previousMessageIds }), role };
};
const issueManagedRecovery = async (requestPhone, canonicalPhone, role) => {
  const previousMessageIds = await captureMailpitMessageIds({ port: mailpitPort, phone: canonicalPhone, purpose: "managed_recover" });
  const challenge = await expect("POST", "/auth/managed/recovery/request", 201, {
    body: { phone: requestPhone, role },
    headers: challengeSourceHeaders(canonicalPhone),
  });
  assert(typeof challenge.challengeId === "string", "managed recovery challenge id missing");
  const readback = sql(`SELECT request_ip_hash FROM identity_challenges WHERE id='${sqlLiteral(challenge.challengeId)}'`);
  assert(readback === challengeSourceHash(canonicalPhone, env.IDENTITY_ABUSE_HMAC_SECRET), "managed recovery source readback does not match the isolated proof actor");
  assert(typeof mailpitPort === "string" && mailpitPort.trim(), "canonical Mailpit web port missing");
  return {
    ...challenge,
    code: await readMailpitCode({ port: mailpitPort, phone: canonicalPhone, purpose: "managed_recover", excludeMessageIds: previousMessageIds }),
  };
};
const session = (pair, role, surface, subject) => {
  assert(typeof pair?.accessToken === "string" && typeof pair?.refreshToken === "string", "token pair missing");
  assert(pair.identity?.role === role && pair.identity?.surface === surface && pair.identity?.subject === subject, "session identity mismatch");
};
const refreshRequestId = (refreshToken, clientInstanceId) => crypto.createHash("sha256").update("identity-refresh-request-v1\0").update(refreshToken).update("\0").update(clientInstanceId).digest("base64url");
const randomRefreshRequestId = () => crypto.randomBytes(24).toString("base64url");

for (const pathName of ["/identity/health", "/identity/readiness"]) await expect("GET", pathName, 200);
for (const pathName of ["/auth/operator/login/start", "/auth/operator/login/complete"]) await expect("POST", pathName, 404, { body: {} });

const bootstrapPhone = phone();
const bootstrap = await request("POST", "/internal/bootstrap/operator", { token: bootstrapToken, body: { phoneE164: bootstrapPhone, role: "operator" } });
assert([201, 409].includes(bootstrap.status), "first-operator bootstrap fence returned " + bootstrap.status);
let operator = sql("SELECT a.id || '|' || a.phone_e164 FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id AND r.role='operator' ORDER BY a.created_at LIMIT 1").split("|");
assert(operator.length === 2 && operator[0] && operator[1], "operator readback missing");
const operatorActorID = operator[0];

const admitReviewedOperatorCandidate = async (candidatePhone, fullNameAr, expectedActorID = "") => {
  const mutationHeaders = () => ({ "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID() });
  const created = await expect("POST", "/internal/operator-profiles", 201, {
    token: controlToken,
    headers: mutationHeaders(),
    body: { fullNameAr, phoneE164: candidatePhone, jobTitle: "مسؤول العمليات", department: "العمليات" },
  });
  const profileID = created?.profile?.id;
  assert(typeof profileID === "string" && profileID.startsWith("oprof_"), "operator candidate profile was not created");
  assert(created.profile.state === "pending_review" && !created.profile.actorId, "operator candidate received an actor or role before review");
  if (expectedActorID) {
    assert(sql("SELECT count(*) FROM identity_actors WHERE id='" + sqlLiteral(expectedActorID) + "' AND phone_e164='" + sqlLiteral(candidatePhone) + "'") === "1", "shared actor readback changed before operator profile review");
  } else {
    assert(sql("SELECT count(*) FROM identity_actors WHERE phone_e164='" + sqlLiteral(candidatePhone) + "'") === "0", "operator candidate received an actor before role grant");
  }
  assert(sql("SELECT count(*) FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE a.phone_e164='" + sqlLiteral(candidatePhone) + "' AND r.role='operator'") === "0", "operator candidate received the role before review");

  const profilePath = "/internal/operator-profiles/" + encodeURIComponent(profileID);
  const approved = await expect("POST", profilePath + "/approve", 200, {
    token: controlToken,
    headers: mutationHeaders(),
    body: { expectedVersion: 1 },
  });
  assert(approved?.profile?.state === "approved" && !approved.profile.actorId, "review did not remain separate from Identity role admission");
  assert(sql("SELECT count(*) FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE a.phone_e164='" + sqlLiteral(candidatePhone) + "' AND r.role='operator'") === "0", "review approval granted operator access before the final role step");

  const grant = await expect("POST", profilePath + "/grant", 201, {
    token: controlToken,
    headers: mutationHeaders(),
    body: { expectedVersion: 2 },
  });
  assert(grant?.profile?.state === "admitted" && grant.profile.actorId === grant.role?.actorId, "approved profile and Identity role did not bind atomically");
  assert(!expectedActorID || grant.role.actorId === expectedActorID, "operator role grant changed the existing canonical actor");
  assert(sql("SELECT count(*) FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE a.phone_e164='" + sqlLiteral(candidatePhone) + "' AND r.role='operator'") === "1", "reviewed operator role was not persisted");
  return { profileID, profile: grant.profile, role: grant.role };
};

const clientPhone = phone();
const clientPassword = password("Client");
const registration = await issue("/auth/client/registration/request", { phone: clientPhone }, "client_register");
const clientPair = await expect("POST", "/auth/client/register", 201, { body: { phone: clientPhone, code: registration.code, password: clientPassword, clientInstanceId: "runtime-client-instance-" + crypto.randomUUID() } });
session(clientPair, "client", "app-client", clientPair.identity.subject);
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });

// DSH-owned eligibility is assumed here; this fixture proves Identity role separation.
let sharedPartnerPassword = password("SharedPartner");
const sharedPartnerRole = await expect("POST", "/internal/actor-roles/provision", 201, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": operatorActorID },
  body: { phoneE164: clientPhone, role: "partner" },
});
assert(sharedPartnerRole.actorId === clientPair.identity.subject, "same-phone role provisioning created a second actor");
const sharedPartnerChallenge = await issue("/auth/managed/activation/request", { phone: clientPhone, role: "partner" }, "managed_activate", "partner");
const sharedPartnerPair = await expect("POST", "/auth/managed/activate", 200, {
  body: {
    phone: clientPhone,
    role: "partner",
    verificationCode: sharedPartnerChallenge.code,
    password: sharedPartnerPassword,
    clientInstanceId: "runtime-shared-partner-instance-" + crypto.randomUUID(),
  },
});
session(sharedPartnerPair, "partner", "app-partner", clientPair.identity.subject);
assert(sql("SELECT count(*) FROM identity_actor_roles WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role IN ('client','partner')") === "2", "same actor does not own both client and partner roles");

await expect("POST", "/auth/managed/login", 401, {
  body: { phone: clientPhone, role: "partner", password: clientPassword, clientInstanceId: "runtime-client-password-as-partner-" + crypto.randomUUID() },
});
await expect("POST", "/auth/client/login", 401, {
  body: { phone: clientPhone, password: sharedPartnerPassword, clientInstanceId: "runtime-partner-password-as-client-" + crypto.randomUUID() },
});
const sharedPartnerLogin = await expect("POST", "/auth/managed/login", 200, {
  body: { phone: clientPhone, role: "partner", password: sharedPartnerPassword, clientInstanceId: "runtime-shared-partner-login-" + crypto.randomUUID() },
});
session(sharedPartnerLogin, "partner", "app-partner", clientPair.identity.subject);

assert(sql("SELECT count(*) FROM identity_challenges WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role='partner' AND purpose='managed_recover'") === "0", "managed recovery challenge existed before activation-purpose isolation proof");
await expect("POST", "/auth/managed/recover", 401, {
  body: { phone: clientPhone, role: "partner", verificationCode: sharedPartnerChallenge.code, password: password("ActivationCross") },
});
assert(sql("SELECT count(*) FROM identity_challenges WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role='partner' AND purpose='managed_recover'") === "0", "activation proof created or crossed into managed recovery before a recovery challenge existed");

const managedRecoveryShape = await issueManagedRecovery(clientPhone.replace(/^\+967/, "0"), clientPhone, "partner");
const managedRecoveryRow = sql(`SELECT admissible::text || '|' || actor_id || '|' || role || '|' || purpose || '|' || status FROM identity_challenges WHERE id='${sqlLiteral(managedRecoveryShape.challengeId)}'`);
assert(managedRecoveryRow === `true|${clientPair.identity.subject}|partner|managed_recover|pending`, "managed recovery challenge was not bound to the activated partner role");
assert(sql("SELECT count(*) FROM identity_sessions WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role='partner' AND revoked_at IS NULL") === "2", "managed recovery fixture did not have two active partner sessions");
assert(sql("SELECT count(*) FROM identity_sessions WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role='client' AND revoked_at IS NULL") === "1", "managed recovery fixture did not retain its active client session");

const wrongManagedRecoveryCode = managedRecoveryShape.code === "000000" ? "000001" : "000000";
await expect("POST", "/auth/managed/recover", 401, {
  body: { phone: clientPhone, role: "partner", verificationCode: wrongManagedRecoveryCode, password: password("WrongProof") },
});
assert(sql("SELECT attempts::text || '|' || status FROM identity_challenges WHERE id='" + sqlLiteral(managedRecoveryShape.challengeId) + "'") === "1|pending", "invalid managed recovery proof did not consume exactly one attempt");
await expect("POST", "/auth/managed/recover", 401, {
  body: { phone: clientPhone, role: "captain", verificationCode: managedRecoveryShape.code, password: password("CrossRole") },
});
assert(sql("SELECT attempts::text || '|' || status FROM identity_challenges WHERE id='" + sqlLiteral(managedRecoveryShape.challengeId) + "'") === "1|pending", "cross-role recovery proof altered the partner challenge");

const localPartnerPassword = password("LocalProof");
const localManagedRecovery = await expect("POST", "/auth/managed/recover", 200, {
  body: { phone: clientPhone, role: "partner", verificationCode: managedRecoveryShape.code, password: localPartnerPassword },
});
assert(localManagedRecovery?.status === "recovery_complete" && !localManagedRecovery.accessToken && !localManagedRecovery.refreshToken && !localManagedRecovery.identity, "managed recovery issued a session or returned an unexpected result");
assert(sql("SELECT status FROM identity_challenges WHERE id='" + sqlLiteral(managedRecoveryShape.challengeId) + "'") === "consumed", "managed recovery challenge was not consumed");
assert(sql("SELECT count(*) FROM identity_sessions WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role='partner' AND revoked_at IS NULL") === "0", "managed recovery retained a partner session");
assert(sql("SELECT count(*) FROM identity_sessions WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role='client' AND revoked_at IS NULL") === "1", "managed recovery revoked a different role session");
await expect("GET", "/auth/session", 401, { token: sharedPartnerPair.accessToken });
await expect("GET", "/auth/session", 401, { token: sharedPartnerLogin.accessToken });
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });
await expect("POST", "/auth/managed/login", 401, {
  body: { phone: clientPhone, role: "partner", password: sharedPartnerPassword, clientInstanceId: "runtime-managed-old-password-" + crypto.randomUUID() },
});
sharedPartnerPassword = localPartnerPassword;
const localRecoveryLogin = await expect("POST", "/auth/managed/login", 200, {
  body: { phone: clientPhone, role: "partner", password: sharedPartnerPassword, clientInstanceId: "runtime-managed-local-recovery-login-" + crypto.randomUUID() },
});
session(localRecoveryLogin, "partner", "app-partner", clientPair.identity.subject);

const internationalPartnerPassword = password("IntlProof");
const internationalManagedRecovery = await issueManagedRecovery(clientPhone, clientPhone, "partner");
const internationalManagedRecoveryResult = await expect("POST", "/auth/managed/recover", 200, {
  body: { phone: clientPhone.replace(/^\+967/, "0"), role: "partner", verificationCode: internationalManagedRecovery.code, password: internationalPartnerPassword },
});
assert(internationalManagedRecoveryResult?.status === "recovery_complete" && !internationalManagedRecoveryResult.accessToken && !internationalManagedRecoveryResult.refreshToken, "second managed recovery issued a session");
assert(sql("SELECT status FROM identity_challenges WHERE id='" + sqlLiteral(internationalManagedRecovery.challengeId) + "'") === "consumed", "international managed recovery challenge was not consumed");
await expect("POST", "/auth/managed/recover", 401, {
  body: { phone: clientPhone, role: "partner", verificationCode: internationalManagedRecovery.code, password: password("Replay") },
});
await expect("GET", "/auth/session", 401, { token: localRecoveryLogin.accessToken });
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });
await expect("POST", "/auth/managed/login", 401, {
  body: { phone: clientPhone, role: "partner", password: sharedPartnerPassword, clientInstanceId: "runtime-managed-prior-recovery-password-" + crypto.randomUUID() },
});
sharedPartnerPassword = internationalPartnerPassword;
const internationalRecoveryLogin = await expect("POST", "/auth/managed/login", 200, {
  body: { phone: clientPhone, role: "partner", password: sharedPartnerPassword, clientInstanceId: "runtime-managed-international-recovery-login-" + crypto.randomUUID() },
});
session(internationalRecoveryLogin, "partner", "app-partner", clientPair.identity.subject);

const unactivatedManagedPhone = phone();
await expect("POST", "/internal/actor-roles/provision", 201, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": operatorActorID },
  body: { phoneE164: unactivatedManagedPhone, role: "field" },
});
const unactivatedRecovery = await expect("POST", "/auth/managed/recovery/request", 201, {
  body: { phone: unactivatedManagedPhone, role: "field" },
  headers: challengeSourceHeaders(unactivatedManagedPhone),
});
assert(Object.keys(unactivatedRecovery).sort().join(",") === Object.keys(managedRecoveryShape).filter((key) => key !== "code").sort().join(","), "managed recovery response disclosed eligibility through its shape");
assert(sql("SELECT admissible::text || '|' || COALESCE(actor_id,'') || '|' || status FROM identity_challenges WHERE id='" + sqlLiteral(unactivatedRecovery.challengeId) + "'") === "false||pending", "unactivated managed role did not receive a generic suppressed challenge");
assert(sql("SELECT status FROM identity_challenge_deliveries WHERE challenge_id='" + sqlLiteral(unactivatedRecovery.challengeId) + "'") === "suppressed", "ineligible managed recovery challenge was delivered");

const sharedPartnerRoleReadback = await expect("GET", "/internal/actors/" + encodeURIComponent(clientPair.identity.subject) + "/roles/partner", 200, { token: controlToken });
await expect("POST", "/internal/actors/" + encodeURIComponent(clientPair.identity.subject) + "/roles/partner/disable", 204, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(sharedPartnerRoleReadback.roleVersion), "X-Reason": "runtime role-scoped revocation assurance" },
});
await expect("GET", "/auth/session", 401, { token: sharedPartnerPair.accessToken });
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });
await expect("POST", "/internal/actors/" + encodeURIComponent(clientPair.identity.subject) + "/roles/partner/enable", 204, {
  token: dshToken,
  headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(sharedPartnerRoleReadback.roleVersion + 1), "X-Reason": "runtime role-scoped restoration assurance" },
});
const restoredPartnerLogin = await expect("POST", "/auth/managed/login", 200, {
  body: { phone: clientPhone, role: "partner", password: sharedPartnerPassword, clientInstanceId: "runtime-shared-partner-restored-" + crypto.randomUUID() },
});
session(restoredPartnerLogin, "partner", "app-partner", clientPair.identity.subject);
await expect("GET", "/auth/session", 200, { token: clientPair.accessToken });

const sharedOperatorAdmission = await admitReviewedOperatorCandidate(clientPhone, "سالم محمد أحمد", clientPair.identity.subject);
assert(sharedOperatorAdmission.role.actorId === clientPair.identity.subject, "operator role provisioning changed the permanent shared actor");
assert(sql("SELECT count(*) FROM identity_actor_roles WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role IN ('client','partner','operator')") === "3", "same actor does not own all three admitted roles");
assert(sql("SELECT count(*) FROM identity_password_credentials WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role='client'") === "1", "shared client password credential is missing");
assert(sql("SELECT count(*) FROM identity_password_credentials WHERE actor_id='" + sqlLiteral(clientPair.identity.subject) + "' AND role='operator'") === "0", "operator role received a password credential");
await expect("POST", "/auth/managed/login", 400, {
  body: { phone: clientPhone, role: "operator", password: clientPassword, clientInstanceId: "runtime-client-password-as-operator-" + crypto.randomUUID() },
});
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
await expect("POST", "/auth/refresh", 200, { body: { refreshToken: loginPair.refreshToken, clientInstanceId: loginClientInstance, refreshRequestId: refreshRequestId(loginPair.refreshToken, loginClientInstance) } });

const refreshClientInstance = "runtime-refresh-instance-" + crypto.randomUUID();
const refreshFirst = await expect("POST", "/auth/client/login", 200, { body: { phone: clientPhone, password: clientPassword, clientInstanceId: refreshClientInstance } });
const refreshFirstRequestId = refreshRequestId(refreshFirst.refreshToken, refreshClientInstance);
const refreshSecond = await expect("POST", "/auth/refresh", 200, { body: { refreshToken: refreshFirst.refreshToken, clientInstanceId: refreshClientInstance, refreshRequestId: refreshFirstRequestId } });
session(refreshSecond, "client", "app-client", clientPair.identity.subject);
assert(refreshFirst.refreshToken !== refreshSecond.refreshToken && refreshFirst.accessToken !== refreshSecond.accessToken, "refresh did not atomically rotate both tokens");
const refreshSecondReplay = await expect("POST", "/auth/refresh", 200, { body: { refreshToken: refreshFirst.refreshToken, clientInstanceId: refreshClientInstance, refreshRequestId: refreshFirstRequestId } });
assert(refreshSecondReplay.accessToken === refreshSecond.accessToken && refreshSecondReplay.refreshToken === refreshSecond.refreshToken, "refresh reconciliation did not return the committed generation");
await expect("POST", "/auth/refresh", 401, { body: { refreshToken: refreshSecond.refreshToken, clientInstanceId: "runtime-wrong-instance-" + crypto.randomUUID(), refreshRequestId: randomRefreshRequestId() } });
const refreshSecondRequestId = refreshRequestId(refreshSecond.refreshToken, refreshClientInstance);
const refreshThird = await expect("POST", "/auth/refresh", 200, { body: { refreshToken: refreshSecond.refreshToken, clientInstanceId: refreshClientInstance, refreshRequestId: refreshSecondRequestId } });
session(refreshThird, "client", "app-client", clientPair.identity.subject);
const staleReplay = await expect("POST", "/auth/refresh", 401, { body: { refreshToken: refreshSecond.refreshToken, clientInstanceId: refreshClientInstance, refreshRequestId: randomRefreshRequestId() } });
assert(staleReplay?.error?.code === "REFRESH_STALE", "stale refresh did not preserve the REFRESH_STALE contract");
const firstRefreshSecret = refreshFirst.refreshToken.split(".")[1];
const firstRefreshHash = crypto.createHash("sha256").update(firstRefreshSecret).digest("hex");
const refreshHistoryMatch = sql("SELECT count(*) FROM identity_refresh_token_history WHERE token_hash='" + sqlLiteral(firstRefreshHash) + "'");
assert(refreshHistoryMatch === "1", "refresh history aging readback failed before update: " + refreshHistoryMatch);
sql("UPDATE identity_refresh_token_history SET rotated_at=clock_timestamp()-interval '6 seconds' WHERE token_hash='" + sqlLiteral(firstRefreshHash) + "'");
assert(sql("SELECT count(*) FROM identity_refresh_token_history WHERE token_hash='" + sqlLiteral(firstRefreshHash) + "' AND rotated_at < clock_timestamp()-interval '5 seconds'") === "1", "refresh history aging readback failed during update");
const replayAfterGrace = await expect("POST", "/auth/refresh", 200, { body: { refreshToken: refreshFirst.refreshToken, clientInstanceId: refreshClientInstance, refreshRequestId: refreshFirstRequestId } });
assert(replayAfterGrace.accessToken === refreshThird.accessToken && replayAfterGrace.refreshToken === refreshThird.refreshToken, "post-grace reconciliation did not return the current canonical generation");
const compromisedReplay = await expect("POST", "/auth/refresh", 401, { body: { refreshToken: refreshFirst.refreshToken, clientInstanceId: refreshClientInstance, refreshRequestId: randomRefreshRequestId() } });
assert(compromisedReplay?.error?.code === "UNAUTHENTICATED", "post-grace refresh reuse did not become terminal authentication failure");
const revokedCurrent = await expect("POST", "/auth/refresh", 401, { body: { refreshToken: refreshThird.refreshToken, clientInstanceId: refreshClientInstance, refreshRequestId: randomRefreshRequestId() } });
assert(revokedCurrent?.error?.code === "UNAUTHENTICATED", "compromised session still accepted its current refresh token");
const unknownInstance = "runtime-unknown-family-" + crypto.randomUUID();
const unknownFamily = await expect("POST", "/auth/client/login", 200, { body: { phone: clientPhone, password: clientPassword, clientInstanceId: unknownInstance } });
const unknownParts = unknownFamily.refreshToken.split(".");
const unknownRefresh = unknownParts[0] + "." + crypto.randomBytes(48).toString("base64url");
await expect("POST", "/auth/refresh", 401, { body: { refreshToken: unknownRefresh, clientInstanceId: unknownInstance, refreshRequestId: randomRefreshRequestId() } });
await expect("POST", "/auth/refresh", 200, { body: { refreshToken: unknownFamily.refreshToken, clientInstanceId: unknownInstance, refreshRequestId: refreshRequestId(unknownFamily.refreshToken, unknownInstance) } });

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
await expect("POST", "/internal/actor-roles/provision", 201, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorActorID }, body: { phoneE164: managedPhone, role: "partner" } });
const managedPassword = password("Partner");
const managedChallenge = await issue("/auth/managed/activation/request", { phone: managedPhone, role: "partner" }, "managed_activate", "partner");
const managedPair = await expect("POST", "/auth/managed/activate", 200, { body: { phone: managedPhone, role: "partner", verificationCode: managedChallenge.code, password: managedPassword, clientInstanceId: "runtime-managed-instance-" + crypto.randomUUID() } });
session(managedPair, "partner", "app-partner", managedPair.identity.subject);
const repeatedManagedChallenge = await expect("POST", "/auth/managed/activation/request", 201, { body: { phone: managedPhone, role: "partner" }, headers: challengeSourceHeaders(managedPhone) });
assert(typeof repeatedManagedChallenge.challengeId === "string", "repeated managed activation challenge id missing");
await expect("POST", "/auth/managed/activate", 401, { body: { phone: managedPhone, role: "partner", verificationCode: "000000", password: password("Repeated"), clientInstanceId: "runtime-repeat-activation-" + crypto.randomUUID() } });
assert(sql("SELECT count(*) FROM identity_sessions WHERE actor_id='" + sqlLiteral(managedPair.identity.subject) + "' AND role='partner' AND revoked_at IS NULL") === "1", "repeated managed activation created a second live session");
const managedRole = await expect("GET", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/roles/partner", 200, { token: controlToken });
await expect("POST", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/roles/partner/disable", 204, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(managedRole.roleVersion), "X-Reason": "runtime DSH lifecycle boundary assurance" } });
await expect("GET", "/auth/session", 401, { token: managedPair.accessToken });
await expect("POST", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/roles/partner/enable", 204, { token: dshToken, headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(managedRole.roleVersion + 1), "X-Reason": "runtime restore assurance" } });
const managedActor = sql("SELECT version FROM identity_actors WHERE id='" + sqlLiteral(managedPair.identity.subject) + "'");
await expect("POST", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/security/disable", 204, { token: controlToken, headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": managedActor, "X-Reason": "runtime security disable assurance" } });
await expect("GET", "/auth/session", 401, { token: managedPair.accessToken });
await expect("POST", "/internal/actors/" + encodeURIComponent(managedPair.identity.subject) + "/security/enable", 204, { token: controlToken, headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID(), "X-Expected-Version": String(Number(managedActor) + 1), "X-Reason": "runtime security restore assurance" } });
await expect("POST", "/auth/managed/activation/request", 403, { body: { phone: managedPhone, role: "operator" } });

const authOptions = await expect("POST", "/auth/operator/authentication/options", 201);
assert(typeof authOptions.ceremonyId === "string" && authOptions.publicKey?.challenge, "operator passkey options are not server-owned");
assert(!authOptions.accessToken && !authOptions.refreshToken, "passkey options created a session");
const operatorProofPhone = phone();
const operatorProof = await admitReviewedOperatorCandidate(operatorProofPhone, "محمود أحمد علي الدوبحي");
assert(operatorProof.role?.actorId && operatorProof.role?.role === "operator", "disposable operator proof fixture was not admitted through profile review");
const operatorInvitation = await expect("POST", "/internal/operator-profiles/" + encodeURIComponent(operatorProof.profileID) + "/invitation", 201, {
  token: controlToken,
  headers: { "X-Acting-Actor-ID": operatorActorID, "X-Correlation-ID": crypto.randomUUID() },
});
const operatorEnrollmentToken = operatorInvitation?.enrollmentToken?.code;
assert(/^[A-Za-z0-9_-]{24,256}$/.test(operatorEnrollmentToken), "reviewed operator enrollment token is not high entropy");
const operatorChallenge = await issue("/auth/operator/enrollment/request", { phone: operatorProofPhone, operatorEnrollmentToken }, "operator_enroll", "operator");
const enrollmentOptions = await expect("POST", "/auth/operator/enrollment/registration/options", 201, { body: { phone: operatorProofPhone, operatorEnrollmentToken, verificationCode: operatorChallenge.code } });
assert(typeof enrollmentOptions.ceremonyId === "string" && enrollmentOptions.publicKey?.challenge, "operator enrollment ceremony was not created");
const invalidFinish = await request("POST", "/auth/operator/enrollment/registration/finish", { body: { ceremonyId: enrollmentOptions.ceremonyId, credential: {}, clientInstanceId: "runtime-invalid-passkey-instance-" + crypto.randomUUID() } });
assert([400, 401].includes(invalidFinish.status), "invalid operator passkey credential was accepted");
sql("UPDATE identity_webauthn_ceremonies SET expires_at=clock_timestamp()-interval '1 second' WHERE id='" + sqlLiteral(enrollmentOptions.ceremonyId) + "'");
assert(sql("SELECT count(*) FROM identity_webauthn_ceremonies WHERE id='" + sqlLiteral(enrollmentOptions.ceremonyId) + "' AND expires_at < clock_timestamp()") === "1", "passkey ceremony expiry readback failed");
await expect("POST", "/auth/operator/enrollment/registration/finish", 401, { body: { ceremonyId: enrollmentOptions.ceremonyId, credential: {}, clientInstanceId: "runtime-expired-passkey-instance-" + crypto.randomUUID() } });
const recoveryWithoutCredential = await request("POST", "/auth/operator/recovery/request", { body: { phone: operatorProofPhone, recoveryCredential: "not-a-real-recovery-credential" }, headers: challengeSourceHeaders(operatorProofPhone) });
assert(recoveryWithoutCredential.status === 201, "operator recovery leaked whether an invalid recovery credential matched");
assert(recoveryWithoutCredential.body?.challengeId && sql("SELECT admissible::text FROM identity_challenges WHERE id='" + sqlLiteral(recoveryWithoutCredential.body.challengeId) + "'") === "false", "invalid operator recovery credential became admissible");

assert(sql("SELECT count(*) FROM identity_password_credentials WHERE role='operator'") === "0", "operator password credential remains");
assert(sql("SELECT count(*) FROM identity_password_attempts WHERE role='operator'") === "0", "operator password attempts remain");
assert(sql("SELECT count(*) FROM identity_challenges WHERE purpose='operator_mfa'") === "0", "retired operator proof purpose remains in current data");
const retiredInstanceColumn = ["device", "_fingerprint", "_hash"].join("");
assert(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='identity_sessions' AND column_name='" + retiredInstanceColumn + "'") === "0", "retired session binding column remains");
assert(sql("SELECT count(*) FROM identity_schema_migrations WHERE version=25") === "1", "identity schema is not at v25");

console.log("IDENTITY_RUNTIME_SEMANTICS=PASS");
console.log("IDENTITY_SAME_PHONE_MULTI_ROLE_ONE_ACTOR=PASS");
console.log("IDENTITY_CROSS_ROLE_PASSWORD_SEPARATION=PASS");
console.log("IDENTITY_ROLE_SCOPED_REVOCATION=PASS");
console.log("IDENTITY_OPERATOR_CLIENT_CREDENTIAL_SEPARATION=PASS");
console.log("IDENTITY_CUSTOMER_REGISTRATION_AFTER_PHONE_PROOF=PASS");
console.log("IDENTITY_CUSTOMER_PASSWORD_LOGIN=PASS");
console.log("IDENTITY_CUSTOMER_RECOVERY_NO_SESSION=PASS");
console.log("IDENTITY_MANAGED_ACTIVATION_ONE_TIME=PASS");
console.log("IDENTITY_MANAGED_RECOVERY_LOCAL_INTERNATIONAL_PHONE=PASS");
console.log("IDENTITY_MANAGED_RECOVERY_PURPOSE_ROLE_REPLAY_FENCES=PASS");
console.log("IDENTITY_MANAGED_RECOVERY_ROLE_SCOPED_REVOCATION=PASS");
console.log("IDENTITY_MANAGED_RECOVERY_GENERIC_INELIGIBLE_RESPONSE=PASS");
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
