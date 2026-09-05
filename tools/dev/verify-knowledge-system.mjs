import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const cap = read("governance/product/CAPABILITIES.md");
const journeys = read("governance/product/JOURNEYS.md");
const fixed = read("tools/prompting/bthwani-orchestrator/templates/bthwani-target-qualification.md");
const platform = read("governance/project/PLATFORM.md");
const systemContext = read("governance/architecture/SYSTEM-CONTEXT.md");
const topology = read("governance/architecture/REPOSITORY-TOPOLOGY.md");
const governanceIndex = read("governance/GOVERNANCE.md");
const prd = read("governance/product/PRD.md");
const financialModel = read("governance/product/FINANCIAL-MODEL.md");
const glossary = read("governance/project/GLOSSARY.md");
const orchestrator = read("tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md");
const cleanTargetProfile = read("tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md");
const composition = read("governance/architecture/APP-SERVICE-COMPOSITION.md");
const dataContracts = read("governance/architecture/DATA-CONTRACTS-AND-INTEGRATIONS.md");
const runtimeArchitecture = read("governance/architecture/RUNTIME-AND-CONFIGURATION.md");
const foundationSubstrate = read("governance/architecture/FOUNDATION-AND-JOURNEY-READY-SUBSTRATE.md");
const experienceDesign = read("governance/product/EXPERIENCE-AND-DESIGN.md");
const providerPolicy = read("governance/policies/providers-and-integrations.md");
const toolingPolicy = read("governance/policies/tooling-and-assurance.md");
const documentationPolicy = read("governance/policies/documentation-and-knowledge.md");
const deliveryPolicy = read("governance/policies/delivery.md");
const dataPolicy = read("governance/policies/data-and-migrations.md");
const lifecycleRouter = read("docs/development/platform-engineering-lifecycle.md");
const lifecycleIndex = read("docs/platform-engineering-lifecycle/README.md");
const agentRouter = read("AGENTS.md");
const repositoryReadme = read("README.md");
const contributing = read("CONTRIBUTING.md");
const packageJson = JSON.parse(read("package.json"));
const queryKnowledge = read("tools/dev/query-knowledge.mjs");
const experienceReference = read("docs/reference/external-systems/experience-design-ui-assurance.md");
const designGuide = read("docs/development/design-system.md");
const doctorScript = read("tools/dev/doctor.ps1");
const foundationCloseScript = read("tools/dev/close-foundation-runtime.ps1");
const foundationLocalScript = read("tools/dev/verify-foundation-local.ps1");
const failures = [];

function collectMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMarkdown(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(absolute);
  }
  return out;
}

function normalizedLawLine(line) {
  return line.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isGeneralLawLike(line) {
  const t = line.trim();
  if (t.length < 30) return false;
  if (t.includes("=") || t.includes("!=") || t.startsWith("→")) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 20 && letters === letters.toUpperCase();
}

function hasNonNoneAuthority(body, names) {
  const wanted = new Set(names);
  for (const line of body.split("\n")) {
    const match = line.match(/^([A-Z_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!wanted.has(key)) continue;
    if (rawValue.trim() !== "NONE") return true;
  }
  return false;
}

const headingRe = /^###\s+([A-Z0-9_]+)\b.*$/gm;
const headingMatches = [...cap.matchAll(headingRe)];
const sections = headingMatches.map((m, i) => {
  const bodyStart = m.index + m[0].length;
  const bodyEnd = i + 1 < headingMatches.length ? headingMatches[i + 1].index : cap.length;
  return { id: m[1], body: cap.slice(bodyStart, bodyEnd) };
});
const ids = sections.map((x) => x.id);
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
if (duplicates.length) failures.push("duplicate capability IDs: " + [...new Set(duplicates)].join(", "));

for (const id of ["CENTRAL_CATALOG","CART_CHECKOUT","FIELD_OPERATIONS_ASSIGNMENT_READINESS","MARKETING_CAMPAIGNS_LOYALTY","NOTIFICATIONS_COMMUNICATIONS","ANALYTICS_OPERATIONAL_READ_MODELS"]) {
  if (!ids.includes(id)) failures.push("missing required responsibility capability: " + id);
}
if (ids.includes("CATALOG_APPROVAL_PUBLICATION")) failures.push("CATALOG_APPROVAL_PUBLICATION remains a parallel durable capability");
if (ids.includes("PLATFORM_CHANGE_SETS")) failures.push("PLATFORM_CHANGE_SETS remains a parallel durable capability");
if (ids.includes("WLT_MONEY_MOVEMENT_SETTLEMENT")) failures.push("ambiguous legacy WLT_MONEY_MOVEMENT_SETTLEMENT capability name remains");

const highRiskBoundaryIds = [
  "ORDER_CREATION",
  "PARTNER_ONBOARDING_STORE_PUBLICATION",
  "CENTRAL_CATALOG",
  "PROMOTIONS_COUPONS_FUNDING",
  "CART_CHECKOUT",
  "FIELD_OPERATIONS_ASSIGNMENT_READINESS",
  "MARKETING_CAMPAIGNS_LOYALTY",
  "PLATFORM_SOVEREIGN_CONTROL_PLANE",
  "SETTLEMENTS_COMMISSIONS",
  "WLT_MONEY_MOVEMENT_PAYOUT_RECONCILIATION",
];
for (const id of highRiskBoundaryIds) {
  const section = sections.find((x) => x.id === id);
  if (!section || !section.body.includes("**Boundary/non-overlap.**")) failures.push(id + " missing explicit non-overlap boundary");
}
const checks = [
  ["Problem", (b) => b.includes("**Problem.")],
  ["Target state", (b) => b.includes("**Target state.")],
  ["Primary success measure", (b) => b.includes("**Primary success measure.")],
  ["Guardrail measures", (b) => b.includes("**Guardrail measures.")],
  ["Required outcome", (b) => b.includes("**Required outcome.")],
  ["Primary actors", (b) => b.includes("**Primary actors.")],
  ["Canonical ownership", (b) => b.includes("**Canonical ownership.")],
  ["Material surfaces", (b) => b.includes("**Material deployable surfaces.") || b.includes("**Material surfaces.")],
  ["Business invariants", (b) => b.includes("**Business invariants")],
  ["Forbidden invariants", (b) => b.includes("**Forbidden/negative invariants")],
  ["Failure/recovery", (b) => b.includes("**Failure/recovery.") || b.includes("**Named failure classes:")],
  ["Acceptance expectations", (b) => b.includes("**Acceptance expectations")],
  ["Actor responsibility envelope", (b) => b.includes("**Actor responsibility envelope")],
  ["Surface semantics", (b) => b.includes("**Surface semantics")],
];
for (const { id, body } of sections) {
  for (const [label, test] of checks) if (!test(body)) failures.push(id + " missing semantic envelope field: " + label);
}


const durableGovernanceDir = path.join(root, "governance");
const governanceSemanticOwners = new Map();
for (const file of collectMarkdown(durableGovernanceDir)) {
  const body = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).split(path.sep).join("/");

  const ownerMatches = [...body.matchAll(/^SEMANTIC_OWNER:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const requiresSemanticOwner =
    rel === "governance/GOVERNANCE.md" ||
    /^governance\/(project|product|architecture|policies)\/[^/]+\.md$/.test(rel);

  if (requiresSemanticOwner && ownerMatches.length !== 1) {
    failures.push(rel + " must declare exactly one SEMANTIC_OWNER");
  }
  if (ownerMatches.length > 1) failures.push(rel + " declares duplicate SEMANTIC_OWNER lines");
  if (ownerMatches.length === 1) {
    const owner = ownerMatches[0];
    if (owner !== rel) failures.push(rel + " SEMANTIC_OWNER must equal its repository path; found " + owner);
    if (governanceSemanticOwners.has(owner)) {
      failures.push("duplicate Governance SEMANTIC_OWNER " + owner + " in " + governanceSemanticOwners.get(owner) + " and " + rel);
    } else {
      governanceSemanticOwners.set(owner, rel);
    }
  }

  if (/services\/workforce|core\/workforce|workforce-service|Workforce owns/i.test(body)) {
    failures.push("retired current Workforce-service authority residue in durable Governance: " + rel);
  }
  if (/service-owned capability presentation|service-owned presentation where justified/i.test(body)) {
    failures.push("ambiguous service-owned surface presentation wording in durable Governance: " + rel);
  }
  if (/services\/[^\s/]+\/frontend\//i.test(body)) {
    failures.push("service-owned frontend path residue in durable Governance: " + rel);
  }
  if (/during the current refoundation campaign|active refoundation branch|stage-b\//i.test(body)) {
    failures.push("current campaign/branch state leaked into durable Governance: " + rel);
  }
}

const branchSensitiveFiles = [
  ...collectMarkdown(path.join(root, "docs/development")),
  path.join(root, "AGENTS.md"),
  path.join(root, "README.md"),
  path.join(root, "CONTRIBUTING.md"),
  path.join(root, "tools/dev/doctor.ps1"),
  path.join(root, "tools/dev/close-foundation-runtime.ps1"),
  path.join(root, "tools/dev/verify-foundation-local.ps1"),
];
for (const file of branchSensitiveFiles) {
  if (!fs.existsSync(file)) continue;
  const body = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (/ExpectedBranch\s*=\s*["']a["']/i.test(body)) failures.push("hard-coded branch a default in tooling/docs: " + rel);
  if (/clean branch\s+`a`|active refoundation branch|branch\s+`a`/i.test(body)) failures.push("hard-coded branch a guidance in durable/current docs: " + rel);
  if (/stage-b\/[A-Za-z0-9._/-]+/i.test(body)) failures.push("branch-specific stage-b state leaked into durable/current docs: " + rel);
}

const docsDir = path.join(root, "docs");
for (const file of collectMarkdown(docsDir)) {
  const body = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (hasNonNoneAuthority(body, ["EXECUTION_AUTHORITY", "PRODUCT_AUTHORITY", "PRODUCT_SEMANTIC_AUTHORITY", "ARCHITECTURE_AUTHORITY", "CLOSURE_AUTHORITY"])) {
    failures.push("Docs claims forbidden normative authority: " + rel);
  }
}

const orchestratorDir = path.join(root, "tools/prompting/bthwani-orchestrator");
const refoundationDir = path.join(root, "tools/prompting/bthwani-refoundation");
if (fs.existsSync(refoundationDir)) failures.push("legacy bthwani-refoundation package still exists");
const orchestratorTemplateDir = path.join(orchestratorDir, "templates");
const orchestratorLawFiles = collectMarkdown(orchestratorDir).filter((file) => !file.startsWith(orchestratorTemplateDir + path.sep));
const orchestratorLawLines = new Map();
for (const file of orchestratorLawFiles) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!isGeneralLawLike(line)) continue;
    const normalized = normalizedLawLine(line);
    if (!normalized) continue;
    if (!orchestratorLawLines.has(normalized)) orchestratorLawLines.set(normalized, []);
    orchestratorLawLines.get(normalized).push(path.relative(root, file).split(path.sep).join("/"));
  }
}

for (const file of fs.existsSync(orchestratorTemplateDir) ? collectMarkdown(orchestratorTemplateDir) : []) {
  const body = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (!body.includes("ARTIFACT_CLASS: EXECUTION_EVIDENCE_TEMPLATE") && !body.includes("ARTIFACT_CLASS: TEMPORARY_EXECUTION_EVIDENCE_TEMPLATE")) {
    failures.push(rel + " orchestrator template missing evidence-template artifact class");
  }
  if (!body.includes("GENERAL_LAW_AUTHORITY: NONE")) failures.push(rel + " orchestrator template claims or omits law non-authority");
  if (hasNonNoneAuthority(body, ["EXECUTION_AUTHORITY", "PRODUCT_AUTHORITY", "CLOSURE_AUTHORITY"])) {
    failures.push(rel + " orchestrator template claims forbidden authority");
  }
}

const allowedSharedOrchestratorProtocolTokens = new Set([
  "mode clean target reconstruction",
  "product breadth active slice full target",
  "invalidate affected evidence",
  "select next highest authorized executable unit if any",
  "execute immediately if one exists",
  "otherwise verify authorized scope fixed point",
  "orchestrator compliance failure",
  "deferred outside authorized product scope",
  "mapped to pre root catastrophe",
  "authorized intentional condition",
  "stale or superseded with proof",
  "re synthesize current stage graph",
  "execute highest required frontier",
  "accidental partial implementation forbidden",
  "full capability closed claim from increment forbidden",
  "persisted observable readback",
  "unknown must remain unknown until reconciled",
]);

for (const [normalized, occurrences] of orchestratorLawLines) {
  const owners = [...new Set(occurrences)];
  if (owners.length <= 1) continue;
  if (!allowedSharedOrchestratorProtocolTokens.has(normalized)) {
    failures.push("cross-owner orchestrator law duplication outside shared protocol allowlist: " + normalized + " @ " + owners.join(", "));
  }
}

for (const token of allowedSharedOrchestratorProtocolTokens) {
  const occurrences = orchestratorLawLines.get(token) ?? [];
  if (new Set(occurrences).size <= 1) {
    failures.push("stale orchestrator shared-protocol allowlist token: " + token);
  }
}
if (fs.existsSync(refoundationDir)) {
  for (const file of collectMarkdown(refoundationDir)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!isGeneralLawLike(line)) continue;
      const normalized = normalizedLawLine(line);
      if (orchestratorLawLines.has(normalized)) {
        failures.push("general law duplicated in legacy refoundation residue: " + line.trim() + " @ " + path.relative(root, file).split(path.sep).join("/"));
      }
    }
  }
}

const allowedLegacyRefoundationTextReferences = new Set([
  "tools/prompting/bthwani-orchestrator/templates/bthwani-target-qualification.md",
]);
for (const scope of ["governance", "docs", "tools/prompting"]) {
  const scopeDir = path.join(root, scope);
  for (const file of collectMarkdown(scopeDir)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const body = fs.readFileSync(file, "utf8");
    if (!body.includes("bthwani-refoundation")) continue;
    if (!allowedLegacyRefoundationTextReferences.has(rel)) {
      failures.push("stale live knowledge reference to retired bthwani-refoundation package: " + rel);
    }
  }
}

if (cap.includes("`shared` — required")) failures.push("technical shared layer masquerades as Product surface");
if (cap.toLowerCase().includes("proven notification capability")) failures.push("notification owner unresolved");
if (cap.toLowerCase().includes("canonical ownership.** derived analytics/read-model capability")) failures.push("analytics owner unresolved");

const coverageSections = journeys.split("\n").filter((line) => line.trim() === "## Capability-to-journey coverage").length;
if (coverageSections !== 1) failures.push("expected exactly one capability-to-journey matrix; found " + coverageSections);
const rows = [];
for (const line of journeys.split("\n")) {
  if (!line.startsWith("|")) continue;
  const cells = line.split("|").slice(1, -1).map((x) => x.trim());
  if (cells.length < 2 || cells[0] === "Capability" || cells[0] === "---") continue;
  if (/^[A-Z][A-Z0-9_]+$/.test(cells[0])) rows.push({ id: cells[0], coverage: cells[1] });
}
const rowIds = rows.map((x) => x.id);
const duplicateRows = rowIds.filter((id, i) => rowIds.indexOf(id) !== i);
if (duplicateRows.length) failures.push("duplicate journey rows: " + [...new Set(duplicateRows)].join(", "));
for (const id of ids) if (!rowIds.includes(id)) failures.push("capability missing journey row: " + id);
for (const id of rowIds) if (!ids.includes(id)) failures.push("orphan journey row: " + id);

for (const token of ["ALL_MATERIAL_JOURNEY_STEPS_CLASSIFIED=PASS","UNOWNED_MATERIAL_JOURNEY_STEPS=0","CAPABILITY_REQUIRED_SEMANTIC_ENVELOPE=PASS","DURABLE_REPOSITORY_TOPOLOGY_OWNER=PASS"]) {
  if (!fixed.includes(token)) failures.push("fixed-point gate missing: " + token);
}
if (!topology.includes("SEMANTIC_OWNER: governance/architecture/REPOSITORY-TOPOLOGY.md")) failures.push("durable topology owner missing");
if (!governanceIndex.includes("architecture/REPOSITORY-TOPOLOGY.md")) failures.push("governance index missing durable repository-topology owner");
if (systemContext.includes("explicitly admitted Platform Control are the primary bounded contexts")) failures.push("Platform Control service admission is assumed");
if (!platform.includes("independent deployable-service admission remains conditional")) failures.push("Platform Control semantic/deployment split missing");

if (!orchestrator.includes("PRODUCT_BREADTH: ACTIVE_SLICE | FULL_TARGET")) failures.push("orchestrator missing explicit Product-breadth invocation");
if (!orchestrator.includes("AUTO_EXPAND_BEYOND_AUTHORIZED_PRODUCT_SCOPE=FORBIDDEN")) failures.push("orchestrator missing no-auto-expansion law");
if (!orchestrator.includes("BTHWANI_ACTIVE_PRODUCT_SLICE_LEVEL_4_COMPLETE")) failures.push("orchestrator missing active-slice Level-4 terminal token");

if (!orchestrator.includes("## 6A. Context-loading protocol")) failures.push("orchestrator missing staged context-loading protocol");
if (orchestrator.includes("Then load `00` through `05`")) failures.push("orchestrator still requires unconditional preload of all 00-05 modules");
const orchestratorLoadTriggers = new Map([
  ["tools/prompting/bthwani-orchestrator/01-SCOPE-AUTHORITY-RULES.md", "LOAD_TRIGGER: ENTRY_RESUME_SCOPE_AUTHORITY_BEFORE_BRANCH_OR_SCOPE_ACTION"],
  ["tools/prompting/bthwani-orchestrator/02-DIAGNOSE-ROOT-CAUSE.md", "LOAD_TRIGGER: BEFORE_DIAGNOSIS_OR_ROOT_SELECTION"],
  ["tools/prompting/bthwani-orchestrator/03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md", "LOAD_TRIGGER: BEFORE_MUTATION_REFOUNDATION_MIGRATION_CUTOVER_OR_DELETION"],
  ["tools/prompting/bthwani-orchestrator/04-VERIFY-REDIAGNOSE-CLOSE.md", "LOAD_TRIGGER: BEFORE_VERIFICATION_FALSIFICATION_RECENSUS_OR_CLOSURE"],
  ["tools/prompting/bthwani-orchestrator/05-EXECUTION-PLAYBOOK.md", "LOAD_TRIGGER: WHEN_MULTI_STEP_CAMPAIGN_STATE_RECOVERY_OR_AUTOMATIC_CONTINUATION_APPLIES"],
]);
for (const [modulePath, trigger] of orchestratorLoadTriggers) {
  const body = read(modulePath);
  if (!body.includes(trigger)) failures.push(modulePath + " missing canonical LOAD_TRIGGER");
}
if (!cleanTargetProfile.includes("GENERAL_EXECUTION_AUTHORITY: tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md")) failures.push("clean-target profile missing canonical orchestrator authority routing");

if (!prd.includes("## 1B. Target Product vision versus delivery breadth")) failures.push("PRD missing target-vs-active Product breadth law");
if (prd.includes("The current operational fulfillment-policy modes are")) failures.push("PRD still treats every target fulfillment mode as current operational scope");
if (!prd.includes("The target supported fulfillment-policy modes are")) failures.push("PRD missing target fulfillment-mode semantics");
if (!journeys.includes("## Target journey envelope versus active increment")) failures.push("journey governance missing target-envelope versus active-increment law");
if (!journeys.includes("TARGET_JOURNEY_ENVELOPE != ACTIVE_JOURNEY_INCREMENT")) failures.push("journey governance missing no-auto-expansion invariant");
if (!financialModel.includes("## Financial breadth activation law")) failures.push("financial governance missing incremental breadth activation law");
if (!financialModel.includes("REAL_FINANCIAL_EFFECT_CREATED_BY_ACTIVE_SLICE = CURRENT_WLT_OBLIGATION")) failures.push("financial governance can defer an already-created financial effect");

for (const term of ["**Partner**", "**Internal Wallet**", "**Ledger**", "**Balance**", "**External Financial Rail / External Wallet Provider**"]) {
  if (!glossary.includes(term)) failures.push("glossary missing canonical term: " + term);
}

if (!fixed.includes("BTHWANI_JOURNEY_READY_PLATFORM_SUBSTRATE=PASS")) failures.push("target qualification checklist missing journey-ready platform-substrate gate");

if (!prd.includes("app-owned surface-specific capability presentation")) failures.push("PRD does not encode app-owned surface-specific presentation");
if (!composition.includes("SURFACE_SPECIFIC_FEATURE_UI → APP HOST")) failures.push("app/service composition governance missing canonical surface-specific UI owner");
if (!topology.includes("Surface-specific presentation belongs to app hosts")) failures.push("repository topology does not route surface-specific presentation to app hosts");
if (/services\/<owner>\/frontend\/<capability>\/presentation\/control-panel/i.test(composition)) failures.push("composition governance contains forbidden service-owned Control Panel feature path");

for (const token of [
  "JOURNEY_READY",
  "DEPLOYABLE_HOST_SHELLS         = PASS",
  "DATA_OWNER_ISOLATION           = PASS",
  "STANDARD_MIGRATION_LINEAGE     = PASS",
  "CANONICAL_CONTRACT_GENERATION  = PASS",
  "DESIGN/RTL/A11Y_FOUNDATION     = PASS",
  "PREMATURE_BUSINESS_FURNISHING  = 0",
]) {
  if (!foundationSubstrate.includes(token)) failures.push("journey-ready substrate governance missing token: " + token);
}

for (const token of [
  "REPOSITORY_PATH_CHANGE != DEPLOYABLE_IDENTITY_CHANGE",
  "DEPLOYABLE_IDENTITY_CHANGE → EXPLICIT_MIGRATION",
]) {
  if (!deliveryPolicy.includes(token)) failures.push("delivery policy missing deployable-identity invariant: " + token);
}

for (const token of [
  "ONE_DATA_OWNER",
  "ONE_CANONICAL_MIGRATION_HISTORY",
  "one globally ordered canonical migration lane",
]) {
  if (!dataPolicy.includes(token)) failures.push("data policy missing migration-authority invariant: " + token);
}

for (const token of [
  "REPOSITORY-WIDE API DISCOVERY INDEX → generated/derived or absent",
  "DETERMINISTIC GENERATION",
  "DRIFT CHECK",
]) {
  if (!dataContracts.includes(token)) failures.push("data/contracts governance missing generation/catalog invariant: " + token);
}

for (const token of [
  "INFRA BINDS/COMPOSES VALUES",
  "SERVICE-SPECIFIC PROVIDER SIMULATOR",
]) {
  if (!runtimeArchitecture.includes(token)) failures.push("runtime architecture missing infra/simulator ownership token: " + token);
}

for (const token of [
  "PREBUILD FULL DOMAIN COMPONENT CATALOG = FORBIDDEN",
  "REPOSITORY_WIDE_GENERIC_LOCALES_AUTHORITY = FORBIDDEN",
]) {
  if (!experienceDesign.includes(token)) failures.push("experience/design governance missing design-system admission token: " + token);
}

for (const token of [
  "GENERIC_PROVIDER_GOD_SERVICE=0",
  "BLIND_FALLBACK_ON_UNKNOWN_MUTATION=0",
  "WEBHOOK_TRUST/REPLAY/IDEMPOTENCY=PASS_WHEN_APPLICABLE",
]) {
  if (!providerPolicy.includes(token)) failures.push("provider/integration policy missing closure token: " + token);
}

for (const token of [
  "TOOLS_PRODUCT_AUTHORITY=0",
  "GUARDS_ENFORCING_LOSING_TOPOLOGY=0",
  "TOOLS_ARE_EVIDENCE_PRODUCERS_ONLY=PASS",
]) {
  if (!toolingPolicy.includes(token)) failures.push("tooling/assurance policy missing closure token: " + token);
}

for (const token of [
  "DOCS_PARALLEL_AUTHORITY=0",
  "KNOWLEDGE_FALSE_GREEN=0",
  "AGENT_AMBIGUITY=0",
]) {
  if (!documentationPolicy.includes(token)) failures.push("documentation/knowledge policy missing closure token: " + token);
}


for (const token of [
  "ARTIFACT_CLASS: DERIVED_AGENT_ROUTING",
  "SEMANTIC_AUTHORITY: NONE",
  "EXECUTION_AUTHORITY: NONE",
  "CLOSURE_AUTHORITY: NONE",
  "GOVERNANCE   = durable Product/System/architecture/policy meaning",
  "ORCHESTRATOR = authorized execution, mutation, recovery, verification and closure",
  "SOURCE       = current executable implementation/configuration/runtime truth",
]) {
  if (!agentRouter.includes(token)) failures.push("AGENTS.md missing routing/non-authority token: " + token);
}
if (!agentRouter.includes("never infer `FULL_TARGET` from `LEVEL_4`")) failures.push("AGENTS.md missing active-slice anti-expansion routing");
if (!agentRouter.includes("surface-specific feature UI belongs to the consuming app host by default")) failures.push("AGENTS.md missing app-host feature UI routing");
if (!agentRouter.includes("pnpm knowledge:query -- capability IDENTITY_ACTIVATION_SESSIONS")) failures.push("AGENTS.md missing selective capability-query routing");
if (!agentRouter.includes("pnpm knowledge:query -- list owners")) failures.push("AGENTS.md missing derived semantic-owner navigation");
if (!agentRouter.includes("pnpm knowledge:query -- owner financial")) failures.push("AGENTS.md missing semantic-owner query example");

if (!doctorScript.includes('[string] $ExpectedBranch = ""')) failures.push("doctor branch check is not invocation-driven");
if (!foundationCloseScript.includes('[string] $ExpectedBranch = ""')) failures.push("foundation runtime closure branch check is not invocation-driven");
if (!foundationLocalScript.includes('[string] $ExpectedBranch = ""')) failures.push("local foundation proof branch check is not invocation-driven");
if (!foundationLocalScript.includes('$verificationBranch = if ([string]::IsNullOrWhiteSpace($ExpectedBranch))')) failures.push("local foundation proof does not derive verification branch from current candidate");


const agentAdapterPaths = ["CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md"];
for (const adapterPath of agentAdapterPaths) {
  const body = read(adapterPath);
  for (const token of [
    "ADAPTER_CLASS: DERIVED_AGENT_ROUTING",
    "SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
    "CLOSURE_AUTHORITY: NONE",
    "AGENTS.md",
  ]) {
    if (!body.includes(token)) failures.push(adapterPath + " missing routing-only token: " + token);
  }
  if (body.split("\n").length > 60) failures.push(adapterPath + " is too large for a routing-only adapter");
  if (/TARGET_BRANCH:|stage-b\/|active refoundation branch/i.test(body)) {
    failures.push(adapterPath + " contains branch/campaign state");
  }
  if (hasNonNoneAuthority(body, ["PRODUCT_AUTHORITY"])) {
    failures.push(adapterPath + " claims Product authority");
  }
}
if (packageJson.scripts?.["knowledge:query"] !== "node tools/dev/query-knowledge.mjs") failures.push("package.json missing canonical knowledge:query command");
for (const sourcePath of ["governance/product/CAPABILITIES.md", "governance/product/JOURNEYS.md"]) {
  if (!queryKnowledge.includes(sourcePath)) failures.push("knowledge query tool missing canonical source: " + sourcePath);
}
if (!queryKnowledge.includes("function governanceOwners()")) failures.push("knowledge query tool missing source-derived Governance owner discovery");
if (!queryKnowledge.includes('rawId === "owners"')) failures.push("knowledge query tool missing list owners mode");
if (!queryKnowledge.includes('kind === "owner"')) failures.push("knowledge query tool missing owner lookup mode");
if (/writeFileSync|appendFileSync|createWriteStream/.test(queryKnowledge)) failures.push("knowledge query tool writes a parallel knowledge artifact");

if (/\ba\b.*active refoundation|active refoundation.*\ba\b/i.test(repositoryReadme)) failures.push("README hard-codes temporary branch a as active repository state");
if (/\ba\b.*active refoundation|active refoundation.*\ba\b/i.test(contributing)) failures.push("CONTRIBUTING hard-codes temporary branch a as active repository state");


const lifecycleModules = [
  "docs/platform-engineering-lifecycle/README.md",
  "docs/platform-engineering-lifecycle/01-foundation-scope-and-donor.md",
  "docs/platform-engineering-lifecycle/02-architecture-security-and-technical-foundation.md",
  "docs/platform-engineering-lifecycle/03-identity-experience-and-journey-ready.md",
  "docs/platform-engineering-lifecycle/04-integrations-finance-and-verification.md",
  "docs/platform-engineering-lifecycle/05-build-release-and-operations.md",
  "docs/platform-engineering-lifecycle/06-evidence-gates-and-templates.md",
];
for (const modulePath of lifecycleModules) {
  if (!fs.existsSync(path.join(root, modulePath))) failures.push("missing modular lifecycle document: " + modulePath);
}
if (!lifecycleRouter.includes("former monolithic lifecycle guide has been losslessly decomposed")) failures.push("legacy lifecycle path is not a compact router");
if (lifecycleRouter.split("\n").length > 80) failures.push("legacy lifecycle router has regrown into a monolith");
if (!lifecycleIndex.includes("## Lifecycle module map")) failures.push("modular lifecycle README missing load-by-need map");
for (const modulePath of lifecycleModules.slice(1)) {
  const body = read(modulePath);
  if (!body.includes("PARENT_GUIDE: docs/platform-engineering-lifecycle/README.md")) failures.push(modulePath + " missing parent-guide routing metadata");
}

const externalReferencePaths = [
  "docs/reference/external-systems/README.md",
  "docs/reference/external-systems/commerce-fulfillment.md",
  "docs/reference/external-systems/finance-payments.md",
  "docs/reference/external-systems/identity-platform.md",
  "docs/reference/external-systems/engineering-infrastructure.md",
  "docs/reference/external-systems/experience-design-ui-assurance.md",
];
for (const referencePath of externalReferencePaths) {
  const body = read(referencePath);
  for (const token of [
    "DOCUMENT_CLASS: NON_AUTHORITATIVE_EXTERNAL_REFERENCE",
    "EXECUTION_AUTHORITY: NONE",
    "PRODUCT_AUTHORITY: NONE",
    "CURRENT_REPOSITORY_STATE_AUTHORITY: NONE",
    "ADOPTION_AUTHORITY: NONE",
    "REFERENCE_FRESHNESS: REVALIDATE_MATERIAL_FACTS_AT_USE",
    "LICENSE_RECHECK_ON_ADOPTION: REQUIRED",
    "SECURITY_SUPPLY_CHAIN_RECHECK_ON_ADOPTION: REQUIRED",
  ]) {
    if (!body.includes(token)) failures.push(referencePath + " missing external-reference metadata: " + token);
  }
}

if (!read("docs/reference/external-systems/README.md").includes("../donor-reconstruction-patterns.md")) {
  failures.push("external reference index missing donor reconstruction reference");
}
if (!read("docs/README.md").includes("reference/donor-reconstruction-patterns.md")) {
  failures.push("Docs index missing donor reconstruction reference");
}

for (const token of [
  "DOCUMENT_CLASS: NON_AUTHORITATIVE_EXTERNAL_REFERENCE",
  "ADOPTION_AUTHORITY: NONE",
  "Style Dictionary",
  "Base UI",
  "React Aria",
  "Cloudscape",
  "Storybook",
  "Playwright",
  "axe-core",
  "Maestro",
  "Lucide",
  "AXE_GREEN != ACCESSIBILITY_CLOSED",
]) {
  if (!experienceReference.includes(token)) failures.push("experience/design reference corpus missing token: " + token);
}
if (!designGuide.includes("docs/reference/external-systems/experience-design-ui-assurance.md")) failures.push("design-system guide does not route to experience/UI reference corpus");
if (!designGuide.includes("PREBUILD_FULL_COMPONENT_CATALOG = FORBIDDEN")) failures.push("design-system guide missing just-in-time component law");

const retiredPlanPath = "tools/prompting/bthwani-refoundation/05-CLEAN-REPOSITORY-RECONSTRUCTION-PLAN.md";
if (fs.existsSync(path.join(root, retiredPlanPath))) failures.push("temporary clean-reconstruction campaign plan remains in the live knowledge system");
if (cleanTargetProfile.includes("05-CLEAN-REPOSITORY-RECONSTRUCTION-PLAN.md")) failures.push("clean-target profile depends on the retired campaign plan");

for (const scope of ["governance", "docs", "tools/prompting"]) {
  const scopeDir = path.join(root, scope);
  if (!fs.existsSync(scopeDir)) continue;
  for (const file of collectMarkdown(scopeDir)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel === retiredPlanPath) continue;
    const body = fs.readFileSync(file, "utf8");
    if (body.includes("05-CLEAN-REPOSITORY-RECONSTRUCTION-PLAN.md")) {
      failures.push("stale retired campaign-plan reference: " + rel);
    }
  }
}

if (failures.length) {
  console.error("KNOWLEDGE_SYSTEM_VERIFY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("KNOWLEDGE_SYSTEM_VERIFY=PASS");
console.log("CAPABILITIES=" + ids.length);
console.log("JOURNEY_COVERAGE_ROWS=" + rows.length);
