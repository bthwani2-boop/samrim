import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function count(text, needle) {
  return text.split(needle).length - 1;
}

function positions(text, expression) {
  return [...text.matchAll(expression)].map((match) => match.index);
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
if (!staticCi.includes("node tools/dev/verify-ci-exact-sha.mjs")) failures.push("CI Static shared exact SHA guard missing");

if (!runtimeCi.includes("CANDIDATE_SHA: ${{ " + candidateExpression + " }}")) {
  failures.push("CI Runtime candidate SHA binding missing");
}
if (!runtimeCi.includes("ref: ${{ env.CANDIDATE_SHA }}")) failures.push("CI Runtime exact checkout missing");
if (!runtimeCi.includes("Verify exact candidate checkout")) failures.push("CI Runtime exact checkout proof missing");
if (!runtimeCi.includes("node tools/dev/verify-ci-exact-sha.mjs")) failures.push("CI Runtime shared exact SHA guard missing");

for (const [name, workflow] of [["security", securityCi], ["policy", policyCi]]) {
  if (!workflow.includes("CANDIDATE_SHA: ${{ " + candidateExpression + " }}")) failures.push("CI " + name + " candidate SHA binding missing");
  if (!workflow.includes("ref: ${{ env.CANDIDATE_SHA }}")) failures.push("CI " + name + " exact candidate checkout missing");
}

for (const [name, workflow, checkoutCount, affectedGuardCount] of [
  ["static", staticCi, 2, 2],
  ["runtime", runtimeCi, 1, 1],
  ["security", securityCi, 1, 0],
  ["policy", policyCi, 1, 0],
]) {
  if (count(workflow, "node tools/dev/verify-ci-exact-sha.mjs") !== checkoutCount + affectedGuardCount) {
    failures.push("CI " + name + " must use the canonical exact-SHA guard at checkout and after affected SHA resolution");
  }
}
for (const [name, workflow, jobCount] of [["static", staticCi, 2], ["runtime", runtimeCi, 1]]) {
  const shaResolutionSteps = positions(workflow, /uses: nrwl\/nx-set-shas@/g);
  const affectedGuards = positions(workflow, /REQUIRE_NX_HEAD: "true"/g);
  if (shaResolutionSteps.length !== jobCount || affectedGuards.length !== jobCount) {
    failures.push("CI " + name + " must resolve and guard affected SHAs once per job");
    continue;
  }
  for (let index = 0; index < jobCount; index += 1) {
    if (affectedGuards[index] < shaResolutionSteps[index] || (shaResolutionSteps[index + 1] !== undefined && affectedGuards[index] > shaResolutionSteps[index + 1])) {
      failures.push("CI " + name + " must verify exact NX_HEAD immediately after affected SHA resolution");
    }
  }
}
if (!staticCi.includes("REQUIRE_NX_HEAD: \"true\"") || !runtimeCi.includes("REQUIRE_NX_HEAD: \"true\"")) {
  failures.push("affected CI gates must require the canonical NX_HEAD guard");
}

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

const candidateSha = process.env.CANDIDATE_SHA?.trim();
if ((process.env.GITHUB_ACTIONS === "true" || process.env.REQUIRE_NX_HEAD === "true") && !candidateSha) {
  console.error("CI_EXACT_SHA=FAIL CANDIDATE_SHA is required in CI");
  process.exit(1);
}
if (candidateSha) {
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    console.error("CI_EXACT_SHA=FAIL invalid CANDIDATE_SHA");
    process.exit(1);
  }
  const observedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (observedHead !== candidateSha) {
    console.error("CI_EXACT_SHA=FAIL checkout mismatch expected=" + candidateSha + " observed=" + observedHead);
    process.exit(1);
  }
  const nxHead = process.env.NX_HEAD?.trim();
  const nxBase = process.env.NX_BASE?.trim();
  if (process.env.REQUIRE_NX_HEAD === "true" && !nxHead) {
    console.error("CI_EXACT_SHA=FAIL NX_HEAD is required after affected SHA resolution");
    process.exit(1);
  }
  if (process.env.REQUIRE_NX_HEAD === "true" && !nxBase) {
    console.error("CI_EXACT_SHA=FAIL NX_BASE is required after affected SHA resolution");
    process.exit(1);
  }
  if (nxBase && !/^[0-9a-f]{40}$/.test(nxBase)) {
    console.error("CI_EXACT_SHA=FAIL invalid NX_BASE");
    process.exit(1);
  }
  if (nxHead && nxHead !== observedHead) {
    console.error("CI_EXACT_SHA=FAIL NX_HEAD mismatch checkout=" + observedHead + " NX_HEAD=" + nxHead);
    process.exit(1);
  }
  console.log("EXACT_CANDIDATE_SHA=" + observedHead);
  if (nxHead) console.log("EXACT_NX_HEAD=" + nxHead);
}

console.log("CI_EXACT_SHA=PASS gates=4 static_jobs=2 runtime_jobs=1");
