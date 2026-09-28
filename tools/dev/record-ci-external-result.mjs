import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [name, outcome, source = null] = process.argv.slice(2);
if (!name || !outcome) {
  console.error("CI_EXTERNAL_RESULT=FAIL usage: node tools/dev/record-ci-external-result.mjs <name> <outcome> [source]");
  process.exit(2);
}

const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
const outputPath = process.env.SAMRIM_CI_EXTERNAL_RESULTS_PATH || path.join(runnerTemp, "samrim-ci-external-results.jsonl");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.appendFileSync(outputPath, JSON.stringify({
  name,
  outcome,
  source,
  observedAt: new Date().toISOString(),
  sha: process.env.CANDIDATE_SHA || process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
}) + "\n");
console.log(`CI_EXTERNAL_RESULT=PASS name=${name} outcome=${outcome}`);
