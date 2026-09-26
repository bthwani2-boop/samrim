import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const kindArg = process.argv.find((arg) => arg.startsWith("--kind="));
const outArg = process.argv.find((arg) => arg.startsWith("--out="));
const kind = kindArg ? kindArg.slice("--kind=".length) : "unknown";
const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
const outDir = path.resolve(outArg ? outArg.slice("--out=".length) : path.join(runnerTemp, "samrim-failure-package-" + kind));
const metricsPath = process.env.SAMRIM_CI_METRICS_PATH || path.join(runnerTemp, "samrim-ci-metrics.jsonl");
const logsDir = process.env.SAMRIM_CI_LOG_DIR || path.join(runnerTemp, "samrim-ci-logs");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

function write(name, value) {
  fs.writeFileSync(path.join(outDir, name), String(value ?? ""));
}

function run(command, args, options = {}) {
  const executable = process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
  const result = spawnSync(executable, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

const metadata = {
  kind,
  repository: process.env.GITHUB_REPOSITORY || null,
  workflow: process.env.GITHUB_WORKFLOW || null,
  job: process.env.GITHUB_JOB || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  sha: process.env.GITHUB_SHA || null,
  nxBase: process.env.NX_BASE || null,
  nxHead: process.env.NX_HEAD || null,
  runnerOs: process.env.RUNNER_OS || process.platform,
  capturedAt: new Date().toISOString(),
};
write("metadata.json", JSON.stringify(metadata, null, 2) + "\n");

const gitStatus = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
write("git-status.txt", gitStatus.stdout + gitStatus.stderr);
const gitHead = run("git", ["rev-parse", "HEAD"]);
write("git-head.txt", gitHead.stdout + gitHead.stderr);
const nxReport = run("pnpm", ["exec", "nx", "report"]);
write("nx-report.txt", nxReport.stdout + nxReport.stderr);

if (metadata.nxBase && metadata.nxHead) {
  const affected = run("pnpm", ["exec", "nx", "show", "projects", "--affected", "--base=" + metadata.nxBase, "--head=" + metadata.nxHead]);
  write("affected-projects.txt", affected.stdout + affected.stderr);
}

for (const relative of ["nx.json", ".github/project.json"]) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) continue;
  const target = path.join(outDir, relative.replaceAll("/", "__"));
  fs.copyFileSync(source, target);
}

if (fs.existsSync(metricsPath)) {
  fs.copyFileSync(metricsPath, path.join(outDir, "ci-metrics.jsonl"));
  const records = fs.readFileSync(metricsPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const failed = records.filter((record) => record.exitCode !== 0);
  write("failed-commands.json", JSON.stringify(failed, null, 2) + "\n");
}
if (fs.existsSync(logsDir)) fs.cpSync(logsDir, path.join(outDir, "command-logs"), { recursive: true });

const controlLog = path.join(runnerTemp, "control-panel.log");
if (fs.existsSync(controlLog)) fs.copyFileSync(controlLog, path.join(outDir, "control-panel.log"));
for (const relative of ["apps/control-panel/test-results", "apps/control-panel/playwright-report"]) {
  const source = path.join(root, relative);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(outDir, path.basename(relative)), { recursive: true });
}

const envFile = path.join(root, "infra/local/.env");
if (kind === "runtime" && fs.existsSync(envFile)) {
  const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envFile, "-f", path.join(root, "infra/local/compose/compose.yaml")];
  const ps = run("docker", [...composeArgs, "ps", "-a"]);
  write("compose-ps.txt", ps.stdout + ps.stderr);
  const logs = run("docker", [...composeArgs, "logs", "--no-color"]);
  let logText = logs.stdout + logs.stderr;
  const values = [];
  for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value.length >= 12) values.push([name, value]);
  }
  values.sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of values) logText = logText.split(value).join("[REDACTED:" + name + "]");
  write("compose.log", logText);
}

console.log("CI_FAILURE_PACKAGE=PASS kind=" + kind + " path=" + outDir);
