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
  "/internal/operator-enrollment-tokens:",
  "/auth/operator/login/start:",
  "/auth/operator/login/complete:",
  "/auth/refresh:",
  "/auth/logout:",
  "/auth/session:",
  "/internal/actor-roles/provision:",
  "/internal/bootstrap/operator:",
  "/internal/actor-roles/search:",
  "/internal/actors/{actorId}/roles/{role}:",
  "/internal/actors/{actorId}/roles/{role}/disable:",
  "/internal/actors/{actorId}/roles/{role}/enable:",
  "/internal/actors/{actorId}/roles/{role}/reenrollment:",
  "/internal/actors/{actorId}/roles/{role}/sessions:",
]) {
  if (!contract.includes(route)) failures.push("missing canonical route " + route);
}

const retiredHumanRole = ["platform", "owner"].join("_");
for (const forbidden of [
  retiredHumanRole,
  "operator_owner",
  "/internal/bootstrap/" + ["platform", "owner"].join("-") + ":",
  "bootstrap" + "PlatformOwner",
  "PlatformControl",
  "X-Service-Caller",
  "identity_access_grants",
  "activationCode:",
  "/internal/managed-activation-codes:",
  "ManagedActivationCode",
]) {
  if (contract.includes(forbidden)) failures.push("retired Identity authority remains: " + forbidden);
}

function schemaBlock(name, next) {
  const start = contract.indexOf("    " + name + ":");
  const end = next ? contract.indexOf("    " + next + ":", start + 1) : contract.indexOf("\n  responses:", start + 1);
  return start >= 0 ? contract.slice(start, end >= 0 ? end : contract.length) : "";
}

const actorType = schemaBlock("ActorType", "ManagedActorType");
if (!actorType.includes("enum: [client, partner, captain, field, operator]")) failures.push("ActorType is not the canonical five-role set");
const controlRole = schemaBlock("ControlPanelRole", "PhoneRequest");
if (!controlRole.includes("enum: [operator]")) failures.push("operator must be the only control-panel human role");
const managedActivationRole = schemaBlock("ManagedActivationRole", "ControlPanelRole");
if (!managedActivationRole.includes("enum: [partner, captain, field, operator]")) failures.push("operator activation role boundary missing");
const provision = schemaBlock("ProvisionActorRoleRequest", "ActorRoleView");
if (!provision.includes("enum: [partner, captain, field, operator]")) failures.push("trusted provisioning roles are incorrect");
if (provision.includes("actorId:")) failures.push("consumer can author actor_id");

const challenge = schemaBlock("Challenge", "RefreshRequest");
if (/^\s+code:/m.test(challenge)) failures.push("challenge response leaks raw code");

const operatorStart = contract.slice(contract.indexOf("  /auth/operator/login/start:"), contract.indexOf("  /auth/operator/login/complete:"));
if (operatorStart.includes("#/components/responses/TokenPair")) failures.push("operator password-start route can create a session");
if (!operatorStart.includes("Password proof alone never creates a control-panel session")) failures.push("operator password-only session prohibition missing");
const operatorStartRequest = schemaBlock("OperatorLoginStartRequest", "OperatorLoginCompleteRequest");
const operatorCompleteRequest = schemaBlock("OperatorLoginCompleteRequest", "Challenge");
if (operatorStartRequest.includes("role:") || operatorCompleteRequest.includes("role:")) failures.push("operator login endpoints must own the operator role instead of accepting a role selector");

const managedRequest = schemaBlock("ManagedChallengeRequest", "ManagedRecoveryChallengeRequest");
if (!managedRequest.includes("#/components/schemas/ManagedActivationRole")) failures.push("managed activation role boundary missing");
if (!managedRequest.includes("operatorEnrollmentToken:")) failures.push("operator enrollment token input missing");
if (!managedRequest.includes("minLength: 24") || !managedRequest.includes('pattern: "^[A-Za-z0-9_-]{24,256}$"')) failures.push("operator enrollment token must be high entropy");

const enrollmentIssue = schemaBlock("OperatorEnrollmentTokenIssueRequest", "OperatorEnrollmentToken");
if (!enrollmentIssue.includes("enum: [operator]")) failures.push("operator enrollment token issuance is not operator-scoped");

if (!contract.includes("Identity alone creates actor_id")) failures.push("actor_id authority missing");
if (!contract.includes("First-operator bootstrap is a separate one-time lifecycle")) failures.push("first-operator bootstrap lifecycle distinction missing");
if (!contract.includes("never creates a second human role")) failures.push("bootstrap-as-lifecycle invariant missing");

if (failures.length) {
  console.error("IDENTITY_CONTRACT_GUARD=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("IDENTITY_CONTRACT_GUARD=PASS");
