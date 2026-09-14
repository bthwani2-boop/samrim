import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const retiredRole = ["platform", "owner"].join("_");
const oldDeviceName = ["device", "Fingerprint"].join("");
const oldDeviceColumn = ["device", "_", "fingerprint", "_", "hash"].join("");
const oldOperatorLogin = "/auth/operator/" + "login";
const oldManagedRecovery = "/auth/managed/" + "recovery";

function read(relative, optional = false) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    if (!optional) failures.push("missing required artifact: " + relative);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function has(relative, values) {
  const body = read(relative);
  for (const value of values) if (!body.includes(value)) failures.push(relative + " missing " + value);
  return body;
}

const packageBody = read("services/identity/package.json");
try {
  const pkg = JSON.parse(packageBody);
  if (pkg.name !== "@bthwani/identity") failures.push("Identity package name drifted");
  if (pkg.exports?.["."]?.types !== "./clients/index.ts" || pkg.exports?.["."]?.default !== "./clients/index.ts") failures.push("Identity package root export drifted");
  if (pkg.exports?.["./presentation"]?.types !== "./clients/presentation/ManagedIdentityFlow.tsx" || pkg.exports?.["./presentation"]?.default !== "./clients/presentation/ManagedIdentityFlow.tsx") failures.push("Identity presentation export drifted");
} catch { failures.push("Identity package.json is invalid JSON"); }

const presentation = has("services/identity/clients/presentation/ManagedIdentityFlow.tsx", [
  "ManagedIdentityBinding", "requestManagedActivation", "activateManagedIdentity", "chooseIntent", "managedRole", "surface", "roleLabel", "أثبت رقم الهاتف", "رمز تحقق الهاتف", "تفعيل أول مرة", "ابدأ برقم الهاتف",
]);
if ((presentation.match(/<Pressable\b/g) ?? []).length !== (presentation.match(/accessibilityRole="(?:button|link)"/g) ?? []).length) failures.push("ManagedIdentityFlow has an unlabelled Pressable");
for (const value of ["requestManagedRecovery", "recoverManagedIdentity", "activationCode", "رمز التفعيل", "fetch(", "createIdentityClient(", "new IdentitySessionManager(", "error.message", "raw.includes"]) if (presentation.includes(value)) failures.push("ManagedIdentityFlow retains retired/host-owned behavior " + value);
for (const forbidden of ["apps/", "expo-router", "expo-linking", "expo-secure-store", "@bthwani/dsh", "@bthwani/wlt"]) if (presentation.split("\n").filter((line) => /^\s*import\s/.test(line)).join("\n").includes(forbidden)) failures.push("ManagedIdentityFlow imports host/domain dependency " + forbidden);

for (const app of ["app-client", "app-partner", "app-captain", "app-field"]) {
  const pkg = JSON.parse(read("apps/" + app + "/package.json"));
  if (pkg.dependencies?.["@bthwani/identity"] !== "workspace:*") failures.push(app + " does not consume canonical Identity package");
}
for (const file of ["apps/app-client/src/features/location-core/delivery-address-client.ts", "apps/app-partner/src/features/location-core/store-delivery-origin-client.ts", "apps/app-partner/src/features/partner-onboarding/store-readback-client.ts", "apps/app-partner/src/features/store-assortment/store-assortment.tsx"]) {
  const consumer = read(file);
  for (const value of ["readIdentityAccessToken", "getAccessToken("]) if (consumer.includes(value)) failures.push(file + " retains raw Identity token access " + value);
  if (!consumer.includes("getUsableIdentityAccessToken")) failures.push(file + " does not use the canonical usable Identity token accessor");
}
const clientBinding = has("apps/app-client/src/bootstrap/identity.ts", ["requestClientRegistration", "registerClient", "loginClient", "requestClientRecovery", "recoverClient", "createMobileIdentityRuntime"]);
for (const value of ["requestOtp(", "actorType"]) if (clientBinding.includes(value)) failures.push("app-client retains obsolete auth authority " + value);
const clientPage = read("apps/app-client/app/index.tsx") + read("apps/app-client/src/features/access/identity-gate.tsx");
for (const value of ["loginClient", "registerClient", "recoverClient", "requestClientRegistration", "requestClientRecovery"]) if (!clientPage.includes(value)) failures.push("app-client missing customer flow " + value);
for (const [app, role, surface] of [["app-partner", "partner", "app-partner"], ["app-captain", "captain", "app-captain"], ["app-field", "field", "app-field"]]) {
  const binding = has("apps/" + app + "/src/bootstrap/identity.ts", ["requestManagedActivation", "activateManagedIdentity", 'const role = "' + role + '" as const', 'const surface = "' + surface + '" as const']);
  if (binding.includes("requestManagedRecovery") || binding.includes("recoverManagedIdentity")) failures.push(app + " retains generic managed recovery");
  const gate = has("apps/" + app + "/src/features/access/identity-gate.tsx", ["ManagedIdentityFlow", "managedRole={role}", "surface={surface}", "@bthwani/identity/presentation"]);
  if ((gate.match(/<Pressable\b/g) ?? []).length !== (gate.match(/accessibilityRole="(?:button|link)"/g) ?? []).length) failures.push(app + " has an unlabelled Pressable");
}

const bff = has("apps/control-panel/src/server/identity/identity-bff.ts", ["beginOperatorPasskeyAuthentication", "finishOperatorPasskeyAuthentication", "requestOperatorEnrollment", "beginOperatorPasskeyRegistration", "finishOperatorPasskeyRegistration", "isControlPanelIdentity", "httpOnly: true", 'sameSite: "strict" as const']);
for (const value of ["loginOperator(", "startOperatorLogin", "completeOperatorLogin", "username", "localStorage", "sessionStorage", "operator_mfa"]) if (bff.includes(value)) failures.push("control-panel BFF retains retired operator auth " + value);
const controlPage = ["apps/control-panel/app/page.tsx", "apps/control-panel/src/shell/public-shell.tsx", "apps/control-panel/src/features/access/identity-surface.tsx", "apps/control-panel/src/features/access/account-access-panel.tsx"].map((file) => read(file)).join("\n");
for (const value of ["IdentitySurface", "navigator.credentials", "WebAuthn", "مفتاح مرور"]) if (!controlPage.includes(value)) failures.push("control-panel missing passkey UX " + value);
for (const value of ["/api/auth/login/", oldManagedRecovery + "/start", "operator-password", "username"]) if (controlPage.includes(value)) failures.push("control-panel UI retains retired auth " + value);
for (const route of ["apps/control-panel/app/api/auth/passkey/options/route.ts", "apps/control-panel/app/api/auth/passkey/finish/route.ts", "apps/control-panel/app/api/auth/passkey/registration/finish/route.ts", "apps/control-panel/app/api/auth/activation/start/route.ts", "apps/control-panel/app/api/auth/activation/complete/route.ts"]) has(route, ["export async function POST"]);
for (const route of ["apps/control-panel/app/api/auth/login/start/route.ts", "apps/control-panel/app/api/auth/login/complete/route.ts", "apps/control-panel/app/api/auth/recovery/start/route.ts", "apps/control-panel/app/api/auth/recovery/complete/route.ts"]) if (fs.existsSync(path.join(root, route))) failures.push("retired Control Panel auth route remains: " + route);

const contractFiles = ["services/identity/contracts/openapi/identity.openapi.yaml", ...fs.readdirSync(path.join(root, "services/identity/contracts/openapi/paths")).map((name) => "services/identity/contracts/openapi/paths/" + name)];
const contract = contractFiles.map((file) => read(file)).join("\n");
for (const route of ["/auth/client/registration/request:", "/auth/client/login:", "/auth/client/recovery/request:", "/auth/managed/activation/request:", "/auth/operator/enrollment/request:", "/auth/operator/enrollment/registration/options:", "/auth/operator/enrollment/registration/finish:", "/auth/operator/authentication/options:", "/auth/operator/authentication/finish:", "/auth/operator/recovery/request:", "/auth/operator/recovery/registration/options:", "/auth/operator/recovery/registration/finish:", "/internal/bootstrap/operator:", "/internal/actors/{actorId}/roles/{role}/reenrollment:"]) if (!contract.includes(route)) failures.push("Identity contract missing " + route);
for (const value of [oldOperatorLogin + "/start:", oldOperatorLogin + "/complete:", oldManagedRecovery + "/request:", oldManagedRecovery + "/recover:", "operator_mfa", "ManagedRecoveryChallengeRequest", "platform_owner", "operator_owner", "X-Service-Caller", "identity_access_grants", "PasswordResetRequest", "username:", oldDeviceName]) if (contract.includes(value)) failures.push("Identity contract retains retired shape " + value);
for (const value of ["enum: [client, partner, captain, field, operator]", "enum: [partner, captain, field]", "enum: [operator]", "minLength: 8", "maxLength: 8", "pattern: \"^[0-9]{6}$\"", "user-verifying", "WebAuthn"]) if (!contract.includes(value)) failures.push("Identity contract missing invariant " + value);

const generatedTypes = read("services/identity/clients/generated/identity-types.ts");
const generatedOps = read("services/identity/clients/generated/identity-operations.ts");
const generatedGoTypes = read("services/identity/clients/go/identity_types_generated.go");
const generatedGoOps = read("services/identity/clients/go/identity_operations_generated.go");
for (const [name, body] of [["TS types", generatedTypes], ["TS operations", generatedOps], ["Go types", generatedGoTypes], ["Go operations", generatedGoOps]]) if (!body.includes("Source Git graph SHA:")) failures.push(name + " has no contract graph provenance");
for (const value of ["OperatorPasskeyRegistrationOptionsRequest", "OperatorPasskeyAuthenticationFinishRequest", "OperatorPasskeyRecoveryFinishRequest", "RecoveryResult", "clientInstanceId"]) if (!generatedTypes.includes(value)) failures.push("generated Identity types missing " + value);
for (const value of ["OperatorPasskey", "RequestOperatorRecovery", "BeginOperatorPasskeyAuthentication"]) if (!generatedGoOps.includes(value) && !generatedGoTypes.includes(value)) failures.push("generated Go client missing " + value);
for (const value of ["OperatorLogin", "ManagedRecoveryChallengeRequest", "ManagedActivationCode", "ResetOperatorPassword", oldDeviceName]) if (generatedTypes.includes(value) || generatedOps.includes(value)) failures.push("generated Identity client retains " + value);

const domain = has("services/identity/backend/internal/domain/types.go", ["ChallengeOperatorEnroll", "ChallengeOperatorRecover", "IsManagedActivationRole", "CanBootstrapFirstOperator", "CanIssueOperatorEnrollmentTokenForRole", "RequiresEnrollmentToken"]);
for (const value of ["ChallengeOperatorMFA", "CanResetCredential", "PasswordResetRequest", "IsPublicOtpRole", "PasswordHash"]) if (domain.includes(value)) failures.push("Identity domain retains retired authority " + value);
const actor = has("services/identity/backend/internal/actor/service.go", ["RegisterClientTx", "ManagedActivationCandidate", "MarkManagedActivatedTx", "AuthorizeReenrollment", "ResetClientPasswordTx", "identity_bootstrap_state"]);
if (actor.includes("operator" + "Password") || actor.includes("password: string")) failures.push("Identity actor service retains operator password provisioning");
has("services/identity/backend/internal/authentication/service.go", ["LoginClient", "LoginManaged", "waitPasswordBackoff", "PasswordBlocklistVersion"]);
const challengeService = has("services/identity/backend/internal/challenge/service.go", ["RequestClientRegistration", "RequestClientRecovery", "RecoverClient", "RequestManagedActivation", "ActivateManaged", "RequestOperatorEnrollment", "RequestOperatorRecovery", "IssueOperatorEnrollmentToken", "identity_challenge_deliveries"]);
for (const value of ["StartOperatorLogin", "CompleteOperatorLogin", "RequestManagedRecovery", "RecoverManaged", "identity_managed_activation_codes", "operator_mfa", "s.sender.Send("]) if (challengeService.includes(value)) failures.push("Identity challenge service retains retired semantics " + value);
has("services/identity/backend/internal/passkey/service.go", ["webauthn.New", "UserVerification", "VerificationRequired", "BeginRegistration", "FinishRegistration", "FinishPasskeyLogin", "identity_webauthn_ceremonies", "identity_webauthn_credentials", "identity_operator_recovery_credentials", "storeRecoveryCredentialTx"]);
const session = has("services/identity/backend/internal/session/service.go", ["CreateTx", "identity_refresh_token_history", "client_instance_id_hash", "identityOf(actorID"]);
if (session.includes(oldDeviceName) || session.includes("surfaceAccess")) failures.push("Identity session service retains old binding/host semantics");
const mobileSession = has("services/identity/clients/session.ts", ["getUsableAccessToken", "subscribe", "accessTokenSafetySkewMs", "refreshInFlight", "IDENTITY_ACCESS_TOKEN_UNUSABLE"]);
for (const value of ["getAccessToken()", "readAccessToken", "readIdentityAccessToken"]) if (mobileSession.includes(value)) failures.push("Identity mobile client retains raw access-token accessor " + value);

const migration = has("services/identity/database/migrations/017_operator_passkeys_and_instance_binding.sql", ["RENAME COLUMN " + oldDeviceColumn + " TO client_instance_id_hash", "identity_webauthn_users", "identity_webauthn_credentials", "identity_webauthn_ceremonies", "identity_operator_recovery_credentials", "operator_recovery_registration", "operator_authentication", "DELETE FROM identity_challenges", "DROP CONSTRAINT identity_password_attempt_role_check"]);
for (const value of ["INSERT INTO identity_schema_migrations", oldDeviceName]) if (migration.includes(value)) failures.push("v17 migration retains retired shape " + value);
has("services/identity/database/migrations/018_mobile_session_lifetime_cutover.sql", ["365 days", "30 days", "role IN ('client', 'partner', 'captain', 'field')", "revoked_at IS NULL"]);
const readiness = has("services/identity/backend/internal/storage/postgres/migrate.go", ["const SchemaVersion = 18", "CurrentSchemaVersion", "identity_webauthn_users", "identity_webauthn_credentials", "identity_webauthn_ceremonies", "identity_operator_recovery_credentials", "client_instance_id_hash"]);
for (const value of [oldDeviceColumn, "identity_managed_activation_codes"]) if (readiness.includes(value)) failures.push("Identity readiness retains " + value);
const schema = has("services/identity/backend/internal/storage/postgres/schema.go", ["identity_challenge_purpose_check", "operator_recovery", "identity_webauthn_ceremony_kind_check", "identity_operator_recovery_credentials_pkey", "identity_password_attempt_role_check"]); void schema;
has("services/identity/backend/internal/storage/postgres/privileges.go", ["VerifyRuntimePrivileges", "VerifyMaintenancePrivileges", "identity_webauthn_credentials", "identity_webauthn_ceremonies", "identity_operator_recovery_credentials"]);
const security = has("services/identity/backend/internal/security/values.go", ["argon2.IDKey", "HashPassword", "VerifyPassword", "PasswordAllowed", "utf8.RuneCountInString", "NormalizeRecoveryCredential", "RandomRecoveryCredential", "NeedsPasswordRehash"]);
const retiredPasswordNormalization = ["Normalize", "Password"].join("");
const nfcNormalization = ["norm", "NFC"].join(".");
const unicodeNormalization = ["unicode", "norm"].join("/");
for (const value of [retiredPasswordNormalization, nfcNormalization, unicodeNormalization]) if (security.includes(value)) failures.push("Identity password handling retains normalization authority " + value);
if (security.includes("bcrypt")) failures.push("legacy bcrypt remains in Identity security implementation");
const sessionExpiry = has("services/identity/backend/internal/session/service.go", ["calculateSessionExpiries", "minimumAccessLifetime", "calculateRefreshExpiry"]);
const independentAccessExpiry = ["calculate", "Access", "Expiry"].join("");
if (sessionExpiry.includes(independentAccessExpiry)) failures.push("Identity session expiry still calculates access independently of refresh expiry");
has("services/identity/backend/internal/storage/postgres/migrate_test.go", ["runtime.RunMigrations", "applied_at", "identity_sessions", "RunMigrations"]);
has("services/identity/backend/internal/security/password_blocklist.go", ["passwordBlocklistVersion", "PasswordBlocklistVersion", "passwordBlocklistGenerated"]);
has("services/identity/backend/internal/security/password_blocklist_generated.go", ["Code generated by", "Source version:", "Canonical values SHA-256:", "passwordBlocklistGenerated"]);
const runtime = has("services/identity/backend/internal/runtime/server.go", ["passkey.Config", "IDENTITY_WEBAUTHN_RP_ID", "IDENTITY_WEBAUTHN_ALLOWED_ORIGINS", "RequireOrdinaryCLIEnvironment", "production"]);
if (!runtime.includes("RPID")) failures.push("Identity runtime does not configure WebAuthn RP ID");
has("infra/local/compose/compose.yaml", ["IDENTITY_WEBAUTHN_RP_ID", "IDENTITY_WEBAUTHN_ALLOWED_ORIGINS", "identity-migrate:", "IDENTITY_CHALLENGE_HMAC_SECRET", "IDENTITY_ABUSE_HMAC_SECRET"]);
has("infra/local/compose/.env.example", ["IDENTITY_WEBAUTHN_RP_ID=", "IDENTITY_WEBAUTHN_ALLOWED_ORIGINS="]);
has("services/identity/backend/Dockerfile", ["COPY services/identity/database/migrations /app/migrations", "IDENTITY_MIGRATION_DIR=/app/migrations"]);

const dshClient = has("services/dsh/backend/internal/integrations/identity/client.go", ["ProvisionPartner", "ReadActorRole", "ReadSession"]);
for (const value of ["ProvisionCaptain", "ProvisionField", "SetRoleEnabledByPhone", "AuthorizeReenrollmentByPhone", "LookupRoleByPhone", "AuthorizePartnerReenrollment", "AuthorizeCaptainReenrollment", "AuthorizeFieldReenrollment"]) if (dshClient.includes(value)) failures.push("DSH Identity boundary retains " + value);
for (const value of ["ProvisionOperator", "Username", "X-Service-Caller"]) if (dshClient.includes(value)) failures.push("DSH Identity boundary retains " + value);
const dshBff = has("apps/control-panel/src/server/dsh/dsh-bff.ts", ["listJoiningCases", "dshOperationPaths.listJoiningCases", "Idempotency-Key", "X-Acting-Actor-ID"]);
for (const value of ["provisionManagedRole", "getManagedRoleStatus", "reenrollManagedRoleByPhone", "enableManagedRole", "disableManagedRole"]) if (dshBff.includes(value)) failures.push("Control Panel DSH BFF retains retired managed-access operation " + value);
has("apps/control-panel/src/server/identity/identity-bff.ts", ["lookupIdentityRoles", "authorizeIdentityRoleReenrollment", "setIdentityRoleEnabled", "setIdentitySecurityEnabled"]);
for (const file of ["services/dsh/clients/generated/dsh-types.ts", "services/dsh/clients/generated/dsh-operations.ts", "services/dsh/backend/internal/contract/dsh_types_generated.go"]) has(file, ["Source Graph SHA:", "DO NOT EDIT"]);

const currentResidueTokens = [retiredRole, retiredRole.replaceAll("_", "-"), "IDENTITY_" + "PLATFORM_" + "CONTROL_SERVICE_TOKEN", "DSH_" + "PLATFORM_" + "CONTROL_SERVICE_TOKEN", oldDeviceName, oldDeviceColumn];
const historicalMigration = /^services\/identity\/database\/migrations\/(?:00[1-9]|01[0-6])_/;
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  if (historicalMigration.test(normalized) || normalized === "services/identity/backend/internal/storage/postgres/migrate_test.go" || normalized === "tools/dev/verify-identity-boundaries.mjs" || normalized === "services/identity/tests/contract-guard.test.mjs" || normalized === "services/identity/database/migrations/017_operator_passkeys_and_instance_binding.sql") continue;
  if (!fs.existsSync(path.join(root, file))) continue;
  const bytes = fs.readFileSync(path.join(root, file));
  if (bytes.includes(0)) continue;
  const body = bytes.toString("utf8");
  for (const token of currentResidueTokens) if (body.includes(token)) { failures.push("current Identity residue in " + normalized + ": " + token); break; }
}

if (failures.length) {
  console.error("IDENTITY_BOUNDARY_VERIFY=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}
console.log("IDENTITY_BOUNDARY_VERIFY=PASS");
console.log("IDENTITY_ONE_ACTOR_ROLE_MODEL=PASS");
console.log("IDENTITY_CUSTOMER_PASSWORD_AUTH=PASS");
console.log("IDENTITY_MANAGED_ACTIVATION_ONE_TIME=PASS");
console.log("IDENTITY_OPERATOR_PASSKEY_REQUIRED=PASS");
console.log("IDENTITY_OPERATOR_PASSWORD_SESSION=0");
console.log("IDENTITY_GENERIC_MANAGED_RECOVERY=0");
console.log("PARALLEL_IDENTITY_CLIENT_TRUTH=0");
