import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveTrustedExecutable } from "./runtime-proof/trusted-executables.mjs";
import { validateSonarContractAtRoot } from "./sonar-contract.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const event = process.env.GH_EVENT || process.env.GITHUB_EVENT_NAME || "";
const title = process.env.PR_TITLE || "";
const body = process.env.PR_BODY || "";
const draft = process.env.PR_DRAFT === "true";
const baseSha = process.env.PR_BASE_SHA || "";
const failures = [];

function finding(code, detail) {
  failures.push({ code, detail: String(detail).replace(/\s+/g, " ").trim() });
}

function git(args, cwd = root) {
  const result = spawnSync(resolveTrustedExecutable("git"), args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function finish(extra = {}) {
  if (failures.length > 0) {
    for (const item of failures) console.error(`POLICY_FINDING=FAIL code=${item.code} detail=${item.detail}`);
    console.error(`PR_POLICY=FAIL count=${failures.length}`);
    process.exit(1);
  }
  for (const [key, value] of Object.entries(extra)) console.log(`${key}=${value}`);
  console.log("PR_POLICY=PASS");
  process.exit(0);
}

for (const item of validateSonarContractAtRoot(root)) finding(item.code, item.detail);

if (event === "push") {
  if (failures.length > 0) finish();
  console.log("PR_POLICY_MAIN_PUSH=PASS");
  process.exit(0);
}

if (title.length < 8) finding("PR_TITLE_TOO_SHORT", "PR title must contain at least 8 characters");
if (draft) {
  if (failures.length === 0) console.log("PR_POLICY_DRAFT=DEFERRED_UNTIL_READY");
  finish();
}

if (body.length < 160) finding("PR_BODY_TOO_SHORT", "PR body must contain at least 160 characters");
for (const heading of ["## Summary", "## Scope", "## Governance impact", "## Verification", "## Remaining limits"]) {
  if (!body.includes(heading)) finding("PR_SECTION_MISSING", heading);
}

const impacts = [...body.matchAll(/GOVERNANCE_IMPACT=(NONE|REVALIDATE_ONLY|UPDATE_REQUIRED|DEFECT_FOUND)/g)].map((match) => match[1]);
if (impacts.length !== 1) finding("GOVERNANCE_IMPACT_CARDINALITY", `expected exactly one declaration, observed=${impacts.length}`);
const impact = impacts.length === 1 ? impacts[0] : null;

let changed = [];
if (!baseSha) {
  finding("PR_BASE_SHA_MISSING", "PR_BASE_SHA is required for ready PR policy proof");
} else {
  const diff = git(["diff", "--name-only", baseSha, "HEAD"]);
  if (diff.status !== 0) finding("PR_DIFF_FAILED", diff.stderr || diff.stdout || "git diff failed");
  else changed = diff.stdout.split(/\r?\n/).filter(Boolean);
}

const pinChanged = changed.includes("knowledge.sources.json");
if (pinChanged && impact === "NONE") finding("GOVERNANCE_PIN_WITH_NONE", "Governance pin changed but GOVERNANCE_IMPACT=NONE");

let pinned = null;
if (pinChanged) {
  try {
    pinned = JSON.parse(fs.readFileSync(path.join(root, "knowledge.sources.json"), "utf8")).governance.commit;
  } catch (error) {
    finding("GOVERNANCE_PIN_PARSE_FAILED", error.message);
  }

  if (pinned) {
    const checkout = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "bthwani-governance-canonical");
    fs.rmSync(checkout, { recursive: true, force: true });
    const clone = git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", "https://github.com/bthwani2-boop/governance-and-docs.git", checkout]);
    if (clone.status !== 0) {
      finding("GOVERNANCE_CLONE_FAILED", clone.stderr || clone.stdout || "clone failed");
    } else {
      const canonical = git(["merge-base", "--is-ancestor", pinned, "origin/main"], checkout);
      if (canonical.status !== 0) finding("GOVERNANCE_NOT_CANONICAL_MAIN", `pinned=${pinned}`);

      if (baseSha) {
        const previousManifest = git(["show", `${baseSha}:knowledge.sources.json`]);
        if (previousManifest.status !== 0) {
          finding("PREVIOUS_GOVERNANCE_PIN_READ_FAILED", previousManifest.stderr || previousManifest.stdout || "git show failed");
        } else {
          try {
            const previousPinned = JSON.parse(previousManifest.stdout).governance.commit;
            const monotonic = git(["merge-base", "--is-ancestor", previousPinned, pinned], checkout);
            if (monotonic.status !== 0) finding("GOVERNANCE_PIN_ROLLBACK", `previous=${previousPinned} candidate=${pinned}`);
            else console.log(`GOVERNANCE_PIN_MONOTONIC=PASS previous=${previousPinned} candidate=${pinned}`);
          } catch (error) {
            finding("PREVIOUS_GOVERNANCE_PIN_PARSE_FAILED", error.message);
          }
        }
      }
    }
  }
}

if (impact === "UPDATE_REQUIRED" || impact === "DEFECT_FOUND") {
  if (!pinChanged) finding("GOVERNANCE_REPIN_REQUIRED", `${impact} requires knowledge.sources.json repin`);
  const canonicalShas = [...body.matchAll(/GOVERNANCE_CANONICAL_SHA=([0-9a-f]{40})/g)].map((match) => match[1]);
  if (canonicalShas.length !== 1) finding("GOVERNANCE_CANONICAL_SHA_CARDINALITY", `expected exactly one, observed=${canonicalShas.length}`);
  if (canonicalShas.length === 1 && pinned && canonicalShas[0] !== pinned) finding("GOVERNANCE_CANONICAL_SHA_MISMATCH", `declared=${canonicalShas[0]} pinned=${pinned}`);
}

if (pinChanged && pinned) console.log(`GOVERNANCE_CANONICAL_MAIN=PASS sha=${pinned}`);
finish({ GOVERNANCE_IMPACT: impact ?? "UNRESOLVED", GOVERNANCE_PIN_CHANGED: pinChanged ? 1 : 0 });
