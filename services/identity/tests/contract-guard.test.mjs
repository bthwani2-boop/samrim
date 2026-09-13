import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const entry = fs.readFileSync(path.join(root, "contracts", "openapi", "identity.openapi.yaml"), "utf8");
const pathDir = path.join(root, "contracts", "openapi", "paths");
const modules = fs.readdirSync(pathDir).filter((name) => name.endsWith(".yaml")).map((name) => fs.readFileSync(path.join(pathDir, name), "utf8")).join("\n");
const contract = entry + "\n" + modules;
const failures = [];

function requireText(value, message = value) { if (!contract.includes(value)) failures.push("missing " + message); }
function forbidText(value, message = value) { if (contract.includes(value)) failures.push("retired contract shape: " + message); }

if (!entry.includes("openapi: 3.1.0")) failures.push("canonical Identity contract entrypoint is not OpenAPI 3.1");
for (const module of ["runtime.yaml", "client-auth.yaml", "managed-enrollment-auth.yaml", "operator-passkey-access.yaml", "session.yaml", "internal-actor-administration.yaml"]) if (!entry.includes("./paths/" + module)) failures.push("entrypoint does not reference " + module);
for (const route of [
  "/auth/client/registration/request:", "/auth/client/register:", "/auth/client/login:", "/auth/client/recovery/request:", "/auth/client/recover:",
  "/auth/managed/activation/request:", "/auth/managed/activate:", "/auth/managed/login:",
  "/auth/operator/enrollment/request:", "/auth/operator/enrollment/registration/options:", "/auth/operator/enrollment/registration/finish:",
  "/auth/operator/authentication/options:", "/auth/operator/authentication/finish:", "/auth/operator/recovery/request:",
  "/auth/operator/recovery/registration/options:", "/auth/operator/recovery/registration/finish:", "/internal/bootstrap/operator:",
  "/auth/refresh:", "/auth/logout:", "/auth/session:", "/internal/actor-roles/provision:", "/internal/actor-roles/search:",
  "/internal/actors/{actorId}/roles/{role}/reenrollment:", "/internal/actors/{actorId}/security/disable:",
]) requireText(route, "canonical route " + route);
for (const route of ["/auth/operator/" + "login/start:", "/auth/operator/" + "login/complete:", "/auth/managed/" + "recovery/request:", "/auth/managed/" + "recover:"]) forbidText(route, route);
for (const value of ["platform_owner", "operator_owner", "X-Service-Caller", "identity_access_grants", "ManagedRecoveryChallengeRequest", "OperatorLoginStartRequest", "OperatorLoginCompleteRequest", "PasswordResetRequest", "username:", "activationCode:", "operator_mfa"]) forbidText(value);
for (const value of ["enum: [client, partner, captain, field, operator]", "enum: [partner, captain, field]", "enum: [operator]"]) requireText(value);
for (const value of ["ClientRecoveryProofRequest", "RecoveryComplete", "OperatorPasskeyRegistrationOptionsRequest", "OperatorPasskeyAuthenticationFinishRequest", "OperatorPasskeyRecoveryRegistrationOptionsRequest", "OperatorPasskeyRecoveryFinishRequest", "user-verifying", "WebAuthn", "minLength: 15", 'pattern: "^[0-9]{6}$"']) requireText(value);
if (!contract.includes("phone control alone never grants operator access")) failures.push("operator recovery must distinguish phone possession from authority");
if (!contract.includes("never a password or session")) failures.push("operator bootstrap must not mint a password or session");
if (contract.includes("#/components/responses/TokenPair")) {
  const recovery = contract.slice(contract.indexOf("/auth/client/recover:"), contract.indexOf("/auth/managed/activation/request:"));
  if (recovery.includes("#/components/responses/TokenPair")) failures.push("client recovery creates a session");
}
if (!contract.includes("additionalProperties: true")) failures.push("WebAuthn JSON object pass-through schema missing");
for (const file of ["identity-types.ts", "identity-operations.ts"]) {
  const body = fs.readFileSync(path.join(root, "clients", "generated", file), "utf8");
  if (!body.includes("Source Git graph SHA:")) failures.push(file + " lacks source graph provenance");
}
if (failures.length) {
  console.error("IDENTITY_CONTRACT_GUARD=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}
console.log("IDENTITY_CONTRACT_GUARD=PASS");
