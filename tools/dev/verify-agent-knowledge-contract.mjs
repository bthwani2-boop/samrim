import fs from "node:fs";
import path from "node:path";
import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });
const failures = [];

function sourceRoot(relativePath) {
  return relativePath.startsWith("governance/") || relativePath.startsWith("docs/") ? knowledgeRoot : repoRoot;
}
function check(source, tokens, id) {
  const absolute = path.join(sourceRoot(source), ...source.split("/"));
  if (!fs.existsSync(absolute)) {
    failures.push(id + " missing source: " + source);
    return;
  }
  const body = fs.readFileSync(absolute, "utf8");
  for (const token of tokens) {
    if (!body.includes(token)) failures.push(id + " missing invariant in " + source + ": " + token);
  }
}

check("AGENTS.md", [
  "Never implement knowledge mechanically.",
  "No source has global precedence. Authority is fact-specific",
  "Before choosing a material solution, distinguish known facts, assumptions and decision-relevant unknowns",
  "surface the conflict as a blocker",
  "does not implicitly escalate environment or operation authority",
  "HEAD MOVED",
  "UNKNOWN EFFECT → AUTHORITATIVE RECONCILIATION",
  "affected prior evidence is stale",
  "SECURITY / PRIVACY / FINANCIAL / EXTERNAL EFFECTS",
  "capabilities, not authorization",
  "Production",
  "blind-retry an ambiguous external/financial mutation",
  "Do not ask for “next”",
  "A change is not complete because code compiles, a screenshot looks correct or CI is green.",
], "agent_operating_safety");

check("governance/GOVERNANCE.md", [
  "GOVERNANCE          = CURRENT DURABLE DECISION BASELINE",
  "DOCUMENTED != INFALLIBLE",
  "CONFLICT → DIAGNOSE → CORRECT THE WRONG OWNER",
], "governance_falsifiability");

check("docs/method/diagnosis-and-decision.md", [
  "Do not ask “what do the documents tell me to implement?”",
  "CURRENT ROOT CAUSE",
  "REQUIRED PROOF",
], "diagnosis_method");

check("docs/method/change-and-reconstruction.md", [
  "Credentials, authenticated tools, connected devices and reachable endpoints are capability, not authorization.",
  "Never blind-retry an ambiguous external or financial effect.",
  "DELETE LOSERS / RESIDUE",
], "change_method");

check("docs/method/verification-and-evidence.md", [
  "A green command proves only what it exercised.",
  "Do not rerun until green without diagnosis.",
  "KNOWN LOSING/SHADOW AUTHORITIES IN CONE = 0",
], "verification_method");

check("governance/policies/documentation-and-knowledge.md", [
  "EXACT KNOWLEDGE COMMIT SHA = ADMISSIBLE",
  "TRACKED LOCAL GOVERNANCE/DOCS MIRROR = FORBIDDEN",
], "cross_repository_pin");

check("governance/policies/providers-and-integrations.md", [
  "BLIND_FALLBACK_ON_UNKNOWN_MUTATION=0",
], "provider_unknown_outcome");

check("governance/product/FINANCIAL-MODEL.md", [
  "WLT is the sole authoritative owner of internal financial truth",
], "financial_truth");

check("governance/product/capabilities/access/account-privacy-lifecycle.md", [
  "actor_deleted_with_unrelated_roles",
  "dsh_mutates_wlt_for_privacy",
], "privacy_cross_owner");

for (const forbidden of [
  "governance/decisions",
  "governance/product/WORKFORCE-MODEL.md",
  "docs/platform-engineering-lifecycle",
  "docs/reference/target-operations",
  "tools/prompting",
]) {
  const absolute = path.join(sourceRoot(forbidden), ...forbidden.split("/"));
  if (fs.existsSync(absolute)) failures.push("forbidden live artifact exists: " + forbidden);
}

if (failures.length) {
  console.error("AGENT_KNOWLEDGE_CONTRACT=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
