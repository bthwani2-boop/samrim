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

const forbid = (file, tokens, id) => {
  const body = read(file).toLowerCase();
  for (const token of tokens) if (body.includes(token.toLowerCase())) failures.push(`${id} forbidden token in ${file}: ${token}`);
};

const agent = requireTokens("AGENTS.md", [
  "ARTIFACT_CLASS: REPOSITORY_AGENT_OPERATING_CONSTITUTION",
  "REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL",
  "PRODUCT_SEMANTIC_AUTHORITY: NONE",
  "CURRENT_IMPLEMENTATION_AUTHORITY: NONE",
  "THIS FILE IS HARD OPERATING LAW",
  "AGENT ENTRY / EXECUTION GATE",
  "AGENT_BOOTSTRAP=PASS",
  "MUTATION_READY=PASS",
  "CANDIDATE_PROOF=PASS",
  "CLOSURE_READY=PASS",
  "CURRENT-STATE FIRST.",
  "No source has global precedence. Authority is fact-specific",
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

forbid("AGENTS.md", [
  "Platform Control",
  "orchestrator",
  "docs/method/",
  "tools/prompting",
  "LEVEL_4",
  "ACTIVE_SLICE",
  "FULL_TARGET",
  "RECOVERY_FRONTIER",
  "NEXT_REQUIRED_ACTION",
  "CAMPAIGN_COMPLETE",
  "CURRENT_CAUSAL_ROOT",
  "AUTHORIZED_SCOPE_FIXED_POINT",
], "agent_constitution");
if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(agent)) failures.push("AGENTS.md must not hard-code mutable local runtime ports");

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"));
const agentLaws = tracked.filter((file) => /(^|\/)AGENTS\.md$/i.test(file));
if (agentLaws.length !== 1 || agentLaws[0] !== "AGENTS.md") failures.push(`AGENTS.md must be the sole agent-law owner; found ${agentLaws.join(",")}`);
if (tracked.some((file) => /\.instructions\.md$/i.test(file))) failures.push("path-specific instruction authority is forbidden");
if (tracked.includes(".github/hooks/agent-execution-guard.json")) failures.push("unused Copilot execution-guard scaffold must be absent");

for (const [file, id, active] of [
  [".github/copilot-instructions.md", "copilot", false],
  ["CLAUDE.md", "claude", true],
  ["GEMINI.md", "gemini", true],
]) {
  if (!tracked.includes(file)) {
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
  if (active && !read(file).includes("Agent Execution Guard")) failures.push(`${id} adapter is not routed through Agent Execution Guard`);
}

const claude = json(".claude/settings.json");
if (claude) {
  for (const [event, token] of [["SessionStart", "session-start"], ["PreToolUse", "pre-tool"], ["SubagentStart", "subagent-start"]]) {
    const groups = claude.hooks?.[event];
    if (!Array.isArray(groups) || !groups.length) {
      failures.push(`Claude ${event} hook missing`);
      continue;
    }
    const handlers = groups.flatMap((group) => Array.isArray(group.hooks) ? group.hooks : []);
    const hook = handlers.find((item) =>
      item?.command === "node" &&
      Array.isArray(item.args) &&
      item.args.some((arg) => String(arg).includes("agent-execution-guard.mjs")) &&
      item.args.includes(token) &&
      item.args.includes("claude")
    );
    if (!hook) failures.push(`Claude ${event} not routed through guard`);
    else if ((hook.timeout ?? 60) > 5) failures.push(`Claude ${event} timeout must be <=5s`);
  }
}

const gemini = json(".gemini/settings.json");
if (gemini) {
  const files = gemini.context?.fileName;
  if (!Array.isArray(files) || !files.includes("AGENTS.md") || !files.includes("GEMINI.md")) failures.push("Gemini must load AGENTS.md and GEMINI.md project context");
  for (const [event, token] of [["SessionStart", "session-start"], ["BeforeAgent", "before-agent"], ["BeforeTool", "pre-tool"]]) {
    const groups = gemini.hooks?.[event];
    if (!Array.isArray(groups) || !groups.length) {
      failures.push(`Gemini ${event} hook missing`);
      continue;
    }
    const handlers = groups.flatMap((group) => Array.isArray(group.hooks) ? group.hooks : []);
    const hook = handlers.find((item) =>
      String(item?.command ?? "").includes("agent-execution-guard.mjs") &&
      String(item.command).includes(token) &&
      String(item.command).includes("gemini")
    );
    if (!hook) failures.push(`Gemini ${event} not routed through guard`);
    else if ((hook.timeout ?? 60000) > 5000) failures.push(`Gemini ${event} timeout must be <=5000ms`);
  }
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
    if (forbiddenPrefixes.some((prefix) => name.startsWith(prefix))) failures.push(`package.json exposes internal governance/guard verifier: ${name}`);
  }
  for (const retired of ["knowledge:sync", "knowledge:query"]) {
    if (Object.hasOwn(scripts, retired)) failures.push(`package.json exposes internal knowledge command: ${retired}`);
  }
  if (scripts.verify !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-local-candidate.ps1") failures.push("package.json verify must own human local candidate closure");
  if (scripts["safe:push"] !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/safe-push.ps1") failures.push("package.json safe:push must own guarded push");
}

const guard = requireTokens("tools/dev/agent-execution-guard.mjs", [
  ".bthwani-local",
  "STATE_SCHEMA = 2",
  "MUTATION_READY",
  "CANDIDATE_PROOF",
  "CLOSURE_READY",
  "--scope",
  "guard state is machine-owned",
  "raw promotion is forbidden",
  "read/discovery fast path",
  "read-only shell fast path",
  "process.exitCode = 2",
], "agent_execution_guard");
for (const retired of [
  "readiness.json",
  "proof.json",
  "closure.json",
  "qualityCensus",
  "evidenceClasses",
  "allowedCommandIds",
  "proofDigest",
  "guardBundle",
  "pnpm agent:guard:",
]) if (guard.includes(retired)) failures.push(`guard retains retired process/state complexity: ${retired}`);

requireTokens("tools/dev/agent-execution-guard.test.mjs", [
  "direct guard lifecycle is internal and available without pnpm aliases",
  "guard state is machine-owned",
  "raw promotion is denied and safe push requires exact closure",
  "free-form shell is denied while repository-owned mutators remain explicit",
  "remote repository mutation, opaque commit and unknown tools fail closed",
], "guard_tests");
requireTokens("tools/dev/safe-push.ps1", ["require-closure", "REMOTE_BRANCH_STATE=ABSENT", "ls-remote", "SAFE_PUSH=PASS"], "safe_push");
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
console.log("SUPPORTED_AGENT_HOSTS=Claude,Gemini,Codex");
console.log("PUBLIC_GUARD_LIFECYCLE_COMMANDS=0");
console.log("PUBLIC_GOVERNANCE_GUARD_VERIFIER_ALIASES=0");
console.log("FREE_FORM_SHELL_AUTHORITY=0");
console.log("SELF_DECLARED_PROOF_AUTHORITY=0");
console.log("ROUTING_ADAPTER_SHADOW_LAW=0");
console.log("AGENT_EXECUTION_GUARD_WIRING=PASS");
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
