import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureKnowledgeRoot, readKnowledgePin, readKnowledgeSources } from "./knowledge-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });
const pin = readKnowledgePin();
const sources = readKnowledgeSources();
const failures = [];

function requireFile(relative) {
  const absolute = path.join(repoRoot, ...relative.split("/"));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) failures.push("missing repository-owned artifact: " + relative);
  return absolute;
}

let knowledgeVerifierOutput = "";
try {
  knowledgeVerifierOutput = execFileSync(process.execPath, [path.join(knowledgeRoot, "tools", "verify-knowledge.mjs")], {
    cwd: knowledgeRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
} catch (error) {
  const stdout = String(error.stdout ?? "").trim();
  const stderr = String(error.stderr ?? "").trim();
  failures.push("pinned knowledge verifier failed" + (stdout ? "\n" + stdout : "") + (stderr ? "\n" + stderr : ""));
}

for (const forbiddenRoot of ["governance", "docs", "tools/prompting"]) {
  if (fs.existsSync(path.join(repoRoot, ...forbiddenRoot.split("/")))) failures.push("forbidden local/retired authority root exists: " + forbiddenRoot);
}

const legacyManifest = ["governance", "lock", "json"].join(".");
if (fs.existsSync(path.join(repoRoot, legacyManifest))) failures.push("retired knowledge manifest still exists: " + legacyManifest);

if (sources.schema !== 2) failures.push("knowledge manifest must use schema 2 immutable binding");
if (pin.repository !== "bthwani2-boop/governance-and-docs") failures.push("unexpected knowledge repository: " + pin.repository);
if (!/^[0-9a-f]{40}$/.test(pin.commit)) failures.push("knowledge pin is not an exact 40-character SHA");
for (const forbidden of ["branch", "branch_url"]) {
  if (forbidden in sources.governance) failures.push("governance binding must not carry floating provenance field: " + forbidden);
}
for (const forbidden of ["donor", "reference_indexes", "external_sources"]) {
  if (forbidden in sources) failures.push("consumer manifest duplicates canonical knowledge: " + forbidden);
}

for (const required of [
  "AGENTS.md",
  "knowledge.sources.json",
  "tools/dev/safe-push.ps1",
  "tools/dev/knowledge-source.mjs",
  "tools/dev/query-knowledge.mjs",
  "tools/dev/verify-agent-knowledge-contract.mjs",
  "tools/dev/verify-knowledge-references.mjs",
  "tools/dev/verify-pr-evidence.mjs",
  ".github/pull_request_template.md",
  ".github/workflows/baseline-guard.yml",
  ".github/workflows/pr-policy.yml",
]) requireFile(required);

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
  "governance/policy/QUALITY.md",
  "docs/reference",
  "function governanceOwners()",
  "function capabilityRecords()",
  "function referenceRecords()",
  "function qualityDimensions()",
  'rawId === "references"',
  'rawId === "quality-dimensions"',
]) if (!queryTool.includes(token)) failures.push("knowledge query tool missing source-derived behavior: " + token);

const prEvidence = fs.readFileSync(path.join(repoRoot, "tools/dev/verify-pr-evidence.mjs"), "utf8");
for (const token of [
  "ensureKnowledgeRoot",
  "QUALITY_DIMENSION",
  "GOVERNANCE_IMPACT",
  "PROVEN_UNAFFECTED",
  "N/A_WITH_REASON",
  "KNOWN_GOVERNANCE_DRIFT=0",
]) if (!prEvidence.includes(token)) failures.push("PR evidence verifier missing pinned-Governance behavior: " + token);

if (failures.length) {
  console.error("KNOWLEDGE_SYSTEM_VERIFY=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}

if (knowledgeVerifierOutput) console.log(knowledgeVerifierOutput);
console.log("KNOWLEDGE_SYSTEM_VERIFY=PASS");
console.log("KNOWLEDGE_MANIFEST=knowledge.sources.json");
console.log("KNOWLEDGE_REPOSITORY=" + pin.repository);
console.log("KNOWLEDGE_COMMIT=" + pin.commit);
console.log("AGENT_LAW_OWNER=AGENTS.md");
console.log("AGENT_LAW_VERIFIER=tools/dev/verify-agent-knowledge-contract.mjs");
console.log("QUALITY_CENSUS_SOURCE=governance/policy/QUALITY.md");
console.log("LOCAL_PROMPT_PACKAGE_ROOT=0");
