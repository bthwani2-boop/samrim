import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const data = (relative) => JSON.parse(read(relative));

const nx = data("nx.json");
const projects = [];
function discoverProjects(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".nx", ".next", "dist", "build", "coverage", ".cache"].includes(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) discoverProjects(absolute);
    else if (entry.isFile() && entry.name === "project.json") projects.push(path.relative(root, absolute).replaceAll(path.sep, "/"));
  }
}
discoverProjects(root);

function effectiveCache(targetName, target) {
  if (typeof target?.cache === "boolean") return target.cache;
  const inherited = nx.targetDefaults?.[targetName]?.cache;
  return typeof inherited === "boolean" ? inherited : false;
}

const runtimeCommand = /(playwright|next\s+dev|expo\s+(start|run)|docker\s+compose|verify-(?:identity|dsh)-runtime|verify-(?:identity-migrations|dsh-baseline)|build-ci-image)/i;
for (const file of projects) {
  const project = data(file);
  for (const [targetName, target] of Object.entries(project.targets ?? {})) {
    const command = target?.options?.command ?? "";
    const deterministicComposeRender = /docker\s+compose\b.*\bconfig\s+--quiet\b/i.test(command);
    if (runtimeCommand.test(command) && !deterministicComposeRender && effectiveCache(targetName, target)) {
      failures.push(file + ":" + targetName + " runtime/stateful command must be cache=false");
    }
  }
}

for (const [file, targetName, output] of [
  ["apps/control-panel/project.json", "typecheck", "{projectRoot}/.next/types"],
  ["apps/control-panel/project.json", "build", "{projectRoot}/.next"],
  ["tools/dev/project.json", "knowledge-materialize", "{workspaceRoot}/.cache/bthwani-knowledge"],
]) {
  const outputs = data(file).targets?.[targetName]?.outputs ?? [];
  if (!outputs.includes(output)) failures.push(file + ":" + targetName + " missing output " + output);
}

const control = data("apps/control-panel/project.json");
for (const targetName of ["typecheck", "build"]) {
  const inputs = control.targets?.[targetName]?.inputs ?? [];
  for (const required of ["default", "^default", "nodeToolchain", "controlPanelBuildEnvironment"]) {
    if (!inputs.includes(required)) failures.push("control-panel:" + targetName + " missing cache input " + required);
  }
}

const cpInputs = nx.namedInputs?.controlPanelBuildEnvironment ?? [];
const cpInputText = JSON.stringify(cpInputs);
for (const required of [
  "BTHWANI_SECRETS_ROOT",
  "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY",
  "DSH_API_BASE_URL",
  "IDENTITY_API_BASE_URL",
  "CONTROL_PANEL_SERVICE_TOKEN",
  "CONTROL_PANEL_PUBLIC_ORIGIN",
  "hash-control-panel-secret-input.mjs",
]) {
  if (!cpInputText.includes(required)) failures.push("controlPanelBuildEnvironment missing " + required);
}

const mobileInputs = JSON.stringify(nx.targetDefaults?.["export-smoke"]?.inputs ?? []);
for (const required of ["nodeToolchain", "mobileExportEnvironment", "export-mobile-smoke.mjs", "define-samrim-expo-app.cjs"]) {
  if (!mobileInputs.includes(required)) failures.push("export-smoke cache inputs missing " + required);
}
const mobileEnv = JSON.stringify(nx.namedInputs?.mobileExportEnvironment ?? []);
for (const required of ["GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT", "GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN", "GOOGLE_MAPS_ANDROID_API_KEY_APP_FIELD", "BTHWANI_SECRETS_ROOT", "hash-mobile-secret-input.mjs"]) {
  if (!mobileEnv.includes(required)) failures.push("mobileExportEnvironment missing " + required);
}

for (const [file, targets] of [
  ["services/identity/backend/project.json", ["build", "vet", "unit"]],
  ["services/identity/clients/go/project.json", ["vet", "unit"]],
  ["services/dsh/backend/project.json", ["build", "vet", "unit"]],
  ["services/wlt/backend/project.json", ["build", "vet", "unit"]],
]) {
  const project = data(file);
  for (const targetName of targets) {
    const inputs = project.targets?.[targetName]?.inputs ?? [];
    if (!inputs.includes("goToolchain")) failures.push(file + ":" + targetName + " missing goToolchain");
  }
}

for (const [file, targetName] of [
  [".github/project.json", "runtime-integration"],
  [".github/project.json", "runtime-images"],
  ["apps/control-panel/project.json", "e2e"],
  ["apps/control-panel/project.json", "browser-live-proof"],
  ["services/identity/backend/project.json", "migration-proof"],
  ["services/identity/backend/project.json", "runtime-proof"],
  ["services/identity/backend/project.json", "ci-image"],
  ["services/dsh/backend/project.json", "baseline-proof"],
  ["services/dsh/backend/project.json", "runtime-proof"],
  ["services/dsh/backend/project.json", "ci-image"],
  ["services/wlt/backend/project.json", "schema-proof"],
  ["services/wlt/backend/project.json", "ci-image"],
]) {
  if (data(file).targets?.[targetName]?.cache !== false) failures.push(file + ":" + targetName + " must explicitly set cache=false");
}

if (!read("tools/mobile/export-mobile-smoke.mjs").includes("fs.rmSync(distDir")) {
  failures.push("mobile export smoke no longer proves cleanup of transient output");
}

if (failures.length) {
  console.error("NX_CACHE_CONTRACTS=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}

console.log("NX_CACHE_CONTRACTS=PASS projects=" + projects.length + " runtime_cache=0 known_writers_declared=3 control_env_hashed=1");
