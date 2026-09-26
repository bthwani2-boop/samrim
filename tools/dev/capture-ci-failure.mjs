import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const kindArg = process.argv.find((arg) => arg.startsWith("--kind="));
const kind = kindArg ? kindArg.slice("--kind=".length) : "unknown";
const safeKind = kind.replace(/[^A-Za-z0-9._-]+/g, "-") || "unknown";
const runnerTemp = fs.realpathSync(process.env.RUNNER_TEMP || os.tmpdir());
const outDir = fs.mkdtempSync(path.join(runnerTemp, "samrim-failure-package-" + safeKind + "-"));
const metricsPath = process.env.SAMRIM_CI_METRICS_PATH || path.join(runnerTemp, "samrim-ci-metrics.jsonl");
const logsDir = process.env.SAMRIM_CI_LOG_DIR || path.join(runnerTemp, "samrim-ci-logs");
const profileDir = process.env.SAMRIM_CI_PROFILE_DIR || path.join(runnerTemp, "samrim-ci-profiles");
const sensitiveName = /(?:secret|token|password|api[_-]?key|private[_-]?key|credential|dsn|database_url|authorization)/i;
const sensitiveValues = new Map();

function collectSensitive(name, value) {
  const text = String(value ?? "");
  if (sensitiveName.test(name) && text.length >= 4) sensitiveValues.set(text, name);
}

for (const [name, value] of Object.entries(process.env)) collectSensitive(name, value);

const envFile = path.join(root, "infra/local/.env");
if (kind === "runtime" && fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if ((sensitiveName.test(name) || value.length >= 12) && value.length >= 4) sensitiveValues.set(value, name);
  }
}

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
  sha: process.env.CANDIDATE_SHA || process.env.GITHUB_SHA || null,
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

const projectGraphPath = path.join(outDir, "project-graph.json");
const projectGraph = run("pnpm", ["exec", "nx", "graph", "--file=" + projectGraphPath]);
if (projectGraph.status !== 0) write("project-graph-error.txt", projectGraph.stdout + projectGraph.stderr);

if (metadata.nxBase && metadata.nxHead) {
  const affected = run("pnpm", ["exec", "nx", "show", "projects", "--affected", "--base=" + metadata.nxBase, "--head=" + metadata.nxHead]);
  write("affected-projects.txt", affected.stdout + affected.stderr);
  const taskGraphPath = path.join(outDir, "affected-static-task-graph.json");
  const taskGraph = run("pnpm", [
    "exec", "nx", "affected",
    "-t", "lint,format-check,typecheck,unit,contract,build,export-smoke,vet",
    "--base=" + metadata.nxBase,
    "--head=" + metadata.nxHead,
    "--graph=" + taskGraphPath,
  ]);
  if (taskGraph.status !== 0) write("affected-task-graph-error.txt", taskGraph.stdout + taskGraph.stderr);
}

if (kind === "runtime") {
  const runtimeTaskGraphPath = path.join(outDir, "runtime-task-graph.json");
  const runtimeTaskGraph = run("pnpm", ["exec", "nx", "run", "dsh-backend:runtime-proof", "--graph=" + runtimeTaskGraphPath]);
  if (runtimeTaskGraph.status !== 0) write("runtime-task-graph-error.txt", runtimeTaskGraph.stdout + runtimeTaskGraph.stderr);
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
if (fs.existsSync(profileDir)) fs.cpSync(profileDir, path.join(outDir, "nx-profiles"), { recursive: true });

const controlLog = path.join(runnerTemp, "control-panel.log");
if (fs.existsSync(controlLog)) fs.copyFileSync(controlLog, path.join(outDir, "control-panel.log"));
if (kind === "runtime" && fs.existsSync(envFile)) {
  const composeArgs = ["compose", "--project-name", "samrim-local", "--env-file", envFile, "-f", path.join(root, "infra/local/compose/compose.yaml")];
  const ps = run("docker", [...composeArgs, "ps", "-a"]);
  write("compose-ps.txt", ps.stdout + ps.stderr);
  const logs = run("docker", [...composeArgs, "logs", "--no-color"]);
  write("compose.log", logs.stdout + logs.stderr);
}

function redact(value) {
  let text = String(value ?? "");
  for (const [secret, name] of [...sensitiveValues].sort((a, b) => b[0].length - a[0].length)) {
    text = text.split(secret).join("[REDACTED:" + name + "]");
  }
  return text
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+\/-]{8,}={0,2}/gi, "$1[REDACTED:bearer]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED:token]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED:jwt]")
    .replace(/(https?:\/\/[^\s/:]+:)[^\s/@]+(@)/gi, "$1[REDACTED:credential]$2")
    .replace(/("(?:password|secret|access[_-]?token|api[_-]?key|client[_-]?secret)"\s*:\s*)"[^"\r\n]*"/gi, "$1\"[REDACTED]\"")
    .replace(/((?:password|secret|access[_-]?token|api[_-]?key|client[_-]?secret)\s*[=:]\s*)(["']?)[^\s,"'&;}\]]+\2/gi, "$1$2[REDACTED]$2");
}

function redactTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      redactTree(absolute);
      continue;
    }
    if (!entry.isFile()) {
      fs.unlinkSync(absolute);
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    if (bytes.includes(0)) {
      fs.unlinkSync(absolute);
      continue;
    }
    fs.writeFileSync(absolute, redact(bytes.toString("utf8")));
  }
}

redactTree(outDir);

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "path=" + outDir + "\n");
console.log("CI_FAILURE_PACKAGE=PASS kind=" + kind + " path=" + outDir);
