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
const enforcedBudgets = new Set(Array.isArray(budgets.enforcedBudgets) ? budgets.enforcedBudgets : []);
let enforcedOverrun = false;
let observedOverrun = false;
const budgetNames = Object.keys(budgets.budgetsMs ?? {});
const lines = [
  "## CI performance",
  "",
  "| Step | Duration | Budget | Status |",
  "|---|---:|---:|---|",
];

function budgetStatus(hasBudget, overBudget, blocking) {
  if (!hasBudget) return "unbudgeted";
  if (!overBudget) return "within";
  return blocking ? "over (blocking)" : "over (observe)";
}

function performanceState() {
  if (enforcedOverrun) return "FAIL";
  if (observedOverrun) return "OBSERVE";
  return "PASS";
}

for (const record of records) {
  const budget = budgets.budgetsMs?.[record.name];
  const hasBudget = typeof budget === "number";
  const overBudget = hasBudget && record.durationMs > budget;
  const blocking = mode === "enforce" && enforcedBudgets.has(record.name);
  const status = budgetStatus(hasBudget, overBudget, blocking);
  if (overBudget && blocking) enforcedOverrun = true;
  if (overBudget && !blocking) observedOverrun = true;
  const budgetLabel = hasBudget ? (budget / 1000).toFixed(1) + "s" : "—";
  lines.push(
    "| " + record.name +
    " | " + (record.durationMs / 1000).toFixed(1) + "s" +
    " | " + budgetLabel +
    " | " + status + " |",
  );
}

if (records.length === 0) lines.push("| no timed commands | — | — | — |");
const blockingBudgetCount = mode === "enforce" ? enforcedBudgets.size : 0;
lines.push(
  "",
  "Budget mode: " + mode + "; blocking budgets: " + blockingBudgetCount + "/" + budgetNames.length + ". Single-run values are diagnostics in observe mode; p50/p95 remain Nx Cloud/GitHub historical metrics.",
);

const output = lines.join("\n") + "\n";
if (summaryPath) fs.appendFileSync(summaryPath, output);
console.log(output);
const reportState = performanceState();
console.log("CI_PERFORMANCE_REPORT=" + reportState + " records=" + records.length + " mode=" + mode);
if (enforcedOverrun) process.exitCode = 1;
