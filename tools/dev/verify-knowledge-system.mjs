import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ensureKnowledgeRoot,
  readKnowledgePin,
  readKnowledgeSources,
} from "./knowledge-source.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });
const pin = readKnowledgePin();
const sources = readKnowledgeSources();
const failures = [];

function requireFile(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    failures.push(`missing repository-owned artifact: ${relative}`);
  }
}

for (const requiredPinned of [
  "GOVERNANCE-STANDARDS.md",
  "AGENTS.md",
  "governance/GOVERNANCE.md",
  "governance/policy/QUALITY.md",
  "tools/verify-knowledge.mjs",
]) {
  const absolute = path.join(knowledgeRoot, requiredPinned);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    failures.push(`pinned Governance missing required artifact: ${requiredPinned}`);
  }
}

const metaStandardPath = path.join(knowledgeRoot, "GOVERNANCE-STANDARDS.md");
if (fs.existsSync(metaStandardPath)) {
  const meta = fs.readFileSync(metaStandardPath, "utf8");
  for (const token of [
    "ARTIFACT_CLASS: GOVERNANCE_AND_AGENT_META_STANDARD",
    "PROJECT_SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
  ]) {
    if (!meta.includes(token)) failures.push(`pinned meta-standard missing authority boundary: ${token}`);
  }
}

try {
  execFileSync(process.execPath, [path.join(knowledgeRoot, "tools", "verify-knowledge.mjs")], {
    cwd: knowledgeRoot,
    stdio: "inherit",
  });
} catch {
  failures.push("pinned knowledge verifier failed");
}

for (const forbiddenRoot of ["governance", "docs", "tools/prompting"]) {
  if (fs.existsSync(path.join(root, forbiddenRoot))) {
    failures.push(`forbidden local/retired authority root exists: ${forbiddenRoot}`);
  }
}

if (fs.existsSync(path.join(root, "DESIGN.md"))) {
  failures.push("retired root DESIGN.md parallel design authority exists");
}

if (sources.schema !== 2) failures.push("knowledge manifest must use schema 2 immutable binding");
if (pin.repository !== "bthwani2-boop/governance-and-docs") {
  failures.push(`unexpected knowledge repository: ${pin.repository}`);
}
if (!/^[0-9a-f]{40}$/.test(pin.commit)) failures.push("knowledge pin is not an exact commit SHA");

for (const forbidden of ["branch", "branch_url"]) {
  if (forbidden in sources.governance) {
    failures.push(`governance binding must not carry floating provenance field: ${forbidden}`);
  }
}


for (const required of [
  "AGENTS.md",
  "knowledge.sources.json",
  "tools/dev/safe-push.ps1",
  "tools/dev/verify-local-candidate.ps1",
  "tools/dev/knowledge-source.mjs",
  "tools/dev/query-knowledge.mjs",
  "tools/dev/verify-agent-knowledge-contract.mjs",
  "tools/dev/verify-knowledge-references.mjs",
  ".github/pull_request_template.md",
  ".github/workflows/baseline-guard.yml",
  ".github/workflows/pr-policy.yml",
]) {
  requireFile(required);
}

const queryToolPath = path.join(root, "tools/dev/query-knowledge.mjs");
for (const args of [
  ["meta-standard"],
  ["list", "owners"],
  ["list", "policies"],
  ["list", "capabilities"],
  ["list", "journeys"],
  ["list", "references"],
  ["list", "quality-dimensions"],
]) {
  try {
    execFileSync(process.execPath, [queryToolPath, ...args], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    failures.push(`knowledge query behavior failed: ${args.join(" ")}`);
  }
}

if (failures.length) {
  console.error("KNOWLEDGE_SYSTEM_VERIFY=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("KNOWLEDGE_SYSTEM_VERIFY=PASS");
console.log(`KNOWLEDGE_REPOSITORY=${pin.repository}`);
console.log(`KNOWLEDGE_COMMIT=${pin.commit}`);
console.log("AGENT_LAW_OWNER=AGENTS.md");
console.log("LOCAL_PROMPT_PACKAGE_ROOT=0");
console.log("PINNED_GOVERNANCE_META_STANDARD=PASS");
