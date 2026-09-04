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
const failures = [];

const matches = [...cap.matchAll(/^###\\s+([A-Z0-9_]+)(?:[^\\n]*)\\n([\\s\\S]*?)(?=^###\\s+[A-Z0-9_]+|\\z)/gm)];
const sections = matches.map((m) => ({ id: m[1], body: m[2] }));
const ids = sections.map((x) => x.id);
const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
if (duplicateIds.length) failures.push("duplicate capability IDs: " + [...new Set(duplicateIds)].join(", "));

for (const id of ["CENTRAL_CATALOG","CART_CHECKOUT","FIELD_OPERATIONS_ASSIGNMENT_READINESS","MARKETING_CAMPAIGNS_LOYALTY","NOTIFICATIONS_COMMUNICATIONS","ANALYTICS_OPERATIONAL_READ_MODELS"]) {
  if (!ids.includes(id)) failures.push("missing required responsibility capability: " + id);
}
if (ids.includes("CATALOG_APPROVAL_PUBLICATION")) failures.push("CATALOG_APPROVAL_PUBLICATION remains a parallel durable capability");

const requiredFields = [
  ["Problem", /\\*\\*Problem\\./],
  ["Target state", /\\*\\*Target state\\./],
  ["Primary success measure", /\\*\\*Primary success measure\\./],
  ["Guardrail measures", /\\*\\*Guardrail measures\\./],
  ["Required outcome", /\\*\\*Required outcome\\./],
  ["Primary actors", /\\*\\*Primary actors\\./],
  ["Canonical ownership", /\\*\\*Canonical ownership\\./],
  ["Material surfaces", /\\*\\*(?:Material deployable surfaces|Material surfaces)\\./],
  ["Business invariants", /\\*\\*Business invariants/],
  ["Forbidden invariants", /\\*\\*Forbidden\\/negative invariants/],
  ["Failure/recovery", /\\*\\*(?:Named failure classes|Failure\\/recovery)/],
  ["Acceptance expectations", /\\*\\*Acceptance expectations/],
  ["Actor responsibility envelope", /\\*\\*Actor responsibility envelope/],
  ["Surface semantics", /\\*\\*Surface semantics/],
];
for (const { id, body } of sections) for (const [label, regex] of requiredFields) if (!regex.test(body)) failures.push(id + " missing semantic envelope field: " + label);

if (cap.includes("`shared` — required")) failures.push("technical shared layer masquerades as Product surface");
if (/proven notification capability/i.test(cap)) failures.push("notification owner unresolved");
if (/Canonical ownership\\.\\*\\* derived analytics\\/read-model capability/i.test(cap)) failures.push("analytics owner unresolved");

const coverageSections = (journeys.match(/^## Capability-to-journey coverage$/gm) || []).length;
if (coverageSections !== 1) failures.push("expected exactly one capability-to-journey matrix; found " + coverageSections);
const rows = [...journeys.matchAll(/^\\|\\s*([A-Z][A-Z0-9_]+)\\s*\\|\\s*([^|]+)\\|$/gm)].map((m) => ({ id: m[1], coverage: m[2].trim() })).filter((x) => x.id !== "Capability");
const rowIds = rows.map((x) => x.id);
const dupRows = rowIds.filter((id, i) => rowIds.indexOf(id) !== i);
if (dupRows.length) failures.push("duplicate journey rows: " + [...new Set(dupRows)].join(", "));
for (const id of ids) if (!rowIds.includes(id)) failures.push("capability missing journey row: " + id);
for (const id of rowIds) if (!ids.includes(id)) failures.push("orphan journey row: " + id);

for (const token of ["ALL_MATERIAL_JOURNEY_STEPS_CLASSIFIED=PASS","UNOWNED_MATERIAL_JOURNEY_STEPS=0","CAPABILITY_REQUIRED_SEMANTIC_ENVELOPE=PASS","DURABLE_REPOSITORY_TOPOLOGY_OWNER=PASS"]) if (!fixed.includes(token)) failures.push("fixed-point gate missing: " + token);
if (!topology.includes("SEMANTIC_OWNER: governance/architecture/REPOSITORY-TOPOLOGY.md")) failures.push("durable topology owner missing");
if (/explicitly admitted Platform Control are the primary bounded contexts/i.test(systemContext)) failures.push("Platform Control service admission assumed");
if (!/independent deployable-service admission remains conditional/i.test(platform)) failures.push("Platform Control semantic/deployment split missing");

if (failures.length) {
  console.error("KNOWLEDGE_SYSTEM_VERIFY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("KNOWLEDGE_SYSTEM_VERIFY=PASS");
console.log("CAPABILITIES=" + ids.length);
console.log("JOURNEY_COVERAGE_ROWS=" + rows.length);
