import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
const metricsPath = process.env.SAMRIM_CI_METRICS_PATH || path.join(runnerTemp, "samrim-ci-metrics.jsonl");
const budgetsPath = path.join(root, ".github", "ci-performance-budgets.json");
const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();

const budgets = JSON.parse(fs.readFileSync(budgetsPath, "utf8"));
const records = fs.existsSync(metricsPath)
  ? fs.readFileSync(metricsPath, "utf8").split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];

const lines = [
  "## CI performance",
  "",
  "| Step | Duration | Budget | Status |",
  "|---|---:|---:|---|",
];

for (const record of records) {
  const budget = budgets.budgetsMs?.[record.name];
  const status = typeof budget === "number"
    ? (record.durationMs <= budget ? "within" : "over")
    : "unbudgeted";
  const budgetLabel = typeof budget === "number" ? (budget / 1000).toFixed(1) + "s" : "—";
  lines.push(
    "| " + record.name +
    " | " + (record.durationMs / 1000).toFixed(1) + "s" +
    " | " + budgetLabel +
    " | " + status + " |",
  );
}

if (records.length === 0) lines.push("| no timed commands | — | — | — |");
lines.push("");
lines.push("Budget mode: " + budgets.mode + ". Single-run values are diagnostics; p50/p95 remain Nx Cloud/GitHub historical metrics.");

const output = lines.join("\\n") + "\\n";
if (summaryPath) fs.appendFileSync(summaryPath, output);
console.log(output);
console.log("CI_PERFORMANCE_REPORT=PASS records=" + records.length + " mode=" + budgets.mode);
