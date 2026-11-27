#!/usr/bin/env node
// Native Go owner verification. A failed owner never hides independent owners;
// incomplete verification never publishes a partial Sonar coverage inventory.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const services = Object.freeze(["identity", "dsh", "wlt"]);

export function parseArgs(argv) {
  let mode = "quick";
  let moduleName;
  let sonarReport = false;
  let explicitMode = false;
  for (const arg of argv) {
    if (["--quick", "--ci", "--coverage"].includes(arg)) {
      if (explicitMode) throw new Error("Conflicting Go check modes");
      explicitMode = true;
      mode = arg.slice(2);
    } else if (arg === "--sonar-report" && !sonarReport) {
      sonarReport = true;
    } else if (arg.startsWith("--module=") && moduleName === undefined) {
      moduleName = arg.slice("--module=".length);
    } else {
      throw new Error("Unknown Go check argument: " + arg);
    }
  }
  if (moduleName !== undefined && !services.includes(moduleName)) throw new Error("Unknown Go service: " + moduleName);
  if (sonarReport && (mode === "quick" || moduleName !== undefined)) {
    throw new Error("Sonar report requires --ci or --coverage for all owners");
  }
  return { mode, moduleName, sonarReport };
}

export function parseVersion(output) {
  return /^go version go(\d+\.\d+\.\d+)(?=\s|$)/m.exec(output)?.[1] ?? null;
}

// Choose an existing exact toolchain; never download or modify machine PATH.
export function resolvePinnedGo(expected, env = process.env, spawn = spawnSync, platform = process.platform) {
  const windows = platform === "win32";
  const lookup = spawn(windows ? "where.exe" : "which", windows ? ["go"] : ["-a", "go"], {
    encoding: "utf8", windowsHide: true, env, timeout: 20000,
  });
  const candidates = lookup.status === 0
    ? [...new Set(lookup.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean))]
    : ["go"];
  const observed = [];
  for (const executable of candidates) {
    const result = spawn(executable, ["version"], {
      encoding: "utf8", windowsHide: true, timeout: 20000,
      env: { ...env, GOTOOLCHAIN: "local", GOPROXY: "off" },
    });
    const version = result.status === 0 ? parseVersion(result.stdout ?? "") : null;
    if (version === expected) return executable;
    observed.push(version ?? "unavailable");
  }
  throw new Error("Go version mismatch: expected " + expected + ", found " + observed.join(", "));
}

export function discoverModules(root, moduleName) {
  if (moduleName !== undefined && !services.includes(moduleName)) throw new Error("Unknown Go service: " + moduleName);
  const selected = moduleName ? [moduleName] : [...services];
  const missing = selected.filter(name => {
    const entry = lstatSync(join(root, "services", name, "backend", "go.mod"), { throwIfNoEntry: false });
    return !entry?.isFile() || entry.isSymbolicLink();
  });
  if (missing.length) throw new Error("Required Go owner module not found: " + missing.join(", "));
  return selected;
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
  return files.sort();
}

function run(executable, args, cwd, env, timeout = 300000) {
  const command = /(?:^|[\\/])gofmt(?:\.exe)?$/i.test(executable) && args[0] === "-l"
    ? "-l (" + (args.length - 1) + " source files)"
    : args.join(" ");
  process.stdout.write("RUN " + executable + " " + command + " [" + cwd + "]\n");
  const result = spawnSync(executable, args, {
    cwd, env, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(executable + " exited " + result.status);
  return result.stdout ?? "";
}

function checkOwner(root, name, mode, sonarReport, goExecutable, env) {
  discoverModules(root, name);
  const directory = join(root, "services", name, "backend");
  const goFiles = listGoFiles(directory);
  if (!goFiles.length) throw new Error("No Go source files in " + name);
  const formatter = join(dirname(goExecutable), process.platform === "win32" ? "gofmt.exe" : "gofmt");
  const unformatted = run(formatter, ["-l", ...goFiles], directory, env, 30000).trim();
  if (unformatted) throw new Error("gofmt failed for " + name + ": " + unformatted);
  run(goExecutable, ["mod", "verify"], directory, env);
  run(goExecutable, ["vet", "./..."], directory, env);
  if (mode === "quick") {
    run(goExecutable, ["test", "-count=1", "./..."], directory, env);
    return undefined;
  }
  const scratch = mkdtempSync(join(tmpdir(), "bthwani-go-"));
  try {
    const profile = join(scratch, "coverage.out");
    run(goExecutable, ["test", ...(mode === "ci" ? ["-race"] : []), "-count=1",
      ...(sonarReport ? ["-covermode=atomic", "-coverpkg=./..."] : []),
      "-coverprofile=" + profile, "./..."], directory, env, 600000);
    run(goExecutable, ["tool", "cover", "-func=" + profile], directory, env);
    return sonarReport ? readFileSync(profile) : undefined;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Keep every owner outcome observable, without permitting partial publication.
export function checkOwners(selected, check, log = console) {
  const results = new Map();
  const failures = [];
  for (const name of selected) {
    try {
      results.set(name, check(name));
      log.log("GO_CHECK_PASS service=" + name + " database_integration=NOT_RUN");
    } catch (error) {
      failures.push(name);
      log.error("GO_CHECK_FAIL service=" + name + ": " + error.message);
    }
  }
  if (failures.length) throw new Error("Go owner verification failed: " + failures.join(", "));
  return results;
}

export function main(argv = process.argv.slice(2), root = resolve(fileURLToPath(new URL("../..", import.meta.url)))) {
  const { mode, moduleName, sonarReport } = parseArgs(argv);
  const env = { ...process.env, GOTOOLCHAIN: "local", GOWORK: "off" };
  // Native source tests must not access inherited real or protected databases.
  for (const key of [
    "DATABASE_URL", "IDENTITY_DATABASE_URL", "IDENTITY_TEST_DATABASE_URL",
    "DSH_DATABASE_URL", "BTHWANI_DSH_TEST_DATABASE_URL",
    "WLT_DATABASE_URL", "WLT_TEST_DATABASE_URL", "BTHWANI_ISOLATED_TEST_MODE",
  ]) delete env[key];
  const expected = readFileSync(join(root, ".go-version"), "utf8").trim();
  const goExecutable = resolvePinnedGo(expected, env);
  if (parseVersion(run(goExecutable, ["version"], root, env, 20000)) !== expected) {
    throw new Error("Go toolchain changed");
  }
  const selected = moduleName ? [moduleName] : [...services];
  const coverage = join(root, "coverage");
  if (sonarReport && services.some(name => existsSync(join(coverage, name + "-go.out")))) {
    throw new Error("Refusing existing Sonar Go coverage output");
  }
  const results = checkOwners(selected, name => {
    console.log("GO_SERVICE=" + name + " MODE=" + mode);
    return checkOwner(root, name, mode, sonarReport, goExecutable, env);
  });
  if (sonarReport) {
    if (results.size !== services.length || [...results.values()].some(profile => !Buffer.isBuffer(profile) || profile.length === 0)) {
      throw new Error("Incomplete Sonar Go coverage inventory");
    }
    mkdirSync(coverage, { recursive: true });
    for (const [name, profile] of results) writeFileSync(join(coverage, name + "-go.out"), profile, { flag: "wx" });
    console.log("SONAR_GO_REPORTS_PASS owners=" + results.size);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error("GO_CHECK_FAIL " + error.message);
    process.exitCode = 1;
  }
}
