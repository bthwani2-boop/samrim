import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const data = (relative) => JSON.parse(read(relative));

const nx = data("nx.json");
const nxIgnore = read(".nxignore").split(/\r?\n/).map((entry) => entry.trim());
if (!nxIgnore.includes(".kilo/worktrees/")) failures.push("Nx must ignore local auxiliary worktrees");
const ciProject = data(".github/project.json");
const executionProofInputs = ciProject.targets?.["execution-proof-system"]?.inputs ?? [];
if (executionProofInputs.includes("{workspaceRoot}/**/*")) failures.push("repository-ci:execution-proof-system must not hash the entire repository");
for (const required of [
  "{workspaceRoot}/AGENTS.md",
  "{workspaceRoot}/REPOSITORY-STRUCTURE.md",
  "{workspaceRoot}/knowledge.sources.json",
  "{workspaceRoot}/**/project.json",
  "{workspaceRoot}/tools/dev/runtime-proof/**/*",
  "{workspaceRoot}/tools/dev/verify-dsh-runtime-core.mjs",
  "{workspaceRoot}/tools/dev/verify-dsh-location-runtime.mjs",
]) {
  if (!executionProofInputs.includes(required)) failures.push("repository-ci:execution-proof-system missing causal input " + required);
}

const tooling = data("tools/dev/project.json");
if (tooling.namedInputs?.repository) failures.push("workspace-tooling retains ambiguous repository-wide named input");
const trackedRepositoryContent = JSON.stringify(tooling.namedInputs?.trackedRepositoryContent ?? []);
if (!trackedRepositoryContent.includes("git ls-files -s")) failures.push("trackedRepositoryContent must use canonical Git index hashes");
if (!trackedRepositoryContent.includes("git diff --binary HEAD --")) failures.push("trackedRepositoryContent must hash dirty tracked-file content");
if (trackedRepositoryContent.includes("{workspaceRoot}/**/*")) failures.push("trackedRepositoryContent must not make Nx re-hash the whole workspace tree");
const repositoryStructure = JSON.stringify(tooling.namedInputs?.repositoryStructure ?? []);
for (const required of ["REPOSITORY-STRUCTURE.md", "**/project.json", "git ls-files"]) {
  if (!repositoryStructure.includes(required)) failures.push("repositoryStructure cache input missing " + required);
}
const structuralHygiene = JSON.stringify(tooling.namedInputs?.structuralHygiene ?? []);
for (const required of ["git ls-files -s", "git ls-files --eol", "git diff --binary HEAD --", ".gitattributes", "**/package.json", "**/project.json"]) {
  if (!structuralHygiene.includes(required)) failures.push("structuralHygiene cache input missing " + required);
}
const knowledgeInputs = tooling.namedInputs?.knowledge ?? [];
if (!knowledgeInputs.includes("{workspaceRoot}/**/*.md")) failures.push("knowledge cache input must cover Markdown files scanned by knowledge verifiers");
const runtimeOwnershipInputs = tooling.namedInputs?.runtimeOwnership ?? [];
for (const required of [
  "{workspaceRoot}/apps/control-panel/tests/00-live-identity.spec.ts",
  "{workspaceRoot}/apps/control-panel/tests/finance-runtime.spec.ts",
  "{workspaceRoot}/apps/control-panel/tests/live-identity-proof-helpers.ts",
  "{workspaceRoot}/apps/control-panel/tests/zz-dsh-operator.spec.ts",
  "{workspaceRoot}/.github/workflows/ci-runtime.yml",
  "{workspaceRoot}/go.work",
  "{workspaceRoot}/services/dsh/backend/project.json",
  "{projectRoot}/scr.ps1",
  "{projectRoot}/check-local.ps1",
  "{projectRoot}/verify-local-candidate.ps1",
  "{projectRoot}/safe-push.ps1",
  "{projectRoot}/run-ci-runtime-proof.mjs",
  "{projectRoot}/verify-dsh-runtime-core.mjs",
  "{projectRoot}/verify-dsh-location-runtime.mjs",
  "{projectRoot}/runtime-proof/trusted-executables.mjs",
]) {
  if (!runtimeOwnershipInputs.includes(required)) failures.push("runtimeOwnership cache input missing " + required);
}
if (!JSON.stringify(runtimeOwnershipInputs).includes("pwsh --version")) failures.push("runtimeOwnership cache input missing PowerShell tool version");
const workspaceDependencyInputs = tooling.namedInputs?.workspaceDependencies ?? [];
for (const required of [
  "{workspaceRoot}/apps/**/*.{ts,tsx,js,jsx,mjs,cjs,go}",
  "{workspaceRoot}/services/**/*.{ts,tsx,js,jsx,mjs,cjs,go}",
  "{workspaceRoot}/packages/**/*.{ts,tsx,js,jsx,mjs,cjs,go}",
  "{workspaceRoot}/apps/**/package.json",
  "{workspaceRoot}/services/**/package.json",
  "{workspaceRoot}/packages/**/package.json",
  "{workspaceRoot}/contracts/package.json",
  "{projectRoot}/verify-workspace-dependencies.mjs",
]) {
  if (!workspaceDependencyInputs.includes(required)) failures.push("workspaceDependencies cache input missing " + required);
}

const projects = [];
function discoverProjects(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".nx", ".next", ".kilo", "dist", "build", "coverage", ".cache"].includes(entry.name)) continue;
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

const generatedInputPath = /(?:^|\/)(?:\.nx|\.next|dist|build|coverage|\.cache|\.tmp)(?:\/|$)/;
function collectDeclaredInputPaths(inputs, project, seen = new Set()) {
  const paths = [];
  for (const input of inputs ?? []) {
    if (typeof input === "string") {
      const projectNamed = project.namedInputs?.[input];
      const workspaceNamed = nx.namedInputs?.[input];
      const named = projectNamed ?? workspaceNamed;
      if (named && !seen.has(input)) {
        const nextSeen = new Set(seen);
        nextSeen.add(input);
        paths.push(...collectDeclaredInputPaths(named, project, nextSeen));
      } else if (input.includes("{workspaceRoot}") || input.includes("{projectRoot}")) {
        paths.push(input);
      }
      continue;
    }
    if (input && typeof input === "object" && typeof input.fileset === "string") paths.push(input.fileset);
  }
  return paths;
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

    if (effectiveCache(targetName, target)) {
      const declaredInputs = target?.inputs ?? nx.targetDefaults?.[targetName]?.inputs ?? [];
      for (const inputPath of collectDeclaredInputPaths(declaredInputs, project)) {
        const normalized = inputPath.replaceAll("\\", "/");
        if (generatedInputPath.test(normalized)) {
          failures.push(file + ":" + targetName + " cache input must not consume volatile/generated path " + inputPath);
        }
      }
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
  ["apps/control-panel/project.json", "e2e"],
  ["apps/control-panel/project.json", "browser-live-proof"],
  ["services/identity/backend/project.json", "migration-proof"],
  ["services/identity/backend/project.json", "runtime-proof"],
  ["services/identity/backend/project.json", "ci-image"],
  ["services/dsh/backend/project.json", "baseline-proof"],
  ["services/dsh/backend/project.json", "runtime-proof"],
  ["apps/control-panel/project.json", "dsh-runtime-checker-fixture"],
  ["services/dsh/backend/project.json", "ci-image"],
  ["services/wlt/backend/project.json", "schema-proof"],
  ["services/wlt/backend/project.json", "financial-invariants"],
  ["services/wlt/backend/project.json", "ci-image"],
  ["tools/dev/runtime-proof/project.json", "resolve"],
]) {
  if (data(file).targets?.[targetName]?.cache !== false) failures.push(file + ":" + targetName + " must explicitly set cache=false");
}
if (ciProject.targets?.["runtime-images"]) failures.push("repository-ci must not own a blanket runtime-images target");

if (!read("tools/mobile/export-mobile-smoke.mjs").includes("fs.rmSync(distDir")) {
  failures.push("mobile export smoke no longer proves cleanup of transient output");
}

if (failures.length) {
  console.error("NX_CACHE_CONTRACTS=FAIL");
  for (const failure of [...new Set(failures)].toSorted(compareStrings)) console.error("  " + failure);
  process.exit(1);
}

console.log("NX_CACHE_CONTRACTS=PASS projects=" + projects.length + " runtime_cache=0 causal_repository_inputs=1 volatile_generated_inputs=0 known_writers_declared=3 control_env_hashed=1");
