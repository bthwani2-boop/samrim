import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];

const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));
const exists = (relative) => fs.existsSync(path.join(root, relative));

function requireText(relative, needle, label) {
  const value = read(relative);
  if (!value.includes(needle)) failures.push(label + ": missing " + needle + " in " + relative);
}

function forbidText(relative, pattern, label) {
  const value = read(relative);
  if (pattern.test(value)) failures.push(label + ": forbidden pattern in " + relative + " -> " + pattern);
}

const expectedWorkflows = [
  "backend-integration.yml",
  "baseline-guard.yml",
  "pr-policy.yml",
  "secret-safety.yml",
].sort();
const workflowDir = path.join(root, ".github", "workflows");
const workflows = fs.readdirSync(workflowDir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml")).sort();
if (JSON.stringify(workflows) !== JSON.stringify(expectedWorkflows)) {
  failures.push("workflow set drifted: expected=" + expectedWorkflows.join(",") + " observed=" + workflows.join(","));
}
if (exists(".github/workflows/control-panel-e2e.yml")) failures.push("superseded Control Panel runtime workflow still exists");

const expectedNames = new Map([
  ["baseline-guard.yml", "name: CI Static"],
  ["backend-integration.yml", "name: CI Runtime"],
  ["secret-safety.yml", "name: CI Security"],
  ["pr-policy.yml", "name: CI Policy"],
]);
for (const [file, name] of expectedNames) requireText(".github/workflows/" + file, name, "canonical CI gate name");

const projectFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".kilo", ".nx", ".next", "dist", "build", "coverage"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name === "project.json") projectFiles.push(full);
  }
}
walk(root);

for (const file of projectFiles) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const project = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const tag of project.tags ?? []) {
    if (typeof tag === "string" && tag.startsWith("ci-")) failures.push(relative + ": superseded CI scope tag remains: " + tag);
  }
}

const repositoryCi = json(".github/project.json");
const expectedRuntimeDeps = ["control-panel", "dsh-backend", "identity-backend", "infra", "wlt-backend", "workspace-tooling"].sort();
const actualRuntimeDeps = [...(repositoryCi.implicitDependencies ?? [])].sort();
if (JSON.stringify(actualRuntimeDeps) !== JSON.stringify(expectedRuntimeDeps)) {
  failures.push("repository-ci runtime dependency cone drifted");
}
if (repositoryCi.targets?.["runtime-integration"]?.cache !== false) failures.push("repository-ci:runtime-integration must be cache=false");
if (repositoryCi.targets?.["go-workspace-sync"]?.cache !== true) failures.push("repository-ci:go-workspace-sync must be cache=true");
if (repositoryCi.targets?.["tooling-lint"]?.cache !== true) failures.push("repository-ci:tooling-lint must be cache=true");

const uncachedRuntimeTargets = [
  ["apps/control-panel/project.json", "e2e"],
  ["apps/control-panel/project.json", "e2e-live"],
  ["services/identity/backend/project.json", "migration-proof"],
  ["services/identity/backend/project.json", "runtime-proof"],
  ["services/dsh/backend/project.json", "baseline-proof"],
  ["services/dsh/backend/project.json", "runtime-proof"],
  ["services/wlt/backend/project.json", "schema-proof"],
];
for (const [file, target] of uncachedRuntimeTargets) {
  if (json(file).targets?.[target]?.cache !== false) failures.push(file + ": " + target + " must be cache=false");
}

const localVerifier = "tools/dev/verify-local-candidate.ps1";
forbidText(localVerifier, /git\s+-C\s+\$Repo\s+diff\s+--name-only/i, "parallel local affected engine");
forbidText(localVerifier, /--changed\s+--since/i, "parallel local affected engine");
requireText(localVerifier, "nx affected -t lint format-check typecheck unit contract build vet export-smoke", "canonical local affected targets");

const staticCi = ".github/workflows/baseline-guard.yml";
forbidText(staticCi, /biome\s+(ci|lint)[^\n]*--changed/i, "parallel CI affected engine");
forbidText(staticCi, /\bgo work sync\b/, "mutating Go workspace verification");
requireText(staticCi, "repository-ci:go-workspace-sync", "canonical Go workspace proof");
requireText(staticCi, "nx affected -t lint,format-check,typecheck,unit,contract,build,export-smoke,vet", "canonical static affected targets");

const runtimeCi = ".github/workflows/backend-integration.yml";
forbidText(runtimeCi, /node\s+tools\/dev\/verify-(identity|dsh)-/i, "direct runtime proof outside Nx");
forbidText(runtimeCi, /pnpm\s+--dir\s+apps\/control-panel\s+test:e2e:live/i, "direct browser proof outside Nx");
forbidText(runtimeCi, /tag:ci-/i, "superseded CI tag scope");
requireText(runtimeCi, "--projects=repository-ci", "canonical runtime scope");
requireText(runtimeCi, "repository-ci:runtime-integration", "canonical runtime integration target");

if (failures.length > 0) {
  console.error("EXECUTION_PROOF_SYSTEM=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("EXECUTION_PROOF_SYSTEM=PASS");
console.log("CI_WORKFLOWS=4");
console.log("PARALLEL_AFFECTED_ENGINES=0");
console.log("CI_SCOPE_TAGS=0");
console.log("DIRECT_RUNTIME_PROOFS_IN_YAML=0");
