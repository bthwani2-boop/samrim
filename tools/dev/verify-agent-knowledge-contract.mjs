import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../.."), failures = [];
const read = (file) => { const p = path.join(root, file); if (!fs.existsSync(p) || !fs.statSync(p).isFile()) { failures.push(`missing repository artifact: ${file}`); return ""; } return fs.readFileSync(p, "utf8").replaceAll("\r\n", "\n"); };
const json = (file) => { try { return JSON.parse(read(file)); } catch (e) { failures.push(`${file} invalid JSON: ${e.message}`); return null; } };
const requireTokens = (file, tokens, id) => { const body = read(file); for (const t of tokens) if (!body.includes(t)) failures.push(`${id} missing invariant in ${file}: ${t}`); return body; };
const forbid = (file, tokens, id) => { const body = read(file).toLowerCase(); for (const t of tokens) if (body.includes(t.toLowerCase())) failures.push(`${id} forbidden token in ${file}: ${t}`); };

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
  "RIGOR SCALES WITH CONSEQUENCE + UNCERTAINTY + BLAST RADIUS + IRREVERSIBILITY.",
  "READINESS PRECEDES IMPLEMENTATION.",
  "TREAT THE HIGHEST PROVEN CAUSAL ROOT.",
  "FIRST WORKING SOLUTION != BEST SOLUTION.",
  "SMALLEST DIFF != SIMPLEST SYSTEM.",
  "DONOR_VALUE != DONOR_AUTHORITY.",
  "DURABLE BTHWANI TRUTH → GOVERNANCE MUST CONVERGE.",
  "ONE MATERIAL MEANING → ONE SEMANTIC OWNER",
  "ONE MUTABLE FACT → ONE CANONICAL WRITER",
  "NOTHING NEW IS ADMITTED BY DEFAULT.",
  "CAPABILITY != AUTHORITY.",
  "FALSIFY BEFORE TRUSTING.",
  "MATERIAL INTERACTIVE BEHAVIOR MUST BE EXERCISED IN THE REAL AUTHORIZED RUNTIME",
  "SKIPPED / NOT-RUN / STALE REQUIRED EVIDENCE != PASS.",
  "FRESH ADVERSARIAL RE-CENSUS",
  "DECISION-CRITICAL UNKNOWNS = 0",
  "REPOSITORY-OWNED SAFE PUSH",
  "CONFIRM EXACT REMOTE SHA",
], "agent_constitution");
for (const section of ["## 0. BThwani orientation and authority", "## 1. BThwani task and affected-cone resolution", "## 2. Causal reasoning and best-fit decision", "## 3. Canonical execution, cutover and safety", "## 4. Claim-specific verification and BThwani experience", "## 5. Adversarial closure, commit and continuation"]) if (!agent.includes(section)) failures.push(`agent_constitution missing section: ${section}`);
forbid("AGENTS.md", ["Platform Control", "orchestrator", "docs/method/", "tools/prompting", "LEVEL_4", "ACTIVE_SLICE", "FULL_TARGET", "RECOVERY_FRONTIER", "NEXT_REQUIRED_ACTION", "CAMPAIGN_COMPLETE", "CURRENT_CAUSAL_ROOT", "AUTHORIZED_SCOPE_FIXED_POINT"], "agent_constitution");
if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(agent)) failures.push("AGENTS.md must not hard-code mutable local runtime ports");

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean).map((p) => p.replaceAll("\\", "/"));
const agentLaws = tracked.filter((p) => /(^|\/)AGENTS\.md$/i.test(p));
if (agentLaws.length !== 1 || agentLaws[0] !== "AGENTS.md") failures.push(`AGENTS.md must be the sole agent-law owner; found ${agentLaws.join(",")}`);
if (tracked.some((p) => /\.instructions\.md$/i.test(p))) failures.push("path-specific instruction authority is forbidden");
if (tracked.includes(".github/hooks/agent-execution-guard.json")) failures.push("unused Copilot execution-guard scaffold must be absent");

for (const [file, id, active] of [[".github/copilot-instructions.md", "copilot", false], ["CLAUDE.md", "claude", true], ["GEMINI.md", "gemini", true]]) {
  if (!tracked.includes(file)) { failures.push(`${id} routing adapter missing at ${file}`); continue; }
  requireTokens(file, ["ADAPTER_CLASS: DERIVED_AGENT_ROUTING", "SEMANTIC_AUTHORITY: NONE", "EXECUTION_AUTHORITY: NONE", "CLOSURE_AUTHORITY: NONE", "AGENTS.md"], `${id}_adapter`);
  if (active && !read(file).includes("Agent Execution Guard")) failures.push(`${id} adapter is not routed through Agent Execution Guard`);
}

const claude = json(".claude/settings.json");
if (claude) for (const [event, token] of [["SessionStart", "session-start"], ["PreToolUse", "pre-tool"], ["SubagentStart", "subagent-start"]]) {
  const groups = claude.hooks?.[event]; if (!Array.isArray(groups) || !groups.length) { failures.push(`Claude ${event} hook missing`); continue; }
  const handlers = groups.flatMap((g) => Array.isArray(g.hooks) ? g.hooks : []);
  const h = handlers.find((x) => x?.command === "node" && Array.isArray(x.args) && x.args.some((a) => String(a).includes("agent-execution-guard.mjs")) && x.args.includes(token) && x.args.includes("claude"));
  if (!h) failures.push(`Claude ${event} not routed through guard`); else if ((h.timeout ?? 60) > 5) failures.push(`Claude ${event} timeout must be <=5s`);
}
const gemini = json(".gemini/settings.json");
if (gemini) {
  const files = gemini.context?.fileName; if (!Array.isArray(files) || !files.includes("AGENTS.md") || !files.includes("GEMINI.md")) failures.push("Gemini must load AGENTS.md and GEMINI.md project context");
  for (const [event, token] of [["SessionStart", "session-start"], ["BeforeAgent", "before-agent"], ["BeforeTool", "pre-tool"]]) {
    const groups = gemini.hooks?.[event]; if (!Array.isArray(groups) || !groups.length) { failures.push(`Gemini ${event} hook missing`); continue; }
    const handlers = groups.flatMap((g) => Array.isArray(g.hooks) ? g.hooks : []);
    const h = handlers.find((x) => String(x?.command ?? "").includes("agent-execution-guard.mjs") && String(x.command).includes(token) && String(x.command).includes("gemini"));
    if (!h) failures.push(`Gemini ${event} not routed through guard`); else if ((h.timeout ?? 60000) > 5000) failures.push(`Gemini ${event} timeout must be <=5000ms`);
  }
}

const pkg = json("package.json");
const scripts = {
  "agent:guard:bootstrap": "node tools/dev/agent-execution-guard.mjs bootstrap",
  "agent:guard:init-readiness": "node tools/dev/agent-execution-guard.mjs init-readiness",
  "agent:guard:ready": "node tools/dev/agent-execution-guard.mjs ready",
  "agent:guard:verify": "node tools/dev/agent-execution-guard.mjs verify",
  "agent:guard:init-closure": "node tools/dev/agent-execution-guard.mjs init-closure",
  "agent:guard:close": "node tools/dev/agent-execution-guard.mjs close",
  "agent:guard:require-closure": "node tools/dev/agent-execution-guard.mjs require-closure",
  "agent:guard:status": "node tools/dev/agent-execution-guard.mjs status",
  "agent:guard:test": "node --test tools/dev/agent-execution-guard.test.mjs",
};
if (pkg) for (const [name, command] of Object.entries(scripts)) if (pkg.scripts?.[name] !== command) failures.push(`package.json missing canonical ${name}`);

const guard = requireTokens("tools/dev/agent-execution-guard.mjs", [
  ".bthwani-local", "MUTATION_READY", "CANDIDATE_PROOF", "LOCAL_PRE_PUSH", "CLOSURE_READY",
  "decisionCriticalUnknowns", "qualityCensus", "allowedCommandIds", "proofDigest", "machine proof",
  "raw promotion is forbidden", "state/proof receipts are machine-owned", "process.exitCode = 2",
], "agent_execution_guard");
if (guard.includes("allowedShellCommands")) failures.push("FREE_FORM_SHELL_AUTHORITY: allowedShellCommands must not exist");
if (!guard.includes("read/discovery fast path") || !guard.includes("read-only shell fast path")) failures.push("guard read fast path missing");
requireTokens("tools/dev/agent-execution-guard.test.mjs", ["symlink or junction escape", "missing or foreign session fail closed", "machine state and proof", "raw promotion is denied", "free-form shell is denied", "unknown tools fail closed"], "guard_tests");
requireTokens("tools/dev/safe-push.ps1", ["require-closure", "REMOTE_BRANCH_STATE=ABSENT", "ls-remote", "SAFE_PUSH=PASS"], "safe_push");
requireTokens(".github/workflows/pr-policy.yml", ["PR_POLICY_DRAFT=DEFERRED_UNTIL_READY", "## Exact candidate and authorized objective", "## Affected cone and ownership", "## Diagnosis and decision", "## Verification", "## Negative space"], "pr_policy");
requireTokens(".github/pull_request_template.md", ["## Exact candidate and authorized objective", "## Affected cone and ownership", "## Diagnosis and decision", "## Verification", "## Negative space"], "pr_template");

if (failures.length) { console.error("AGENT_KNOWLEDGE_CONTRACT=FAIL"); for (const f of [...new Set(failures)].sort()) console.error(`  ${f}`); process.exit(1); }
console.log("AGENT_LAW_OWNER=AGENTS.md");
console.log("SUPPORTED_AGENT_HOSTS=Claude,Gemini,Codex");
console.log("UNUSED_AGENT_HOST_SCAFFOLD=0");
console.log("FREE_FORM_SHELL_AUTHORITY=0");
console.log("SELF_DECLARED_PROOF_AUTHORITY=0");
console.log("ROUTING_ADAPTER_SHADOW_LAW=0");
console.log("AGENT_EXECUTION_GUARD_WIRING=PASS");
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
