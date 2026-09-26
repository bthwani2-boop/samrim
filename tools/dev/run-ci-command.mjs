import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const separator = process.argv.indexOf("--");
const name = (separator > 2 ? process.argv[2] : "").trim();
const commandArgs = separator >= 0 ? process.argv.slice(separator + 1) : [];

if (!name || commandArgs.length === 0) {
  console.error("CI_TIMED_COMMAND=FAIL usage: node tools/dev/run-ci-command.mjs <name> -- <command> [args...]");
  process.exit(2);
}

const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
const metricsPath = process.env.SAMRIM_CI_METRICS_PATH || path.join(runnerTemp, "samrim-ci-metrics.jsonl");
const logDir = process.env.SAMRIM_CI_LOG_DIR || path.join(runnerTemp, "samrim-ci-logs");
const profileDir = process.env.SAMRIM_CI_PROFILE_DIR || path.join(runnerTemp, "samrim-ci-profiles");
fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(profileDir, { recursive: true });

const isWindows = process.platform === "win32";
const executable = isWindows && commandArgs[0] === "pnpm" ? "pnpm.cmd" : commandArgs[0];
const args = commandArgs.slice(1);
const safeName = name.replace(/[^A-Za-z0-9._-]+/g, "-");
const logPath = path.join(logDir, safeName + ".log");
const isNxCommand = commandArgs[0] === "pnpm" && commandArgs[1] === "exec" && commandArgs[2] === "nx";
const profilePath = isNxCommand ? path.join(profileDir, safeName + ".json") : null;
const nxProfilePath = profilePath ? path.relative(root, profilePath) : null;
const childEnv = nxProfilePath ? { ...process.env, NX_PROFILE: nxProfilePath } : process.env;
const log = fs.createWriteStream(logPath, { flags: "w" });
const startedAt = new Date();
const started = performance.now();

console.log("CI_TIMED_COMMAND_START name=" + name + " command=" + commandArgs.join(" "));

let exitCode = 1;
try {
  const child = spawn(executable, args, {
    cwd: root,
    env: childEnv,
    stdio: ["inherit", "pipe", "pipe"],
    shell: isWindows,
  });

  for (const [stream, destination] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    stream?.on("data", (chunk) => {
      destination.write(chunk);
      log.write(chunk);
    });
  }

  exitCode = await new Promise((resolve) => {
    child.once("error", (error) => {
      const message = "CI_TIMED_COMMAND=FAIL name=" + name + " error=" + String(error?.message || error);
      console.error(message);
      log.write(message + "\n");
      resolve(1);
    });
    child.once("close", (code, signal) => {
      if (signal) {
        const message = "CI_TIMED_COMMAND_SIGNAL name=" + name + " signal=" + signal;
        console.error(message);
        log.write(message + "\n");
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
} catch (error) {
  const message = "CI_TIMED_COMMAND=FAIL name=" + name + " error=" + String(error?.message || error);
  console.error(message);
  log.write(message + "\n");
  exitCode = 1;
}

await new Promise((resolve) => log.end(resolve));
const durationMs = Math.round(performance.now() - started);
const record = {
  name,
  startedAt: startedAt.toISOString(),
  durationMs,
  exitCode,
  logPath,
  profilePath,
  sha: process.env.GITHUB_SHA || null,
  base: process.env.NX_BASE || null,
  head: process.env.NX_HEAD || null,
  runner: process.env.RUNNER_OS || process.platform,
};
fs.appendFileSync(metricsPath, JSON.stringify(record) + "\n");
console.log("CI_TIMED_COMMAND_END name=" + name + " ms=" + durationMs + " exit=" + exitCode);

process.exit(exitCode);
