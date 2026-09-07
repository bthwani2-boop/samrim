import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const KNOWLEDGE_REVIEW_BYTES = 24000;
const reviewSignals = [];

function rel(file) {
  return path.relative(root, file).split(path.sep).join("/");
}
function read(p) {
  return fs.readFileSync(path.join(root, p), "utf8");
}
function exists(p) {
  return fs.existsSync(path.join(root, p));
}
function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMarkdown(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(absolute);
  }
  return out.sort();
}
function requireTokens(p, tokens) {
  const body = read(p);
  for (const token of tokens) {
    if (!body.includes(token)) failures.push(p + " missing canonical token: " + token);
  }
  return body;
}
function duplicates(values) {
  return [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
}

const governanceFiles = collectMarkdown(path.join(root, "governance"));
const docsFiles = collectMarkdown(path.join(root, "docs"));
const orchestratorFiles = collectMarkdown(path.join(root, "tools/prompting/bthwani-orchestrator"));
const activeKnowledge = [...governanceFiles, ...docsFiles, ...orchestratorFiles];

for (const file of activeKnowledge) {
  const size = fs.statSync(file).size;
  if (size > KNOWLEDGE_REVIEW_BYTES) {
    reviewSignals.push(rel(file) + " exceeds review threshold " + KNOWLEDGE_REVIEW_BYTES + " bytes: " + size);
  }
}

for (const retired of [
  "governance/decisions",
  "governance/architecture/FOUNDATION-AND-JOURNEY-READY-SUBSTRATE.md",
  "docs/platform-engineering-lifecycle",
  "docs/reference/target-operations",
  "tools/prompting/bthwani-orchestrator/profiles/foundation-construction.md",
  "tools/prompting/bthwani-orchestrator/verify/structural-qualification.md",
  "tools/prompting/bthwani-orchestrator/verify/unit-fixed-point.md",
  "tools/prompting/bthwani-orchestrator/templates/bthwani-target-qualification.md",
  "tools/prompting/bthwani-orchestrator/templates/required-truth-census.md",
  "tools/prompting/bthwani-orchestrator/templates/donor-zero-loss-accounting.md",
  "tools/dev/close-foundation-runtime.ps1",
  "tools/dev/verify-foundation-runtime.ps1",
  "tools/dev/verify-foundation-local.ps1",
]) {
  if (exists(retired)) failures.push("retired knowledge artifact still exists: " + retired);
}

const currentDocs = docsFiles.filter((f) => !rel(f).startsWith("docs/reference/"));
const forbiddenCurrentVocabulary = [
  ["legacy A0 stage", /(^|[^A-Za-z0-9])A0([^A-Za-z0-9]|$)/],
  ["legacy A1 stage", /(^|[^A-Za-z0-9])A1([^A-Za-z0-9]|$)/],
  ["legacy A2 stage", /(^|[^A-Za-z0-9])A2([^A-Za-z0-9]|$)/],
  ["legacy Stage-B", /STAGE[_ -]?B/i],
  ["legacy Journey-Ready", /JOURNEY[-_ ]?READY/i],
  ["legacy Foundation Construction", /FOUNDATION[_ -]?CONSTRUCTION/i],
  [
    "legacy Foundation stage vocabulary",
    /\b(?:foundation|refoundation)[-_ ]?(?:only|construction|stage|ready|slice)\b/i,
  ],
  ["retired Operator Context", /\bOperator Context\b|\bOPERATOR_CONTEXT\b/i],
];
for (const file of [...governanceFiles, ...orchestratorFiles, ...currentDocs]) {
  const body = fs.readFileSync(file, "utf8");
  for (const [label, re] of forbiddenCurrentVocabulary) {
    if (re.test(body)) failures.push(rel(file) + " contains " + label);
  }
}


const packageJsonText = read("package.json");
for (const token of ["runtime:foundation:", "foundation:runtime:", "foundation:local:"]) {
  if (packageJsonText.includes(token)) failures.push("package.json retains retired runtime command family: " + token);
}
const composeText = read("infra/local/compose/compose.yaml");
if (/profiles:\s*\[[^\]]*"foundation"/i.test(composeText)) failures.push("compose retains retired foundation profile");

const ownerRecords = [];
for (const file of governanceFiles) {
  const relative = rel(file);
  const body = fs.readFileSync(file, "utf8");
  const owners = [...body.matchAll(/^SEMANTIC_OWNER:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  if (owners.length > 1) failures.push(relative + " declares multiple SEMANTIC_OWNER values");
  if (owners.length === 1) {
    ownerRecords.push({ relative, owner: owners[0] });
    if (owners[0] !== relative) failures.push(relative + " SEMANTIC_OWNER must equal file path");
    for (const token of ["EXECUTION_AUTHORITY: NONE", "CLOSURE_AUTHORITY: NONE", "IMPLEMENTATION_STATE_AUTHORITY: NONE"]) {
      if (!body.includes(token)) failures.push(relative + " missing Governance metadata: " + token);
    }
  }
}
const ownerDupes = duplicates(ownerRecords.map((x) => x.owner));
if (ownerDupes.length) failures.push("duplicate Governance semantic owners: " + ownerDupes.join(", "));

requireTokens("governance/GOVERNANCE.md", [
  "ONE MATERIAL MEANING",
  "No live ADR tree",
  "architecture/PLATFORM-SUBSTRATE.md",
  "product/capabilities/**/*.md",
  "Developer reconstruction acceptance",
  "UNACCOUNTED_MATERIAL_PRODUCT_RESPONSIBILITIES=0",
  "UNMAPPED_REQUIRED_FAILURE/RECOVERY_SEMANTICS=0",
]);
requireTokens("governance/architecture/PLATFORM-SUBSTRATE.md", [
  "EMPTY_LANE_AS_READINESS_EVIDENCE = FORBIDDEN",
  "REAL_RESPONSIBILITY_PRECEDES_CONTAINER = REQUIRED",
  "does not define a global substrate-completion gate",
]);
requireTokens("governance/product/capabilities/access/platform-sovereign-control-plane.md", [
  "CONTROL_PLANE_READBACK != EFFECTIVE_CONSUMER_APPLICATION",
  "EMPTY_OR_UNKNOWN_TARGET_SELECTOR = FAIL_CLOSED",
  "FAILED_HEALTH_GATE != SILENT_STATE_MUTATION",
  "ROLLBACK_MUST_NOT_OVERWRITE_NEWER_REVISION",
]);
const archPolicy = read("governance/policies/architecture-and-fullstack.md");
if (/empty canonical contract\/data\/testing lanes/i.test(archPolicy)) failures.push("architecture policy still permits empty readiness lanes");
if (!archPolicy.includes("Empty contract/data/testing/service lanes are not substrate and are forbidden placeholders")) {
  failures.push("architecture policy missing explicit empty-lane prohibition");
}

const capabilityFiles = collectMarkdown(path.join(root, "governance/product/capabilities"));
if (capabilityFiles.length !== 28) failures.push("expected 28 one-file capability owners; found " + capabilityFiles.length);
const capabilityIds = [];
for (const file of capabilityFiles) {
  const relative = rel(file);
  const body = fs.readFileSync(file, "utf8");
  const id = body.match(/^CAPABILITY_ID:\s*([A-Z0-9_]+)\s*$/m)?.[1];
  const headings = [...body.matchAll(/^###\s+([A-Z0-9_]+)\b.*$/gm)].map((m) => m[1]);
  if (!id) failures.push(relative + " missing CAPABILITY_ID");
  if (headings.length !== 1) failures.push(relative + " must contain exactly one capability section; found " + headings.length);
  if (id && headings.length === 1 && id !== headings[0]) failures.push(relative + " CAPABILITY_ID/heading mismatch");
  if (id) capabilityIds.push(id);
  if (!body.includes("PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md")) failures.push(relative + " missing capability-index routing");
}
const capabilityDupes = duplicates(capabilityIds);
if (capabilityDupes.length) failures.push("duplicate capability IDs: " + capabilityDupes.join(", "));

const capabilityIndex = requireTokens("governance/product/CAPABILITIES.md", [
  "DURABLE_PRODUCT_CAPABILITY_INDEX",
  "one editable semantic owner file",
  "pnpm knowledge:query -- capability <CAPABILITY_ID>",
]);
if (/^###\s+[A-Z][A-Z0-9_]+\b/m.test(capabilityIndex)) failures.push("CAPABILITIES.md contains capability semantics");

const journeys = read("governance/product/JOURNEYS.md");
const journeyIds = new Set([...journeys.matchAll(/^##\s+(J\d+)\s+—/gm)].map((m) => m[1]));
if (!journeyIds.size) failures.push("JOURNEYS.md defines no journeys");
const coverageRows = [...journeys.matchAll(/^\|\s*([A-Z][A-Z0-9_]+)\s*\|\s*([^|]+)\|/gm)];
const coveredCapabilities = new Set();
for (const row of coverageRows) {
  if (!capabilityIds.includes(row[1])) continue;
  coveredCapabilities.add(row[1]);
  const refs = [...row[2].matchAll(/\bJ\d+\b/g)].map((m) => m[0]);
  if (!refs.length) failures.push("capability has no concrete journey coverage: " + row[1]);
  for (const ref of refs) if (!journeyIds.has(ref)) failures.push("unknown journey " + ref + " referenced by " + row[1]);
}
for (const id of capabilityIds) if (!coveredCapabilities.has(id)) failures.push("capability missing journey coverage row: " + id);

for (const file of docsFiles) {
  const relative = rel(file);
  const body = fs.readFileSync(file, "utf8");
  for (const token of ["DOCUMENT_CLASS:", "EXECUTION_AUTHORITY: NONE", "PRODUCT_SEMANTIC_AUTHORITY: NONE", "CURRENT_IMPLEMENTATION_AUTHORITY: NONE"]) {
    if (!body.includes(token)) failures.push(relative + " missing Docs metadata: " + token);
  }
  if (/^PRODUCT_AUTHORITY:/m.test(body) || /^CURRENT_STATE_AUTHORITY:/m.test(body)) failures.push(relative + " retains legacy authority metadata");
}

const expectedDevelopment = new Set([
  "docs/development/README.md",
  "docs/development/workflow/developer-workflow.md",
  "docs/development/backend/service-development.md",
  "docs/development/frontend/frontend-and-routing.md",
  "docs/development/frontend/design-system.md",
  "docs/development/mobile/mobile-and-eas.md",
  "docs/development/runtime/runtime-and-configuration.md",
  "docs/development/observability/observability-and-sentry.md",
  "docs/development/quality/quality-and-verification.md",
  "docs/development/release/release-and-store-submission.md",
]);
for (const file of collectMarkdown(path.join(root, "docs/development"))) {
  if (!expectedDevelopment.has(rel(file))) failures.push("unexpected development guide: " + rel(file));
}
for (const expected of expectedDevelopment) if (!exists(expected)) failures.push("missing canonical development guide: " + expected);

const docsIndex = requireTokens("docs/README.md", [
  "development/README.md",
  "runbooks/README.md",
  "reference/external-systems/",
  "Do not recreate a flat development handbook or numbered lifecycle tree",
]);
for (const stale of [
  "development/getting-started.md",
  "development/repository-map.md",
  "development/first-change.md",
  "development/runtime.md",
  "development/mobile.md",
  "reference/target-operations/",
]) {
  if (docsIndex.includes(stale)) failures.push("docs index retains stale path: " + stale);
}

const runbookFiles = collectMarkdown(path.join(root, "docs/runbooks"));
for (const file of runbookFiles) {
  const relative = rel(file);
  if (relative === "docs/runbooks/README.md") continue;
  if (path.dirname(relative) === "docs/runbooks") failures.push("flat runbook remains outside operational domain: " + relative);
}
requireTokens("docs/runbooks/README.md", [
  "access/identity.md",
  "platform/systemic-platform-recovery.md",
]);

const requiredOrchestrator = [
  "tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md",
  "tools/prompting/bthwani-orchestrator/01-SCOPE-AUTHORITY-RULES.md",
  "tools/prompting/bthwani-orchestrator/02-DIAGNOSE-ROOT-CAUSE.md",
  "tools/prompting/bthwani-orchestrator/03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md",
  "tools/prompting/bthwani-orchestrator/04-VERIFY-REDIAGNOSE-CLOSE.md",
  "tools/prompting/bthwani-orchestrator/05-EXECUTION-PLAYBOOK.md",
  "tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md",
  "tools/prompting/bthwani-orchestrator/profiles/structural-substrate.md",
  "tools/prompting/bthwani-orchestrator/verify/evidence-falsification.md",
  "tools/prompting/bthwani-orchestrator/verify/structural-conformance.md",
  "tools/prompting/bthwani-orchestrator/verify/unit-and-scope-closure.md",
  "tools/prompting/bthwani-orchestrator/templates/candidate-proof-matrix.md",
];
for (const p of requiredOrchestrator) if (!exists(p)) failures.push("missing canonical Orchestrator artifact: " + p);

requireTokens("tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md", [
  "Canonical execution cycle",
  "Structural-substrate specialization",
  "AUTHORIZED-SCOPE FIXED POINT",
]);
requireTokens("tools/prompting/bthwani-orchestrator/05-EXECUTION-PLAYBOOK.md", [
  "Canonical runtime states",
  "If the selected root is a structural prerequisite",
]);
requireTokens("tools/prompting/bthwani-orchestrator/profiles/structural-substrate.md", [
  "conditional",
  "EMPTY FUTURE LANES = FORBIDDEN",
]);
requireTokens("tools/prompting/bthwani-orchestrator/verify/unit-and-scope-closure.md", [
  "BTHWANI_ACTIVE_PRODUCT_SLICE_LEVEL_4_COMPLETE",
  "There is no global structural phase transition",
]);
requireTokens("tools/prompting/bthwani-orchestrator/templates/candidate-proof-matrix.md", [
  "Complete affected-cone accounting",
  "Supporting-value accounting",
  "Full binding chain",
  "UNACCOUNTED_FAILURE_UNKNOWN_RECOVERY=0",
]);
requireTokens("tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md", [
  "Semantic-atom accounting record",
  "ACTIVE_SLICE_DONOR_CONE_ACCOUNTING=COMPLETE",
  "UNINSPECTED_DONOR_HISTORY_MATERIAL_TO_ACTIVE_SLICE=0",
  "BTHWANI_DONOR_REQUIRED_VALUE_DISPOSITION=PASS",
]);
requireTokens("docs/README.md", [
  "Developer reconstruction and semantic-parity acceptance",
  "REQUIRED_DEVELOPMENT_GUIDANCE_LOST=0",
  "REQUIRED_OPERATIONAL_GUIDANCE_LOST=0",
]);
requireTokens("docs/development/mobile/mobile-and-eas.md", [
  "Material real-device operational evidence",
  "process death and restart/resume",
]);
requireTokens("docs/development/runtime/runtime-and-configuration.md", [
  "Development non-goals and feasibility spikes",
  "dedicated development VPS",
  "critical external provider early in an isolated spike",
]);
requireTokens("docs/development/quality/quality-and-verification.md", [
  "Official standards reference routing",
  "OWASP ASVS",
  "OWASP MASVS / MASTG / MASWE",
  "W3C WCAG",
  "NIST Secure Software Development Framework",
  "SLSA specification",
]);
requireTokens("docs/development/release/release-and-store-submission.md", [
  "Operational go-live readiness",
  "incident/decision owner and escalation path",
  "support/operator visibility and governed actions",
  "backup checkbox",
]);
requireTokens("tools/prompting/bthwani-orchestrator/verify/evidence-falsification.md", [
  "BLIND_RERUN_UNTIL_GREEN = FORBIDDEN",
  "FAILURE_SUPPRESSION/ALLOWLIST_TO_MANUFACTURE_GREEN = FORBIDDEN",
  "No documentation-only closure",
]);

const focusFiles = collectMarkdown(path.join(root, "tools/prompting/bthwani-orchestrator/focus"));
for (const file of focusFiles) {
  const body = fs.readFileSync(file, "utf8");
  const relative = rel(file);
  if (!body.includes("ARTIFACT_CLASS: ORCHESTRATOR_EXECUTION_FOCUS_LENS")) failures.push(relative + " missing focus-lens class");
  if (!body.includes("DURABLE_SEMANTIC_AUTHORITY: NONE")) failures.push(relative + " missing semantic non-authority");
  if (/^SEMANTIC_OWNER:/m.test(body)) failures.push(relative + " must not become a semantic owner");
}
if (focusFiles.length !== 3) failures.push("expected exactly three execution focus lenses; found " + focusFiles.length);

const templateFiles = collectMarkdown(path.join(root, "tools/prompting/bthwani-orchestrator/templates"));
if (templateFiles.length !== 1 || rel(templateFiles[0] ?? "") !== "tools/prompting/bthwani-orchestrator/templates/candidate-proof-matrix.md") {
  failures.push("Orchestrator templates must contain only candidate-proof-matrix.md");
}

const queryTool = fs.readFileSync(path.join(root, "tools/dev/query-knowledge.mjs"), "utf8");
for (const token of ["governance/product/capabilities", "governance/product/JOURNEYS.md", "function governanceOwners()", "function capabilityRecords()"]) {
  if (!queryTool.includes(token)) failures.push("knowledge query tool missing source-derived behavior: " + token);
}

if (failures.length) {
  console.error("KNOWLEDGE_SYSTEM_VERIFY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
if (reviewSignals.length) {
  console.warn("KNOWLEDGE_SYSTEM_REVIEW_SIGNALS=" + reviewSignals.length);
  for (const signal of reviewSignals) console.warn("  " + signal);
}
console.log("KNOWLEDGE_SYSTEM_VERIFY=PASS");
console.log("GOVERNANCE_MARKDOWN=" + governanceFiles.length);
console.log("DOCS_MARKDOWN=" + docsFiles.length);
console.log("ORCHESTRATOR_MARKDOWN=" + orchestratorFiles.length);
console.log("CAPABILITY_OWNERS=" + capabilityFiles.length);
console.log("JOURNEYS=" + journeyIds.size);
