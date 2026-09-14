import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const physicalRoot = fs.realpathSync.native(repoRoot);
const localRoot = path.join(repoRoot, ".bthwani-local", "agent-execution-guard");
export const statePath = path.join(localRoot, "state.json");
export const readinessPath = path.join(localRoot, "readiness.json");
export const proofPath = path.join(localRoot, "proof.json");
export const closurePath = path.join(localRoot, "closure.json");
const expectedRepository = "bthwani2-boop/samrim";
const STATE_SCHEMA = 1;
const PACKET_SCHEMA = 1;
const EVIDENCE = ["currentState", "governance", "primaryOfficial", "assurance", "ossExemplar", "donorHistory", "runtime"];
const CENSUS = new Set(["AFFECTED", "PROVEN_UNAFFECTED", "N/A_WITH_REASON"]);
const GOVERNANCE_IMPACT = new Set(["NONE", "REVALIDATE_ONLY", "UPDATE_REQUIRED", "DEFECT_FOUND"]);
const COMMANDS = Object.freeze({
  DSH_GENERATE_TYPES: "node services/dsh/tools/generate-types.mjs",
  IDENTITY_GENERATE_TYPES: "node services/identity/tools/generate-types.mjs",
  IDENTITY_BLOCKLIST_GENERATE: "pnpm identity:blocklist:generate",
  THEME_GENERATE: "pnpm theme:generate",
});
const BUNDLE = [
  "tools/dev/agent-execution-guard.mjs",
  "tools/dev/agent-execution-guard.test.mjs",
  "tools/dev/verify-agent-knowledge-contract.mjs",
  "tools/dev/verify-repository-structure.mjs",
  "tools/dev/safe-push.ps1",
  "REPOSITORY-STRUCTURE.md",
  "package.json",
  "CLAUDE.md",
  "GEMINI.md",
  ".claude/settings.json",
  ".gemini/settings.json",
];
const GUARD_LIFECYCLE = /^pnpm agent:guard:(bootstrap|init-readiness|ready|verify|init-closure|close|require-closure|status|test)$/i;
const GUARD_BOOTSTRAP = /^pnpm agent:guard:(bootstrap|status|test)$/i;

function fail(message) { throw new Error(`AGENT_EXECUTION_GUARD=FAIL ${message}`); }
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readJson(file, label) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { fail(`${label}: ${error.message}`); } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temp, file); }
function digest(file) { return hash(fs.readFileSync(file)); }
function git(args, allowFailure = false) { const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }); if (result.status !== 0 && !allowFailure) fail(`git ${args.join(" ")}: ${(result.stderr || result.stdout || "").trim()}`); return { status: result.status ?? 1, out: (result.stdout || "").trim() }; }
function norm(value) { return String(value ?? "").replaceAll("\\", "/"); }
function absolute(value) { return typeof value === "string" && value.trim() ? (path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value)) : null; }
function inside(parent, child) { const relative = path.relative(path.resolve(parent), path.resolve(child)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function physical(value) {
  const target = absolute(value);
  if (!target || !inside(repoRoot, target)) return null;
  let probe = target;
  const tail = [];
  while (!fs.existsSync(probe)) { const parent = path.dirname(probe); if (parent === probe) return null; tail.unshift(path.basename(probe)); probe = parent; }
  const real = path.resolve(fs.realpathSync.native(probe), ...tail);
  return inside(physicalRoot, real) ? real : null;
}
function normalizeScope(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "." || raw === "**" || raw.includes("..")) fail(`invalid mutation scope: ${raw}`);
  const normalized = norm(path.normalize(raw)).replace(/^\.\//, "");
  if (normalized === ".git" || normalized.startsWith(".git/") || normalized === ".bthwani-local" || normalized.startsWith(".bthwani-local/")) fail(`forbidden mutation scope: ${normalized}`);
  if (!physical(normalized)) fail(`mutation scope escapes repository or crosses link boundary: ${normalized}`);
  return normalized;
}
export function pathAllowedByScopes(target, scopes) { const targetPhysical = physical(target); return Boolean(targetPhysical && scopes.some((scope) => { const scopePhysical = physical(scope); return scopePhysical && inside(scopePhysical, targetPhysical); })); }
function bundleDigest() { const h = crypto.createHash("sha256"); for (const file of BUNDLE) { const absolutePath = path.join(repoRoot, file); if (!fs.existsSync(absolutePath)) fail(`guard bundle artifact missing: ${file}`); h.update(file).update("\0").update(fs.readFileSync(absolutePath)).update("\0"); } return h.digest("hex"); }
function governanceSha() { const sha = readJson(path.join(repoRoot, "knowledge.sources.json"), "knowledge.sources.json")?.governance?.commit; if (!/^[0-9a-f]{40}$/.test(sha ?? "")) fail("invalid pinned Governance SHA"); return sha; }
function assertOrigin() { const raw = git(["remote", "get-url", "origin"]).out.replace(/\.git$/i, ""); if (raw === "git@github.com:bthwani2-boop/samrim" || raw === "ssh://git@github.com:bthwani2-boop/samrim") return; try { const url = new URL(raw); if (url.protocol === "https:" && url.hostname === "github.com" && url.pathname.replace(/\/$/, "") === "/bthwani2-boop/samrim") return; } catch {} fail(`origin mismatch: ${raw}`); }
function assertAgentLaw() { const body = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8"); for (const token of ["REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL", "AGENT ENTRY / EXECUTION GATE", "CURRENT-STATE FIRST.", "READINESS PRECEDES IMPLEMENTATION.", "FRESH ADVERSARIAL RE-CENSUS", "REPOSITORY-OWNED SAFE PUSH"]) if (!body.includes(token)) fail(`AGENTS.md missing invariant: ${token}`); }
export function fingerprint() {
  if (path.resolve(git(["rev-parse", "--show-toplevel"]).out) !== repoRoot) fail("wrong repository root");
  assertOrigin();
  const head = git(["rev-parse", "HEAD"]).out;
  const branch = git(["branch", "--show-current"], true).out || process.env.GITHUB_HEAD_REF || `DETACHED:${head}`;
  return Object.freeze({ repository: expectedRepository, branch, head, agentsBlob: git(["hash-object", "AGENTS.md"]).out, knowledgeBlob: git(["hash-object", "knowledge.sources.json"]).out, governanceSha: governanceSha(), guardBundle: bundleDigest() });
}
function sameLane(a, b) { return Boolean(a && b && a.repository === b.repository && a.branch === b.branch); }
function sameExact(a, b) { return Boolean(sameLane(a, b) && a.head === b.head && a.agentsBlob === b.agentsBlob && a.knowledgeBlob === b.knowledgeBlob && a.governanceSha === b.governanceSha && a.guardBundle === b.guardBundle); }
function readState(required = true) { if (!fs.existsSync(statePath)) { if (required) fail("bootstrap state missing"); return null; } const state = readJson(statePath, "state"); if (state.schema !== STATE_SCHEMA) fail("state schema mismatch"); return state; }
function dirty() { const result = new Set(); for (const args of [["diff", "--name-only"], ["diff", "--cached", "--name-only"], ["ls-files", "--others", "--exclude-standard"]]) for (const item of git(args).out.split(/\r?\n/).filter(Boolean)) result.add(norm(item)); return [...result]; }
function staged() { return git(["diff", "--cached", "--name-only"]).out.split(/\r?\n/).filter(Boolean).map(norm); }
function loose() { const result = new Set(); for (const args of [["diff", "--name-only"], ["ls-files", "--others", "--exclude-standard"]]) for (const item of git(args).out.split(/\r?\n/).filter(Boolean)) result.add(norm(item)); return [...result]; }
function ownerMatches(state, sessionId) { if (!state?.ownerSessionId) return true; return Boolean(sessionId && state.ownerSessionId === sessionId); }
function packetKind(value) { const absolutePath = absolute(value); if (!absolutePath) return null; if (absolutePath === path.resolve(readinessPath)) return "readiness"; if (absolutePath === path.resolve(closurePath)) return "closure"; if (absolutePath === path.resolve(statePath)) return "state"; if (absolutePath === path.resolve(proofPath)) return "proof"; return null; }
function requireText(value, label, min = 8) { const text = typeof value === "string" ? value.trim() : ""; if (text.length < min || /REPLACE_WITH_|REMOVE_ONLY_AFTER/.test(text)) fail(`${label} is not materially resolved`); return text; }
function qualityDimensions() { const root = process.env.BTHWANI_KNOWLEDGE_ROOT?.trim() ? path.resolve(process.env.BTHWANI_KNOWLEDGE_ROOT) : path.join(repoRoot, ".cache", "bthwani-knowledge", governanceSha()); const file = path.join(root, "governance", "policy", "QUALITY.md"); if (!fs.existsSync(file)) fail("pinned Governance not materialized; run pnpm knowledge:sync"); const values = [...fs.readFileSync(file, "utf8").matchAll(/^QUALITY_DIMENSION:\s*([A-Z0-9_]+)\s*$/gm)].map((match) => match[1]); if (values.length < 10 || new Set(values).size !== values.length) fail("invalid Governance quality census"); return values; }
export function validateReadiness(packet, dimensions = qualityDimensions()) {
  if (packet?.schema !== PACKET_SCHEMA) fail("readiness schema mismatch");
  for (const field of ["objective", "authorityEnvelope", "environment", "materialQuestion", "selectedTreatment"]) requireText(packet[field], field);
  for (const field of ["affectedCone", "owners", "falsification", "mutationScope"]) if (!Array.isArray(packet[field]) || !packet[field].length || packet[field].some((value) => !String(value).trim())) fail(`${field} must be non-empty`);
  if (!Array.isArray(packet.decisionCriticalUnknowns) || packet.decisionCriticalUnknowns.length) fail("DECISION_CRITICAL_UNKNOWNS must be 0");
  if (!GOVERNANCE_IMPACT.has(packet.governanceImpact)) fail("invalid governanceImpact");
  const scopes = packet.mutationScope.map(normalizeScope);
  const commandIds = Array.isArray(packet.allowedCommandIds) ? packet.allowedCommandIds : [];
  if (commandIds.some((id) => !Object.hasOwn(COMMANDS, id)) || new Set(commandIds).size !== commandIds.length) fail("allowedCommandIds must contain unique repository-owned command IDs");
  if (!packet.evidenceClasses || JSON.stringify(Object.keys(packet.evidenceClasses).sort()) !== JSON.stringify([...EVIDENCE].sort())) fail("classify every evidence class exactly once");
  for (const key of EVIDENCE) { const evidence = packet.evidenceClasses[key]; if (!evidence || !["USED", "PROVEN_UNNECESSARY"].includes(evidence.state)) fail(`invalid evidence class ${key}`); requireText(evidence.reason, `${key}.reason`); }
  if (packet.evidenceClasses.currentState.state !== "USED" || packet.evidenceClasses.governance.state !== "USED") fail("currentState and governance must be USED");
  if (!packet.qualityCensus || JSON.stringify(Object.keys(packet.qualityCensus).sort()) !== JSON.stringify([...dimensions].sort())) fail("resolve every quality dimension exactly once");
  for (const dimension of dimensions) { const evidence = packet.qualityCensus[dimension]; if (!evidence || !CENSUS.has(evidence.state)) fail(`invalid quality state: ${dimension}`); requireText(evidence.reason, `${dimension}.reason`); if (evidence.state === "AFFECTED") for (const field of ["owner", "invariant", "proofPlan"]) requireText(evidence[field], `${dimension}.${field}`); }
  return { scopes, commandIds, runtimeRequired: packet.evidenceClasses.runtime.state === "USED" };
}
function proofValid(proof, state, current) { if (proof?.schema !== 1 || proof.scope !== "LOCAL_PRE_PUSH" || proof.head !== current.head || proof.readinessDigest !== state.readinessDigest || proof.guardBundle !== current.guardBundle || !Array.isArray(proof.checks) || !proof.checks.length || proof.checks.some((check) => check.result !== "PASS" || check.exitCode !== 0 || !/^[0-9a-f]{64}$/.test(check.outputDigest ?? ""))) fail("machine proof receipt is invalid or stale"); return true; }
function closureValid(packet, state, current) { if (packet?.schema !== PACKET_SCHEMA || packet.candidateHead !== current.head || packet.readinessDigest !== state.readinessDigest || packet.proofDigest !== state.proofDigest) fail("closure is not bound to current proof"); for (const field of ["freshAdversarialRecensus", "negativeSpaceCensus"]) { if (!Array.isArray(packet[field]) || !packet[field].length) fail(`${field} required`); for (const value of packet[field]) requireText(value, field); } for (const field of ["decisionCriticalUnknowns", "knownMaterialDefects", "knownMaterialContradictions", "knownGovernanceDrift", "knownShadowTruth", "knownPartialCutovers", "knownUnjustifiedResidue", "invalidatedRequiredEvidence"]) if (!Array.isArray(packet[field]) || packet[field].length) fail(`${field} must be empty`); return true; }

function shellInput(input) { const object = input?.toolArgs ?? input?.tool_input ?? input?.toolInput ?? {}; return String(object.command ?? object.cmd ?? object.script ?? ""); }
function toolInput(input) { return input?.toolArgs ?? input?.tool_input ?? input?.toolInput ?? {}; }
function toolName(input) { return String(input?.toolName ?? input?.tool_name ?? input?.name ?? ""); }
function sessionId(input) { return String(input?.sessionId ?? input?.session_id ?? "").trim() || null; }
function shellComposite(command) { return /[;&|><`\n\r]/.test(command) || command.includes("$("); }
export function readOnlyShell(command) { const normalized = String(command ?? "").trim().replace(/\s+/g, " "); return Boolean(normalized && !shellComposite(normalized) && [/^git (status|diff|show|log|ls-files|grep|rev-parse|remote get-url|branch --show-current|merge-base)(?:\s|$)/i, /^(rg|grep|cat|type|pwd|ls|dir)(?:\s|$)/i, /^(Get-Content|Get-ChildItem|Get-Location|Resolve-Path|Select-String|Test-Path)(?:\s|$)/i, /^pnpm agent:guard:status(?:\s|$)/i].some((pattern) => pattern.test(normalized))); }
function classify(name) { const normalized = name.toLowerCase(); if (!normalized) return "unknown"; if (/(github|mcp_github).*(create_file|update_file|delete_file|create_commit|update_ref|create_branch)/.test(normalized)) return "remote"; if (/(bash|powershell|shell|terminal|run_command|run_shell_command)/.test(normalized)) return "shell"; if (/(write|edit|replace|patch|delete|remove|rename|move|create_file|update_file|apply_patch|notebookedit)/.test(normalized)) return "write"; if (/(create_commit|\bcommit\b)/.test(normalized)) return "opaque-commit"; if (/(push|merge|rebase|cherry|release|deploy|submit|update_ref)/.test(normalized)) return "promotion"; if (/(agent|task|subagent)/.test(normalized)) return "delegate"; if (/(read|view|grep|glob|search|find|list|status|get|show|query|open|fetch|web|inspect|diff)/.test(normalized)) return "read"; return "unknown"; }
function pathsFrom(value, out = []) { if (!value || typeof value !== "object") return out; for (const [key, nested] of Object.entries(value)) { if (typeof nested === "string" && /(?:^|_)(?:file_?path|path|target_?file|filename)$/i.test(key)) out.push(nested); else if (nested && typeof nested === "object") pathsFrom(nested, out); } return out; }
function currentReady(state, current) { return Boolean(state?.mutationReady && state.readyHead === current.head && sameExact(state.readyFingerprint, current)); }
function currentClosed(state, current) { return Boolean(state?.closureReady && state.closedHead === current.head && sameExact(state.candidateFingerprint, current)); }
function repoVerification(command) { return [/^pnpm knowledge:sync(?:\s|$)/i, /^node tools\/dev\/verify-[^\s]+\.mjs(?:\s|$)/i, /^pnpm (knowledge:verify(?::[^\s]+)?|docs:verify(?::[^\s]+)?|repository:verify-[^\s]+|candidate:verify:static|candidate:local:verify|quality:lint|workspace:(typecheck|test|build|vet|verify)|mobile:verify-config|nx:verify-tags)(?:\s|$)/i, /^pwsh -NoProfile -ExecutionPolicy Bypass -File tools\/dev\/verify-local-candidate\.ps1(?:\s|$)/i].some((pattern) => pattern.test(command)); }
function promotion(command) { return /\bgit\s+(push|merge|rebase|cherry-pick|tag|update-ref)\b|\bgh\s+(pr|release)\b|\beas\s+(submit|build\s+--auto-submit)\b|\bexpo\s+submit\b/i.test(command); }
function registered(command, ids) { return ids.find((id) => COMMANDS[id] === command) ?? null; }
export function evaluate({ name, input, state, current, session }) {
  const kind = classify(name);
  const command = kind === "shell" ? shellInput({ toolInput: input }).trim().replace(/\s+/g, " ") : "";
  if (kind === "read") return { decision: "allow", reason: "read/discovery" };
  if (kind === "shell" && readOnlyShell(command)) return { decision: "allow", reason: "read-only shell" };
  if (kind === "shell" && GUARD_BOOTSTRAP.test(command)) return { decision: "allow", reason: "repository-owned guard bootstrap/status/test lifecycle" };
  if (!ownerMatches(state, session)) return { decision: "deny", reason: "active guard state is owned by another or unidentified session" };
  if (!state?.bootstrapPass) return { decision: "deny", reason: "AGENT_BOOTSTRAP required" };
  if (kind === "shell" && GUARD_LIFECYCLE.test(command)) return { decision: "allow", reason: "repository-owned guard lifecycle; command validates its own state transition" };
  if (kind === "remote" || kind === "opaque-commit") return { decision: "deny", reason: "opaque/remote repository mutation bypasses the local candidate lane" };
  if (kind === "promotion") return { decision: "deny", reason: "promotion tools are not the repository-owned safe-push lane" };
  if (kind === "delegate") return { decision: "allow", reason: "delegation remains subordinate to repository hooks" };
  if (kind === "write") {
    const targets = pathsFrom(input);
    const kinds = targets.map(packetKind);
    if (targets.length && kinds.every((packet) => packet === "readiness" || packet === "closure")) return { decision: "allow", reason: "agent fills non-authoritative readiness or closure packet" };
    if (kinds.includes("state") || kinds.includes("proof")) return { decision: "deny", reason: "state/proof receipts are machine-owned" };
    if (!currentReady(state, current)) return { decision: "deny", reason: "MUTATION_READY required for exact current HEAD" };
    if (!targets.length || targets.some((target) => !pathAllowedByScopes(target, state.mutationScope ?? []))) return { decision: "deny", reason: "write target outside declared mutation scope" };
    return { decision: "allow", reason: "scoped ready mutation" };
  }
  if (kind === "shell") {
    if (!command || shellComposite(command)) return { decision: "deny", reason: "composite shell command is not guardable" };
    if (/^pnpm safe:push$/i.test(command)) return currentClosed(state, current) ? { decision: "allow", reason: "exact-head closure proven" } : { decision: "deny", reason: "CLOSURE_READY required" };
    if (promotion(command)) return { decision: "deny", reason: "raw promotion is forbidden; use pnpm safe:push" };
    if (repoVerification(command)) return { decision: "allow", reason: "repository-owned verification" };
    if (!currentReady(state, current)) return { decision: "deny", reason: "MUTATION_READY required" };
    if (/^git add(?:\s|$)/i.test(command) && !/(?:^|\s)(-f|--force)(?:\s|$)/i.test(command)) { const outside = dirty().filter((item) => !pathAllowedByScopes(item, state.mutationScope)); return outside.length ? { decision: "deny", reason: `dirty path outside scope: ${outside.join(",")}` } : { decision: "allow", reason: "scoped staging" }; }
    if (/^git commit(?:\s|$)/i.test(command) && !/(?:^|\s)(-a|--all|--amend|--no-verify)(?:\s|$)/i.test(command)) { const stagedPaths = staged(); const loosePaths = loose(); if (!stagedPaths.length) return { decision: "deny", reason: "git commit requires staged candidate changes" }; const outside = stagedPaths.filter((item) => !pathAllowedByScopes(item, state.mutationScope)); if (outside.length) return { decision: "deny", reason: `staged path outside scope: ${outside.join(",")}` }; if (loosePaths.length) return { decision: "deny", reason: `git commit requires reconciled unstaged/untracked set: ${loosePaths.join(",")}` }; return { decision: "allow", reason: "scoped coherent checkpoint" }; }
    const id = registered(command, state.allowedCommandIds ?? []);
    return id ? { decision: "allow", reason: `repository-owned command id ${id}` } : { decision: "deny", reason: "shell command is not read-only, verification, guarded git lifecycle, safe push, or repository-owned command ID" };
  }
  return { decision: "deny", reason: `unclassified tool '${name}'` };
}

function bootstrap(source = "manual", ownerSessionId = null, preserve = false) { assertAgentLaw(); const current = fingerprint(); const old = readState(false); if (preserve && old && sameExact(old.bootstrapFingerprint, current) && (!ownerSessionId || !old.ownerSessionId || old.ownerSessionId === ownerSessionId)) return old; const state = { schema: STATE_SCHEMA, source, ownerSessionId, bootstrapPass: true, mutationReady: false, proofReady: false, closureReady: false, bootstrapFingerprint: current, readyFingerprint: null, candidateFingerprint: null, readyHead: null, proofHead: null, closedHead: null, mutationScope: [], allowedCommandIds: [], runtimeRequired: false, readinessDigest: null, proofDigest: null, closureDigest: null }; writeJson(statePath, state); return state; }
function initReadiness() { const state = readState(); const current = fingerprint(); if (!sameExact(state.bootstrapFingerprint, current)) fail("bootstrap stale"); const dimensions = qualityDimensions(); writeJson(readinessPath, { schema: PACKET_SCHEMA, objective: "REPLACE_WITH_AUTHORIZED_OBJECTIVE", authorityEnvelope: "REPLACE_WITH_AUTHORITY_ENVELOPE", environment: "LOCAL_INTEGRATION", materialQuestion: "REPLACE_WITH_MATERIAL_QUESTION", affectedCone: ["REPLACE_WITH_AFFECTED_CONE"], owners: ["REPLACE_WITH_OWNER"], falsification: ["REPLACE_WITH_DISCONFIRMING_TEST"], mutationScope: ["REPLACE_WITH_EXACT_SCOPE"], allowedCommandIds: [], selectedTreatment: "REPLACE_WITH_SIMPLEST_COMPLETE_TREATMENT", governanceImpact: "REVALIDATE_ONLY", decisionCriticalUnknowns: ["REMOVE_ONLY_AFTER_RESOLUTION"], evidenceClasses: Object.fromEntries(EVIDENCE.map((key) => [key, { state: ["currentState", "governance"].includes(key) ? "USED" : "PROVEN_UNNECESSARY", reason: "REPLACE_WITH_DECISION_SPECIFIC_REASON" }])), qualityCensus: Object.fromEntries(dimensions.map((dimension) => [dimension, { state: "PROVEN_UNAFFECTED", reason: "REPLACE_WITH_SCOPE_SPECIFIC_REASON" }])) }); return readinessPath; }
function ready() { const state = readState(); const current = fingerprint(); if (!sameExact(state.bootstrapFingerprint, current)) fail("bootstrap stale"); if (dirty().length) fail("readiness requires clean baseline"); const validated = validateReadiness(readJson(readinessPath, "readiness")); const next = { ...state, mutationReady: true, proofReady: false, closureReady: false, readyFingerprint: current, candidateFingerprint: null, readyHead: current.head, mutationScope: validated.scopes, allowedCommandIds: validated.commandIds, runtimeRequired: validated.runtimeRequired, readinessDigest: digest(readinessPath), proofDigest: null, closureDigest: null }; writeJson(statePath, next); return next; }
function runCheck(id, executable, args) { const result = spawnSync(executable, args, { cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 32 * 1024 * 1024 }); const output = `${result.stdout || ""}${result.stderr || ""}`; if (result.status !== 0) fail(`${id} failed\n${output}`); return { id, result: "PASS", outputDigest: hash(output), exitCode: 0 }; }
function verify() {
  const state = readState();
  if (!state.mutationReady) fail("MUTATION_READY required");
  const current = fingerprint();
  if (!sameLane(state.readyFingerprint, current) || current.guardBundle !== state.readyFingerprint.guardBundle) fail("guard lane changed after readiness");
  if (git(["merge-base", "--is-ancestor", state.readyHead, current.head], true).status !== 0 || current.head === state.readyHead) fail("verification requires committed descendant of readiness HEAD");
  if (dirty().length) fail("verification requires clean working tree");
  const count = Number(git(["rev-list", "--count", `${state.readyHead}..${current.head}`]).out);
  if (count !== 1) fail(`candidate must be one coherent commit after readiness; observed=${count}`);
  const changed = git(["diff", "--name-only", `${state.readyHead}...${current.head}`]).out.split(/\r?\n/).filter(Boolean);
  if (changed.some((item) => !pathAllowedByScopes(item, state.mutationScope))) fail("committed candidate escaped mutation scope");
  const checks = [
    runCheck("AGENT_GUARD_TESTS", process.execPath, ["--test", "tools/dev/agent-execution-guard.test.mjs"]),
    runCheck("AGENT_KNOWLEDGE_CONTRACT", process.execPath, ["tools/dev/verify-agent-knowledge-contract.mjs"]),
    runCheck("REPOSITORY_STRUCTURE", process.execPath, ["tools/dev/verify-repository-structure.mjs"]),
  ];
  if (state.runtimeRequired) checks.push(runCheck("LOCAL_CANDIDATE", "pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/dev/verify-local-candidate.ps1", "-SkipFetch"]));
  else checks.push(runCheck("CANDIDATE_STATIC", process.execPath, ["tools/dev/verify-candidate-static.mjs"]));
  const proof = { schema: 1, scope: "LOCAL_PRE_PUSH", head: current.head, readinessDigest: state.readinessDigest, guardBundle: current.guardBundle, changed, checks, createdAt: new Date().toISOString() };
  writeJson(proofPath, proof);
  const proofDigest = digest(proofPath);
  const next = { ...state, proofReady: true, closureReady: false, candidateFingerprint: current, proofHead: current.head, proofDigest, closureDigest: null };
  writeJson(statePath, next);
  return next;
}
function initClosure() { const state = readState(); const current = fingerprint(); if (!state.proofReady || !sameExact(state.candidateFingerprint, current)) fail("machine proof stale"); proofValid(readJson(proofPath, "proof"), state, current); writeJson(closurePath, { schema: PACKET_SCHEMA, candidateHead: current.head, readinessDigest: state.readinessDigest, proofDigest: state.proofDigest, freshAdversarialRecensus: ["REPLACE_WITH_FRESH_ADVERSARIAL_RECENSUS"], negativeSpaceCensus: ["REPLACE_WITH_NEGATIVE_SPACE_CENSUS"], decisionCriticalUnknowns: ["REMOVE_ONLY_AFTER_RESOLUTION"], knownMaterialDefects: ["REMOVE_ONLY_AFTER_RESOLUTION"], knownMaterialContradictions: [], knownGovernanceDrift: [], knownShadowTruth: [], knownPartialCutovers: [], knownUnjustifiedResidue: [], invalidatedRequiredEvidence: [] }); return closurePath; }
function close() { const state = readState(); const current = fingerprint(); if (!state.proofReady || !sameExact(state.candidateFingerprint, current) || dirty().length) fail("proof stale or working tree dirty"); proofValid(readJson(proofPath, "proof"), state, current); closureValid(readJson(closurePath, "closure"), state, current); const next = { ...state, closureReady: true, closedHead: current.head, closureDigest: digest(closurePath) }; writeJson(statePath, next); return next; }
function requireClosure() { const state = readState(); const current = fingerprint(); if (!currentClosed(state, current) || dirty().length || digest(closurePath) !== state.closureDigest || digest(proofPath) !== state.proofDigest) fail("CLOSURE_READY not valid for exact clean HEAD"); proofValid(readJson(proofPath, "proof"), state, current); closureValid(readJson(closurePath, "closure"), state, current); return state; }
function parseHook() { const raw = fs.readFileSync(0, "utf8").trim(); if (!raw) return {}; try { return JSON.parse(raw); } catch (error) { fail(`invalid hook JSON: ${error.message}`); } }
function context(state, conflict = false) { return ["BThwani Agent Execution Guard active.", "AGENTS.md is the mandatory repository entrypoint and sole agent-law owner.", `Pinned branch=${state.bootstrapFingerprint.branch} head=${state.bootstrapFingerprint.head} Governance=${state.bootstrapFingerprint.governanceSha}`, conflict ? "Another identified session owns active mutation state; this session is mutation-read-only." : "This session is attached to the current guard lane.", "Mutation requires MUTATION_READY. Machine proof + closure are required before pnpm safe:push."].join("\n"); }
function outputContext(host, event, text) { if (host === "claude") process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })}\n`); else process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })}\n`); }
function outputDecision(host, decision, reason) { if (host === "claude") process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } })}\n`); else process.stdout.write(`${JSON.stringify({ decision, reason })}\n`); }
function hookBootstrap(host, input, event) { const id = sessionId(input); const current = fingerprint(); const old = readState(false); const conflict = Boolean(old?.ownerSessionId && old.ownerSessionId !== id && old.mutationReady && !old.closureReady && sameLane(old.bootstrapFingerprint, current)); const state = conflict ? old : bootstrap(host, id, true); outputContext(host, event, context(state, conflict)); }
function hookPreTool(host, input) { const name = toolName(input); const inputObject = toolInput(input); const kind = classify(name); const command = kind === "shell" ? shellInput(input) : ""; if (kind === "read") return outputDecision(host, "allow", "read/discovery fast path"); if (kind === "shell" && readOnlyShell(command)) return outputDecision(host, "allow", "read-only shell fast path"); const state = readState(false); const current = fingerprint(); const result = evaluate({ name, input: inputObject, state, current, session: sessionId(input) }); outputDecision(host, result.decision, result.reason); }
function status() { console.log(JSON.stringify({ state: readState(false), current: fingerprint(), dirty: dirty() }, null, 2)); }

function main() {
  const [command = "status", ...args] = process.argv.slice(2);
  const hostIndex = args.indexOf("--host");
  const host = hostIndex >= 0 ? args[hostIndex + 1] : "manual";
  try {
    if (command === "session-start") return hookBootstrap(host, parseHook(), "SessionStart");
    if (command === "before-agent") return hookBootstrap(host, parseHook(), "BeforeAgent");
    if (command === "subagent-start") return hookBootstrap(host, parseHook(), "SubagentStart");
    if (command === "pre-tool") return hookPreTool(host, parseHook());
    if (command === "bootstrap") { const state = bootstrap(); return console.log(`AGENT_BOOTSTRAP=PASS branch=${state.bootstrapFingerprint.branch} head=${state.bootstrapFingerprint.head}`); }
    if (command === "init-readiness") return console.log(`READINESS_PACKET=${norm(path.relative(repoRoot, initReadiness()))}`);
    if (command === "ready") { const state = ready(); return console.log(`MUTATION_READY=PASS branch=${state.bootstrapFingerprint.branch} head=${state.readyHead}`); }
    if (command === "verify") { const state = verify(); return console.log(`CANDIDATE_PROOF=PASS scope=LOCAL_PRE_PUSH head=${state.proofHead} digest=${state.proofDigest}`); }
    if (command === "init-closure") return console.log(`CLOSURE_PACKET=${norm(path.relative(repoRoot, initClosure()))}`);
    if (command === "close") { const state = close(); return console.log(`CLOSURE_READY=PASS head=${state.closedHead}`); }
    if (command === "require-closure") { const state = requireClosure(); return console.log(`CLOSURE_REQUIRED_PROOF=PASS head=${state.closedHead}`); }
    if (command === "status") return status();
    fail(`unknown command: ${command}`);
  } catch (error) {
    if (["before-agent", "pre-tool"].includes(command) && ["claude", "gemini"].includes(host)) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; return; }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) { try { main(); } catch (error) { console.error(error.message); process.exit(1); } }
