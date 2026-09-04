import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const contractPath = path.join(root, "contracts", "identity.openapi.yaml");
const contract = fs.readFileSync(contractPath, "utf8");
const failures = [];

for (const route of [
  "/auth/otp/request:",
  "/auth/activate:",
  "/auth/login:",
  "/auth/refresh:",
  "/auth/logout:",
  "/auth/session:",
  "/internal/actor-roles/provision:",
  "/internal/actor-roles/search:",
  "/internal/actors/{actorId}/roles/{role}:",
  "/internal/actors/{actorId}/roles/{role}/disable:",
  "/internal/actors/{actorId}/roles/{role}/enable:",
  "/internal/actors/{actorId}/operator-password/reset:",
  "/internal/actors/{actorId}/roles/{role}/sessions:",
]) {
  if (!contract.includes(route)) failures.push("missing canonical route " + route);
}

for (const forbidden of [
  "X-Service-Caller",
  "X-Operator-Context-ID",
  "operatorContextId",
  "identity_access_grants",
  "actorId,omitempty",
  "expectedActorType",
  "sessionSurface",
  "surfaceAccess",
  "permissions:",
  "roles:",
  "ActorStatus:",
]) {
  if (contract.includes(forbidden)) failures.push("legacy/premature Identity authority remains: " + forbidden);
}

const schemaBlock = (name, next) => {
  const start = contract.indexOf("    " + name + ":");
  const end = contract.indexOf("    " + next + ":", start + 1);
  return start >= 0 ? contract.slice(start, end >= 0 ? end : contract.length) : "";
};

const otp = schemaBlock("OtpRequest", "ActivationRequest");
if (!otp.includes("enum: [client, partner, captain, field]")) failures.push("OTP role boundary is incomplete");
if (otp.includes("operator")) failures.push("operator OTP must be forbidden by contract");

const activation = schemaBlock("ActivationRequest", "ActivationChallenge");
if (activation.includes("operator")) failures.push("operator activation must be password-only");

const challenge = schemaBlock("ActivationChallenge", "LoginRequest");
if (/^\s+code:/m.test(challenge)) failures.push("activation challenge leaks raw code");

const provision = schemaBlock("ProvisionActorRoleRequest", "ActorRoleView");
if (provision.includes("actorId:")) failures.push("consumer can author actor_id");
if (!contract.includes("Identity alone creates actor_id.")) failures.push("actor_id authority is undocumented");
if (!contract.includes("authenticated service token determines the caller")) failures.push("service credential caller authority is undocumented");
if (!contract.includes("bearerFormat: opaque")) failures.push("opaque access token contract missing");
if (!contract.includes("Refresh token rotated atomically")) failures.push("refresh rotation contract missing");

if (failures.length) {
  console.error("IDENTITY_CONTRACT_GUARD=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("IDENTITY_CONTRACT_GUARD=PASS");
