import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureKnowledgeRoot, readKnowledgePin } from "./knowledge-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });
const pin = readKnowledgePin();
const failures = [];

function requireFile(relative) {
  const absolute = path.join(repoRoot, ...relative.split("/"));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    failures.push("missing repository-owned artifact: " + relative);
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
  failures.push("pinned knowledge verifier failed" + (stdout ? "\n" + stdout : "") + (stderr ? "\n" + stderr : ""));
}

for (const forbiddenRoot of ["governance", "docs", "tools/prompting"]) {
  if (fs.existsSync(path.join(repoRoot, ...forbiddenRoot.split("/")))) {
    failures.push("forbidden local/retired authority root exists: " + forbiddenRoot);
  }
}

if (pin.repository !== "bthwani2-boop/governance-and-docs") failures.push("unexpected knowledge repository: " + pin.repository);
if (!/^[0-9a-f]{40}$/.test(pin.commit)) failures.push("knowledge pin is not an exact 40-character SHA");

requireTokens("AGENTS.md", [
  "Never implement knowledge mechanically.",
  "No source has global precedence. Authority is fact-specific",
  "Before choosing a material solution, distinguish known facts, assumptions and decision-relevant unknowns",
  "does not implicitly escalate environment or operation authority",
  "HEAD MOVED",
  "UNKNOWN EFFECT → AUTHORITATIVE RECONCILIATION",
  "affected prior evidence is stale",
  "capabilities, not authorization",
  "Production",
  "blind-retry an ambiguous external/financial mutation",
  "docs/method/diagnosis-and-decision.md",
  "docs/method/change-and-reconstruction.md",
  "docs/method/verification-and-evidence.md",
]);

for (const required of [
  "tools/dev/safe-push.ps1",
  "tools/dev/knowledge-source.mjs",
  "tools/dev/query-knowledge.mjs",
  "tools/dev/verify-agent-knowledge-contract.mjs",
  "tools/dev/verify-knowledge-references.mjs",
  ".github/workflows/baseline-guard.yml",
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
  "function governanceOwners()",
  "function capabilityRecords()",
]) {
  if (!queryTool.includes(token)) failures.push("knowledge query tool missing source-derived behavior: " + token);
}

if (failures.length) {
  console.error("KNOWLEDGE_SYSTEM_VERIFY=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}

if (knowledgeVerifierOutput) console.log(knowledgeVerifierOutput);
console.log("KNOWLEDGE_SYSTEM_VERIFY=PASS");
console.log("KNOWLEDGE_REPOSITORY=" + pin.repository);
console.log("KNOWLEDGE_COMMIT=" + pin.commit);
console.log("AGENT_SAFETY_CONTRACT=PASS");
console.log("LOCAL_PROMPT_PACKAGE_ROOT=0");
