import fs from "node:fs";
import path from "node:path";
import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

const eventPath = process.env.GITHUB_EVENT_PATH?.trim();
if (!eventPath) {
  console.error("PR_EVIDENCE=FAIL missing GITHUB_EVENT_PATH");
  process.exit(1);
}

const event = JSON.parse(fs.readFileSync(path.resolve(eventPath), "utf8"));
const pull = event.pull_request;

if (!pull) {
  console.log("PR_EVIDENCE=PASS event=non_pull_request");
  process.exit(0);
}

if (pull.draft) {
  console.log("PR_EVIDENCE=DRAFT_DEFERRED");
  process.exit(0);
}

const author = String(pull.user?.login ?? "");
const actor = String(event.sender?.login ?? "");
if (author === "dependabot[bot]" || actor === "dependabot[bot]") {
  console.log("PR_EVIDENCE=DEPENDABOT_DEFERRED_TO_DEPENDENCY_POLICY");
  process.exit(0);
}

const body = String(pull.body ?? "");
const failures = [];
const fail = (message) => failures.push(message);

const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });
const qualityPath = path.join(knowledgeRoot, "governance", "policy", "QUALITY.md");
const quality = fs.readFileSync(qualityPath, "utf8");
const dimensions = [...quality.matchAll(/^QUALITY_DIMENSION:\s*([A-Z0-9_]+)\s*$/gm)].map((match) => match[1]);

if (!dimensions.length) fail("pinned Governance exposes no QUALITY_DIMENSION values");
if (new Set(dimensions).size !== dimensions.length) fail("pinned Governance contains duplicate QUALITY_DIMENSION values");

const requiredHeadings = [
  "## Governance impact",
  "## Material quality census",
];
for (const heading of requiredHeadings) if (!body.includes(heading)) fail("PR body missing required section: " + heading);

const impacts = [...body.matchAll(/GOVERNANCE_IMPACT=(NONE|REVALIDATE_ONLY|UPDATE_REQUIRED|DEFECT_FOUND)/g)].map((match) => match[1]);
if (impacts.length !== 1) fail("ready PR must declare exactly one GOVERNANCE_IMPACT");

for (const dimension of dimensions) {
  const escaped = dimension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^- ${escaped}: (AFFECTED|PROVEN_UNAFFECTED|N/A_WITH_REASON)\\s+(?:-|—)\\s+(.+)$`, "gm");
  const matches = [...body.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(`${dimension} must have exactly one resolved classification; observed=${matches.length}`);
    continue;
  }
  if (!matches[0][2]?.trim()) fail(`${dimension} classification is missing reason/evidence`);
}

for (const closure of [
  "MATERIAL_DIMENSIONS_UNEXAMINED=0",
  "AFFECTED_DIMENSIONS_WITHOUT_OWNER=0",
  "AFFECTED_DIMENSIONS_WITHOUT_RULE=0",
  "AFFECTED_DIMENSIONS_WITHOUT_REQUIRED_PROOF=0",
  "KNOWN_MATERIAL_DEFECTS=0",
  "KNOWN_MATERIAL_CONTRADICTIONS=0",
  "DECISION_CRITICAL_UNKNOWNS=0",
  "KNOWN_GOVERNANCE_DRIFT=0",
]) if (!body.includes(closure)) fail("PR body missing closure assertion: " + closure);

if (/(^|[^A-Z])TODO([^A-Z]|$)/i.test(body)) fail("ready PR contains unresolved TODO evidence");

if (failures.length) {
  console.error("PR_EVIDENCE=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}

console.log("PR_EVIDENCE=PASS");
console.log("GOVERNANCE_IMPACT=" + impacts[0]);
console.log("QUALITY_DIMENSIONS=" + dimensions.length);
