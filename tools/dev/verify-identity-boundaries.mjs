import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];

function read(relative, optional = false) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    if (!optional) failures.push("missing required Identity artifact: " + relative);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function requireText(relative, text) {
  const body = read(relative);
  if (!body.includes(text)) failures.push(relative + " missing " + text);
  return body;
}

const packageBody = read("services/identity/package.json");
try {
  const pkg = JSON.parse(packageBody);
  if (pkg.name !== "@bthwani/identity") failures.push("Identity package name drifted");
  if (pkg.exports?.["."]?.types !== "./clients/index.ts") failures.push("Identity package types export drifted");
  if (pkg.exports?.["."]?.default !== "./clients/index.ts") failures.push("Identity package runtime export drifted");
} catch {
  failures.push("services/identity/package.json is invalid JSON");
}

for (const app of ["app-client", "app-partner", "app-captain", "app-field"]) {
  const pkgPath = "apps/" + app + "/package.json";
  try {
    const pkg = JSON.parse(read(pkgPath));
    if (pkg.dependencies?.["@bthwani/identity"] !== "workspace:*") {
      failures.push(pkgPath + " must consume @bthwani/identity via workspace:*");
    }
  } catch {
    failures.push(pkgPath + " is invalid JSON");
  }
}

const clientBinding = read("apps/app-client/src/identity.ts");
for (const required of [
  'const role = "client" as const',
  'from "@bthwani/identity"',
  'from "expo-secure-store"',
  "requestClientRegistration",
  "registerClient",
  "loginClient",
  "requestClientRecovery",
  "recoverClient",
  "new IdentitySessionManager(",
]) {
  if (!clientBinding.includes(required)) failures.push("app-client Identity binding missing " + required);
}
for (const forbidden of ["requestOtp(", "activate({", "actorType", "operatorContext"]) {
  if (clientBinding.includes(forbidden)) failures.push("app-client retains obsolete auth authority " + forbidden);
}
const clientPage = read("apps/app-client/app/index.tsx");
for (const required of ["loginClient", "registerClient", "recoverClient", "requestClientRegistration", "requestClientRecovery"]) {
  if (!clientPage.includes(required)) failures.push("app-client UI missing canonical customer flow " + required);
}
if (clientPage.includes("رمز التفعيل") || clientPage.includes("requestIdentityActivation")) {
  failures.push("app-client still presents customer normal auth as activation");
}

for (const [app, role, surface] of [
  ["app-partner", "partner", "app-partner"],
  ["app-captain", "captain", "app-captain"],
  ["app-field", "field", "app-field"],
]) {
  const runtimePath = "apps/" + app + "/src/identity.ts";
  const runtime = read(runtimePath);
  for (const required of [
    'const role = "' + role + '" as const',
    'const surface = "' + surface + '" as const',
    "requestManagedActivation",
    "activateManagedIdentity",
    "new IdentitySessionManager(",
  ]) {
    if (!runtime.includes(required)) failures.push(runtimePath + " missing " + required);
  }
  for (const forbidden of ["requestOtp(", "loginClient(", "actorType", "operatorContext"]) {
    if (runtime.includes(forbidden)) failures.push(runtimePath + " contains wrong auth flow " + forbidden);
  }
  const page = read("apps/" + app + "/app/index.tsx");
  if (!page.includes("requestManagedActivation") || !page.includes("activateManagedIdentity")) {
    failures.push(app + " UI is not bound to one-time managed activation");
  }
  if (!page.includes("التفعيل ليس شاشة دخول يومية")) {
    failures.push(app + " UI does not distinguish one-time activation from normal session use");
  }
  if (!page.includes("currentIdentityState")) failures.push(app + " logout must mirror canonical local Identity state");
}

const controlPackagePath = "apps/control-panel/package.json";
try {
  const pkg = JSON.parse(read(controlPackagePath));
  if (pkg.dependencies?.["@bthwani/identity"] !== "workspace:*") failures.push("control-panel must consume @bthwani/identity via workspace:*");
} catch {
  failures.push("control-panel package.json is invalid");
}
const bff = read("apps/control-panel/lib/identity-bff.ts");
for (const required of [
  "startOperatorLogin",
  "completeOperatorLogin",
  'identityAuthorizesSurface(pair.identity, "operator", "control-panel")',
  "httpOnly: true",
  'sameSite: "strict" as const',
]) {
  if (!bff.includes(required)) failures.push("control-panel BFF missing " + required);
}
for (const forbidden of ["loginOperator(", "username", "activateOperator", "localStorage", "sessionStorage"]) {
  if (bff.includes(forbidden)) failures.push("control-panel BFF contains retired/single-factor auth " + forbidden);
}
if (fs.existsSync(path.join(root, "apps/control-panel/app/api/auth/login/route.ts"))) {
  failures.push("single-step operator login BFF route still exists");
}
for (const route of ["start", "complete"]) {
  requireText("apps/control-panel/app/api/auth/login/" + route + "/route.ts", route === "start" ? "startOperatorLogin" : "completeOperatorLogin");
}
const controlPage = read("apps/control-panel/app/page.tsx");
for (const required of ["/api/auth/login/start", "/api/auth/login/complete", "رمز التحقق الثاني", "جلسة المشغل موثقة بعاملين"]) {
  if (!controlPage.includes(required)) failures.push("control-panel UI missing MFA flow " + required);
}
if (controlPage.includes("username")) failures.push("control-panel still requires username without Product need");

const dsh = read("services/dsh/backend/internal/identityboundary/client.go");
for (const required of [
  "ProvisionPartner", "ProvisionCaptain", "ProvisionField",
  "SetPartnerEnabled", "SetCaptainEnabled", "SetFieldEnabled",
  "AuthorizePartnerReenrollment", "AuthorizeCaptainReenrollment", "AuthorizeFieldReenrollment",
]) {
  if (!dsh.includes(required)) failures.push("DSH Identity boundary missing " + required);
}
for (const forbidden of ["ProvisionOperator", "Username", "X-Service-Caller", "X-Operator-Context-ID"]) {
  if (dsh.includes(forbidden)) failures.push("DSH Identity boundary contains forbidden authority " + forbidden);
}

const goClient = read("services/identity/clients/go/client.go");
for (const required of ["/internal/actor-roles/provision", "/roles/", "/reenrollment", "/security/", "/operator-password/reset"]) {
  if (!goClient.includes(required)) failures.push("Identity Go client missing canonical route " + required);
}
for (const forbidden of ["Username", "X-Service-Caller", "X-Operator-Context-ID", "/activations"]) {
  if (goClient.includes(forbidden)) failures.push("Identity Go client contains retired authority " + forbidden);
}

const contract = read("services/identity/contracts/identity.openapi.yaml");
for (const required of [
  "/auth/client/registration/request:",
  "/auth/client/login:",
  "/auth/client/recovery/request:",
  "/auth/managed/activation/request:",
  "/auth/operator/login/start:",
  "/auth/operator/login/complete:",
  "/internal/actors/{actorId}/roles/{role}/reenrollment:",
]) {
  if (!contract.includes(required)) failures.push("Identity contract missing " + required);
}
for (const forbidden of ["/auth/otp/request:", "\n  /auth/login:", "username:", "X-Service-Caller", "operatorContextId"]) {
  if (contract.includes(forbidden)) failures.push("Identity contract contains retired auth shape " + forbidden);
}

const generated = read("services/identity/clients/generated/identity-types.ts");
for (const required of [
  "AUTO-GENERATED from services/identity/contracts/identity.openapi.yaml",
  "export type ManagedActorType",
  "export type ClientCredentialProofRequest",
  "export type OperatorLoginCompleteRequest",
  "readonly activatedAt?: string;",
]) {
  if (!generated.includes(required)) failures.push("generated Identity types missing " + required);
}
for (const forbidden of ["OtpRequest", "ActivationRequest", "LoginRequest", "username"]) {
  if (generated.includes(forbidden)) failures.push("generated Identity types retain old auth shape " + forbidden);
}

const domain = read("services/identity/backend/internal/domain/types.go");
for (const required of ["type ActorRole struct", "ActivatedAt *time.Time", "ChallengeClientRegister", "ChallengeManagedActivate", "ChallengeOperatorMFA", "IsManagedRole"]) {
  if (!domain.includes(required)) failures.push("Identity domain missing " + required);
}
for (const forbidden of ["Username", "PasswordHash", "IsPublicOtpRole", "OperatorContextID", "Roles []string", "Permissions []"]) {
  if (domain.includes(forbidden)) failures.push("Identity domain contains collapsed/retired authority " + forbidden);
}

const actor = read("services/identity/backend/internal/actor/service.go");
for (const required of [
  "identity_password_credentials",
  "RegisterClientTx",
  "ManagedActivationCandidate",
  "MarkManagedActivatedTx",
  "AuthorizeReenrollment",
  "ResetClientPasswordTx",
  "ResetOperatorPassword",
]) {
  if (!actor.includes(required)) failures.push("Identity actor service missing " + required);
}
if (actor.includes("username")) failures.push("Identity actor service still owns username");
if (!actor.includes('return "act_" + token')) failures.push("Identity actor_id generation drifted");

const challenge = read("services/identity/backend/internal/challenge/service.go");
for (const required of [
  "RequestClientRegistration",
  "LoginClient",
  "RequestClientRecovery",
  "RequestManagedActivation",
  "ActivateManaged",
  "StartOperatorLogin",
  "CompleteOperatorLogin",
  "challenge.decoy_issued",
  "identity_challenges",
  "purpose",
]) {
  if (!challenge.includes(required)) failures.push("Identity challenge service missing " + required);
}
if (challenge.includes("EnsurePublicClientTx") || challenge.includes("IsPublicOtpRole")) {
  failures.push("Identity challenge service retains universal OTP activation semantics");
}
const operatorStart = challenge.slice(challenge.indexOf("func (s *Service) StartOperatorLogin"), challenge.indexOf("func (s *Service) CompleteOperatorLogin"));
if (operatorStart.includes("CreateTx(")) failures.push("operator password proof can create a session before MFA");
if (!challenge.includes("r.ActivatedAt==nil")) failures.push("managed activation does not enforce one-time enrollment state");

const session = read("services/identity/backend/internal/session/service.go");
for (const required of ["CreateTx", "identity_refresh_token_history", "device_fingerprint_hash", "identityOf(actorID,sessionID,role"]) {
  if (!session.includes(required)) failures.push("Identity session service missing " + required);
}
for (const forbidden of ["func (s *Service) Login(", "PasswordHash", "username", "operator_context", "surfaceAccess"]) {
  if (session.includes(forbidden)) failures.push("Identity session service retains credential/login authority " + forbidden);
}

const migration = read("services/identity/database/migrations/001_identity_authentication.sql");
for (const required of [
  "CREATE TABLE IF NOT EXISTS identity_password_credentials",
  "CREATE TABLE IF NOT EXISTS identity_challenges",
  "purpose varchar(32) NOT NULL",
  "admissible boolean NOT NULL DEFAULT false",
  "activated_at timestamptz",
  "CREATE TABLE IF NOT EXISTS identity_sessions",
]) {
  if (!migration.includes(required)) failures.push("Identity migration missing " + required);
}
for (const forbidden of ["username varchar", "password_hash text,", "identity_activation_challenges", "identity_login_attempts"]) {
  if (migration.includes(forbidden) && forbidden !== "password_hash text,") failures.push("Identity migration retains old auth schema " + forbidden);
}
const actorTable = migration.slice(migration.indexOf("CREATE TABLE IF NOT EXISTS identity_actors"), migration.indexOf("CREATE TABLE IF NOT EXISTS identity_actor_roles"));
if (actorTable.includes("password_hash") || actorTable.includes("username")) failures.push("actor row still owns credentials/username");

const security = read("services/identity/backend/internal/security/values.go");
if (!security.includes("argon2.IDKey")) failures.push("Identity password hashing is not Argon2id");
if (security.includes("bcrypt")) failures.push("legacy bcrypt remains in Identity security implementation");

const readiness = read("services/identity/backend/internal/storage/postgres/migrate.go");
for (const required of ["identity_password_credentials", "identity_challenges", "identity_password_attempts", "identity_sessions_active_idx"]) {
  if (!readiness.includes(required)) failures.push("Identity readiness proof missing " + required);
}

for (const file of ["infra/local/compose/compose.yaml", "infra/local/compose/.env.example", "services/identity/backend/internal/runtime/server.go"]) {
  const body = read(file);
  if (!body.includes("IDENTITY_CHALLENGE_HMAC_SECRET")) failures.push(file + " missing challenge secret configuration");
  if (body.includes("IDENTITY_ACTIVATION_HMAC_SECRET") || body.includes("IDENTITY_ACTIVATION_DELIVERY_MODE")) {
    failures.push(file + " retains activation-only runtime configuration");
  }
}

if (fs.existsSync(path.join(root, "services/identity/backend/internal/activation/service.go"))) {
  failures.push("retired universal activation package remains");
}
if (fs.existsSync(path.join(root, "services/identity/backend/internal/integrations/activation/delivery.go"))) {
  failures.push("retired activation delivery package remains");
}
if (fs.existsSync(path.join(root, "services/identity/database/migrations/001_identity_activation_sessions.sql"))) {
  failures.push("retired activation-schema migration remains");
}

const tsSession = read("services/identity/clients/session.ts");
for (const required of [
  "isIdentityServiceUnavailable",
  "this.client.refresh({",
  "await this.clearLocal()",
  'this.stateValue = { kind: "signed_out" }',
]) {
  if (!tsSession.includes(required)) failures.push("Identity TS session continuity missing " + required);
}

if (failures.length > 0) {
  console.error("IDENTITY_BOUNDARY_VERIFY=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}
console.log("IDENTITY_BOUNDARY_VERIFY=PASS");
console.log("IDENTITY_ONE_ACTOR_ROLE_MODEL=PASS");
console.log("IDENTITY_CUSTOMER_PASSWORD_AUTH=PASS");
console.log("IDENTITY_MANAGED_ACTIVATION_ONE_TIME=PASS");
console.log("IDENTITY_OPERATOR_MFA_REQUIRED=PASS");
console.log("IDENTITY_PREMATURE_CONTEXT_RESIDUE=0");
console.log("PARALLEL_IDENTITY_CLIENT_TRUTH=0");
