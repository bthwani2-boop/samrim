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
  "GOVERNANCE_IMPACT=NONE",
  "GOVERNANCE_IMPACT=REVALIDATE_ONLY",
  "GOVERNANCE_IMPACT=UPDATE_REQUIRED",
  "GOVERNANCE_IMPACT=DEFECT_FOUND",
  "GOVERNANCE-STANDARDS.md",
  "## 2.1 Material artifact survival",
  "## 2.2 Equal correctness across material dimensions",
  "EVIDENCE IS VALID ONLY FOR THE EXACT STATE IT PROVES.",
  "PROVE LOSER ABSENT",
  "KNOWN MATERIAL DEFECTS = 0",
  "KNOWN MATERIAL WEAKNESSES = 0",
  "KNOWN DUPLICATE OWNERSHIP = 0",
  "UNPROVEN MATERIAL CLAIMS = 0",
  "`pnpm verify`",
  "`pnpm safe:push`",
  "pnpm runtime:up",
  "pnpm runtime:doctor",
  "pnpm runtime:status",
]);

if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(agent)) {
  failures.push("AGENTS.md must not hard-code mutable local runtime ports");
}
if (/Docker is the sole LOCAL_INTEGRATION runtime owner|all four Metro servers/i.test(agent)) {
  failures.push("AGENTS.md retains mutable LOCAL_INTEGRATION participant inventory");
}

requireTokens("REPOSITORY-STRUCTURE.md", [
  "ARTIFACT_CLASS: REPOSITORY_LOCAL_PLACEMENT_CONTRACT",
  "PLACEMENT_CONTRACT_AUTHORITY: DELEGATED_BY_AGENTS_MD",
  "PRODUCT_SEMANTIC_AUTHORITY: NONE",
  "DURABLE_ARCHITECTURE_AUTHORITY: NONE",
  "CURRENT_IMPLEMENTATION_INVENTORY_AUTHORITY: NONE",
  "`pnpm verify` is the stable public local verification entrypoint.",
]);

const verifier = requireTokens("tools/dev/verify-local-candidate.ps1", [
  "BaseSha",
  "EXACT_LOCAL_CANDIDATE_SHA",
  "nx affected",
  "Affected workspace targets",
  "VERIFY=PASS",
]);
for (const forbidden of [
  "runtime:up",
  "runtime:doctor",
  "runtime:status",
  "bootstrap.ps1",
  "workspace:verify",
  "Get-RuntimeSnapshot",
  "Restore-RuntimeSnapshot",
]) {
  if (verifier.includes(forbidden)) failures.push(`local verifier must not own ${forbidden}`);
}

const safePush = requireTokens("tools/dev/safe-push.ps1", [
  "SAFE_PUSH=NOOP",
  "VERIFY_BASE=REMOTE_BRANCH",
  "VERIFY_BASE=MAIN_MERGE_BASE",
  "verify-local-candidate.ps1",
  "REMOTE_SHA_CONFIRMATION=PASS",
]);
const noopIndex = safePush.indexOf("SAFE_PUSH=NOOP");
const verifyIndex = safePush.indexOf("SAFE_PUSH_VERIFY=START");
if (noopIndex < 0 || verifyIndex < 0 || noopIndex > verifyIndex) {
  failures.push("safe push must resolve exact-remote NOOP before candidate verification");
}
if (safePush.includes("pnpm verify")) {
  failures.push("safe push must invoke the canonical verifier once directly, not nest the public verify command");
}

requireTokens("tools/dev/runtime.ps1", [
  "runtime.psm1",
  "Import-Module",
  "Invoke-SamrimRuntime @PSBoundParameters",
]);
const runtime = requireTokens("tools/dev/runtime.psm1", [
  "function Write-Full-Runtime-Pass",
  "CANONICAL_LOCAL_RUNTIME=PASS mode=$Mode",
  "Write-Full-Runtime-Pass 'full'",
  "Write-Full-Runtime-Pass 'warm-reconcile'",
  "RUNTIME_STATUS=READ_ONLY scope=service-state-display",
  "CANONICAL_RUNTIME_READBACK=PASS scope=full-canonical-compose",
  "MOBILE_SURFACE_RUNTIME=PASS",
  "Export-ModuleMember -Function Invoke-SamrimRuntime",
]);
if (runtime.includes("Stop-OtherOptionalServices")) {
  failures.push("runtime target startup must not stop unrelated already-running surfaces");
}

const pkg = JSON.parse(read("package.json"));
if (pkg?.scripts?.verify !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-local-candidate.ps1") {
  failures.push("package.json verify must own local candidate verification");
}
if (pkg?.scripts?.["safe:push"] !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/safe-push.ps1") {
  failures.push("package.json safe:push must own push safety");
}
for (const required of ["runtime:up", "runtime:doctor", "runtime:status"]) {
  if (!pkg?.scripts?.[required]) failures.push(`package.json missing required full-runtime command: ${required}`);
}

const prTemplate = requireTokens(".github/pull_request_template.md", [
  "## Governance impact",
  "GOVERNANCE_IMPACT=<NONE | REVALIDATE_ONLY | UPDATE_REQUIRED | DEFECT_FOUND>",
  "GOVERNANCE_CANONICAL_SHA=<40-char SHA>",
]);
if (prTemplate.includes("GOVERNANCE_IMPACT=NONE\n")) {
  failures.push("PR template must not preselect a Governance impact value");
}

requireTokens(".github/workflows/pr-policy.yml", [
  "GOVERNANCE_IMPACT=(NONE|REVALIDATE_ONLY|UPDATE_REQUIRED|DEFECT_FOUND)",
  "knowledge.sources.json",
  "GOVERNANCE_CANONICAL_SHA=",
  "Governance pin changed but GOVERNANCE_IMPACT=NONE",
  "merge-base --is-ancestor",
  "governance-and-docs.git",
  "Governance pin rollback is forbidden",
  "GOVERNANCE_PIN_MONOTONIC=PASS",
]);

const adapterCandidates = [
  ...fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name),
  ...fs.readdirSync(path.join(root, ".github"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => ".github/" + entry.name),
];
const adapters = adapterCandidates.filter((file) =>
  read(file).includes("ADAPTER_CLASS: DERIVED_AGENT_ROUTING"),
);
for (const file of adapters) {
  requireTokens(file, [
    "ADAPTER_CLASS: DERIVED_AGENT_ROUTING",
    "SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
    "CLOSURE_AUTHORITY: NONE",
    "AGENTS.md",
  ]);
}

if (failures.length) {
  console.error("AGENT_KNOWLEDGE_CONTRACT=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("AGENT_LAW_OWNER=AGENTS.md");
console.log("EXECUTION_MODEL=AFFECTED_STATIC_PLUS_CLAIM_SPECIFIC_RUNTIME_PLUS_SINGLE_SAFE_PUSH");
console.log("CUSTOM_AFFECTED_ENGINE=0");
console.log("STATEFUL_PROOF_LEDGER=0");
console.log("RUNTIME_VERIFY_COUPLING=0");
console.log("GOVERNANCE_IMPACT_INTERLOCK=PASS");
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
