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

function forbidText(relative, text) {
  const body = read(relative);
  if (body.includes(text)) failures.push(relative + " contains forbidden residue " + text);
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

for (const [app, role, surface] of [
  ["app-client", "client", "app-client"],
  ["app-partner", "partner", "app-partner"],
  ["app-captain", "captain", "app-captain"],
  ["app-field", "field", "app-field"],
]) {
  const pkgPath = "apps/" + app + "/package.json";
  try {
    const pkg = JSON.parse(read(pkgPath));
    if (pkg.dependencies?.["@bthwani/identity"] !== "workspace:*") {
      failures.push(pkgPath + " must consume @bthwani/identity via workspace:*");
    }
  } catch {
    failures.push(pkgPath + " is invalid JSON");
  }

  const runtimePath = "apps/" + app + "/src/identity.ts";
  const runtime = read(runtimePath);
  for (const required of [
    'from "@bthwani/identity"',
    'from "expo-secure-store"',
    'from "expo-crypto"',
    'const role = "' + role + '" as const',
    'const surface = "' + surface + '" as const',
    "new IdentitySessionManager(",
    "requestIdentityActivation",
    "requestOtp({ phone, role })",
  ]) {
    if (!runtime.includes(required)) failures.push(runtimePath + " missing " + required);
  }
  for (const forbidden of ["actorType", "operatorContext", "X-Service-Caller", "X-Operator-Context-ID"]) {
    if (runtime.includes(forbidden)) failures.push(runtimePath + " contains legacy authority " + forbidden);
  }

  const page = read("apps/" + app + "/app/index.tsx");
  if (!page.includes('from "../src/identity"')) failures.push(app + " UI bypasses its Identity host binding");
  if (!page.includes("currentIdentityState")) {
    failures.push(app + " UI must read canonical local Identity state after logout");
  }
  const mobileLogoutStart = page.indexOf("async function logout()");
  const mobileLogoutEnd = page.indexOf("\n  if (state.kind", mobileLogoutStart);
  const mobileLogoutBody = mobileLogoutStart >= 0
    ? page.slice(mobileLogoutStart, mobileLogoutEnd >= 0 ? mobileLogoutEnd : page.length)
    : "";
  const mobileLogoutFinally = mobileLogoutBody.indexOf("finally");
  const mobileLogoutStateSync = mobileLogoutBody.indexOf("setState(currentIdentityState());");
  if (
    mobileLogoutFinally < 0 ||
    mobileLogoutStateSync < 0 ||
    mobileLogoutStateSync < mobileLogoutFinally
  ) {
    failures.push(
      app + " logout must mirror canonical IdentitySessionManager state in finally after local-clear/remote-revoke outcome",
    );
  }
}

const controlPackagePath = "apps/control-panel/package.json";
try {
  const pkg = JSON.parse(read(controlPackagePath));
  if (pkg.dependencies?.["@bthwani/identity"] !== "workspace:*") {
    failures.push("control-panel must consume @bthwani/identity via workspace:*");
  }
} catch {
  failures.push("control-panel package.json is invalid");
}

const controlNextConfigCandidates = [
  "apps/control-panel/next.config.js",
  "apps/control-panel/next.config.mjs",
  "apps/control-panel/next.config.ts",
  "apps/control-panel/next.config.mts",
].filter((relative) => fs.existsSync(path.join(root, relative)));
if (
  controlNextConfigCandidates.length !== 1 ||
  controlNextConfigCandidates[0] !== "apps/control-panel/next.config.mjs"
) {
  failures.push(
    "control-panel must have one canonical Next config at apps/control-panel/next.config.mjs",
  );
}
const controlNextConfig = read("apps/control-panel/next.config.mjs");
if (!controlNextConfig.includes('transpilePackages: ["@bthwani/identity"]')) {
  failures.push("control-panel Next config must transpile the canonical Identity package");
}

const bff = read("apps/control-panel/lib/identity-bff.ts");
for (const required of [
  'from "@bthwani/identity"',
  'httpOnly: true',
  'sameSite: "strict" as const',
  'identityAuthorizesSurface(pair.identity, "operator", "control-panel")',
  'identityAuthorizesSurface(identity, "operator", "control-panel")',
  "loginOperator",
]) {
  if (!bff.includes(required)) failures.push("control-panel Identity BFF missing " + required);
}
for (const forbidden of ["activateOperator", "localStorage", "sessionStorage", "actorType", "operatorContext"]) {
  if (bff.includes(forbidden)) failures.push("control-panel Identity BFF contains forbidden residue " + forbidden);
}
if (fs.existsSync(path.join(root, "apps/control-panel/app/api/auth/activate/route.ts"))) {
  failures.push("operator OTP BFF route still exists");
}
for (const route of ["login", "session", "logout"]) {
  requireText("apps/control-panel/app/api/auth/" + route + "/route.ts", "identity-bff");
}

const controlPage = read("apps/control-panel/app/page.tsx");
const controlLogoutStart = controlPage.indexOf("async function logout()");
const controlLogoutEnd = controlPage.indexOf("\n  if (view.kind", controlLogoutStart);
const controlLogoutBody = controlLogoutStart >= 0
  ? controlPage.slice(controlLogoutStart, controlLogoutEnd >= 0 ? controlLogoutEnd : controlPage.length)
  : "";
const controlLogoutFetch = controlLogoutBody.indexOf('fetch("/api/auth/logout"');
const controlSignedOutTransition = controlLogoutBody.indexOf('setView({ kind: "signed_out" });');
const controlFailedResponseBranch = controlLogoutBody.indexOf("if (!response.ok)");
if (
  controlLogoutFetch < 0 ||
  controlSignedOutTransition < 0 ||
  controlFailedResponseBranch < 0 ||
  !(controlLogoutFetch < controlSignedOutTransition && controlSignedOutTransition < controlFailedResponseBranch)
) {
  failures.push(
    "control-panel logout must converge to signed_out after the BFF response before reporting remote revocation failure",
  );
}

const bffLogoutStart = bff.indexOf("export async function logoutOperator()");
const bffLogoutEnd = bff.indexOf("\nexport function identityHttpStatus", bffLogoutStart);
const bffLogoutBody = bffLogoutStart >= 0
  ? bff.slice(bffLogoutStart, bffLogoutEnd >= 0 ? bffLogoutEnd : bff.length)
  : "";
if (!bffLogoutBody.includes("finally") || !bffLogoutBody.includes("await clearOperatorCookies()")) {
  failures.push("control-panel BFF logout must clear local cookies regardless of remote revocation result");
}

const dsh = read("services/dsh/backend/internal/identityboundary/client.go");
for (const required of [
  "ProvisionPartner",
  "ProvisionCaptain",
  "ProvisionField",
  "SetPartnerEnabled",
  "SetCaptainEnabled",
  "SetFieldEnabled",
]) {
  if (!dsh.includes(required)) failures.push("DSH Identity boundary missing " + required);
}
for (const forbidden of [
  "ProvisionOperator",
  "IssueActivation",
  "operatorContext",
  "ActorID",
  "Username",
  '"dsh"',
  "X-Service-Caller",
  "X-Operator-Context-ID",
]) {
  if (dsh.includes(forbidden)) failures.push("DSH Identity boundary contains forbidden authority " + forbidden);
}

const dshMod = read("services/dsh/backend/go.mod");
if (!dshMod.includes("github.com/bthwani2-boop/samrim/services/identity/clients/go v0.0.0")) {
  failures.push("DSH Go module does not require canonical Identity Go client");
}
if (!dshMod.includes("../../identity/clients/go")) {
  failures.push("DSH Go module local Identity client replacement missing");
}

const goClient = read("services/identity/clients/go/client.go");
for (const route of ["/internal/actor-roles/provision", "/roles/", "/security/", "/operator-password/reset"]) {
  if (!goClient.includes(route)) failures.push("Identity Go client missing canonical route " + route);
}
for (const forbidden of [
  "X-Service-Caller",
  "X-Operator-Context-ID",
  "Idempotency-Key",
  "/internal/actors/provision",
  "/activations",
  "operatorContext",
]) {
  if (goClient.includes(forbidden)) failures.push("Identity Go client contains legacy authority " + forbidden);
}

const contract = read("services/identity/contracts/identity.openapi.yaml");
for (const required of [
  "/internal/actor-roles/provision:",
  "/internal/actors/{actorId}/roles/{role}/disable:",
  "/internal/actors/{actorId}/security/disable:",
  "/internal/actors/{actorId}/security/enable:",
  "/internal/actors/{actorId}/operator-password/reset:",
  "authenticated service token determines the caller",
  "Identity alone creates actor_id",
]) {
  if (!contract.includes(required)) failures.push("Identity contract missing " + required);
}
for (const forbidden of [
  "X-Service-Caller",
  "X-Operator-Context-ID",
  "operatorContextId",
  "IssueActivationRequest",
  "expectedActorType",
  "sessionSurface",
  "surfaceAccess",
  "ActorStatus:",
  "Permission:",
]) {
  if (contract.includes(forbidden)) failures.push("Identity contract contains legacy/premature authority " + forbidden);
}

const generated = read("services/identity/clients/generated/identity-types.ts");
if (!generated.includes("AUTO-GENERATED from services/identity/contracts/identity.openapi.yaml")) {
  failures.push("generated Identity types provenance header missing");
}
if (!generated.includes("readonly securityEnabled: boolean;")) {
  failures.push("generated Identity types missing global security eligibility");
}
for (const forbidden of ["ActorStatus", "Permission", "operatorContextId", "roles:", "surfaceAccess", "sessionSurface"]) {
  if (generated.includes(forbidden)) failures.push("generated Identity types contain legacy shape " + forbidden);
}

const domain = read("services/identity/backend/internal/domain/types.go");
for (const required of ["type ActorRole struct", "type ActorIdentity struct"]) {
  if (!domain.includes(required)) failures.push("Identity domain missing " + required);
}
if (!/type ActorRole struct\s*\{[\s\S]*?Role\s+string[\s\S]*?Enabled\s+bool[\s\S]*?\}/.test(domain)) {
  failures.push("Identity ActorRole must contain role and enabled fields");
}
for (const forbidden of ["OperatorContextID", "Roles []string", "Permissions []", "ActorStatus", "ProvisioningFingerprint", "CreatedByService"]) {
  if (domain.includes(forbidden)) failures.push("Identity domain contains collapsed actor authority " + forbidden);
}

const actor = read("services/identity/backend/internal/actor/service.go");
for (const required of ['return "act_" + token', "identity_actor_roles", "SetRoleEnabled", "SetSecurityEnabled", "ResetOperatorPassword"]) {
  if (!actor.includes(required)) failures.push("Identity actor service missing " + required);
}
for (const forbidden of ["requestedID", "operatorContextID", "roles,permissions", "provisioning_fingerprint", "created_by_service"]) {
  if (actor.includes(forbidden)) failures.push("Identity actor service contains legacy actor authority " + forbidden);
}

const session = read("services/identity/backend/internal/session/service.go");
if (!session.includes("currentPasswordHash != a.PasswordHash")) {
  failures.push("Identity login must reject a credential hash changed after pre-transaction verification");
}
for (const required of [
  "identity_actor_roles",
  "role,access_token_hash",
  "identityOf(actorID, sessionID, role",
  "identity_refresh_token_history",
]) {
  if (!session.includes(required)) failures.push("Identity session service missing " + required);
}
if (
  !session.includes(
    "WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL AND refresh_expires_at>clock_timestamp() ORDER BY created_at DESC",
  )
) {
  failures.push("Identity active-session readback must exclude refresh-expired sessions");
}
for (const forbidden of ["previous_refresh_token_hash", "operator_context", "surfaceAccess", "Roles:", "Permissions:"]) {
  if (session.includes(forbidden)) failures.push("Identity session service contains redundant/legacy state " + forbidden);
}

const activation = read("services/identity/backend/internal/activation/service.go");
const requestStart = activation.indexOf("func (s *Service) Request(");
const issueStart = activation.indexOf("func (s *Service) issue(", requestStart);
const requestBody = activation.slice(requestStart, issueStart);
if (requestBody.includes("EnsurePublicClient")) {
  failures.push("public OTP request must not create client actor before proof");
}
if (activation.includes("genericChallenge(")) {
  failures.push("OTP decoy responses must be persisted/rate-accounted rather than bypass throttling");
}
if (!activation.includes("activation.decoy_issued") || !activation.includes("if deliveryAllowed")) {
  failures.push("Identity OTP decoy path must be non-delivering and auditable");
}
const consumeStart = activation.indexOf("func (s *Service) Consume(");
const codeProofIndex = activation.indexOf("ConstantTimeHexEqual(codeHash, expected)", consumeStart);
const clientCreateIndex = activation.indexOf("EnsurePublicClientTx(ctx, tx, phone)", consumeStart);
if (codeProofIndex < 0 || clientCreateIndex < 0 || clientCreateIndex < codeProofIndex) {
  failures.push("client actor creation must happen only after valid OTP proof");
}
for (const required of [
  '"identity:otp-source:" + ipHash',
  '"identity:otp-phone:" + a.PhoneE164',
  "FindEnabledByPhoneRole",
  "QueryRowContext",
]) {
  if (!activation.includes(required)) failures.push("Identity activation service missing " + required);
}
for (const forbidden of ["IssueForActor", "idempotencyKey", "expectedActorType", "operatorContextID"]) {
  if (activation.includes(forbidden)) failures.push("Identity activation service contains obsolete governed-issuance semantics " + forbidden);
}

const security = read("services/identity/backend/internal/security/values.go");
if (!security.includes("argon2.IDKey")) failures.push("Identity password hashing is not Argon2id");
if (security.includes("bcrypt")) failures.push("legacy bcrypt remains in Identity security implementation");

const readiness = read("services/identity/backend/internal/storage/postgres/migrate.go");
for (const required of [
  "identitySchemaRequirements",
  "information_schema.columns",
  "pg_indexes",
  "required column missing",
  "required index missing",
  "identity_sessions_active_idx",
]) {
  if (!readiness.includes(required)) failures.push("Identity readiness proof missing " + required);
}

const migration = read("services/identity/database/migrations/001_identity_activation_sessions.sql");
for (const required of [
  "security_enabled boolean NOT NULL DEFAULT true",
  "CREATE TABLE IF NOT EXISTS identity_actor_roles",
  "PRIMARY KEY (actor_id, role)",
  "FOREIGN KEY (actor_id, role) REFERENCES identity_actor_roles(actor_id, role)",
]) {
  if (!migration.includes(required)) failures.push("Identity migration missing " + required);
}
for (const forbidden of [
  "operator_context_id varchar",
  "roles text[]",
  "permissions jsonb",
  "previous_refresh_token_hash",
  "provisioning_fingerprint char",
  "created_by_service varchar",
]) {
  if (migration.includes(forbidden)) failures.push("Identity migration recreates legacy actor/session state " + forbidden);
}

for (const file of [
  "services/identity/backend/internal/transport/http/server.go",
  "services/identity/backend/internal/runtime/server.go",
  "services/identity/clients/go/client.go",
  "services/dsh/backend/internal/identityboundary/client.go",
  "infra/local/compose/compose.yaml",
  "infra/local/compose/.env.example",
]) {
  const body = read(file);
  for (const forbidden of ["X-Service-Caller", "X-Operator-Context-ID", "IDENTITY_CONSUMER_OPERATOR_CONTEXT_ID"]) {
    if (body.includes(forbidden)) failures.push(file + " contains removed Identity context/caller authority " + forbidden);
  }
}

const directAuthPattern = /["'`]\/(?:auth|internal\/actor|internal\/actors)\//;
for (const app of ["app-client", "app-partner", "app-captain", "app-field"]) {
  const pageBody = read("apps/" + app + "/app/index.tsx");
  if (pageBody.includes("sessionSurface")) failures.push(app + " contains legacy sessionSurface residue in deployable app");
  for (const file of ["apps/" + app + "/src/identity.ts", "apps/" + app + "/app/index.tsx"]) {
    const body = read(file);
    if (directAuthPattern.test(body)) failures.push(file + " bypasses canonical Identity client with direct auth URL");
  }
}

if (failures.length > 0) {
  console.error("IDENTITY_BOUNDARY_VERIFY=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}

console.log("IDENTITY_BOUNDARY_VERIFY=PASS");
console.log("IDENTITY_ONE_ACTOR_ROLE_MODEL=PASS");
console.log("IDENTITY_SESSION_SINGLE_ROLE=PASS");
console.log("IDENTITY_PREMATURE_CONTEXT_RESIDUE=0");
console.log("IDENTITY_CALLER_HEADER_AUTHORITY=0");
console.log("PARALLEL_IDENTITY_CLIENT_TRUTH=0");
