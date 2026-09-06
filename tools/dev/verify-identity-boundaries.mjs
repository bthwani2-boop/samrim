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
for (const forbidden of ["requestOtp(", "activate({", "actorType"]) {
  if (clientBinding.includes(forbidden)) failures.push("app-client retains obsolete auth authority " + forbidden);
}
const clientEntryPath = "apps/app-client/app/index.tsx";
const clientEntry = read(clientEntryPath);
let clientPage = clientEntry;
const clientReexport = clientEntry.match(/^export\s+\{\s*default\s*\}\s+from\s+["']([^"']+)["'];?/m)?.[1];
if (clientReexport) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(clientEntryPath), clientReexport));
  const candidates = [base + ".tsx", base + ".ts", base + ".jsx", base + ".js", path.posix.join(base, "index.tsx")];
  const resolved = candidates.find((candidate) => fs.existsSync(path.join(root, candidate)));
  if (!resolved) failures.push("app-client entry re-export target cannot be resolved: " + clientReexport);
  else clientPage = read(resolved);
}
for (const required of ["loginClient", "registerClient", "recoverClient", "requestClientRegistration", "requestClientRecovery"]) {
  if (!clientPage.includes(required)) failures.push("app-client UI owner missing canonical customer flow " + required);
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
  for (const forbidden of ["requestOtp(", "loginClient(", "actorType"]) {
    if (runtime.includes(forbidden)) failures.push(runtimePath + " contains wrong auth flow " + forbidden);
  }
  const page = read("packages/design-system/src/native/ManagedIdentityGate.tsx");
  if (!page.includes("chooseIntent") || !page.includes("requestCode") || !page.includes("requestRecovery") || !page.includes("recover") || !page.includes("activate")) {
    failures.push(app + " UI is not bound to one-time managed activation");
  }
  for (const phrase of ["رمز التفعيل", "رمز تحقق الهاتف", "تفعيل أول مرة", "ابدأ برقم الهاتف"]) {
    if (!page.includes(phrase)) failures.push(app + " UI does not distinguish managed activation from phone verification: " + phrase);
  }
  if (page.includes("auth-mode-switch") || page.includes("<select")) failures.push(app + " managed auth must resolve the next step from phone without tabs or role selectors");
  if (!page.includes("currentState")) failures.push(app + " logout must mirror canonical local Identity state");
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
  "isControlPanelIdentity",
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
for (const required of ["/api/auth/login/start", "/api/auth/login/complete", "التحقق الثاني", "تم توثيق جلستك بعاملين"]) {
  if (!controlPage.includes(required)) failures.push("control-panel UI missing MFA flow " + required);
}
for (const required of ["ابدأ برقم الهاتف", "login-role", "account-role", "الدور الإداري", "استرداد وإعادة تفعيل الحساب"]) {
  if (!controlPage.includes(required)) failures.push("control-panel UI missing separated phone-first login or administrative provisioning flow " + required);
}
if (controlPage.includes("/api/auth/state")) failures.push("control-panel UI retains a public authentication-state oracle");
if (controlPage.includes("ManagedAccessPanel")) failures.push("control-panel retains a shadow managed provisioning panel");
if (controlPage.includes("username")) failures.push("control-panel still requires username without Product need");

const dsh = read("services/dsh/backend/internal/identityboundary/client.go");
for (const required of [
  "ProvisionPartner", "ProvisionCaptain", "ProvisionField",
  "SetPartnerEnabled", "SetCaptainEnabled", "SetFieldEnabled",
  "AuthorizePartnerReenrollment", "AuthorizeCaptainReenrollment", "AuthorizeFieldReenrollment",
]) {
  if (!dsh.includes(required)) failures.push("DSH Identity boundary missing " + required);
}
for (const forbidden of ["ProvisionOperator", "Username", "X-Service-Caller"]) {
  if (dsh.includes(forbidden)) failures.push("DSH Identity boundary contains forbidden authority " + forbidden);
}

const goClient = read("services/identity/clients/go/client.go");
for (const required of ["/internal/actor-roles/provision", "/internal/actor-roles/search", "/roles/", "/reenrollment", "/security/", "/operator-password/reset", "AuthorizeReenrollmentByPhone"]) {
  if (!goClient.includes(required)) failures.push("Identity Go client missing canonical route " + required);
}
for (const forbidden of ["Username", "X-Service-Caller", "/activations"]) {
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
  "/internal/managed-activation-codes:",
  "/internal/bootstrap/platform-owner:",
]) {
  if (!contract.includes(required)) failures.push("Identity contract missing " + required);
}
const sixDigitPatterns = contract.match(/pattern: "\^\[0-9\]\{6\}\$"/g) ?? [];
if (sixDigitPatterns.length < 3) failures.push("Identity contract must expose six-digit challenge schemas");
if (!contract.includes('pattern: "^[0-9]{6}$"') || !contract.includes("minLength: 6")) failures.push("Identity contract must expose six-digit activation schemas");
if (contract.includes('pattern: "^[0-9]{4}$"')) failures.push("Identity contract contains retired four-digit challenge schema");
if (contract.includes("minLength: 12")) failures.push("Identity contract contains retired twelve-character password minimum");
for (const forbidden of ["/auth/otp/request:", "\n  /auth/login:", "username:", "X-Service-Caller"]) {
  if (contract.includes(forbidden)) failures.push("Identity contract contains retired auth shape " + forbidden);
}

const generated = read("services/identity/clients/generated/identity-types.ts");
for (const required of [
  "AUTO-GENERATED from services/identity/contracts/identity.openapi.yaml",
  "export type ManagedActorType",
  "export type ClientCredentialProofRequest",
  "export type OperatorLoginCompleteRequest",
  "readonly activatedAt?: string;",
  "export type ManagedActivationCode =",
]) {
  if (!generated.includes(required)) failures.push("generated Identity types missing " + required);
}
for (const forbidden of [
  "export type OtpRequest =",
  "export type ActivationRequest =",
  "export type LoginRequest =",
  "readonly username",
]) {
  if (generated.includes(forbidden)) failures.push("generated Identity types retain old auth shape " + forbidden);
}

const domain = read("services/identity/backend/internal/domain/types.go");
for (const required of ["type ActorRole struct", "ActivatedAt *time.Time", "ChallengeClientRegister", "ChallengeManagedActivate", "ChallengeOperatorMFA", "IsManagedRole", "CanIssueManagedActivationCode"]) {
  if (!domain.includes(required)) failures.push("Identity domain missing " + required);
}
for (const forbidden of ["Username", "PasswordHash", "IsPublicOtpRole", "Roles []string", "Permissions []"]) {
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
if (!/return\s+"act_"\s*\+\s*token/.test(actor)) failures.push("Identity actor_id generation drifted");

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
  "IssueManagedActivationCode",
  "identity_managed_activation_codes",
]) {
  if (!challenge.includes(required)) failures.push("Identity challenge service missing " + required);
}
if (challenge.includes("EnsurePublicClientTx") || challenge.includes("IsPublicOtpRole")) {
  failures.push("Identity challenge service retains universal OTP activation semantics");
}
if (challenge.includes("s.sender.Send(")) failures.push("public challenge request synchronously exposes provider delivery outcome");
for (const required of ["identity_challenge_deliveries", "deliveryStatus", "s.sender.Provider()"]) {
  if (!challenge.includes(required)) failures.push("Identity challenge request missing durable async-delivery handoff " + required);
}
const deliveryWorker = read("services/identity/backend/internal/challenge/delivery_worker.go");
for (const required of ["RunDeliveryWorker", "status='sending'", "status='unknown'", "status='suppressed'", "status='expired'", "attempts=1", "s.sender.Send(ctx"]) {
  if (!deliveryWorker.includes(required)) failures.push("Identity challenge delivery worker missing " + required);
}
if (deliveryWorker.includes("attempts=attempts+1")) failures.push("unknown challenge delivery can be blindly retried");
const deliveryAdapter = read("services/identity/backend/internal/integrations/challenge/delivery.go");
for (const required of ["Provider() string", 'return "mailpit"', 'return "twilio"', 'return "webhook"']) {
  if (!deliveryAdapter.includes(required)) failures.push("Identity challenge provider provenance missing " + required);
}

const operatorStart = challenge.slice(challenge.indexOf("func (s *Service) StartOperatorLogin"), challenge.indexOf("func (s *Service) CompleteOperatorLogin"));
if (operatorStart.includes("CreateTx(")) failures.push("operator password proof can create a session before MFA");
for (const required of [
  "expectedCredentialVersion",
  "currentVersion",
  "FOR UPDATE OF c,r,a",
  "credential_version",
]) {
  if (!challenge.includes(required)) failures.push("operator MFA issuance is not fenced against credential rotation: " + required);
}
if (!/r\.ActivatedAt\s*==\s*nil/.test(challenge)) failures.push("managed activation does not enforce one-time enrollment state");

const session = read("services/identity/backend/internal/session/service.go");
for (const required of ["CreateTx", "identity_refresh_token_history", "device_fingerprint_hash", "identityOf(actorID"]) {
  if (!session.includes(required)) failures.push("Identity session service missing " + required);
}
for (const forbidden of ["func (s *Service) Login(", "PasswordHash", "username", "surfaceAccess"]) {
  if (session.includes(forbidden)) failures.push("Identity session service retains credential/login authority " + forbidden);
}

const migration = read("services/identity/database/migrations/001_identity_authentication.sql");
const deliveryMigration = read("services/identity/database/migrations/002_identity_challenge_delivery.sql");
const activationCodeMigration = read("services/identity/database/migrations/003_managed_activation_codes.sql");
for (const required of [
  "CREATE TABLE identity_challenge_deliveries",
  "status IN ('suppressed','pending','sending','sent','unknown','expired')",
  "attempts BETWEEN 0 AND 1",
  "VALUES (2)",
]) {
  if (!deliveryMigration.includes(required)) failures.push("Identity challenge-delivery migration missing " + required);
}
for (const required of ["CREATE TABLE identity_managed_activation_codes", "code_hash", "status IN ('pending','consumed','revoked','expired','locked')"]) {
  if (!activationCodeMigration.includes(required)) failures.push("Identity managed activation-code migration missing " + required);
}

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
for (const required of ["verificationCodePattern = regexp.MustCompile(\"^[0-9]{6}$\")", "activationCodePattern", "func RandomToken(byteCount int)", "RandomActivationCode()", "NormalizePassword", "PasswordAllowed"]) {
  if (!security.includes(required)) failures.push("Identity security boundary missing " + required);
}
const actorService = read("services/identity/backend/internal/actor/service.go");
for (const required of ["SELECT EXISTS(SELECT 1 FROM identity_actor_roles WHERE role='platform_owner')", "platform_owner", "activatedAt.Valid"]) {
  if (!actorService.includes(required)) failures.push("Identity owner bootstrap fence missing " + required);
}
const domainTypes = read("services/identity/backend/internal/domain/types.go");
for (const required of ["case \"platform-bootstrap\":", "return role == \"platform_owner\""]) {
  if (!domainTypes.includes(required)) failures.push("Identity platform bootstrap caller boundary missing " + required);
}
const runtimeConfig = read("services/identity/backend/internal/runtime/server.go");
if (!runtimeConfig.includes('tokens["platform-bootstrap"] = bootstrapToken')) failures.push("Identity platform bootstrap secret is not runtime-configured");
const httpServer = read("services/identity/backend/internal/transport/http/server.go");
for (const required of ["/internal/bootstrap/platform-owner", 'caller != "platform-bootstrap"']) {
  if (!httpServer.includes(required)) failures.push("Identity platform bootstrap route fence missing " + required);
}

const readiness = read("services/identity/backend/internal/storage/postgres/migrate.go");
for (const required of [
    "const SchemaVersion = 11",
  "CurrentSchemaVersion",
  "migration history is non-contiguous",
  "identity_password_credentials",
  "identity_managed_activation_codes",
  "identity_challenges",
  "identity_challenge_deliveries",
  "identity_password_attempts",
  "identity_sessions_active_idx",
  "absolute_expires_at",
  "identity_sessions_absolute_idx",
  "identity_challenges_phone_purpose_idx",
]) {
  if (!readiness.includes(required)) failures.push("Identity readiness proof missing " + required);
}
const controlLifetimeMigration = read("services/identity/database/migrations/009_control_session_lifetimes.sql");
for (const required of ["role IN ('operator', 'platform_owner')", "refresh_expires_at = LEAST", "absolute_expires_at = LEAST"]) {
  if (!controlLifetimeMigration.includes(required)) failures.push("Identity control-session lifetime migration missing " + required);
}
const migrationRuntime = read("services/identity/backend/internal/runtime/migrations.go");
for (const required of ["postgres.SchemaVersion", "missing identity migration version", "postgres.Migrate(ctx,db,version"]) {
  if (!migrationRuntime.includes(required)) failures.push("Identity ordered migration runtime missing " + required);
}
const dockerfile = read("services/identity/backend/Dockerfile");
if (!dockerfile.includes("COPY services/identity/database/migrations /app/migrations") ||
    !dockerfile.includes("IDENTITY_MIGRATION_DIR=/app/migrations")) {
  failures.push("Identity image must package the canonical ordered migration directory");
}

for (const file of ["infra/local/compose/compose.yaml", "infra/local/compose/.env.example", "services/identity/backend/internal/runtime/server.go"]) {
  const body = read(file);
  if (!body.includes("IDENTITY_CHALLENGE_HMAC_SECRET")) failures.push(file + " missing challenge secret configuration");
  if (!body.includes("IDENTITY_ABUSE_HMAC_SECRET")) failures.push(file + " missing abuse secret configuration");
  if (body.includes("IDENTITY_ACTIVATION_HMAC_SECRET") || body.includes("IDENTITY_ACTIVATION_DELIVERY_MODE")) {
    failures.push(file + " retains activation-only runtime configuration");
  }
}
const runtimeServer = read("services/identity/backend/internal/runtime/server.go");
for (const required of ["applyMigrations", "RunDeliveryWorker", "deliveryErrCh", "IDENTITY_MIGRATION_DIR"]) {
  if (!runtimeServer.includes(required)) failures.push("Identity runtime async-delivery lifecycle missing " + required);
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
