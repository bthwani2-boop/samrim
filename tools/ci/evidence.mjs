import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error("Arguments must be --key value pairs");
  args.set(key.slice(2), value);
}
const req = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};
const allowed = new Set(["PASS","FAIL","NOT_APPLICABLE","TOOL_ERROR","BLOCKED"]);
const claimId = req("claim");
const status = req("status");
if (!allowed.has(status)) throw new Error(`Invalid status: ${status}`);
const candidateSha = req("candidate").toLowerCase();
if (!/^[0-9a-f]{40}$/.test(candidateSha)) throw new Error("candidate SHA must be 40 hex characters");

const scope = (args.get("scope") ?? "").split(",").map(v => v.trim()).filter(Boolean);
const expectedScope = (args.get("expected-scope") ?? args.get("scope") ?? "").split(",").map(v => v.trim()).filter(Boolean);
const scopeDigest = crypto.createHash("sha256").update(JSON.stringify({scope, expectedScope})).digest("hex");
const reportPath = args.get("report") ?? "";
let reportDigest = "", reportValid = false;
if (reportPath && fs.existsSync(reportPath) && fs.statSync(reportPath).isFile()) {
  reportDigest = crypto.createHash("sha256").update(fs.readFileSync(reportPath)).digest("hex");
  reportValid = true;
}
if (status === "PASS" && !reportValid) throw new Error(`PASS requires a real report file: ${reportPath || "<missing>"}`);
const completedAt = new Date().toISOString();
const findingCount = Number.parseInt(args.get("findings") ?? "0", 10);
if (!Number.isInteger(findingCount) || findingCount < 0) throw new Error("finding_count must be a non-negative integer");

const evidence = {
  schema_version: 1,
  claim_id: claimId,
  tool: req("tool"),
  tool_version: req("version"),
  candidate_sha: candidateSha,
  base_sha: args.get("base") ?? "",
  scope,
  expected_scope: expectedScope,
  scope_digest: scopeDigest,
  status,
  finding_count: findingCount,
  started_at: args.get("started") ?? completedAt,
  completed_at: completedAt,
  report_format: args.get("format") ?? "text",
  report_path: reportPath,
  report_digest: reportDigest,
  report_valid: reportValid,
  runner: process.env.RUNNER_NAME ?? "unknown",
  workflow_run_id: process.env.GITHUB_RUN_ID ?? "",
  reason: args.get("reason") || null
};
fs.mkdirSync(".ci-evidence", {recursive: true});
const outPath = path.join(".ci-evidence", claimId.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json");
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### ${claimId}\n\n- Status: **${status}**\n- Tool: ${evidence.tool} ${evidence.tool_version}\n- Candidate: \`${candidateSha}\`\n- Findings: ${findingCount}\n\n`);
}
console.log(outPath);
