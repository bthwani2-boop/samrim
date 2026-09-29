import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveTrustedExecutable } from "./trusted-executables.mjs";

test("trusted Git resolution returns an absolute executable outside PATH lookup", () => {
  const executable = resolveTrustedExecutable("git");
  assert.equal(path.isAbsolute(executable), true);
  assert.match(path.basename(executable), /^git(\.exe)?$/i);
});

test("trusted executable resolution fails closed for names outside the allowlist", () => {
  assert.throws(() => resolveTrustedExecutable("git.exe"), /not on the trusted allowlist/);
  assert.throws(() => resolveTrustedExecutable("docker-compose"), /not on the trusted allowlist/);
});

test("trusted executable resolution fails closed when every fixed location is missing", () => {
  const realpathSync = fs.realpathSync;
  fs.realpathSync = () => {
    throw new Error("fixed executable location is missing");
  };
  try {
    assert.throws(() => resolveTrustedExecutable("git"), /trusted git executable was not found/);
  } finally {
    fs.realpathSync = realpathSync;
  }
});

test("trusted executable resolution rejects a non-absolute resolved path", () => {
  const realpathSync = fs.realpathSync;
  fs.realpathSync = () => "relative/git";
  try {
    assert.throws(() => resolveTrustedExecutable("git"), /trusted git executable was not found/);
  } finally {
    fs.realpathSync = realpathSync;
  }
});

test("trusted Git resolution works with an empty PATH", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { resolveTrustedExecutable } from ${JSON.stringify(new URL("./trusted-executables.mjs", import.meta.url).href)}; console.log(resolveTrustedExecutable("git"));`,
    ],
    { cwd: import.meta.dirname, encoding: "utf8", env: { ...process.env, PATH: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(path.isAbsolute(result.stdout.trim()), true);
});

test("trusted Go resolution uses the pinned GitHub tool cache without PATH", () => {
  const runnerToolCache = fs.mkdtempSync(path.join(os.tmpdir(), "samrim-trusted-go-"));
  const goDirectory = path.join(runnerToolCache, "go", "1.27.1", process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "x86" : "x64", "bin");
  fs.mkdirSync(goDirectory, { recursive: true });
  const executableName = process.platform === "win32" ? "go.exe" : "go";
  const executablePath = path.join(goDirectory, executableName);
  fs.copyFileSync(process.execPath, executablePath);
  if (process.platform !== "win32") fs.chmodSync(executablePath, 0o755);

  const previous = {
    githubActions: process.env.GITHUB_ACTIONS,
    runnerToolCache: process.env.RUNNER_TOOL_CACHE,
  };
  process.env.GITHUB_ACTIONS = "true";
  process.env.RUNNER_TOOL_CACHE = runnerToolCache;
  try {
    assert.equal(resolveTrustedExecutable("go"), fs.realpathSync(executablePath));
  } finally {
    if (previous.githubActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous.githubActions;
    if (previous.runnerToolCache === undefined) delete process.env.RUNNER_TOOL_CACHE;
    else process.env.RUNNER_TOOL_CACHE = previous.runnerToolCache;
    fs.rmSync(runnerToolCache, { recursive: true, force: true });
  }
});
