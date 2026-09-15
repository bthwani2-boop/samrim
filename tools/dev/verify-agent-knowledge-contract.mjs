import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];

const read = (file) => {
  const absolute = path.join(root, file);
  try {
    return fs.readFileSync(absolute, "utf8").replaceAll("\r\n", "\n");
  } catch {
    failures.push(`missing repository artifact: ${file}`);
    return "";
  }
};

const json = (file) => {
  try {
    return JSON.parse(read(file));
  } catch (error) {
    failures.push(`${file} invalid JSON: ${error.message}`);
    return null;
  }
};

const requireTokens = (file, tokens, id) => {
  const body = read(file);
  for (const token of tokens) if (!body.includes(token)) failures.push(`${id} missing invariant in ${file}: ${token}`);
  return body;
};

const forbidTokens = (file, tokens, id) => {
  const body = read(file).toLowerCase();
  for (const token of tokens) if (body.includes(token.toLowerCase())) failures.push(`${id} forbidden residue in ${file}: ${token}`);
  return body;
};

const agent = requireTokens("AGENTS.md", [
  "ARTIFACT_CLASS: REPOSITORY_AGENT_OPERATING_CONSTITUTION",
  "REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL",
  "PRODUCT_SEMANTIC_AUTHORITY: NONE",
  "CURRENT_IMPLEMENTATION_AUTHORITY: NONE",
  "THIS FILE IS HARD OPERATING LAW",
  "CURRENT-STATE FIRST.",
  "CENSUS MATERIAL AFFECTED CONE",
  "UNEXAMINED != UNAFFECTED.",
  "READINESS PRECEDES IMPLEMENTATION.",
  "TREAT THE HIGHEST PROVEN CAUSAL ROOT.",
  "NO COMPLEXITY WITHOUT MATERIAL BENEFIT.",
  "ONE MATERIAL MEANING → ONE SEMANTIC OWNER",
  "NOTHING NEW IS ADMITTED BY DEFAULT.",
  "FALSIFY BEFORE TRUSTING.",
  "FRESH ADVERSARIAL RE-CENSUS",
  "DECISION-CRITICAL UNKNOWNS = 0",
  "REPOSITORY-OWNED SAFE PUSH",
  "CONFIRM EXACT REMOTE SHA",
], "agent_constitution");

for (const section of [
  "## 0. BThwani orientation and authority",
  "## 1. BThwani task and affected-cone resolution",
  "## 2. Causal reasoning and best-fit decision",
  "## 3. Canonical execution, cutover and safety",
  "## 4. Claim-specific verification and BThwani experience",
  "## 5. Adversarial closure, commit and continuation",
]) if (!agent.includes(section)) failures.push(`agent_constitution missing section: ${section}`);

forbidTokens("AGENTS.md", [
  "Agent Execution Guard",
  "AGENT_EXECUTION_GUARD",
  "AGENT_BOOTSTRAP=PASS",
  "MUTATION_READY=PASS",
  "CANDIDATE_PROOF=PASS",
  "CLOSURE_READY=PASS",
  "agent-execution-guard",
  "require-closure",
], "agent_constitution");
if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(agent)) failures.push("AGENTS.md must not hard-code mutable local runtime ports");

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"));
const trackedSet = new Set(tracked);
const agentLaws = tracked.filter((file) => /(^|\/)AGENTS\.md$/i.test(file));
if (agentLaws.length !== 1 || agentLaws[0] !== "AGENTS.md") failures.push(`AGENTS.md must be the sole agent-law owner; found ${agentLaws.join(",")}`);
if (tracked.some((file) => /\.instructions\.md$/i.test(file))) failures.push("path-specific instruction authority is forbidden");

for (const forbidden of [
  ".claude/settings.json",
  ".gemini/settings.json",
  ".github/hooks/agent-execution-guard.json",
  "tools/dev/agent-execution-guard.mjs",
  "tools/dev/agent-execution-guard.test.mjs",
]) if (trackedSet.has(forbidden)) failures.push(`retired execution-layer artifact remains tracked: ${forbidden}`);

for (const [file, id] of [
  [".github/copilot-instructions.md", "copilot"],
  ["CLAUDE.md", "claude"],
  ["GEMINI.md", "gemini"],
]) {
  if (!trackedSet.has(file)) {
    failures.push(`${id} routing adapter missing at ${file}`);
    continue;
  }
  requireTokens(file, [
    "ADAPTER_CLASS: DERIVED_AGENT_ROUTING",
    "SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
    "CLOSURE_AUTHORITY: NONE",
    "AGENTS.md",
  ], `${id}_adapter`);
  forbidTokens(file, ["Agent Execution Guard", "agent-execution-guard", "SessionStart", "PreToolUse", "BeforeTool"], `${id}_adapter`);
}

const pkg = json("package.json");
if (pkg) {
  const scripts = pkg.scripts ?? {};
  const forbiddenPrefixes = [
    "agent:guard:",
    "knowledge:verify",
    "docs:verify",
    "repository:verify",
    "candidate:verify",
    "candidate:local:",
    "nx:verify",
  ];
  for (const name of Object.keys(scripts)) {
    if (forbiddenPrefixes.some((prefix) => name.startsWith(prefix))) failures.push(`package.json exposes internal verifier/lifecycle alias: ${name}`);
  }
  for (const retired of ["knowledge:sync", "knowledge:query"]) {
    if (Object.hasOwn(scripts, retired)) failures.push(`package.json exposes internal knowledge command: ${retired}`);
  }
  if (scripts.verify !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-local-candidate.ps1") failures.push("package.json verify must own local exact-candidate verification");
  if (scripts["safe:push"] !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/safe-push.ps1") failures.push("package.json safe:push must own repository push safety");
}

const safePush = requireTokens("tools/dev/safe-push.ps1", [
  "pnpm verify",
  "REMOTE_BRANCH_STATE=ABSENT",
  "merge-base",
  "ls-remote",
  "REMOTE_SHA_CONFIRMATION=PASS",
  "SAFE_PUSH=PASS",
], "safe_push");
for (const token of ["agent-execution-guard", "require-closure", "CLOSURE_READY", "state.json"]) {
  if (safePush.toLowerCase().includes(token.toLowerCase())) failures.push(`safe_push retains retired stateful coupling: ${token}`);
}

const verifier = requireTokens("tools/dev/verify-local-candidate.ps1", [
  "EXACT_LOCAL_CANDIDATE_SHA",
  "Assert-CleanTree 'candidate start'",
  "Canonical static verification",
  "Canonical runtime doctor",
  "VERIFY=PASS",
], "local_candidate_verifier");
for (const token of ["SkipFetch", "origin/", "agent-execution-guard", "Agent guard behavior"]) {
  if (verifier.includes(token)) failures.push(`local candidate verifier retains retired dual/stateful path: ${token}`);
}

const baseline = read(".github/workflows/baseline-guard.yml");
for (const token of ["agent-execution-guard", "Verify Agent Execution Guard adversarial behavior"]) {
  if (baseline.includes(token)) failures.push(`baseline workflow retains retired execution layer: ${token}`);
}

requireTokens(".github/workflows/pr-policy.yml", [
  "PR_POLICY_DRAFT=DEFERRED_UNTIL_READY",
  "## Exact candidate and authorized objective",
  "## Affected cone and ownership",
  "## Diagnosis and decision",
  "## Verification",
  "## Negative space",
], "pr_policy");
requireTokens(".github/pull_request_template.md", [
  "## Exact candidate and authorized objective",
  "## Affected cone and ownership",
  "## Diagnosis and decision",
  "## Verification",
  "## Negative space",
], "pr_template");

if (failures.length) {
  console.error("AGENT_KNOWLEDGE_CONTRACT=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("AGENT_LAW_OWNER=AGENTS.md");
console.log("AGENT_EXECUTION_MODEL=AGENTS_PLUS_GIT_PLUS_VERIFY_PLUS_SAFE_PUSH_PLUS_CI");
console.log("HOST_EXECUTION_HOOKS=0");
console.log("STATEFUL_EXECUTION_CONTROL=0");
console.log("STATEFUL_CLOSURE_CONTROL=0");
console.log("ROUTING_ADAPTER_SHADOW_LAW=0");
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
