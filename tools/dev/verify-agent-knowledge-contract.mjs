import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });
const failures = [];

function sourceRoot(relativePath) {
  return relativePath.startsWith("governance/") || relativePath.startsWith("docs/") ? knowledgeRoot : repoRoot;
}

function read(relativePath) {
  const absolute = path.join(sourceRoot(relativePath), ...relativePath.split("/"));
  if (!fs.existsSync(absolute)) {
    failures.push("missing source: " + relativePath);
    return "";
  }
  return fs.readFileSync(absolute, "utf8").replaceAll("\r\n", "\n");
}

function requireTokens(relativePath, tokens, id) {
  const body = read(relativePath);
  for (const token of tokens) {
    if (!body.includes(token)) failures.push(id + " missing invariant in " + relativePath + ": " + token);
  }
  return body;
}

function forbidTokens(relativePath, tokens, id) {
  const body = read(relativePath);
  for (const token of tokens) {
    if (body.includes(token)) failures.push(id + " forbidden token in " + relativePath + ": " + token);
  }
  return body;
}

const agentBody = requireTokens("AGENTS.md", [
  "REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL",
  "MATERIAL = capable of changing behavior, meaning, authority, safety",
  "THIS FILE IS HARD SEMANTIC OPERATING LAW, NOT OPTIONAL GUIDANCE OR A CHECKLIST.",
  "END-TO-END OWNERSHIP IS NON-DELEGABLE.",
  "OWN THE MATERIAL OUTCOME, NOT THE PATCH, FILE OR REQUESTED STEP.",
  "ONE MATERIAL TASK → ONE PRIMARY AGENT → ONE RECONCILED EVIDENCE MODEL → ONE FINAL DECISION / INTEGRATION / CLOSURE AUTHORITY.",
  "SUBAGENT CONSENSUS != PROOF.",
  "the primary agent MUST decompose material uncertainty into independent diagnostic, research, specialist and adversarial inquiries",
  "OVERLAPPING MUTABLE CONES MUST SERIALIZE",
  "No source has global precedence. Authority is fact-specific",
  "CENSUS THE EVIDENCE CLASSES CAPABLE OF CHANGING IT",
  "prefer current primary/official sources",
  "PRE-EXISTING STATE HAS NO PRESUMPTION OF CORRECTNESS.",
  "READINESS PRECEDES IMPLEMENTATION.",
  "DEPTH IS MANDATORY; BREADTH IS EVIDENCE-DRIVEN.",
  "A FINDING IS EVIDENCE, NOT TREATMENT.",
  "TREAT THE HIGHEST PROVEN CAUSAL ROOT.",
  "CHOOSE THE MINIMUM COMPLETE CANONICAL TREATMENT. MINIMUM != PARTIAL.",
  "refound only when the structure itself is a proven causal defect",
  "ONE MATERIAL MEANING → ONE SEMANTIC OWNER",
  "NOTHING NEW IS ADMITTED BY DEFAULT.",
  "EVERY SURVIVING MATERIAL ARTIFACT IN THE AFFECTED CONE MUST RE-EARN ITS RIGHT TO EXIST.",
  "COMPATIBILITY_JUST_IN_CASE = FORBIDDEN.",
  "legal/license/asset provenance",
  "CAPABILITY != AUTHORITY.",
  "UNKNOWN CONSEQUENTIAL EFFECT → AUTHORITATIVE RECONCILIATION",
  "AUDIT-ONLY IS NOT COMPLETION.",
  "NEVER CHECKPOINT A KNOWN UNSAFE MIXED STATE",
  "REPOSITORY-OWNED SAFE PUSH",
  "CI / PR ARE INTEGRATION ASSURANCE, NOT SUBSTITUTES FOR DIAGNOSIS, CLAIM-SPECIFIC PROOF OR REAL-RUNTIME VERIFICATION.",
  "SKIPPED / NOT-RUN / STALE REQUIRED EVIDENCE != PASS.",
  "ONE MATERIAL CLAIM → ONE PRIMARY CI OWNER.",
  "Bot-authored dependency PRs may use a bounded machine policy instead of human prose",
  "USER EXPERIENCE IS A SYSTEM OUTCOME, NOT SCREEN AESTHETICS.",
  "DESIGN READINESS PRECEDES UI IMPLEMENTATION",
  "Prefer the canonical design system plus current primary platform and accessibility guidance.",
  "Every visible control and persistent visual/interaction pattern must earn user-task value",
  "TOOLS / TESTS / CI / GUARDS / MANIFESTS / REPORTS ARE EVIDENCE PRODUCERS",
  "MISSING REQUIRED EVIDENCE = OPEN PROOF LIMIT, NOT PASS.",
  "PASS AFTER AN UNEXPLAINED FAILURE != CLOSED.",
  "temporary exception requires a real bounded transition and an explicit removal condition.",
  "Runtime evidence is valid only when the tested process/app/build/config/database/provider mode is attributable to the claimed exact candidate.",
  "tracked declarations do not prove live state",
  "MATERIAL INTERACTIVE BEHAVIOR MUST BE EXERCISED IN THE REAL AUTHORIZED RUNTIME.",
  "WEB INTERACTION / JOURNEYS → PLAYWRIGHT",
  "MOBILE REPEATABLE JOURNEYS → MAESTRO",
  "MOBILE EXPLORATION / CONTROL / INSPECTION → AGENT-DEVICE",
  "LOW-LEVEL ANDROID / PROCESS / PACKAGE / LOG DIAGNOSIS → ADB",
  "preserve the same material actor, authorization, candidate provenance and state/test-data lineage across surfaces",
  "visual/responsive, accessibility, localization/directionality, theme, keyboard/input and permission states",
  "If repeatable automation is genuinely unavailable, keep the regression claim open with an explicit proof limit",
  "TREATMENT DOES NOT PROVE CLOSURE.",
  "FRESH ADVERSARIAL RE-CENSUS FROM THE RESULTING EXACT STATE AS IF THE PRIOR FINDING LIST DID NOT EXIST",
  "KNOWN PARALLEL / SHADOW TRUTH = 0",
], "agent_constitution");

forbidTokens("AGENTS.md", [
  "docs/method/",
  "tools/prompting",
  "LEVEL_4",
  "ACTIVE_SLICE",
  "FULL_TARGET",
  "RECOVERY_FRONTIER",
  "NEXT_REQUIRED_ACTION",
  "UNIT_CLOSED",
  "CAMPAIGN_COMPLETE",
  "CURRENT_CAUSAL_ROOT",
  "AUTHORIZED_SCOPE_FIXED_POINT",
], "agent_constitution");

if (agentBody.length > 20000) {
  failures.push("AGENTS.md exceeds compact-contract ceiling: " + agentBody.length + " bytes");
}

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .map((item) => item.replaceAll("\\", "/"));

const agentLawFiles = tracked.filter((item) => /(^|\/)AGENTS\.md$/i.test(item));
if (agentLawFiles.length !== 1 || agentLawFiles[0] !== "AGENTS.md") {
  failures.push("AGENTS.md must be the only tracked AGENTS law owner; found: " + agentLawFiles.join(", "));
}

const unexpectedInstructionFiles = tracked.filter((item) => /\.instructions\.md$/i.test(item));
if (unexpectedInstructionFiles.length > 0) {
  failures.push("unexpected path-specific instruction authority: " + unexpectedInstructionFiles.join(", "));
}

const adapterPaths = {
  copilot: tracked.filter((item) => /(^|\/)copilot-instructions\.md$/i.test(item)),
  claude: tracked.filter((item) => /(^|\/)CLAUDE\.md$/i.test(item)),
  gemini: tracked.filter((item) => /(^|\/)GEMINI\.md$/i.test(item)),
};
for (const [name, paths] of Object.entries(adapterPaths)) {
  const expectedPath =
    name === "copilot" ? ".github/copilot-instructions.md" :
    name === "claude" ? "CLAUDE.md" :
    "GEMINI.md";
  if (paths.length !== 1 || paths[0] !== expectedPath) {
    failures.push(name + " routing adapter must exist exactly once at " + expectedPath + "; found: " + paths.join(", "));
  }
}

const tick = String.fromCharCode(96);
const canonicalAdapters = {
  ".github/copilot-instructions.md": [
    "# GitHub Copilot Routing Adapter",
    "",
    "ADAPTER_CLASS: DERIVED_AGENT_ROUTING",
    "SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
    "CLOSURE_AUTHORITY: NONE",
    "",
    "Use " + tick + "AGENTS.md" + tick + " as the repository routing entrypoint before material code or repository changes.",
    "",
    "This adapter owns no Product, architecture, execution, branch, migration, deletion, verification or closure semantics. Canonical owners routed by " + tick + "AGENTS.md" + tick + " remain authoritative within their classes.",
    "",
  ].join("\n"),
  "CLAUDE.md": [
    "# Claude Code Routing Adapter",
    "",
    "ADAPTER_CLASS: DERIVED_AGENT_ROUTING",
    "SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
    "CLOSURE_AUTHORITY: NONE",
    "",
    "Read and follow " + tick + "AGENTS.md" + tick + " first for repository authority routing.",
    "",
    "This file adds no Product, architecture, execution, branch, deletion, migration, verification or closure law. If it ever conflicts with " + tick + "AGENTS.md" + tick + " or a canonical owner routed by " + tick + "AGENTS.md" + tick + ", this adapter is stale and must be corrected or deleted.",
    "",
  ].join("\n"),
  "GEMINI.md": [
    "# Gemini CLI Routing Adapter",
    "",
    "ADAPTER_CLASS: DERIVED_AGENT_ROUTING",
    "SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
    "CLOSURE_AUTHORITY: NONE",
    "",
    "Read and follow " + tick + "AGENTS.md" + tick + " first for repository authority routing.",
    "",
    "This file adds no Product, architecture, execution, branch, deletion, migration, verification or closure law. If it ever conflicts with " + tick + "AGENTS.md" + tick + " or a canonical owner routed by " + tick + "AGENTS.md" + tick + ", this adapter is stale and must be corrected or deleted.",
    "",
  ].join("\n"),
};

for (const [relativePath, expected] of Object.entries(canonicalAdapters)) {
  const actual = read(relativePath);
  if (actual !== expected) failures.push(relativePath + " must remain an exact routing-only adapter with zero independent agent law");
}

requireTokens("governance/GOVERNANCE.md", [
  "GOVERNANCE          = CURRENT DURABLE DECISION BASELINE",
  "DOCUMENTED != INFALLIBLE",
  "CONFLICT → DIAGNOSE → CORRECT THE WRONG OWNER",
], "governance_falsifiability");

requireTokens("governance/policies/documentation-and-knowledge.md", [
  "EXACT KNOWLEDGE COMMIT SHA = ADMISSIBLE",
  "TRACKED LOCAL GOVERNANCE/DOCS MIRROR = FORBIDDEN",
], "cross_repository_pin");

requireTokens("governance/policies/providers-and-integrations.md", [
  "BLIND_FALLBACK_ON_UNKNOWN_MUTATION=0",
], "provider_unknown_outcome");

requireTokens("governance/product/FINANCIAL-MODEL.md", [
  "WLT is the sole authoritative owner of internal financial truth",
], "financial_truth");

requireTokens("governance/product/capabilities/access/account-privacy-lifecycle.md", [
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

console.log("AGENT_LAW_OWNER=AGENTS.md");
console.log("NESTED_AGENT_LAW_OWNERS=0");
console.log("PATH_SPECIFIC_AGENT_LAW_OWNERS=0");
console.log("ROUTING_ADAPTER_SHADOW_LAW=0");
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
