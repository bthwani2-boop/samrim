import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const world = read("tools/dev/local-world.mjs");
const runtime = read("tools/dev/runtime.ps1");
const candidate = read("tools/dev/verify-local-candidate.ps1");
const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts ?? {};

const worldCommands = Object.entries(scripts)
  .filter(([name]) => name.startsWith("world:"))
  .sort(([left], [right]) => left.localeCompare(right));
assert(JSON.stringify(worldCommands) === JSON.stringify([
  ["world:ensure", "node tools/dev/local-world.mjs --ensure"],
  ["world:status", "node tools/dev/local-world.mjs --status"],
]), "public world commands must be exactly ensure and status owned by local-world.mjs");
assert(fs.existsSync(path.join(root, "tools/dev/local-world.mjs")), "canonical local-world owner is missing");
assert(world.includes("const action = process.argv[2] ?? \"--status\""), "world owner must default to read-only status");
assert(world.includes("if (![\"--ensure\", \"--status\"].includes(action))"), "world owner must expose only ensure and status actions");

const statusStart = world.indexOf("async function readStatus");
const mainStart = world.indexOf("async function main");
assert(statusStart >= 0 && mainStart > statusStart, "world status owner is not structurally discoverable");
const statusSource = statusStart >= 0 && mainStart > statusStart ? world.slice(statusStart, mainStart) : "";
assert(!/\b(?:POST|PATCH|DELETE|PUT)\b/.test(statusSource), "world status must not contain mutation methods");
assert(!statusSource.includes("saveState"), "world status must not rewrite the locator");
assert(world.includes("read_only=1 complete_baseline=1"), "world status must report a complete read-only baseline");

assert(world.includes("/internal/bootstrap/operator"), "zero-state world must use canonical first-operator bootstrap");
assert(world.includes("/internal/operator-enrollment-tokens"), "existing unactivated operator must use canonical enrollment-token ownership");
assert(world.includes("createRequire(path.join(root, \"apps/control-panel/package.json\"))"), "operator activation must reuse the Control Panel Playwright dependency boundary");
assert(world.includes("WebAuthn.addVirtualAuthenticator"), "operator activation must use a standards-compliant local virtual authenticator");
assert(world.includes("hasResidentKey: true") && world.includes("hasUserVerification: true"), "operator activation must require resident key and user verification");
assert(world.includes("/api/auth/activation/start") || world.includes("تفعيل حساب موظف"), "operator activation must exercise the canonical Control Panel enrollment surface");
assert(world.includes("/api/auth/session"), "operator activation must prove the resulting canonical session");

assert(!world.includes("/internal/actor-roles/provision"), "world owner must not bypass DSH joining-case partner provisioning");
assert(read("services/dsh/backend/internal/joiningcase/service.go").includes("ProvisionPartnerWithContext"), "DSH joining-case service must remain the partner provisioning owner");
assert(!world.includes("abandonedOperatorPhone"), "historical abandoned operator persona must be absent");
assert(!world.includes("local-world-unactivated-bootstrap-cleanup"), "historical operator cleanup reason must be absent");
assert(!world.includes("psql"), "world owner must not use direct database setup or readback");
assert(!/\b(?:insert|update|delete|truncate|drop|alter)\s+/i.test(world), "world owner must not contain SQL/business-state mutation verbs");
assert(!world.includes("identity_actor_roles"), "world owner must not read or write Identity tables directly");

assert(world.includes("BTHWANI_SECRETS_ROOT"), "world locator must remain under the existing machine-local secrets root");
assert(!world.includes("path.join(root, \"world.json\")"), "world locator must not be repository-local");
assert(world.includes("fs.renameSync(tempPath, locatorPath)"), "world locator writes must use the atomic replacement boundary");
assert(world.includes("recoveryCredential") && world.includes("forbidden credential material"), "world locator must reject credential-shaped material");
assert(world.includes("fs.writeFileSync(tempPath"), "world locator must stage its replacement before the atomic rename");

assert(!runtime.includes("local-world"), "normal runtime owner must not depend on world tooling");
assert(!read("infra/local/compose/compose.yaml").includes("local-world"), "canonical Compose runtime must not depend on world tooling");
assert(runtime.includes("if ($Action -in @('Reset','Purge') -and -not $AllowDataLoss)"), "destructive reset interlock must remain present");
assert(runtime.includes("rerun_same_invocation_with=-AllowDataLoss"), "destructive reset interlock must retain explicit authorization guidance");
assert(!fs.existsSync(path.join(root, "tools/dev/verify-dsh-runtime.mjs")), "retired duplicate DSH runtime verifier must remain absent");

const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
assert(!tracked.some((file) => /(^|[\\/])world\.json$/i.test(file)), "world locator must not be tracked by Git");
assert(!candidate.includes("runtime:up") && !candidate.includes("runtime:doctor") && !candidate.includes("runtime:status"), "candidate verification must not own runtime lifecycle");
assert(candidate.includes("nx affected"), "candidate verification must remain affected-aware");

function collectFiles(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  const result = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(relative));
    else result.push(relative);
  }
  return result;
}

for (const file of collectFiles("services")) {
  if (!file.includes(`${path.sep}database${path.sep}migrations${path.sep}`)) continue;
  const contents = fs.readFileSync(path.join(root, file), "utf8");
  assert(!/(abandonedOperatorPhone|local-world|متجر العالم المحلي|is_synthetic|test_mode)/i.test(contents), `migrations must not contain synthetic world personas: ${file}`);
}

if (failures.length) {
  console.error("LOCAL_WORLD_CONTRACT=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("LOCAL_WORLD_CONTRACT=PASS");
console.log("ONE_LOCAL_WORLD_OWNER=1");
console.log("PUBLIC_WORLD_COMMANDS=ensure,status");
console.log("WORLD_STATUS_MUTATION_PATHS=0");
console.log("ZERO_STATE_OPERATOR_PATH=canonical-bootstrap-passkey");
console.log("DIRECT_WORLD_PARTNER_PROVISION_CALL=0");
console.log("LOCAL_WORLD_SQL_BUSINESS_MUTATION=0");
console.log("HISTORICAL_PERSONA_CLEANUP_HACKS=0");
console.log("WORLD_LOCATOR_TRACKED_IN_GIT=0");
console.log("NORMAL_RUNTIME_DEPENDS_ON_WORLD_TOOLING=0");
console.log("RESET_PURGE_INTERLOCK_STILL_PRESENT=1");
