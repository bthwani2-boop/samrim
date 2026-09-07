import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureKnowledgeRoot, readKnowledgePin } from "./knowledge-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });
const pin = readKnowledgePin();
const failures = [];

function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMarkdown(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(absolute);
  }
  return out.sort();
}

function requireFile(relative) {
  const absolute = path.join(repoRoot, ...relative.split("/"));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    failures.push("missing repository-owned knowledge/execution artifact: " + relative);
  }
  return absolute;
}

function requireTokens(relative, tokens) {
  const absolute = requireFile(relative);
  if (!fs.existsSync(absolute)) return;
  const body = fs.readFileSync(absolute, "utf8");
  for (const token of tokens) {
    if (!body.includes(token)) failures.push(relative + " missing required invariant: " + token);
  }
}

// The knowledge repository owns its own structure, capability catalog, Docs topology and semantic-owner census.
// The consuming implementation repository must not duplicate those inventories.
let knowledgeVerifierOutput = "";
try {
  knowledgeVerifierOutput = execFileSync(
    process.execPath,
    [path.join(knowledgeRoot, "tools", "verify-knowledge.mjs")],
    { cwd: knowledgeRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
} catch (error) {
  const stdout = String(error.stdout ?? "").trim();
  const stderr = String(error.stderr ?? "").trim();
  failures.push("pinned knowledge repository verifier failed" + (stdout ? "\n" + stdout : "") + (stderr ? "\n" + stderr : ""));
}

for (const forbiddenLocalRoot of ["governance", "docs"]) {
  if (fs.existsSync(path.join(repoRoot, forbiddenLocalRoot))) {
    failures.push("tracked/local knowledge authority must not exist in samrim root: " + forbiddenLocalRoot);
  }
}

if (pin.repository !== "bthwani2-boop/governance-and-docs") {
  failures.push("unexpected knowledge repository: " + pin.repository);
}
if (!/^[0-9a-f]{40}$/.test(pin.commit)) failures.push("knowledge pin is not an exact 40-character SHA");

const requiredOrchestrator = [
  "tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md",
  "tools/prompting/bthwani-orchestrator/01-SCOPE-AUTHORITY-RULES.md",
  "tools/prompting/bthwani-orchestrator/02-DIAGNOSE-ROOT-CAUSE.md",
  "tools/prompting/bthwani-orchestrator/03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md",
  "tools/prompting/bthwani-orchestrator/04-VERIFY-REDIAGNOSE-CLOSE.md",
  "tools/prompting/bthwani-orchestrator/05-EXECUTION-PLAYBOOK.md",
  "tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md",
  "tools/prompting/bthwani-orchestrator/profiles/structural-substrate.md",
  "tools/prompting/bthwani-orchestrator/verify/evidence-falsification.md",
  "tools/prompting/bthwani-orchestrator/verify/structural-conformance.md",
  "tools/prompting/bthwani-orchestrator/verify/unit-and-scope-closure.md",
  "tools/prompting/bthwani-orchestrator/templates/candidate-proof-matrix.md",
];
for (const relative of requiredOrchestrator) requireFile(relative);

for (const retired of [
  "tools/prompting/bthwani-refoundation",
  "tools/prompting/bthwani-orchestrator/profiles/foundation-construction.md",
  "tools/prompting/bthwani-orchestrator/verify/structural-qualification.md",
  "tools/prompting/bthwani-orchestrator/verify/unit-fixed-point.md",
  "tools/prompting/bthwani-orchestrator/templates/bthwani-target-qualification.md",
  "tools/prompting/bthwani-orchestrator/templates/required-truth-census.md",
  "tools/prompting/bthwani-orchestrator/templates/donor-zero-loss-accounting.md",
  "tools/dev/close-foundation-runtime.ps1",
  "tools/dev/verify-foundation-runtime.ps1",
  "tools/dev/verify-foundation-local.ps1",
]) {
  if (fs.existsSync(path.join(repoRoot, ...retired.split("/")))) failures.push("retired execution artifact remains: " + retired);
}

requireTokens("tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md", [
  "There is one execution cycle, not a mandatory stage pipeline",
  "KNOWLEDGE_PIN: governance.lock.json",
  "AUTHORIZED-SCOPE FIXED POINT",
]);
requireTokens("tools/prompting/bthwani-orchestrator/01-SCOPE-AUTHORITY-RULES.md", [
  "Repository/branch mutation authority is not runtime/environment authority.",
  "CREDENTIAL_POSSESSION != AUTHORITY",
  "PRODUCTION_EXPLICIT",
]);
requireTokens("tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md", [
  "ACTIVE_SLICE_DONOR_CONE_ACCOUNTING=COMPLETE",
  "UNINSPECTED_DONOR_HISTORY_MATERIAL_TO_ACTIVE_SLICE=0",
]);
requireTokens("tools/prompting/bthwani-orchestrator/verify/evidence-falsification.md", [
  "BLIND_RERUN_UNTIL_GREEN = FORBIDDEN",
  "FAILURE_SUPPRESSION/ALLOWLIST_TO_MANUFACTURE_GREEN = FORBIDDEN",
  "No documentation-only closure",
]);

const orchestratorRoot = path.join(repoRoot, "tools", "prompting", "bthwani-orchestrator");
const orchestratorFiles = collectMarkdown(orchestratorRoot);
for (const file of orchestratorFiles) {
  const body = fs.readFileSync(file, "utf8");
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  if (/^SEMANTIC_OWNER:/m.test(body)) failures.push(relative + " must not become a durable semantic owner");
}

const focusFiles = collectMarkdown(path.join(orchestratorRoot, "focus"));
if (focusFiles.length !== 3) failures.push("expected exactly three Orchestrator focus lenses; found " + focusFiles.length);
for (const file of focusFiles) {
  const body = fs.readFileSync(file, "utf8");
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  if (!body.includes("ARTIFACT_CLASS: ORCHESTRATOR_EXECUTION_FOCUS_LENS")) failures.push(relative + " missing focus-lens class");
  if (!body.includes("DURABLE_SEMANTIC_AUTHORITY: NONE")) failures.push(relative + " missing semantic non-authority");
}

const templateFiles = collectMarkdown(path.join(orchestratorRoot, "templates"));
const templateRel = templateFiles.map((file) => path.relative(repoRoot, file).split(path.sep).join("/"));
if (templateRel.length !== 1 || templateRel[0] !== "tools/prompting/bthwani-orchestrator/templates/candidate-proof-matrix.md") {
  failures.push("Orchestrator templates must contain only candidate-proof-matrix.md");
}

const packageJsonText = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
for (const token of ["runtime:foundation:", "foundation:runtime:", "foundation:local:"]) {
  if (packageJsonText.includes(token)) failures.push("package.json retains retired runtime command family: " + token);
}
const composeText = fs.readFileSync(path.join(repoRoot, "infra/local/compose/compose.yaml"), "utf8");
if (/profiles:\s*\[[^\]]*"foundation"/i.test(composeText)) failures.push("compose retains retired foundation profile");

const queryTool = fs.readFileSync(path.join(repoRoot, "tools/dev/query-knowledge.mjs"), "utf8");
for (const token of [
  "ensureKnowledgeRoot",
  "governance/product/capabilities",
  "governance/product/JOURNEYS.md",
  "function governanceOwners()",
  "function capabilityRecords()",
]) {
  if (!queryTool.includes(token)) failures.push("knowledge query tool missing source-derived behavior: " + token);
}

if (failures.length) {
  console.error("KNOWLEDGE_SYSTEM_VERIFY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

if (knowledgeVerifierOutput) console.log(knowledgeVerifierOutput);
console.log("KNOWLEDGE_SYSTEM_VERIFY=PASS");
console.log("KNOWLEDGE_REPOSITORY=" + pin.repository);
console.log("KNOWLEDGE_COMMIT=" + pin.commit);
console.log("ORCHESTRATOR_MARKDOWN=" + orchestratorFiles.length);
