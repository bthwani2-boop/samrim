import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function count(text, needle) {
  return text.split(needle).length - 1;
}

const staticCi = read(".github/workflows/ci-static.yml");
const runtimeCi = read(".github/workflows/ci-runtime.yml");
const securityCi = read(".github/workflows/ci-security.yml");
const policyCi = read(".github/workflows/ci-policy.yml");

const candidateExpression = "github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha";

if (count(staticCi, "CANDIDATE_SHA: ${{ " + candidateExpression + " }}") !== 2) {
  failures.push("CI Static must bind Linux and Windows to the exact candidate SHA");
}
if (count(staticCi, "ref: ${{ env.CANDIDATE_SHA }}") !== 2) {
  failures.push("CI Static must checkout the exact candidate SHA in both jobs");
}
if (count(staticCi, "Verify exact candidate checkout") !== 2) {
  failures.push("CI Static must prove exact checkout in both jobs");
}
if (!staticCi.includes("EXACT_CANDIDATE_SHA=")) failures.push("CI Static exact SHA evidence marker missing");

if (!runtimeCi.includes("CANDIDATE_SHA: ${{ " + candidateExpression + " }}")) {
  failures.push("CI Runtime candidate SHA binding missing");
}
if (!runtimeCi.includes("ref: ${{ env.CANDIDATE_SHA }}")) failures.push("CI Runtime exact checkout missing");
if (!runtimeCi.includes("Verify exact candidate checkout")) failures.push("CI Runtime exact checkout proof missing");
if (!runtimeCi.includes("EXACT_CANDIDATE_SHA=")) failures.push("CI Runtime exact SHA evidence marker missing");

const directRef = "ref: ${{ " + candidateExpression + " }}";
if (!securityCi.includes(directRef)) failures.push("CI Security exact candidate checkout missing");
if (!policyCi.includes(directRef)) failures.push("CI Policy exact candidate checkout missing");

for (const [name, workflow] of [["static", staticCi], ["runtime", runtimeCi]]) {
  if (workflow.includes("refs/remotes/pull/") || workflow.includes("pull/merge")) {
    failures.push("CI " + name + " contains merge-ref evidence path");
  }
}

if (failures.length > 0) {
  console.error("CI_EXACT_SHA=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("CI_EXACT_SHA=PASS gates=4 static_jobs=2 runtime_jobs=1");
