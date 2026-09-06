import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const contract = fs.readFileSync(path.join(root, "contracts", "identity.openapi.yaml"), "utf8");
const failures = [];

for (const route of [
  "/auth/client/registration/request:",
  "/auth/client/register:",
  "/auth/client/login:",
  "/auth/client/recovery/request:",
  "/auth/client/recover:",
  "/auth/managed/activation/request:",
  "/auth/managed/activate:",
  "/internal/managed-activation-codes:",
  "/auth/operator/login/start:",
  "/auth/operator/login/complete:",
  "/auth/refresh:",
  "/auth/logout:",
  "/auth/session:",
  "/internal/actor-roles/provision:",
  "/internal/bootstrap/platform-owner:",
  "/internal/actor-roles/search:",
  "/internal/actors/{actorId}/roles/{role}:",
  "/internal/actors/{actorId}/roles/{role}/disable:",
  "/internal/actors/{actorId}/roles/{role}/enable:",
  "/internal/actors/{actorId}/roles/{role}/reenrollment:",
  "/internal/actors/{actorId}/operator-password/reset:",
  "/internal/actors/{actorId}/roles/{role}/sessions:",
]) {
  if (!contract.includes(route)) failures.push("missing canonical route " + route);
}

for (const forbidden of [
  "/auth/otp/request:",
  "/auth/activate:",
  "\n  /auth/login:",
  "X-Service-Caller",
  "identity_access_grants",
  "username:",
  "expectedActorType",
  "sessionSurface",
  "surfaceAccess",
  "permissions:",
  "roles:",
  "ActorStatus:",
]) {
  if (contract.includes(forbidden)) failures.push("legacy/premature Identity authority remains: " + forbidden);
}

function schemaBlock(name, next) {
  const start = contract.indexOf("    " + name + ":");
  const end = next ? contract.indexOf("    " + next + ":", start + 1) : contract.indexOf("\n  responses:", start + 1);
  return start >= 0 ? contract.slice(start, end >= 0 ? end : contract.length) : "";
}

const challenge = schemaBlock("Challenge", "RefreshRequest");
if (/^\s+code:/m.test(challenge)) failures.push("challenge response leaks raw code");
if (!contract.includes("Phone is a mutable verified identifier rather than the cross-boundary primary identity")) {
  failures.push("phone/actor_id identity law missing");
}
if (!contract.includes("A password proof alone never creates an operator session")) {
  failures.push("operator password-only session prohibition missing");
}
if (!contract.includes("Repeated activation is not normal login")) {
  failures.push("managed one-time activation semantics missing");
}
if (!contract.includes("revokes existing client sessions and creates a fresh client session")) {
  failures.push("client recovery revocation semantics missing");
}
if (!contract.includes("authenticated service token determines the caller")) {
  failures.push("service credential caller authority missing");
}
if (!contract.includes("Identity alone creates actor_id")) {
  failures.push("actor_id authority missing");
}
if (!contract.includes("Refresh token rotated atomically")) {
  failures.push("refresh rotation contract missing");
}

const provision = schemaBlock("ProvisionActorRoleRequest", "ActorRoleView");
if (provision.includes("actorId:")) failures.push("consumer can author actor_id");
if (provision.includes("username:")) failures.push("username remains an Identity provisioning requirement");

const operatorStart = contract.slice(
  contract.indexOf("  /auth/operator/login/start:"),
  contract.indexOf("  /auth/operator/login/complete:"),
);
if (operatorStart.includes("#/components/responses/TokenPair")) {
  failures.push("operator password-start route can create a session");
}
const managedRequest = schemaBlock("ManagedChallengeRequest", "ClientCredentialProofRequest");
if (!managedRequest.includes("#/components/schemas/ManagedActivationRole")) failures.push("managed activation role boundary missing");
if (!managedRequest.includes("activationCode:")) failures.push("managed activation request does not require the control-surface code");
const managedActivation = schemaBlock("ManagedActivationRequest", "OperatorLoginStartRequest");
if (!managedActivation.includes("verificationCode:")) failures.push("managed activation does not require the separate phone verification code");
if (!contract.includes("ManagedActivationCode")) failures.push("managed activation code issuance contract missing");
const managedType = schemaBlock("ManagedActorType", "PhoneRequest");
if (!managedType.includes("enum: [partner, captain, field]")) failures.push("managed activation roles are incorrect");
const managedActivationRole = schemaBlock("ManagedActivationRole", "ControlPanelRole");
if (!managedActivationRole.includes("enum: [partner, captain, field, operator]")) failures.push("operator activation role boundary missing");

if (failures.length) {
  console.error("IDENTITY_CONTRACT_GUARD=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("IDENTITY_CONTRACT_GUARD=PASS");
