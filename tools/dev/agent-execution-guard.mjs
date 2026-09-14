import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const physicalRoot = fs.realpathSync.native(repoRoot);
const localRoot = path.join(repoRoot, ".bthwani-local", "agent-execution-guard");
export const statePath = path.join(localRoot, "state.json");
const expectedRepository = "bthwani2-boop/samrim";
const STATE_SCHEMA = 2;

const REPOSITORY_MUTATORS = new Set([
  "node services/dsh/tools/generate-types.mjs",
  "node services/identity/tools/generate-types.mjs",
  "pnpm identity:blocklist:generate",
  "pnpm theme:generate",
]);

const GUARD_COMMAND = String.raw`node\s+tools[\\/]dev[\\/]agent-execution-guard\.mjs`;
const GUARD_LIFECYCLE = new RegExp(`^${GUARD_COMMAND}\\s+(bootstrap|ready|verify|close|require-closure|status)(?:\\s|$)`, "i");
const GUARD_BOOTSTRAP = new RegExp(`^${GUARD_COMMAND}\\s+(bootstrap|status)(?:\\s|$)`, "i");

function fail(message) {
  throw new Error(`AGENT_EXECUTION_GUARD=FAIL ${message}`);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label}: ${error.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function git(args, allowFailure = false) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    fail(`git ${args.join(" ")}: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return { status: result.status ?? 1, out: (result.stdout || "").trim() };
}

function norm(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function absolute(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function physical(value) {
  const target = absolute(value);
  if (!target || !inside(repoRoot, target)) return null;
  let probe = target;
  const tail = [];
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    tail.unshift(path.basename(probe));
    probe = parent;
  }
  const real = path.resolve(fs.realpathSync.native(probe), ...tail);
  return inside(physicalRoot, real) ? real : null;
}

function normalizeScope(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "." || raw === "**" || raw.includes("..")) fail(`invalid mutation scope: ${raw}`);
  const normalized = norm(path.normalize(raw)).replace(/^\.\//, "");
  if (
    normalized === ".git" || normalized.startsWith(".git/") ||
    normalized === ".bthwani-local" || normalized.startsWith(".bthwani-local/")
  ) fail(`forbidden mutation scope: ${normalized}`);
  if (!physical(normalized)) fail(`mutation scope escapes repository or crosses link boundary: ${normalized}`);
  return normalized;
}

export function pathAllowedByScopes(target, scopes) {
  const targetPhysical = physical(target);
  return Boolean(targetPhysical && scopes.some((scope) => {
    const scopePhysical = physical(scope);
    return scopePhysical && inside(scopePhysical, targetPhysical);
  }));
}

function governanceSha() {
  const sha = readJson(path.join(repoRoot, "knowledge.sources.json"), "knowledge.sources.json")?.governance?.commit;
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) fail("invalid pinned Governance SHA");
  return sha;
}

function assertOrigin() {
  const raw = git(["remote", "get-url", "origin"]).out.replace(/\.git$/i, "");
  if (raw === "git@github.com:bthwani2-boop/samrim" || raw === "ssh://git@github.com/bthwani2-boop/samrim") return;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.hostname === "github.com" && url.pathname.replace(/\/$/, "") === "/bthwani2-boop/samrim") return;
  } catch {}
  fail(`origin mismatch: ${raw}`);
}

function assertAgentLaw() {
  const body = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
  for (const token of [
    "REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL",
    "AGENT ENTRY / EXECUTION GATE",
    "CURRENT-STATE FIRST.",
    "READINESS PRECEDES IMPLEMENTATION.",
    "FRESH ADVERSARIAL RE-CENSUS",
    "REPOSITORY-OWNED SAFE PUSH",
  ]) if (!body.includes(token)) fail(`AGENTS.md missing invariant: ${token}`);
}

export function fingerprint() {
  if (path.resolve(git(["rev-parse", "--show-toplevel"]).out) !== repoRoot) fail("wrong repository root");
  assertOrigin();
  const head = git(["rev-parse", "HEAD"]).out;
  const branch = git(["branch", "--show-current"], true).out || process.env.GITHUB_HEAD_REF || `DETACHED:${head}`;
  return Object.freeze({
    repository: expectedRepository,
    branch,
    head,
    agentsBlob: git(["hash-object", "AGENTS.md"]).out,
    knowledgeBlob: git(["hash-object", "knowledge.sources.json"]).out,
    governanceSha: governanceSha(),
  });
}

function sameLane(a, b) {
  return Boolean(a && b && a.repository === b.repository && a.branch === b.branch);
}

function sameExact(a, b) {
  return Boolean(
    sameLane(a, b) &&
    a.head === b.head &&
    a.agentsBlob === b.agentsBlob &&
    a.knowledgeBlob === b.knowledgeBlob &&
    a.governanceSha === b.governanceSha
  );
}

function readState(required = true) {
  if (!fs.existsSync(statePath)) {
    if (required) fail("bootstrap state missing");
    return null;
  }
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (state.schema !== STATE_SCHEMA) {
      if (required) fail("state schema mismatch; start a fresh guarded session");
      return null;
    }
    return state;
  } catch (error) {
    if (required) fail(`state: ${error.message}`);
    return null;
  }
}

function dirty() {
  const result = new Set();
  for (const args of [
    ["diff", "--name-only"],
    ["diff", "--cached", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    for (const item of git(args).out.split(/\r?\n/).filter(Boolean)) result.add(norm(item));
  }
  return [...result];
}

function staged() {
  return git(["diff", "--cached", "--name-only"]).out.split(/\r?\n/).filter(Boolean).map(norm);
}

function loose() {
  const result = new Set();
  for (const args of [["diff", "--name-only"], ["ls-files", "--others", "--exclude-standard"]]) {
    for (const item of git(args).out.split(/\r?\n/).filter(Boolean)) result.add(norm(item));
  }
  return [...result];
}

function ownerMatches(state, id) {
  if (!state?.ownerSessionId) return true;
  return Boolean(id && state.ownerSessionId === id);
}

function shellInput(input) {
  const object = input?.toolArgs ?? input?.tool_input ?? input?.toolInput ?? {};
  return String(object.command ?? object.cmd ?? object.script ?? "");
}

function toolInput(input) {
  return input?.toolArgs ?? input?.tool_input ?? input?.toolInput ?? {};
}

function toolName(input) {
  return String(input?.toolName ?? input?.tool_name ?? input?.name ?? "");
}

function sessionId(input) {
  return String(input?.sessionId ?? input?.session_id ?? "").trim() || null;
}

function shellComposite(command) {
  return /[;&|><`\n\r]/.test(command) || command.includes("$(");
}

export function readOnlyShell(command) {
  const normalized = String(command ?? "").trim().replace(/\s+/g, " ");
  return Boolean(normalized && !shellComposite(normalized) && [
    /^git (status|diff|show|log|ls-files|grep|rev-parse|remote get-url|branch --show-current|merge-base)(?:\s|$)/i,
    /^(rg|grep|cat|type|pwd|ls|dir)(?:\s|$)/i,
    /^(Get-Content|Get-ChildItem|Get-Location|Resolve-Path|Select-String|Test-Path)(?:\s|$)/i,
    new RegExp(`^${GUARD_COMMAND}\\s+status(?:\\s|$)`, "i"),
  ].some((pattern) => pattern.test(normalized)));
}

function classify(name) {
  const normalized = name.toLowerCase();
  if (!normalized) return "unknown";
  if (/(github|mcp_github).*(create_file|update_file|delete_file|create_commit|update_ref|create_branch)/.test(normalized)) return "remote";
  if (/(bash|powershell|shell|terminal|run_command|run_shell_command)/.test(normalized)) return "shell";
  if (/(write|edit|replace|patch|delete|remove|rename|move|create_file|update_file|apply_patch|notebookedit)/.test(normalized)) return "write";
  if (/(create_commit|\bcommit\b)/.test(normalized)) return "opaque-commit";
  if (/(push|merge|rebase|cherry|release|deploy|submit|update_ref)/.test(normalized)) return "promotion";
  if (/(agent|task|subagent)/.test(normalized)) return "delegate";
  if (/(read|view|grep|glob|search|find|list|status|get|show|query|open|fetch|web|inspect|diff)/.test(normalized)) return "read";
  return "unknown";
}

function pathsFrom(value, out = []) {
  if (!value || typeof value !== "object") return out;
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string" && /(?:^|_)(?:file_?path|path|target_?file|filename)$/i.test(key)) out.push(nested);
    else if (nested && typeof nested === "object") pathsFrom(nested, out);
  }
  return out;
}

function stateTarget(target) {
  const resolved = absolute(target);
  return Boolean(resolved && inside(localRoot, resolved));
}

function currentReady(state, current) {
  return Boolean(state?.mutationReady && state.readyHead === current.head && sameExact(state.readyFingerprint, current));
}

function currentClosed(state, current) {
  return Boolean(state?.closureReady && state.closedHead === current.head && sameExact(state.candidateFingerprint, current));
}

function repoVerification(command) {
  return [
    /^node tools[\\/]dev[\\/]verify-[^\s]+\.mjs(?:\s|$)/i,
    /^node tools[\\/]mobile[\\/]verify-[^\s]+\.mjs(?:\s|$)/i,
    /^pnpm (?:run )?(verify|quality:lint|workspace:(typecheck|test|build|vet|verify)|mobile:verify-config|theme:(check|verify))(?:\s|$)/i,
    /^pwsh -NoProfile -ExecutionPolicy Bypass -File tools[\\/]dev[\\/]verify-local-candidate\.ps1(?:\s|$)/i,
  ].some((pattern) => pattern.test(command));
}

function promotion(command) {
  return /\bgit\s+(push|merge|rebase|cherry-pick|tag|update-ref)\b|\bgh\s+(pr|release)\b|\beas\s+(submit|build\s+--auto-submit)\b|\bexpo\s+submit\b/i.test(command);
}

export function evaluate({ name, input, state, current, session }) {
  const kind = classify(name);
  const command = kind === "shell" ? shellInput({ toolInput: input }).trim().replace(/\s+/g, " ") : "";

  if (kind === "read") return { decision: "allow", reason: "read/discovery" };
  if (kind === "shell" && readOnlyShell(command)) return { decision: "allow", reason: "read-only shell" };
  if (kind === "shell" && GUARD_BOOTSTRAP.test(command)) return { decision: "allow", reason: "guard bootstrap/status" };
  if (!ownerMatches(state, session)) return { decision: "deny", reason: "active guard state is owned by another or unidentified session" };
  if (!state?.bootstrapPass) return { decision: "deny", reason: "AGENT_BOOTSTRAP required" };
  if (kind === "shell" && GUARD_LIFECYCLE.test(command)) return { decision: "allow", reason: "guard lifecycle command validates its own transition" };
  if (kind === "remote" || kind === "opaque-commit") return { decision: "deny", reason: "opaque/remote repository mutation bypasses the local candidate lane" };
  if (kind === "promotion") return { decision: "deny", reason: "promotion tools are not the repository-owned safe-push lane" };
  if (kind === "delegate") return { decision: "allow", reason: "delegation remains subordinate to repository hooks" };

  if (kind === "write") {
    const targets = pathsFrom(input);
    if (!targets.length) return { decision: "deny", reason: "write target is not explicit" };
    if (targets.some(stateTarget)) return { decision: "deny", reason: "guard state is machine-owned" };
    if (!currentReady(state, current)) return { decision: "deny", reason: "MUTATION_READY required for exact current HEAD" };
    if (targets.some((target) => !pathAllowedByScopes(target, state.mutationScope ?? []))) {
      return { decision: "deny", reason: "write target outside declared mutation scope" };
    }
    return { decision: "allow", reason: "scoped ready mutation" };
  }

  if (kind === "shell") {
    if (!command || shellComposite(command)) return { decision: "deny", reason: "composite shell command is not guardable" };
    if (/^pnpm safe:push$/i.test(command)) {
      return currentClosed(state, current)
        ? { decision: "allow", reason: "exact-head closure proven" }
        : { decision: "deny", reason: "CLOSURE_READY required" };
    }
    if (promotion(command)) return { decision: "deny", reason: "raw promotion is forbidden; use pnpm safe:push" };
    if (repoVerification(command)) return { decision: "allow", reason: "repository-owned verification" };
    if (!currentReady(state, current)) return { decision: "deny", reason: "MUTATION_READY required" };

    if (/^git add(?:\s|$)/i.test(command) && !/(?:^|\s)(-f|--force)(?:\s|$)/i.test(command)) {
      const outside = dirty().filter((item) => !pathAllowedByScopes(item, state.mutationScope));
      return outside.length
        ? { decision: "deny", reason: `dirty path outside scope: ${outside.join(",")}` }
        : { decision: "allow", reason: "scoped staging" };
    }

    if (/^git commit(?:\s|$)/i.test(command) && !/(?:^|\s)(-a|--all|--amend|--no-verify)(?:\s|$)/i.test(command)) {
      const stagedPaths = staged();
      const loosePaths = loose();
      if (!stagedPaths.length) return { decision: "deny", reason: "git commit requires staged candidate changes" };
      const outside = stagedPaths.filter((item) => !pathAllowedByScopes(item, state.mutationScope));
      if (outside.length) return { decision: "deny", reason: `staged path outside scope: ${outside.join(",")}` };
      if (loosePaths.length) return { decision: "deny", reason: `git commit requires reconciled unstaged/untracked set: ${loosePaths.join(",")}` };
      return { decision: "allow", reason: "scoped coherent checkpoint" };
    }

    if (REPOSITORY_MUTATORS.has(command)) return { decision: "allow", reason: "repository-owned mutator" };
    return { decision: "deny", reason: "shell mutation is not a guarded git operation, verification, safe push, or repository-owned mutator" };
  }

  return { decision: "deny", reason: `unclassified tool '${name}'` };
}

function freshState(source, ownerSessionId, current) {
  return {
    schema: STATE_SCHEMA,
    source,
    ownerSessionId,
    bootstrapPass: true,
    mutationReady: false,
    proofReady: false,
    closureReady: false,
    bootstrapFingerprint: current,
    readyFingerprint: null,
    candidateFingerprint: null,
    readyHead: null,
    proofHead: null,
    closedHead: null,
    mutationScope: [],
    runtimeRequired: false,
  };
}

function bootstrap(source = "manual", ownerSessionId = null, preserve = false) {
  assertAgentLaw();
  const current = fingerprint();
  const old = readState(false);
  if (
    preserve && old && sameExact(old.bootstrapFingerprint, current) &&
    (!ownerSessionId || !old.ownerSessionId || old.ownerSessionId === ownerSessionId)
  ) return old;
  const state = freshState(source, ownerSessionId, current);
  writeJson(statePath, state);
  return state;
}

function parseReadyArgs(args) {
  const scopes = [];
  let runtimeRequired = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--runtime") {
      runtimeRequired = true;
      continue;
    }
    if (value === "--scope") {
      const next = args[index + 1];
      if (!next) fail("--scope requires a repository path");
      scopes.push(next);
      index += 1;
      continue;
    }
    if (value.startsWith("--scope=")) {
      scopes.push(value.slice("--scope=".length));
      continue;
    }
    fail(`unknown ready option: ${value}`);
  }
  if (!scopes.length) fail("ready requires at least one --scope");
  return { scopes: [...new Set(scopes.map(normalizeScope))], runtimeRequired };
}

function ready(args) {
  const state = readState();
  const current = fingerprint();
  if (!sameExact(state.bootstrapFingerprint, current)) fail("bootstrap stale");
  if (dirty().length) fail("readiness requires clean baseline");
  const parsed = parseReadyArgs(args);
  const next = {
    ...state,
    mutationReady: true,
    proofReady: false,
    closureReady: false,
    readyFingerprint: current,
    candidateFingerprint: null,
    readyHead: current.head,
    proofHead: null,
    closedHead: null,
    mutationScope: parsed.scopes,
    runtimeRequired: parsed.runtimeRequired,
  };
  writeJson(statePath, next);
  return next;
}

function runCheck(id, executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) fail(`${id} failed\n${output}`);
  return id;
}

function verify() {
  const state = readState();
  if (!state.mutationReady) fail("MUTATION_READY required");
  const current = fingerprint();
  if (!sameLane(state.readyFingerprint, current)) fail("guard lane changed after readiness");
  if (git(["merge-base", "--is-ancestor", state.readyHead, current.head], true).status !== 0 || current.head === state.readyHead) {
    fail("verification requires committed descendant of readiness HEAD");
  }
  if (dirty().length) fail("verification requires clean working tree");
  const count = Number(git(["rev-list", "--count", `${state.readyHead}..${current.head}`]).out);
  if (count !== 1) fail(`candidate must be one coherent commit after readiness; observed=${count}`);
  const changed = git(["diff", "--name-only", `${state.readyHead}...${current.head}`]).out.split(/\r?\n/).filter(Boolean);
  if (changed.some((item) => !pathAllowedByScopes(item, state.mutationScope))) fail("committed candidate escaped mutation scope");

  if (state.runtimeRequired) {
    runCheck("LOCAL_CANDIDATE", "pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/dev/verify-local-candidate.ps1", "-SkipFetch"]);
  } else {
    runCheck("AGENT_GUARD_TESTS", process.execPath, ["--test", "tools/dev/agent-execution-guard.test.mjs"]);
    runCheck("AGENT_KNOWLEDGE_CONTRACT", process.execPath, ["tools/dev/verify-agent-knowledge-contract.mjs"]);
    runCheck("REPOSITORY_STRUCTURE", process.execPath, ["tools/dev/verify-repository-structure.mjs"]);
    runCheck("CANDIDATE_STATIC", process.execPath, ["tools/dev/verify-candidate-static.mjs"]);
  }

  const next = {
    ...state,
    proofReady: true,
    closureReady: false,
    candidateFingerprint: current,
    proofHead: current.head,
    closedHead: null,
  };
  writeJson(statePath, next);
  return next;
}

function close() {
  const state = readState();
  const current = fingerprint();
  if (!state.proofReady || !sameExact(state.candidateFingerprint, current)) fail("machine proof stale");
  if (dirty().length) fail("closure requires clean working tree");
  const next = { ...state, closureReady: true, closedHead: current.head };
  writeJson(statePath, next);
  return next;
}

function requireClosure() {
  const state = readState();
  const current = fingerprint();
  if (!currentClosed(state, current) || dirty().length) fail("CLOSURE_READY not valid for exact clean HEAD");
  return state;
}

function parseHook() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`invalid hook JSON: ${error.message}`);
  }
}

function context(state, conflict = false) {
  return [
    "BThwani Agent Execution Guard active.",
    "AGENTS.md is the mandatory repository entrypoint and sole agent-law owner.",
    `Pinned branch=${state.bootstrapFingerprint.branch} head=${state.bootstrapFingerprint.head} Governance=${state.bootstrapFingerprint.governanceSha}`,
    conflict ? "Another identified session owns active mutation state; this session is mutation-read-only." : "This session is attached to the current guard lane.",
    "Mutation requires explicit scoped MUTATION_READY. Exact-candidate proof and closure are required before pnpm safe:push.",
  ].join("\n");
}

function outputContext(event, text) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })}\n`);
}

function outputDecision(host, decision, reason) {
  if (host === "claude") {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ decision, reason })}\n`);
  }
}

function hookBootstrap(host, input, event) {
  const id = sessionId(input);
  const current = fingerprint();
  const old = readState(false);
  const conflict = Boolean(
    old?.ownerSessionId && old.ownerSessionId !== id &&
    old.mutationReady && !old.closureReady && sameExact(old.bootstrapFingerprint, current)
  );
  const state = conflict ? old : bootstrap(host, id, true);
  outputContext(event, context(state, conflict));
}

function hookPreTool(host, input) {
  const name = toolName(input);
  const inputObject = toolInput(input);
  const kind = classify(name);
  const command = kind === "shell" ? shellInput(input) : "";
  if (kind === "read") return outputDecision(host, "allow", "read/discovery fast path");
  if (kind === "shell" && readOnlyShell(command)) return outputDecision(host, "allow", "read-only shell fast path");
  const state = readState(false);
  const current = fingerprint();
  const result = evaluate({ name, input: inputObject, state, current, session: sessionId(input) });
  outputDecision(host, result.decision, result.reason);
}

function status() {
  console.log(JSON.stringify({ state: readState(false), current: fingerprint(), dirty: dirty() }, null, 2));
}

function main() {
  const [command = "status", ...args] = process.argv.slice(2);
  const hostIndex = args.indexOf("--host");
  const host = hostIndex >= 0 ? args[hostIndex + 1] : "manual";
  const commandArgs = hostIndex >= 0 ? args.filter((_, index) => index !== hostIndex && index !== hostIndex + 1) : args;
  try {
    if (command === "session-start") return hookBootstrap(host, parseHook(), "SessionStart");
    if (command === "before-agent") return hookBootstrap(host, parseHook(), "BeforeAgent");
    if (command === "subagent-start") return hookBootstrap(host, parseHook(), "SubagentStart");
    if (command === "pre-tool") return hookPreTool(host, parseHook());
    if (command === "bootstrap") {
      const state = bootstrap();
      return console.log(`AGENT_BOOTSTRAP=PASS branch=${state.bootstrapFingerprint.branch} head=${state.bootstrapFingerprint.head}`);
    }
    if (command === "ready") {
      const state = ready(commandArgs);
      return console.log(`MUTATION_READY=PASS branch=${state.bootstrapFingerprint.branch} head=${state.readyHead} scopes=${state.mutationScope.join(",")} runtime=${Number(state.runtimeRequired)}`);
    }
    if (command === "verify") {
      const state = verify();
      return console.log(`CANDIDATE_PROOF=PASS scope=LOCAL_PRE_PUSH head=${state.proofHead}`);
    }
    if (command === "close") {
      const state = close();
      return console.log(`CLOSURE_READY=PASS head=${state.closedHead}`);
    }
    if (command === "require-closure") {
      const state = requireClosure();
      return console.log(`CLOSURE_REQUIRED_PROOF=PASS head=${state.closedHead}`);
    }
    if (command === "status") return status();
    fail(`unknown command: ${command}`);
  } catch (error) {
    if (["before-agent", "pre-tool"].includes(command) && ["claude", "gemini"].includes(host)) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
