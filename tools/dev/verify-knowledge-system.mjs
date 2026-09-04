import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const cap = read("governance/product/CAPABILITIES.md");
const journeys = read("governance/product/JOURNEYS.md");
const fixed = read("tools/prompting/bthwani-refoundation/closure/TARGET-FIXED-POINT.md");
const platform = read("governance/project/PLATFORM.md");
const systemContext = read("governance/architecture/SYSTEM-CONTEXT.md");
const topology = read("governance/architecture/REPOSITORY-TOPOLOGY.md");
const governanceIndex = read("governance/GOVERNANCE.md");
const campaignPlan = read("tools/prompting/bthwani-refoundation/05-CLEAN-REPOSITORY-RECONSTRUCTION-PLAN.md");
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


const refoundationTargetsDir = path.join(root, "tools/prompting/bthwani-refoundation/targets");
for (const file of collectMarkdown(refoundationTargetsDir)) {
  const body = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (!body.includes("TEMPORARY_TARGET_SPECIALIZATION: YES")) failures.push(rel + " temporary target module missing specialization header");
  if (!body.includes("GENERAL_EXECUTION_AUTHORITY: NONE")) failures.push(rel + " target module missing execution non-authority marker");
  if (!body.includes("DURABLE_AUTHORITY: NONE")) failures.push(rel + " target module missing durable non-authority marker");
}

const orchestratorDir = path.join(root, "tools/prompting/bthwani-orchestrator");
const refoundationDir = path.join(root, "tools/prompting/bthwani-refoundation");
const orchestratorLawLines = new Map();
for (const file of collectMarkdown(orchestratorDir)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!isGeneralLawLike(line)) continue;
    const normalized = normalizedLawLine(line);
    if (!normalized) continue;
    if (!orchestratorLawLines.has(normalized)) orchestratorLawLines.set(normalized, []);
    orchestratorLawLines.get(normalized).push(path.relative(root, file).split(path.sep).join("/"));
  }
}
for (const file of collectMarkdown(refoundationDir)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!isGeneralLawLike(line)) continue;
    const normalized = normalizedLawLine(line);
    if (orchestratorLawLines.has(normalized)) {
      failures.push("general law duplicated in refoundation: " + line.trim() + " @ " + path.relative(root, file).split(path.sep).join("/"));
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
if (campaignPlan.includes("## Current durable-knowledge gaps to close")) failures.push("campaign plan still reports resolved responsibility families as open");
if (systemContext.includes("explicitly admitted Platform Control are the primary bounded contexts")) failures.push("Platform Control service admission is assumed");
if (!platform.includes("independent deployable-service admission remains conditional")) failures.push("Platform Control semantic/deployment split missing");

if (failures.length) {
  console.error("KNOWLEDGE_SYSTEM_VERIFY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("KNOWLEDGE_SYSTEM_VERIFY=PASS");
console.log("CAPABILITIES=" + ids.length);
console.log("JOURNEY_COVERAGE_ROWS=" + rows.length);
