import path from "node:path";
import { spawnSync } from "node:child_process";
import { runTrackedArtifactEvidenceAudit } from "./tracked-artifact-evidence.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const regressionTest = path.join(repoRoot, "tools/dev/tracked-artifact-evidence.test.mjs");

const regression = spawnSync(process.execPath, ["--test", regressionTest], {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (regression.status !== 0) {
  console.error("STRUCTURAL_HYGIENE=FAIL");
  console.error("TRACKED_ARTIFACT_REGRESSION=FAIL");
  if (regression.stdout) process.stderr.write(regression.stdout);
  if (regression.stderr) process.stderr.write(regression.stderr);
  process.exit(regression.status ?? 1);
}
console.log("TRACKED_ARTIFACT_REGRESSION=PASS");

const originalLog = console.log;
const legacyLines = [];
console.log = (...parts) => legacyLines.push(parts.map(String).join(" "));
try {
  await import("./verify-structural-hygiene-legacy.mjs");
} finally {
  console.log = originalLog;
}

for (const line of legacyLines) {
  if (!line) continue;
  if (line === "STRUCTURAL_HYGIENE=PASS") continue;
  if (line === "DEAD_TRACKED_FILES_AUDIT=NOT_PERFORMED") continue;
  if (line === "DEAD_TRACKED_DIRECTORIES_AUDIT=NOT_PERFORMED") continue;
  console.log(line);
}

let audit;
try {
  audit = runTrackedArtifactEvidenceAudit(repoRoot);
} catch (error) {
  console.error("STRUCTURAL_HYGIENE=FAIL");
  console.error("DEAD_TRACKED_FILES_AUDIT=REVIEW_REQUIRED");
  console.error("DEAD_TRACKED_DIRECTORIES_AUDIT=REVIEW_REQUIRED");
  console.error("  REVIEW_REQUIRED:AUDIT_EXECUTION:" + (error?.stack ?? error));
  process.exit(1);
}

if (audit.review.length) {
  console.error("STRUCTURAL_HYGIENE=FAIL");
  console.error("DEAD_TRACKED_FILES_AUDIT=REVIEW_REQUIRED");
  console.error("DEAD_TRACKED_DIRECTORIES_AUDIT=REVIEW_REQUIRED");
  for (const failure of audit.review) console.error("  " + failure);
  process.exit(1);
}

const counts = {};
for (const evidence of audit.fileEvidence.values()) counts[evidence] = (counts[evidence] ?? 0) + 1;

console.log("TRACKED_FILES_EVIDENCE=" + audit.files.length);
console.log("TRACKED_DIRECTORIES_EVIDENCE=" + audit.directories.length);
console.log("REVIEW_REQUIRED_TRACKED_FILES=0");
console.log("REVIEW_REQUIRED_TRACKED_DIRECTORIES=0");
console.log("DEAD_TRACKED_FILES_AUDIT=PASS");
console.log("DEAD_TRACKED_DIRECTORIES_AUDIT=PASS");
console.log("TRACKED_ARTIFACT_EVIDENCE_COUNTS=" + JSON.stringify(counts));
console.log("STRUCTURAL_HYGIENE=PASS");
