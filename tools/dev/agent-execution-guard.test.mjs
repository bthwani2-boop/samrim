import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluate,
  pathAllowedByScopes,
  readOnlyShell,
  repoRoot,
  statePath,
  readinessPath,
  proofPath,
  closurePath,
  validateReadiness,
} from "./agent-execution-guard.mjs";

const fingerprint = Object.freeze({ repository: "bthwani2-boop/samrim", branch: "feature", head: "a".repeat(40), agentsBlob: "b".repeat(40), knowledgeBlob: "c".repeat(40), governanceSha: "d".repeat(40), guardBundle: "e".repeat(64) });
const dims = ["PRODUCT_BUSINESS", "OWNERSHIP_ARCHITECTURE", "DATA_MIGRATION", "CONTRACT_API_EVENT", "SECURITY_AUTHORIZATION", "PRIVACY_PII_LOCATION", "FINANCE", "RELIABILITY_RECOVERY", "PERFORMANCE_CAPACITY", "OBSERVABILITY_AUDIT", "UX_IA_CONTENT", "ACCESSIBILITY_RTL_LOCALIZATION", "VISUAL_IDENTITY_DESIGN_SYSTEM", "PLATFORM_DEVICE", "RUNTIME_CONFIG_INFRA", "DEPENDENCY_SUPPLY_CHAIN", "RELEASE_STORE_DEPLOYABLE_IDENTITY", "VERIFICATION_EVIDENCE", "GOVERNANCE_DOCS_RESIDUE"];
function state(extra = {}) { return { schema: 1, ownerSessionId: "session-a", bootstrapPass: true, mutationReady: false, proofReady: false, closureReady: false, bootstrapFingerprint: fingerprint, readyFingerprint: null, candidateFingerprint: null, readyHead: null, proofHead: null, closedHead: null, mutationScope: ["tools/dev"], allowedCommandIds: [], runtimeRequired: false, readinessDigest: null, proofDigest: null, closureDigest: null, ...extra }; }
function packet() { const qualityCensus = Object.fromEntries(dims.map((dimension) => [dimension, { state: "PROVEN_UNAFFECTED", reason: "No material effect in this bounded guard test." }])); qualityCensus.VERIFICATION_EVIDENCE = { state: "AFFECTED", reason: "Execution enforcement changes verification behavior.", owner: "tools/dev", invariant: "Only exact scoped candidates receive machine proof.", proofPlan: "Run guard tests and repository verification." }; return { schema: 1, objective: "Make repository agent execution fail closed without slowing reads.", authorityEnvelope: "READ + REPOSITORY/DEV_MUTATION", environment: "LOCAL_INTEGRATION", materialQuestion: "Can mutation and promotion require exact machine evidence?", affectedCone: ["agent routing", "repository tooling"], owners: ["AGENTS.md", "tools/dev"], falsification: ["Attempt stale, unscoped and raw promotion paths."], mutationScope: ["tools/dev"], allowedCommandIds: ["THEME_GENERATE"], selectedTreatment: "One repository-owned guard with thin host adapters.", governanceImpact: "REVALIDATE_ONLY", decisionCriticalUnknowns: [], evidenceClasses: { currentState: { state: "USED", reason: "Exact repository state is decision evidence." }, governance: { state: "USED", reason: "Pinned Governance defines quality obligations." }, primaryOfficial: { state: "USED", reason: "Current host hooks define enforcement behavior." }, assurance: { state: "USED", reason: "Adversarial cases define guard assurance." }, ossExemplar: { state: "PROVEN_UNNECESSARY", reason: "No external implementation topology is required." }, donorHistory: { state: "PROVEN_UNNECESSARY", reason: "Current repository evidence is sufficient." }, runtime: { state: "PROVEN_UNNECESSARY", reason: "This unit test changes no Product runtime." } }, qualityCensus }; }

test("scope matching rejects sibling prefix and repository escape", () => {
  assert.equal(pathAllowedByScopes(path.join(repoRoot, "tools/dev/a.mjs"), ["tools/dev"]), true);
  assert.equal(pathAllowedByScopes(path.join(repoRoot, "tools/development/a.mjs"), ["tools/dev"]), false);
  assert.equal(pathAllowedByScopes(path.resolve(repoRoot, "../escape.txt"), ["tools/dev"]), false);
});

test("scope matching rejects symlink or junction escape", (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guard-outside-"));
  const link = path.join(repoRoot, "tools", "dev", "guard-link-test");
  try { fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir"); } catch (error) { fs.rmSync(outside, { recursive: true, force: true }); t.skip(`link unavailable: ${error.message}`); return; }
  try { assert.equal(pathAllowedByScopes(path.join(link, "payload.txt"), ["tools/dev"]), false); } finally { fs.rmSync(link, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test("read-only shell fast path rejects composition", () => {
  assert.equal(readOnlyShell("git status --short"), true);
  assert.equal(readOnlyShell("Get-Content AGENTS.md"), true);
  assert.equal(readOnlyShell("git status | cat"), false);
  assert.equal(readOnlyShell("git status > out.txt"), false);
});

test("read discovery remains available before bootstrap", () => {
  assert.equal(evaluate({ name: "Read", input: { file_path: "AGENTS.md" }, state: null, current: fingerprint, session: null }).decision, "allow");
});

test("guard bootstrap/status/test lifecycle can start before state but stateful lifecycle requires the owner", () => {
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm agent:guard:bootstrap" }, state: null, current: fingerprint, session: null }).decision, "allow");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm agent:guard:status" }, state: null, current: fingerprint, session: null }).decision, "allow");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm agent:guard:ready" }, state: state(), current: fingerprint, session: "session-a" }).decision, "allow");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm agent:guard:verify" }, state: state(), current: fingerprint, session: "session-b" }).decision, "deny");
});

test("identified owner makes missing or foreign session fail closed", () => {
  const ready = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "tools/dev/x.mjs") }, state: ready, current: fingerprint, session: null }).decision, "deny");
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "tools/dev/x.mjs") }, state: ready, current: fingerprint, session: "session-b" }).decision, "deny");
});

test("guard packets are editable but machine state and proof are not", () => {
  const current = state();
  assert.equal(evaluate({ name: "Write", input: { file_path: readinessPath }, state: current, current: fingerprint, session: "session-a" }).decision, "allow");
  assert.equal(evaluate({ name: "Write", input: { file_path: closurePath }, state: current, current: fingerprint, session: "session-a" }).decision, "allow");
  assert.equal(evaluate({ name: "Write", input: { file_path: statePath }, state: current, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "Write", input: { file_path: proofPath }, state: current, current: fingerprint, session: "session-a" }).decision, "deny");
});

test("ready mutation is constrained to exact head and declared scope", () => {
  const current = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "tools/dev/x.mjs") }, state: current, current: fingerprint, session: "session-a" }).decision, "allow");
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "apps/x.ts") }, state: current, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "tools/dev/x.mjs") }, state: current, current: { ...fingerprint, head: "f".repeat(40) }, session: "session-a" }).decision, "deny");
});

test("raw promotion is denied even after closure; safe push requires closure", () => {
  const ready = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "Bash", input: { command: "git push origin HEAD" }, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm safe:push" }, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
  const closed = state({ mutationReady: true, closureReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint, candidateFingerprint: fingerprint, closedHead: fingerprint.head });
  assert.equal(evaluate({ name: "Bash", input: { command: "git push origin HEAD" }, state: closed, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm safe:push" }, state: closed, current: fingerprint, session: "session-a" }).decision, "allow");
});

test("free-form shell is denied and only repository-owned command IDs authorize mutation commands", () => {
  const current = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint, allowedCommandIds: ["THEME_GENERATE"] });
  assert.equal(evaluate({ name: "Bash", input: { command: "node arbitrary-mutator.mjs" }, state: current, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm theme:generate" }, state: current, current: fingerprint, session: "session-a" }).decision, "allow");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm theme:generate && touch x" }, state: current, current: fingerprint, session: "session-a" }).decision, "deny");
});

test("remote repository mutation, opaque commit and unknown tools fail closed", () => {
  const current = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "GitHub.update_file", input: { path: "tools/dev/x.mjs" }, state: current, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "create_commit", input: {}, state: current, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "mystery_capability", input: {}, state: current, current: fingerprint, session: "session-a" }).decision, "deny");
});

test("readiness is complete, placeholder-free, scoped and command-ID based", () => {
  const good = packet();
  const validated = validateReadiness(good, dims);
  assert.deepEqual(validated.commandIds, ["THEME_GENERATE"]);
  const unknown = packet(); unknown.allowedCommandIds = ["ARBITRARY_SHELL"]; assert.throws(() => validateReadiness(unknown, dims), /allowedCommandIds/);
  const unresolved = packet(); unresolved.decisionCriticalUnknowns = ["owner unresolved"]; assert.throws(() => validateReadiness(unresolved, dims), /DECISION_CRITICAL_UNKNOWNS/);
  const placeholder = packet(); placeholder.selectedTreatment = "REPLACE_WITH_SOMETHING"; assert.throws(() => validateReadiness(placeholder, dims), /not materially resolved/);
  const metadata = packet(); metadata.mutationScope = [".git"]; assert.throws(() => validateReadiness(metadata, dims), /forbidden mutation scope/);
  const missingOwner = packet(); delete missingOwner.qualityCensus.VERIFICATION_EVIDENCE.owner; assert.throws(() => validateReadiness(missingOwner, dims), /owner/);
});
