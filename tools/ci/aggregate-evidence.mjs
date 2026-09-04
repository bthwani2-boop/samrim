import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
const get = (name) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const root = get("root") ?? ".closure-evidence";
const candidate = get("candidate");
const required = (get("require") ?? "").split(",").map(v => v.trim()).filter(Boolean);
if (!candidate || !/^[0-9a-f]{40}$/.test(candidate)) throw new Error("A 40-character --candidate SHA is required");
if (!required.length) throw new Error("At least one required claim is required");

const files = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && e.name.endsWith(".json")) files.push(full);
  }
};
walk(root);

const byClaim = new Map();
for (const file of files) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
  if (!data.claim_id) continue;
  if (byClaim.has(data.claim_id)) throw new Error("Duplicate evidence for " + data.claim_id);
  byClaim.set(data.claim_id, {data, file});
}

const failures = [];
const statuses = new Set(["PASS","FAIL","NOT_APPLICABLE","TOOL_ERROR","BLOCKED"]);
const sha256 = /^[0-9a-f]{64}$/;
const sha40 = /^[0-9a-f]{40}$/;
const rootResolved = path.resolve(root);

for (const claim of required) {
  const record = byClaim.get(claim);
  if (!record) { failures.push(claim + ": missing evidence"); continue; }
  const e = record.data;
  const file = record.file;

  const mandatory = [
    "schema_version","claim_id","tool","tool_version","candidate_sha","base_sha",
    "scope","expected_scope","scope_digest","status","finding_count","started_at",
    "completed_at","report_format","report_path","report_digest","report_valid",
    "runner","workflow_run_id","reason"
  ];
  for (const field of mandatory) {
    if (!Object.hasOwn(e, field)) failures.push(claim + ": missing field " + field);
  }

  if (e.schema_version !== 1) failures.push(claim + ": unsupported schema_version=" + e.schema_version);
  if (e.claim_id !== claim) failures.push(claim + ": claim_id mismatch=" + e.claim_id);
  if (typeof e.tool !== "string" || !e.tool) failures.push(claim + ": invalid tool");
  if (typeof e.tool_version !== "string" || !e.tool_version) failures.push(claim + ": invalid tool_version");
  if (!sha40.test(e.candidate_sha ?? "")) failures.push(claim + ": invalid candidate SHA shape");
  if (e.candidate_sha !== candidate) failures.push(claim + ": wrong candidate SHA " + e.candidate_sha);
  if (e.base_sha && !sha40.test(e.base_sha)) failures.push(claim + ": invalid base SHA");
  if (!Array.isArray(e.scope) || !Array.isArray(e.expected_scope)) failures.push(claim + ": invalid scope arrays");

  const expectedScopeDigest = crypto.createHash("sha256")
    .update(JSON.stringify({scope:e.scope, expectedScope:e.expected_scope})).digest("hex");
  if (!sha256.test(e.scope_digest ?? "") || e.scope_digest !== expectedScopeDigest) failures.push(claim + ": invalid scope_digest");

  if (!statuses.has(e.status)) failures.push(claim + ": invalid status=" + e.status);
  if (e.status !== "PASS") failures.push(claim + ": status=" + e.status);
  if (!Number.isInteger(e.finding_count) || e.finding_count < 0) failures.push(claim + ": invalid finding_count");
  if (Number.isNaN(Date.parse(e.started_at)) || Number.isNaN(Date.parse(e.completed_at))) failures.push(claim + ": invalid timestamps");
  if (typeof e.workflow_run_id !== "string" || !e.workflow_run_id) failures.push(claim + ": missing workflow_run_id");
  if (typeof e.runner !== "string" || !e.runner) failures.push(claim + ": missing runner");

  if (e.report_valid !== true || !sha256.test(e.report_digest ?? "") || typeof e.report_path !== "string" || !e.report_path) {
    failures.push(claim + ": invalid report metadata");
    continue;
  }

  const reportFile = path.resolve(path.dirname(file), e.report_path);
  if (!(reportFile === rootResolved || reportFile.startsWith(rootResolved + path.sep))) {
    failures.push(claim + ": report path escapes evidence root");
    continue;
  }
  if (!fs.existsSync(reportFile) || !fs.statSync(reportFile).isFile()) {
    failures.push(claim + ": raw report artifact missing: " + e.report_path);
    continue;
  }
  const bytes = fs.readFileSync(reportFile);
  const actualDigest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualDigest !== e.report_digest) failures.push(claim + ": raw report digest mismatch");
  if (e.report_format === "json" || e.report_format === "sarif") {
    try { JSON.parse(bytes.toString("utf8")); } catch { failures.push(claim + ": raw " + e.report_format + " report does not parse"); }
  } else if (e.report_format !== "text") {
    failures.push(claim + ": unsupported report format " + e.report_format);
  }
}

const summary = [
  "# Promotion closure evidence",
  "",
  "Candidate: " + candidate,
  "",
  ...required.map(c => "- " + c + ": " + (byClaim.get(c)?.data.status ?? "MISSING")),
  ""
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
