#!/usr/bin/env node
// Native owner checks: independent quality phases, verified dependencies
// before execution, no inherited test selectors, and complete coverage only.
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
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

// Race execution belongs to the native hosted Linux producer only.
// Runner variables are routing metadata, not authentication.
export function requireModeEnvironment(mode, env = process.env, platform = process.platform) {
  if (mode === "ci" && (platform !== "linux" || env.GITHUB_ACTIONS !== "true" ||
      env.RUNNER_ENVIRONMENT !== "github-hosted" || env.RUNNER_OS !== "Linux")) {
    throw new Error("GO_RACE_REQUIRES_HOSTED_LINUX_CI");
  }
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

// This environment belongs only to native source checks, never to the
// separately authorized PostgreSQL integration runner. Keep tool/cache/proxy
// settings but exclude inherited selectors, target overrides and owner data.
export function sourceEnvironment(inherited = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (/^(?:BTHWANI_|IDENTITY_|DSH_|WLT_|REF_POSTGRES_|PG[A-Z]|DATABASE_URL$|GOFLAGS$|GOENV$|GOOS$|GOARCH$|GOEXPERIMENT$|GOTOOLCHAIN$|GOWORK$)/i.test(key)) continue;
    env[key] = value;
  }
  return { ...env, GOTOOLCHAIN: "local", GOWORK: "off", GOENV: "off", GOFLAGS: "" };
}

function requireDirectory(directory) {
  const entry = lstatSync(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink() ||
      relative(resolve(directory), realpathSync.native(directory)) !== "") {
    throw new Error("Unsafe Go owner directory: " + directory);
  }
}

export function discoverModules(root, moduleName) {
  if (moduleName !== undefined && !services.includes(moduleName)) throw new Error("Unknown Go service: " + moduleName);
  const selected = moduleName ? [moduleName] : [...services];
  const missing = selected.filter(name => {
    const directory = join(root, "services", name, "backend");
    const entry = lstatSync(join(directory, "go.mod"), { throwIfNoEntry: false });
    if (!entry?.isFile() || entry.isSymbolicLink()) return true;
    requireDirectory(directory);
    return false;
  });
  if (missing.length) throw new Error("Required Go owner module not found: " + missing.join(", "));
  return selected;
}

export function listGoFiles(directory) {
  const files = [];
  function walk(path) {
    requireDirectory(path);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (["vendor", ".git"].includes(entry.name)) continue;
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Linked Go owner source: " + file);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".go")) files.push(file);
    }
  }
  walk(directory);
  return files.sort((left, right) => left < right ? -1 : Number(left > right));
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

// Failed formatting and full vet do not suppress independent test execution.
// Failed dependency integrity does prohibit executing that module's tests.
export function verifyOwnerPhases(phases, log = console) {
  const failed = [];
  const attempt = (name, operation) => {
    try {
      const result = operation();
      log.log("GO_PHASE_PASS phase=" + name);
      return { ok: true, result };
    } catch (error) {
      failed.push(name);
      log.error("GO_PHASE_FAIL phase=" + name + ": " + error.message);
      return { ok: false };
    }
  };
  attempt("format", phases.format);
  const dependencies = attempt("dependencies", phases.dependencies);
  let measured;
  if (dependencies.ok) {
    attempt("vet", phases.vet);
    measured = attempt("test", phases.test);
  } else {
    log.error("GO_PHASE_NOT_RUN phase=vet,test reason=dependency_integrity");
  }
  if (failed.length) throw new Error("Go owner phases failed: " + failed.join(", "));
  return measured.result;
}

// Consume the native test2json stream; package-level pass and skip events
// cannot establish that an individual test actually completed successfully.
export function admitNativeGoTests(output) {
  const running = new Set();
  let passed = 0;
  let skipped = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (!event || typeof event.Action !== "string") throw new Error("NATIVE_GO_TEST_EVENT_INVALID");
    if (event.Action === "fail" || event.Action === "build-fail") throw new Error("NATIVE_GO_TEST_FAILED");
    if (!event.Test) continue;
    if (typeof event.Package !== "string" || typeof event.Test !== "string") throw new Error("NATIVE_GO_TEST_EVENT_INVALID");
    const key = JSON.stringify([event.Package, event.Test]);
    if (event.Action === "run") running.add(key);
    if (event.Action === "pass" || event.Action === "skip") {
      if (!running.delete(key)) throw new Error("NATIVE_GO_TEST_OUTCOME_WITHOUT_RUN");
      if (event.Action === "pass") passed++;
      else skipped++;
    }
  }
  if (running.size) throw new Error("NATIVE_GO_TEST_EXECUTION_INCOMPLETE");
  if (!passed) throw new Error("NATIVE_GO_TEST_EXECUTION_EMPTY");
  return { passed, skipped };
}

export function admitNativeGoCoverage(output) {
  const totals = [...output.matchAll(/^total:\s+\(statements\)\s+(\d+(?:\.\d+)?)%\s*$/gm)];
  const percent = Number(totals[0]?.[1]);
  if (totals.length !== 1 || !(percent > 0 && percent <= 100)) throw new Error("NATIVE_GO_COVERAGE_NOT_MEASURED");
  return percent;
}

function nativeOwnerTests(directory, mode, sonarReport, executable, env) {
  // Full go vet has its own phase; do not execute the default subset again.
  const args = ["test", "-json", "-vet=off", "-count=1"];
  const execute = extra => {
    const output = run(executable, [...args, ...extra, "./..."], directory, env, 600000);
    const outcome = admitNativeGoTests(output);
    console.log("NATIVE_GO_TEST_EXECUTION_PASS tests=" + outcome.passed + " skipped=" + outcome.skipped);
  };
  if (mode === "quick") {
    execute([]);
    return undefined;
  }
  if (mode === "ci") args.push("-race");
  if (sonarReport) args.push("-covermode=atomic", "-coverpkg=./...");
  const scratch = mkdtempSync(join(tmpdir(), "bthwani-go-"));
  try {
    const profile = join(scratch, "coverage.out");
    execute(["-coverprofile=" + profile]);
    // Native Go validates its own report; reject a valid but unmeasured profile.
    admitNativeGoCoverage(run(executable, ["tool", "cover", "-func=" + profile], directory, env));
    return sonarReport ? readFileSync(profile) : undefined;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function checkOwner(root, name, mode, sonarReport, executable, formatter, env) {
  discoverModules(root, name);
  const directory = join(root, "services", name, "backend");
  const files = listGoFiles(directory);
  if (!files.length) throw new Error("No Go source files in " + name);
  return verifyOwnerPhases({
    format() {
      const unformatted = run(formatter, ["-l", ...files], directory, env, 30000).trim();
      if (unformatted) throw new Error("gofmt failed for " + name + ": " + unformatted);
    },
    dependencies: () => run(executable, ["mod", "verify"], directory, env),
    vet: () => run(executable, ["vet", "./..."], directory, env),
    test: () => nativeOwnerTests(directory, mode, sonarReport, executable, env),
  });
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

function requireFreshReports(directory) {
  if (lstatSync(directory, { throwIfNoEntry: false })) requireDirectory(directory);
  for (const name of services) {
    if (lstatSync(join(directory, name + "-go.out"), { throwIfNoEntry: false })) {
      throw new Error("Refusing existing Sonar Go coverage output: " + name);
    }
  }
}

function publishReports(directory, results) {
  if (results.size !== services.length || services.some(name => {
    const bytes = results.get(name);
    return !Buffer.isBuffer(bytes) || bytes.length === 0;
  })) throw new Error("Incomplete Sonar Go coverage inventory");
  requireFreshReports(directory);
  mkdirSync(directory, { recursive: true });
  requireDirectory(directory);
  for (const [name, profile] of results) writeFileSync(join(directory, name + "-go.out"), profile, { flag: "wx" });
  console.log("SONAR_GO_REPORTS_PASS owners=" + results.size);
}

// Preserve only the installed toolchain's effective cache directories from
// its existing configuration, not flags, selectors or owner credentials.
function configuredCaches(executable, root) {
  const result = spawnSync(executable, ["env", "-json", "GOCACHE", "GOMODCACHE"], {
    cwd: root, env: { ...process.env, GOTOOLCHAIN: "local", GOWORK: "off", GOFLAGS: "-mod=readonly" },
    encoding: "utf8", windowsHide: true, timeout: 20000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Unable to resolve native Go cache configuration");
  const caches = JSON.parse(result.stdout);
  if (typeof caches.GOCACHE !== "string" || !caches.GOCACHE ||
      typeof caches.GOMODCACHE !== "string" || !caches.GOMODCACHE) {
    throw new Error("Incomplete native Go cache configuration");
  }
  return { GOCACHE: caches.GOCACHE, GOMODCACHE: caches.GOMODCACHE };
}

export function main(argv = process.argv.slice(2), root = resolve(fileURLToPath(new URL("../..", import.meta.url)))) {
  const { mode, moduleName, sonarReport } = parseArgs(argv);
  requireModeEnvironment(mode);
  const expected = readFileSync(join(root, ".go-version"), "utf8").trim();
  const executable = resolvePinnedGo(expected, sourceEnvironment());
  const env = { ...sourceEnvironment(), ...configuredCaches(executable, root) };
  if (parseVersion(run(executable, ["version"], root, env, 20000)) !== expected) {
    throw new Error("Go toolchain changed");
  }
  const goRoot = run(executable, ["env", "GOROOT"], root, env, 20000).trim();
  const formatter = join(goRoot, "bin", process.platform === "win32" ? "gofmt.exe" : "gofmt");
  const selected = moduleName ? [moduleName] : [...services];
  const coverage = join(root, "coverage");
  if (sonarReport) requireFreshReports(coverage);
  const results = checkOwners(selected, name => {
    console.log("GO_SERVICE=" + name + " MODE=" + mode);
    return checkOwner(root, name, mode, sonarReport, executable, formatter, env);
  });
  if (sonarReport) publishReports(coverage, results);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error("GO_CHECK_FAIL " + error.message);
    process.exitCode = 1;
  }
}
