import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];

function read(relative) {
  try {
    return fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n");
  } catch {
    failures.push(`missing repository artifact: ${relative}`);
    return "";
  }
}

function requireTokens(file, tokens) {
  const body = read(file);
  for (const token of tokens) {
    if (!body.includes(token)) failures.push(`${file} missing invariant: ${token}`);
  }
  return body;
}

const agent = requireTokens("AGENTS.md", [
  "ARTIFACT_CLASS: REPOSITORY_AGENT_OPERATING_CONSTITUTION",
  "REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL",
  "PRODUCT_SEMANTIC_AUTHORITY: NONE",
  "CURRENT_IMPLEMENTATION_AUTHORITY: NONE",
  "knowledge.sources.json",
  "CURRENT USER / TASK AUTHORITY",
  "Temporary task authorization should normally remain outside durable repository authority",
  "After one bounded discovery sufficient to choose owner, boundary, safety, treatment and proof, default to execution rather than repeated audit",
  "GOVERNANCE_IMPACT=NONE",
  "GOVERNANCE_IMPACT=REVALIDATE_ONLY",
  "GOVERNANCE_IMPACT=UPDATE_REQUIRED",
  "GOVERNANCE_IMPACT=DEFECT_FOUND",
  "pnpm verify",
  "pnpm safe:push",
  "SMALLEST DIFF != SIMPLEST SYSTEM",
  "Proof tooling must not reset developer credentials",
  "Subagents must not independently push",
  "NX AFFECTED OWNER",
  "ONLY REQUIRED RUNTIME PROOF LANES",
  "FULL_REGRESSION_ONLY",
]);
if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(agent)) failures.push("AGENTS.md hard-codes mutable runtime ports");
if (/Server-Driven Operational Registry|Control Panel operational-resource law/i.test(agent)) failures.push("AGENTS.md duplicates durable Operator presentation policy");
if (/Identity owns identity|DSH owns|WLT owns financial/i.test(agent)) failures.push("AGENTS.md duplicates durable System ownership semantics");

const structure = requireTokens("REPOSITORY-STRUCTURE.md", [
  "ARTIFACT_CLASS: REPOSITORY_LOCAL_PLACEMENT_CONTRACT",
  "PLACEMENT_CONTRACT_AUTHORITY: DELEGATED_BY_AGENTS_MD",
  "PRODUCT_SEMANTIC_AUTHORITY: NONE",
  "DURABLE_ARCHITECTURE_AUTHORITY: NONE",
  "CURRENT_IMPLEMENTATION_INVENTORY_AUTHORITY: NONE",
  "Current app/service/package members are discovered from the exact project graph/source",
  "This is a placement grammar, not current inventory",
  "`pnpm verify` is the stable public local verification entrypoint.",
  "governance-and-docs/docs/reference/competitors/",
  "Task authorization, branch/order instructions, checkpoint cadence and promotion constraints belong to current user/task authority outside durable tracked repository content",
]);
const retainedMatrixPath = "tools/BTHWANI_FULL_PLATFORM_CLOSURE_MATRIX.md";
const retainedMatrixEvidenceRule =
  structure.includes(`The user-directed \`${retainedMatrixPath}\` is the sole admitted retained task-evidence exception`) &&
  structure.includes("it grants no semantic/execution/implementation authority and must be revalidated against exact live state before use") &&
  fs.existsSync(path.join(root, retainedMatrixPath));
if (/single derived closure matrix/i.test(structure) || (structure.includes(retainedMatrixPath) && !retainedMatrixEvidenceRule)) {
  failures.push("REPOSITORY-STRUCTURE.md does not bound its closure-matrix exception to non-authoritative retained evidence");
}

const retiredTriggerPath = "tools/BTHWANI_FULL_PLATFORM_A_TO_Z_FIXED_POINT_CLOSURE_TRIGGER.md";
if (fs.existsSync(path.join(root, retiredTriggerPath))) {
  failures.push(`tracked task authorization must remain retired: ${retiredTriggerPath}`);
}

const security = requireTokens("SECURITY.md", [
  "DOCUMENT_CLASS: SECURITY_REPORTING_AND_SECRET_HANDLING_GUIDANCE",
  "EXECUTION_AUTHORITY: NONE",
  "PRODUCT_AUTHORITY: NONE",
  "governance/policy/SECURITY.md",
  "GitHub Private Vulnerability Reporting",
]);
if (/authorization matrix|session lifetime|actor scope|object scope/i.test(security)) failures.push("SECURITY.md duplicates durable application security policy");

const manifest = JSON.parse(read("knowledge.sources.json"));
if (manifest?.schema !== 2) failures.push("knowledge.sources.json schema drifted");
if (manifest?.governance?.repository !== "bthwani2-boop/governance-and-docs") failures.push("Governance repository binding drifted");
if (!/^[0-9a-f]{40}$/.test(manifest?.governance?.commit ?? "")) failures.push("Governance binding must be an immutable 40-char SHA");

const pkg = JSON.parse(read("package.json"));
if (pkg?.scripts?.verify !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-local-candidate.ps1") failures.push("package.json verify owner drifted");
if (pkg?.scripts?.["safe:push"] !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/safe-push.ps1") failures.push("package.json safe:push owner drifted");
for (const command of ["dev", "client", "partner", "captain", "field", "control", "scr", "runtime:up", "runtime:status", "runtime:down"]) {
  if (!pkg?.scripts?.[command]) failures.push(`package.json missing stable local command: ${command}`);
}

const safePush = requireTokens("tools/dev/safe-push.ps1", [
  "SAFE_PUSH=NOOP",
  "VERIFY_BASE=REMOTE_BRANCH",
  "VERIFY_BASE=MAIN_MERGE_BASE",
  "verify-local-candidate.ps1",
  "REMOTE_SHA_CONFIRMATION=PASS",
]);
const noop = safePush.indexOf("SAFE_PUSH=NOOP");
const verify = safePush.indexOf("SAFE_PUSH_VERIFY=START");
if (noop < 0 || verify < 0 || noop > verify) failures.push("safe push must resolve exact-remote NOOP before verification");
if (safePush.includes("pnpm verify")) failures.push("safe push must invoke the canonical verifier directly, not recursively");

const localVerifier = requireTokens("tools/dev/verify-local-candidate.ps1", [
  "EXACT_LOCAL_CANDIDATE_SHA",
  "repository-ci:execution-proof-system",
  "go-workspace-sync",
  "nx affected -t lint format-check typecheck unit contract build vet",
  "VERIFY_TOTAL_MS",
  "VERIFY=PASS",
]);
for (const forbidden of ["runtime:up", "runtime:doctor", "Get-RuntimeSnapshot", "Restore-RuntimeSnapshot"]) {
  if (localVerifier.includes(forbidden)) failures.push(`local static verifier must not own runtime behavior: ${forbidden}`);
}

const prTemplate = requireTokens(".github/pull_request_template.md", [
  "## Governance impact",
  "GOVERNANCE_IMPACT=<NONE | REVALIDATE_ONLY | UPDATE_REQUIRED | DEFECT_FOUND>",
  "GOVERNANCE_CANONICAL_SHA=<40-char SHA>",
]);
if (prTemplate.includes("GOVERNANCE_IMPACT=NONE\n")) failures.push("PR template must not preselect Governance impact");

const policy = requireTokens(".github/workflows/ci-policy.yml", [
  "GOVERNANCE_IMPACT=(NONE|REVALIDATE_ONLY|UPDATE_REQUIRED|DEFECT_FOUND)",
  "knowledge.sources.json",
  "GOVERNANCE_CANONICAL_SHA=",
  "Governance pin changed but GOVERNANCE_IMPACT=NONE",
  "Governance pin rollback is forbidden",
]);
if (!policy.includes("merge-base --is-ancestor")) failures.push("Governance pin monotonicity proof missing");

const adapterCandidates = [
  ...fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name),
  ...fs.readdirSync(path.join(root, ".github"), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => `.github/${entry.name}`),
];
for (const file of adapterCandidates) {
  const body = read(file);
  if (!body.includes("ADAPTER_CLASS: DERIVED_AGENT_ROUTING")) continue;
  for (const token of ["SEMANTIC_AUTHORITY: NONE", "EXECUTION_AUTHORITY: NONE", "CLOSURE_AUTHORITY: NONE", "AGENTS.md"]) {
    if (!body.includes(token)) failures.push(`${file} derived adapter missing ${token}`);
  }
}

if (failures.length) {
  console.error("AGENT_KNOWLEDGE_CONTRACT=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("AGENT_LAW_OWNER=AGENTS.md");
console.log("PLACEMENT_OWNER=REPOSITORY-STRUCTURE.md");
console.log("SECURITY_LOCAL_OWNER=REPORTING_AND_SECRET_HANDLING_ONLY");
console.log("TASK_AUTHORIZATION_LOCATION=EXTERNAL_CURRENT_USER_AUTHORITY");
console.log("TRACKED_TASK_TRIGGER=ABSENT");
console.log("DUPLICATE_DURABLE_AUTHORITY=0");
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
