#!/usr/bin/env node
// Check only service-owned Go modules. No tool installation or database access.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const services = ["identity", "dsh", "wlt"];

export function parseArgs(argv) {
  let mode = "quick";
  let moduleName;
  for (const arg of argv) {
    if (arg === "--quick") mode = "quick";
    else if (arg === "--ci") mode = "ci";
    else if (arg === "--coverage") mode = "coverage";
    else if (arg.startsWith("--module=")) moduleName = arg.slice("--module=".length);
    else throw new Error("Unknown Go check argument: " + arg);
  }
  if (moduleName !== undefined && !services.includes(moduleName)) {
    throw new Error("Unknown Go service: " + moduleName);
  }
  return { mode, moduleName };
}

export function parseVersion(output) {
  return /^go version go(\d+\.\d+\.\d+)\b/m.exec(output)?.[1] ?? null;
}

export function discoverModules(root, moduleName) {
  const candidates = moduleName ? [moduleName] : services;
  const modules = candidates.filter(name => existsSync(join(root, "services", name, "backend", "go.mod")));
  if (moduleName && modules.length === 0) throw new Error("Go module not found for " + moduleName);
  if (modules.length === 0) throw new Error("No Go backend modules found");
  return modules;
}

export function listGoFiles(directory) {
  const files = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory() && !["vendor", ".git"].includes(entry.name)) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".go")) files.push(file);
    }
  }
  walk(directory);
  // Preserve Array#sort's code-unit ordering for file paths explicitly.
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function run(executable, args, cwd, env, timeout = 300000) {
  process.stdout.write("RUN " + executable + " " + args.join(" ") + " [" + cwd + "]\n");
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8", windowsHide: true, timeout });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(executable + " exited " + result.status);
  return result.stdout ?? "";
}

export function main(argv = process.argv.slice(2), root = resolve(fileURLToPath(new URL("../..", import.meta.url)))) {
  const { mode, moduleName } = parseArgs(argv);
  // Go's exact version is a repository invariant; never auto-download a replacement.
  const env = { ...process.env, GOTOOLCHAIN: "local", GOWORK: "off" };
  // Do not touch existing/protected databases even when the caller's shell is configured.
  for (const key of [
    "DATABASE_URL", "IDENTITY_DATABASE_URL", "IDENTITY_TEST_DATABASE_URL",
    "DSH_DATABASE_URL", "BTHWANI_DSH_TEST_DATABASE_URL",
    "WLT_DATABASE_URL", "WLT_TEST_DATABASE_URL", "BTHWANI_ISOLATED_TEST_MODE",
  ]) delete env[key];

  const expected = readFileSync(join(root, ".go-version"), "utf8").trim();
  const actual = parseVersion(run("go", ["version"], root, env, 20000));
  if (actual !== expected) throw new Error("Go version mismatch: expected " + expected + ", got " + actual);
  const modules = discoverModules(root, moduleName);
  for (const name of modules) {
    const directory = join(root, "services", name, "backend");
    process.stdout.write("\nGO_SERVICE=" + name + " MODE=" + mode + "\n");
    const goFiles = listGoFiles(directory);
    if (!goFiles.length) throw new Error("No Go source files in " + name);
    const unformatted = run("gofmt", ["-l", ...goFiles], directory, env, 30000).trim();
    if (unformatted) throw new Error("gofmt failed for " + name + ": " + unformatted);
    run("go", ["mod", "verify"], directory, env);
    run("go", ["vet", "./..."], directory, env);
    if (mode === "ci" || mode === "coverage") {
      const scratch = mkdtempSync(join(tmpdir(), "bthwani-go-"));
      try {
        const profile = join(scratch, "coverage.out");
        run("go", ["test", ...(mode === "ci" ? ["-race"] : []), "-count=1", "-coverprofile=" + profile, "./..."], directory, env, 600000);
        run("go", ["tool", "cover", "-func=" + profile], directory, env);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    } else {
      run("go", ["test", "-count=1", "./..."], directory, env, 300000);
    }
    process.stdout.write("GO_CHECK_PASS service=" + name + " mode=" + mode + " database_integration=NOT_RUN\n");
  }
  for (const name of services.filter(name => !modules.includes(name))) {
    if (!moduleName) process.stdout.write("GO_SERVICE_NOT_PRESENT=" + name + "\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error("GO_CHECK_FAIL " + error.message); process.exitCode = 1; }
}
