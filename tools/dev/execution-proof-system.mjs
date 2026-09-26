import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const self = "tools/dev/execution-proof-system.mjs";
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const data = (p) => JSON.parse(read(p));

const workflows = fs.readdirSync(path.join(root, ".github/workflows"))
  .filter((x) => /\.ya?ml$/.test(x))
  .sort();
const expected = ["ci-policy.yml","ci-runtime.yml","ci-security.yml","ci-static.yml"];
if (JSON.stringify(workflows) !== JSON.stringify(expected)) failures.push("workflow set drifted");

for (const [file, name] of [
  ["ci-static.yml","name: CI Static"],
  ["ci-runtime.yml","name: CI Runtime"],
  ["ci-security.yml","name: CI Security"],
  ["ci-policy.yml","name: CI Policy"],
]) {
  if (!read(".github/workflows/" + file).includes(name)) failures.push(file + ": canonical gate name missing");
}

const legacy = ["backend-integration.yml","baseline-guard.yml","control-panel-e2e.yml","pr-policy.yml","secret-safety.yml"];
const tracked = execFileSync("git", ["ls-files","-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
for (const file of tracked) {
  const rel = file.replaceAll("\\","/");
  if (rel === self) continue;
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
  const bytes = fs.readFileSync(abs);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const old of legacy) if (text.includes(old)) failures.push(rel + ": legacy workflow reference " + old);
}

const projects = tracked.filter((x) => /(^|\/)project\.json$/.test(x));
for (const file of projects) {
  const project = data(file);
  for (const tag of project.tags ?? []) if (String(tag).startsWith("ci-")) failures.push(file + ": retired CI scope tag " + tag);
}

const ci = data(".github/project.json");
const wantedDeps = ["control-panel","dsh-backend","identity-backend","infra","wlt-backend","workspace-tooling"].sort();
if (JSON.stringify([...(ci.implicitDependencies ?? [])].sort()) !== JSON.stringify(wantedDeps)) failures.push("repository-ci dependency cone drifted");
if (ci.targets?.["runtime-integration"]?.cache !== false) failures.push("runtime-integration must be cache=false");
if (ci.targets?.["execution-proof-system"]?.cache !== true) failures.push("execution-proof-system must be cache=true");
for (const old of ["tooling-lint","go-workspace-sync"]) if (ci.targets?.[old]) failures.push("repository-ci duplicate target " + old);

const tooling = data("tools/dev/project.json");
for (const target of ["lint","go-workspace-sync","structural-hygiene","knowledge-materialize"]) {
  if (tooling.targets?.[target]?.cache !== true) failures.push("workspace-tooling:" + target + " must be cache=true");
}
const knowledgeOutput = tooling.targets?.["knowledge-materialize"]?.outputs ?? [];
if (!knowledgeOutput.includes("{workspaceRoot}/.cache/bthwani-knowledge")) failures.push("knowledge-materialize stable output missing");
const structural = JSON.stringify(tooling.targets?.["structural-hygiene"]?.inputs ?? []);
if (!structural.includes("git ls-files -s") || !structural.includes("git ls-files --eol")) failures.push("structural-hygiene Git index inputs missing");
for (const workflow of expected) {
  if (!(tooling.namedInputs?.knowledge ?? []).includes("{workspaceRoot}/.github/workflows/" + workflow)) failures.push("knowledge input missing " + workflow);
}

for (const [file,target] of [
  ["apps/control-panel/project.json","e2e"],
  ["apps/control-panel/project.json","browser-live-proof"],
  ["services/identity/backend/project.json","migration-proof"],
  ["services/identity/backend/project.json","runtime-proof"],
  ["services/dsh/backend/project.json","baseline-proof"],
  ["services/dsh/backend/project.json","runtime-proof"],
  ["services/wlt/backend/project.json","schema-proof"],
]) {
  if (data(file).targets?.[target]?.cache !== false) failures.push(file + ":" + target + " must be cache=false");
}
if (data("apps/control-panel/project.json").targets?.["e2e-live"]) failures.push("duplicate control-panel:e2e-live remains");

for (const app of ["app-client","app-partner","app-captain","app-field"]) {
  const deps = data("apps/" + app + "/project.json").implicitDependencies ?? [];
  if (!deps.includes("mobile-tooling")) failures.push(app + ": mobile-tooling dependency edge missing");
}

for (const [file,targets] of [
  ["services/identity/backend/project.json",["build","vet","unit"]],
  ["services/identity/clients/go/project.json",["vet","unit"]],
  ["services/dsh/backend/project.json",["build","vet","unit"]],
  ["services/wlt/backend/project.json",["build","vet","unit"]],
]) {
  const project = data(file);
  for (const target of targets) {
    if (!(project.targets?.[target]?.inputs ?? []).includes("goToolchain")) failures.push(file + ":" + target + " missing goToolchain input");
  }
}

const local = read("tools/dev/verify-local-candidate.ps1");
if (local.includes("git -C $Repo diff --name-only") || local.includes("--changed --since")) failures.push("local parallel affected engine remains");
if (!local.includes("nx affected -t lint format-check typecheck unit contract build vet export-smoke")) failures.push("local Nx affected target set drifted");
if (!local.includes("workspace-tooling:lint")) failures.push("local tooling lint owner drifted");

const staticCi = read(".github/workflows/ci-static.yml");
if (staticCi.includes("--changed --since") || staticCi.includes("go work sync")) failures.push("static CI parallel/mutating proof remains");
if (staticCi.includes("run: node tools/dev/knowledge-source.mjs")) failures.push("static CI bypasses Nx for knowledge materialization");
for (const required of ["workspace-tooling:knowledge-materialize","workspace-tooling:lint","workspace-tooling:go-workspace-sync","repository-ci:execution-proof-system","nx affected -t lint,format-check,typecheck,unit,contract,build,export-smoke,vet","actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"]) {
  if (!staticCi.includes(required)) failures.push("static CI missing " + required);
}

const runtimeCi = read(".github/workflows/ci-runtime.yml");
for (const forbidden of ["node tools/dev/verify-identity-","node tools/dev/verify-dsh-","pnpm --dir apps/control-panel test:e2e:live","tag:ci-"]) {
  if (runtimeCi.includes(forbidden)) failures.push("runtime CI direct/shadow proof remains: " + forbidden);
}
for (const required of [
  "--projects=repository-ci",
  "repository-ci:runtime-integration",
  "docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f",
  "docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8",
  "cache-from: type=gha",
  "github.event_name != 'pull_request'",
  "up -d --no-build",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
]) if (!runtimeCi.includes(required)) failures.push("runtime CI missing " + required);
if (!read(".github/workflows/ci-security.yml").includes("node tools/dev/verify-secret-safety.mjs")) failures.push("security verifier owner drifted");

if (failures.length) {
  console.error("EXECUTION_PROOF_SYSTEM=FAIL");
  for (const item of [...new Set(failures)].sort()) console.error("  " + item);
  process.exit(1);
}
console.log("EXECUTION_PROOF_SYSTEM=PASS workflows=4 legacy_refs=0 parallel_affected=0 ci_scope_tags=0 duplicate_owners=0");
