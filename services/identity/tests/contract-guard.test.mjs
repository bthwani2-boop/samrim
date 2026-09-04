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
  "/internal/actors/provision:",
  "/internal/actors/{actorId}/activations:",
  "/internal/actors/{actorId}/sessions:",
]) {
  if (!contract.includes(route)) failures.push("missing canonical route " + route);
}

const schemaBlock = (name, next) => {
  const start = contract.indexOf("    " + name + ":");
  const end = contract.indexOf("    " + next + ":", start + 1);
  return start >= 0 ? contract.slice(start, end >= 0 ? end : contract.length) : "";
};

const otp = schemaBlock("OtpRequest", "ActivationRequest");
if (!otp.includes("const: client")) failures.push("public OTP is not client-only");
if (otp.includes("operatorContext")) failures.push("public OTP exposes operator context");

const activation = schemaBlock("ActivationRequest", "ActivationChallenge");
if (activation.includes("operatorContext")) failures.push("activation request exposes operator context");

const challenge = schemaBlock("ActivationChallenge", "LoginRequest");
if (/^\s+code:/m.test(challenge)) failures.push("activation challenge leaks raw code");

const provision = schemaBlock("ProvisionActorRequest", "ActorView");
if (provision.includes("operatorContext")) failures.push("provision body can override trusted operator context");

if (!contract.includes("Trusted only after internal service authentication.")) {
  failures.push("internal operator context trust boundary is undocumented");
}
if (!contract.includes("bearerFormat: opaque")) failures.push("opaque access token contract missing");
if (!contract.includes("Refresh token rotated atomically.")) failures.push("refresh rotation contract missing");

if (failures.length) {
  console.error("IDENTITY_CONTRACT_GUARD=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("IDENTITY_CONTRACT_GUARD=PASS");
