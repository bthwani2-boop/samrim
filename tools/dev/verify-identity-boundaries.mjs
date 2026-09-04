import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];

function read(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    failures.push("missing required Identity artifact: " + relative);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function expectText(relative, text, label = text) {
  const body = read(relative);
  if (!body.includes(text)) failures.push(relative + " missing " + label);
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
    'const actorType = "' + role + '" as const',
    'const surface = "' + surface + '" as const',
    "new IdentitySessionManager(",
  ]) {
    if (!runtime.includes(required)) failures.push(runtimePath + " missing " + required);
  }

  const page = read("apps/" + app + "/app/index.tsx");
  if (!page.includes('from "../src/identity"')) failures.push(app + " UI bypasses its Identity host binding");

  if (role === "client") {
    if (!runtime.includes("requestIdentityActivation")) failures.push("client activation request binding missing");
  } else {
    if (runtime.includes("requestIdentityActivation") || runtime.includes(".requestOtp(")) {
      failures.push(app + " must not expose public OTP issuance");
    }
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

const bff = read("apps/control-panel/lib/identity-bff.ts");
for (const required of [
  'from "@bthwani/identity"',
  'httpOnly: true',
  'sameSite: "strict" as const',
  'identityAuthorizesSurface(pair.identity, "operator", "control-panel")',
  'identityAuthorizesSurface(identity, "operator", "control-panel")',
  "activateOperator",
]) {
  if (!bff.includes(required)) failures.push("control-panel Identity BFF missing " + required);
}
for (const forbidden of ["localStorage", "sessionStorage"]) {
  if (bff.includes(forbidden)) failures.push("control-panel Identity BFF uses forbidden browser storage: " + forbidden);
}

expectText("apps/control-panel/next.config.mjs", 'transpilePackages: ["@bthwani/identity"]');

for (const route of ["activate", "login", "session", "logout"]) {
  expectText("apps/control-panel/app/api/auth/" + route + "/route.ts", "identity-bff", route + " BFF binding");
}

const workforce = read("services/workforce/backend/internal/identityboundary/client.go");
for (const required of ["ProvisionCaptain", "ProvisionField", '"workforce"']) {
  if (!workforce.includes(required)) failures.push("Workforce Identity boundary missing " + required);
}
for (const forbidden of ["ProvisionPartner", "ProvisionOperator"]) {
  if (workforce.includes(forbidden)) failures.push("Workforce Identity boundary exceeds role ownership: " + forbidden);
}

const dsh = read("services/dsh/backend/internal/identityboundary/client.go");
for (const required of ["ProvisionPartner", '"dsh"']) {
  if (!dsh.includes(required)) failures.push("DSH Identity boundary missing " + required);
}
for (const forbidden of ["ProvisionCaptain", "ProvisionField", "ProvisionOperator"]) {
  if (dsh.includes(forbidden)) failures.push("DSH Identity boundary exceeds role ownership: " + forbidden);
}

for (const service of ["workforce", "dsh"]) {
  const mod = read("services/" + service + "/backend/go.mod");
  if (!mod.includes("github.com/bthwani2-boop/samrim/services/identity/clients/go v0.0.0")) {
    failures.push(service + " Go module does not require canonical Identity Go client");
  }
  if (!mod.includes("../../identity/clients/go")) {
    failures.push(service + " Go module local Identity client replacement missing");
  }
}

const goClient = read("services/identity/clients/go/client.go");
for (const route of ["/internal/actors/provision", "/internal/actors/", "/activations"]) {
  if (!goClient.includes(route)) failures.push("Identity Go client missing canonical route " + route);
}
for (const header of ["X-Service-Caller", "X-Operator-Context-ID", "Idempotency-Key"]) {
  if (!goClient.includes(header)) failures.push("Identity Go client missing trust header " + header);
}

const generated = read("services/identity/clients/generated/identity-types.ts");
if (!generated.includes("AUTO-GENERATED from services/identity/contracts/identity.openapi.yaml")) {
  failures.push("generated Identity types provenance header missing");
}

const directAuthPattern = /["'`]\/(?:auth|internal\/actors)\//;
for (const app of ["app-client", "app-partner", "app-captain", "app-field"]) {
  const files = [
    "apps/" + app + "/src/identity.ts",
    "apps/" + app + "/app/index.tsx",
  ];
  for (const file of files) {
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
console.log("IDENTITY_SURFACE_BINDINGS=5");
console.log("IDENTITY_TRUSTED_CONSUMERS=2");
console.log("PARALLEL_IDENTITY_CLIENT_TRUTH=0");
