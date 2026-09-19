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
  "GOVERNANCE-STANDARDS.md",
  "governance/policy/QUALITY.md",
  "governance/policy/EXPERIENCE.md",
  "governance/policy/DESIGN.md",
  "GOVERNANCE_IMPACT=NONE",
  "GOVERNANCE_IMPACT=REVALIDATE_ONLY",
  "GOVERNANCE_IMPACT=UPDATE_REQUIRED",
  "GOVERNANCE_IMPACT=DEFECT_FOUND",
  "pnpm verify",
  "pnpm safe:push",
  "pnpm dev",
  "pnpm runtime:up",
  "pnpm runtime:status",
  "SMALLEST DIFF != SIMPLEST SYSTEM",
  "Proof tooling must not reset developer credentials",
  "Subagents must not independently push",
  "REQUIRED FAILURE/RECOVERY BEHAVIOR = PROVEN WHEN APPLICABLE",
  "PINNED GOVERNANCE = EXACT WHEN MATERIALLY REQUIRED",
  "KNOWN MATERIAL DEFECTS = 0",
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
  "AFFECTED_MOBILE_EXPORT_SMOKE=SKIPPED reason=no_changes",
  "nx affected -t export-smoke",
  "VERIFY_STEP_MS",
  "VERIFY_TOTAL_MS",
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

const runtimeOwnership = read("tools/dev/verify-local-runtime-ownership.mjs");
for (const forbidden of [
  'read("AGENTS.md")',
  'read("README.md")',
  'read("infra/local/compose/README.md")',
]) {
  if (runtimeOwnership.includes(forbidden)) {
    failures.push(`runtime ownership verifier must derive runtime truth from executable source/config, not docs: ${forbidden}`);
  }
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

const pkg = JSON.parse(read("package.json"));
if (pkg?.scripts?.verify !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-local-candidate.ps1") {
  failures.push("package.json verify must own local candidate verification");
}
if (pkg?.scripts?.["safe:push"] !== "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/safe-push.ps1") {
  failures.push("package.json safe:push must own push safety");
}
for (const required of ["dev", "client", "partner", "captain", "field", "control", "scr", "runtime:up", "runtime:status", "runtime:down"]) {
  if (!pkg?.scripts?.[required]) failures.push(`package.json missing required local command: ${required}`);
}

const nx = JSON.parse(read("nx.json"));
const exportInputs = nx?.targetDefaults?.["export-smoke"]?.inputs ?? [];
for (const required of [
  "default",
  "^default",
  "{workspaceRoot}/tools/mobile/export-mobile-smoke.mjs",
  "{workspaceRoot}/tools/mobile/define-samrim-expo-app.cjs",
]) {
  if (!exportInputs.includes(required)) failures.push(`nx export-smoke missing cache input: ${required}`);
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
