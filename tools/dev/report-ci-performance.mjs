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
  ? fs.readFileSync(metricsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];

const mode = budgets.mode === "enforce" ? "enforce" : "observe";
let enforcedOverrun = false;
let observedOverrun = false;
const budgetNames = Object.keys(budgets.budgetsMs ?? {});
const lines = [
  "## CI performance",
  "",
  "| Step | Duration | Budget | Status |",
  "|---|---:|---:|---|",
];

for (const record of records) {
  const budget = budgets.budgetsMs?.[record.name];
  const overBudget = typeof budget === "number" && record.durationMs > budget;
  const enforced = mode === "enforce";
  const status = typeof budget !== "number"
    ? "unbudgeted"
    : overBudget
      ? enforced ? "over (blocking)" : "over (observe)"
      : "within";
  if (overBudget && enforced) enforcedOverrun = true;
  if (overBudget && !enforced) observedOverrun = true;
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
lines.push("Budget mode: " + mode + "; blocking budgets: " + (mode === "enforce" ? budgetNames.length : 0) + "/" + budgetNames.length + ". Single-run values are diagnostics in observe mode; p50/p95 remain Nx Cloud/GitHub historical metrics.");

const output = lines.join("\n") + "\n";
if (summaryPath) fs.appendFileSync(summaryPath, output);
console.log(output);
const reportState = enforcedOverrun ? "FAIL" : observedOverrun ? "OBSERVE" : "PASS";
console.log("CI_PERFORMANCE_REPORT=" + reportState + " records=" + records.length + " mode=" + mode);
if (enforcedOverrun) process.exitCode = 1;
