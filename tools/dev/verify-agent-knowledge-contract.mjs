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
  "REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL",
  "RIGOR SCALES WITH CONSEQUENCE + UNCERTAINTY + AFFECTED CONE + IRREVERSIBILITY.",
  "EVERY EXISTING OR NEW COMPLEXITY MUST RE-EARN EXISTENCE.",
  "NO PROVEN CURRENT MATERIAL BENEFIT → DELETE",
  "Use the repository's real project/dependency graph.",
  "`pnpm verify` is non-mutating exact-candidate static/workspace proof.",
  "`pnpm safe:push` owns the single final local candidate verification",
  "pnpm runtime:up",
  "pnpm runtime:doctor",
  "pnpm runtime:status",
  "KNOWN UNJUSTIFIED COMPLEXITY/RESIDUE = 0",
]);

if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(agent)) {
  failures.push("AGENTS.md must not hard-code mutable local runtime ports");
}

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

const runtime = requireTokens("tools/dev/runtime.ps1", [
  "CANONICAL_LOCAL_RUNTIME=PASS mode=full",
  "RUNTIME_STATUS=READ_ONLY scope=full-canonical-compose",
  "CANONICAL_RUNTIME_READBACK=PASS scope=full-canonical-compose",
  "MOBILE_SURFACE_RUNTIME=PASS",
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

const adapters = [
  ".github/copilot-instructions.md",
  "CLAUDE.md",
  "GEMINI.md",
];
for (const file of adapters) {
  requireTokens(file, [
    "SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
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
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
