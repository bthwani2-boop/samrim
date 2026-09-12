import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const failures = [];

function read(relativePath) {
  const absolute = path.join(repoRoot, ...relativePath.split("/"));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    failures.push("missing repository artifact: " + relativePath);
    return "";
  }
  return fs.readFileSync(absolute, "utf8").replaceAll("\r\n", "\n");
}

function requireTokens(relativePath, tokens, id) {
  const body = read(relativePath);
  for (const token of tokens) {
    if (!body.includes(token)) failures.push(`${id} missing invariant in ${relativePath}: ${token}`);
  }
  return body;
}

function forbidTokens(relativePath, tokens, id) {
  const body = read(relativePath);
  for (const token of tokens) {
    if (body.toLowerCase().includes(token.toLowerCase())) failures.push(`${id} forbidden token in ${relativePath}: ${token}`);
  }
  return body;
}

const agentBody = requireTokens(
  "AGENTS.md",
  [
    "ARTIFACT_CLASS: REPOSITORY_AGENT_OPERATING_CONSTITUTION",
    "REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL",
    "PRODUCT_SEMANTIC_AUTHORITY: NONE",
    "CURRENT_IMPLEMENTATION_AUTHORITY: NONE",
    "BTHWANI ORIENTATION KEYS ARE DISCOVERY KEYS, NOT PROOF OR SEMANTIC AUTHORITY.",
    "ORIENTATION != PROOF.",
    "SPECIALIZATION != BLIND TRUST.",
    "GOVERNED != INFALLIBLE.",
    "DOCUMENTED != CORRECT.",
    "OBJECTIVE != PROJECT TRUTH.",
    "OBJECTIVE != FACT AUTHORITY.",
    "OBJECTIVE != ARCHITECTURAL EXCEPTION.",
    "CURRENT-STATE FIRST.",
    "CURRENT SOURCE = FIRST EVIDENCE FOR WHAT EXISTS NOW.",
    "CURRENT SOURCE != AUTOMATICALLY CORRECT DESIGN.",
    "No source has global precedence. Authority is fact-specific",
    "PINNED GOVERNANCE / knowledge.sources.json",
    "GOVERNANCE / DOCS ARE VALUABLE EVIDENCE, NOT ORACLES.",
    "SOURCE AGREEMENT != INDEPENDENT CORROBORATION",
    "MUTATE ITS SOURCE ONLY WHEN THAT CORRECTION IS MATERIAL TO THE AUTHORIZED OUTCOME",
    "PIN EXACT SAMRIM STATE",
    "CENSUS MATERIAL AFFECTED CONE",
    "UNEXAMINED != UNAFFECTED.",
    "RIGOR SCALES WITH CONSEQUENCE + UNCERTAINTY + BLAST RADIUS + IRREVERSIBILITY.",
    "DURABLE TARGET MODEL != CURRENT IMPLEMENTATION INVENTORY != CURRENT AUTHORIZED DELIVERY SLICE.",
    "SUBAGENT CONSENSUS != PROOF.",
    "CONCLUSION MUST FOLLOW FROM EVIDENCE.",
    "FACT != INFERENCE != HYPOTHESIS != ASSUMPTION.",
    "NECESSARY CONDITION != SUFFICIENT PROOF.",
    "ONE COMPATIBLE EXPLANATION != PROVEN CAUSE.",
    "VISIBLE FAILURE != DEFECT OWNER.",
    "APP_HOST != BUSINESS_CAPABILITY_OWNER.",
    "TREAT THE HIGHEST PROVEN CAUSAL ROOT.",
    "FIRST WORKING SOLUTION != BEST SOLUTION.",
    "LOCAL OPTIMUM != WHOLE-PLATFORM OUTCOME.",
    "SMALLEST DIFF != SIMPLEST SYSTEM.",
    "DONOR_VALUE != DONOR_AUTHORITY.",
    "GOOD_REFERENCE != RIGHT_TO_COPY_TOPOLOGY.",
    "DURABLE BTHWANI TRUTH → GOVERNANCE MUST CONVERGE.",
    "NO COMPLEXITY WITHOUT MATERIAL BENEFIT.",
    "ONE MATERIAL MEANING → ONE SEMANTIC OWNER",
    "ONE MUTABLE FACT → ONE CANONICAL WRITER",
    "NOTHING NEW IS ADMITTED BY DEFAULT.",
    "COMPATIBILITY_JUST_IN_CASE = FORBIDDEN.",
    "PREFER THE REPOSITORY-OWNED MECHANISM FOR THE OPERATION OR CLAIM WHEN IT IS CURRENT AND FIT FOR PURPOSE.",
    "REPOSITORY TOOL != INFALLIBLE.",
    "CAPABILITY != AUTHORITY.",
    "NEVER CHECKPOINT",
    "FALSIFY BEFORE TRUSTING.",
    "CLAIM",
    "→ REQUIRED EVIDENCE CLASS",
    "MATERIAL INTERACTIVE BEHAVIOR MUST BE EXERCISED IN THE REAL AUTHORIZED RUNTIME",
    "USER EXPERIENCE IS A SYSTEM OUTCOME, NOT SCREEN AESTHETICS.",
    "DESIGN READINESS PRECEDES UI IMPLEMENTATION.",
    "SKIPPED / NOT-RUN / STALE REQUIRED EVIDENCE != PASS.",
    "IMPLEMENTATION SUCCESS != DECISION SUCCESS.",
    "TREATMENT DOES NOT PROVE CLOSURE.",
    "FRESH ADVERSARIAL RE-CENSUS",
    "DECISION-CRITICAL UNKNOWNS = 0",
    "KNOWN MATERIAL DURABLE GOVERNANCE DRIFT = 0",
    "KNOWN PARALLEL / SHADOW TRUTH = 0",
    "REPOSITORY-OWNED SAFE PUSH",
    "CONFIRM EXACT REMOTE SHA",
  ],
  "agent_constitution",
);

for (const section of [
  "## 0. BThwani orientation and authority",
  "## 1. BThwani task and affected-cone resolution",
  "## 2. Causal reasoning and best-fit decision",
  "## 3. Canonical execution, cutover and safety",
  "## 4. Claim-specific verification and BThwani experience",
  "## 5. Adversarial closure, commit and continuation",
]) if (!agentBody.includes(section)) failures.push("agent_constitution missing canonical section: " + section);

forbidTokens(
  "AGENTS.md",
  [
    "Platform Control",
    "orchestrator",
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
  ],
  "agent_constitution",
);

if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(agentBody)) failures.push("AGENTS.md must not hard-code mutable local runtime ports");

const agentBytes = Buffer.byteLength(agentBody, "utf8");
if (agentBytes > 20000) failures.push(`AGENTS.md exceeds compact-contract ceiling: ${agentBytes} bytes`);

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((item) => item.replaceAll("\\", "/"));

const agentLawFiles = tracked.filter((item) => /(^|\/)AGENTS\.md$/i.test(item));
if (agentLawFiles.length !== 1 || agentLawFiles[0] !== "AGENTS.md") failures.push("AGENTS.md must be the only tracked AGENTS law owner; found: " + agentLawFiles.join(", "));

const unexpectedInstructionFiles = tracked.filter((item) => /\.instructions\.md$/i.test(item));
if (unexpectedInstructionFiles.length > 0) failures.push("unexpected path-specific instruction authority: " + unexpectedInstructionFiles.join(", "));

const adapterPaths = {
  copilot: tracked.filter((item) => /(^|\/)copilot-instructions\.md$/i.test(item)),
  claude: tracked.filter((item) => /(^|\/)CLAUDE\.md$/i.test(item)),
  gemini: tracked.filter((item) => /(^|\/)GEMINI\.md$/i.test(item)),
};
for (const [name, paths] of Object.entries(adapterPaths)) {
  const expectedPath = name === "copilot" ? ".github/copilot-instructions.md" : name === "claude" ? "CLAUDE.md" : "GEMINI.md";
  if (paths.length !== 1 || paths[0] !== expectedPath) failures.push(`${name} routing adapter must exist exactly once at ${expectedPath}; found: ${paths.join(", ")}`);
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
  if (read(relativePath) !== expected) failures.push(`${relativePath} must remain an exact routing-only adapter with zero independent agent law`);
}

requireTokens(
  ".github/workflows/pr-policy.yml",
  [
    "PR_POLICY_DRAFT=DEFERRED_UNTIL_READY",
    "PR_POLICY_HUMAN_AGENT_EVIDENCE=PASS",
    "## Exact candidate and authorized objective",
    "## Affected cone and ownership",
    "## Diagnosis and decision",
    "## Verification",
    "## Negative space",
  ],
  "pr_policy_derivation",
);
requireTokens(
  ".github/pull_request_template.md",
  [
    "## Exact candidate and authorized objective",
    "## Affected cone and ownership",
    "## Diagnosis and decision",
    "## Verification",
    "## Negative space",
  ],
  "pr_template_derivation",
);

if (failures.length) {
  console.error("AGENT_KNOWLEDGE_CONTRACT=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}

console.log("AGENT_LAW_OWNER=AGENTS.md");
console.log("AGENT_CONTRACT_BYTES=" + agentBytes);
console.log("NESTED_AGENT_LAW_OWNERS=0");
console.log("PATH_SPECIFIC_AGENT_LAW_OWNERS=0");
console.log("ROUTING_ADAPTER_SHADOW_LAW=0");
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
