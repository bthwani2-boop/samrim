import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { admitNativeGoCoverage, admitNativeGoTests, checkOwners, discoverModules, listGoFiles, parseArgs, parseVersion, resolvePinnedGo, services, sourceEnvironment, verifyOwnerPhases } from "./check-go.mjs";

test("Go CLI selects only an unambiguous admitted mode and owner", () => {
  assert.deepEqual(parseArgs([]), { mode: "quick", moduleName: undefined, sonarReport: false });
  assert.deepEqual(parseArgs(["--ci", "--module=identity"]), { mode: "ci", moduleName: "identity", sonarReport: false });
  assert.deepEqual(parseArgs(["--coverage", "--module=dsh"]), { mode: "coverage", moduleName: "dsh", sonarReport: false });
  for (const mode of ["ci", "coverage"]) {
    assert.deepEqual(parseArgs(["--" + mode, "--sonar-report"]), { mode, moduleName: undefined, sonarReport: true });
  }
  for (const args of [["--sonar-report"], ["--ci", "--sonar-report", "--module=dsh"]]) {
    assert.throws(() => parseArgs(args), /Sonar report requires/);
  }
  assert.throws(() => parseArgs(["--ci", "--quick"]), /Conflicting/);
  assert.throws(() => parseArgs(["--module=dsh", "--module=identity"]), /Unknown Go check argument/);
  assert.throws(() => parseArgs(["--ci", "--sonar-report", "--sonar-report"]), /Unknown Go check argument/);
  assert.throws(() => parseArgs(["--install"]), /Unknown Go check argument/);
  assert.throws(() => parseArgs(["--module=payments"]), /Unknown Go service/);
});

test("Go pin requires an exact stable version", () => {
  assert.equal(parseVersion("go version go1.27.4 windows/amd64"), "1.27.4");
  assert.equal(parseVersion("go version go1.27.1 linux/amd64"), "1.27.1");
  for (const version of ["1.28rc1", "1.27.4rc1", "1.27.4-custom"]) {
    assert.equal(parseVersion("go version go" + version + " linux/amd64"), null);
  }
});

test("Go resolver selects the exact installed pin rather than an older PATH candidate", () => {
  const seen = [];
  const spawn = (binary, args, options) => {
    seen.push({ binary, args, options });
    if (binary === "where.exe") return { status: 0, stdout: "C:\\stale\\go.exe\r\nC:\\correct\\go.exe\r\n" };
    return { status: 0, stdout: binary.includes("correct") ? "go version go1.27.4 windows/amd64" : "go version go1.27.3 windows/amd64" };
  };
  assert.equal(resolvePinnedGo("1.27.4", { PATH: "synthetic" }, spawn, "win32"), "C:\\correct\\go.exe");
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].args, ["go"]);
  assert.ok(seen.slice(1).every(call => call.options.env.GOTOOLCHAIN === "local" && call.options.env.GOPROXY === "off"));
  assert.throws(() => resolvePinnedGo("1.27.5", { PATH: "synthetic" }, spawn, "win32"), /Go version mismatch/);
});

test("complete discovery refuses missing owner modules; scoped discovery checks the requested owner", () => {
  const root = mkdtempSync(join(tmpdir(), "bthwani-go-verify-"));
  try {
    assert.throws(() => discoverModules(root), /identity, dsh, wlt/);
    for (const name of services) {
      const backend = join(root, "services", name, "backend");
      mkdirSync(backend, { recursive: true });
      writeFileSync(join(backend, "go.mod"), "module example.com/" + name + "\n");
      writeFileSync(join(backend, "main.go"), "package main\n");
      assert.deepEqual(discoverModules(root, name), [name]);
      assert.deepEqual(listGoFiles(backend), [join(backend, "main.go")]);
    }
    assert.deepEqual(discoverModules(root), services);
    rmSync(join(root, "services", "identity", "backend", "go.mod"));
    assert.throws(() => discoverModules(root), /identity/);
    assert.deepEqual(discoverModules(root, "dsh"), ["dsh"]);
    assert.throws(() => discoverModules(root, "identity"), /not found/);
    assert.throws(() => discoverModules(root, "payments"), /Unknown Go service/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Go file listing preserves code-unit ordering and excludes other file types", () => {
  const root = mkdtempSync(join(tmpdir(), "bthwani-go-sort-"));
  try {
    for (const name of ["file2.go", "a.go", "file10.go", "Z.go"]) writeFileSync(join(root, name), "package example\n");
    writeFileSync(join(root, "ignore.ts"), "ignored");
    assert.deepEqual(listGoFiles(root), ["Z.go", "a.go", "file10.go", "file2.go"].map(name => join(root, name)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Go owner execution reports every independent outcome and returns no partial coverage inventory", () => {
  for (const failing of [[], ["identity"], ["dsh"], ["wlt"], [...services]]) {
    const visited = [], errors = [], passed = [];
    const execute = () => checkOwners(services, name => {
      visited.push(name);
      if (failing.includes(name)) throw new Error("synthetic owner failure");
      return Buffer.from(name);
    }, { log: message => passed.push(message), error: message => errors.push(message) });
    if (failing.length) assert.throws(execute, new RegExp(failing.join(", ")));
    else assert.deepEqual([...execute().keys()], services);
    assert.deepEqual(visited, services);
    assert.equal(errors.length, failing.length);
    assert.equal(passed.length, services.length - failing.length);
    for (const name of failing) assert.ok(errors.some(message => message.includes("service=" + name + ":")));
  }
});

test("source checks exclude inherited owner data and test selectors, preserve native tools and cache", () => {
  const inherited = { PATH: "tools", GOCACHE: "cache", GOPROXY: "proxy", GOFLAGS: "-run=^Missing$",
    GOENV: "user-config", GOOS: "other", GOARCH: "other", BTHWANI_ISOLATED_TEST_MODE: "true",
    WLT_SANDBOX_DATABASE_URL: "protected", BTHWANI_MERCHANT_TEST_DATABASE_URL: "protected",
    DSH_DB_HOST: "protected", PGHOST: "protected", IDENTITY_TEST_DATABASE_URL: "protected" };
  assert.deepEqual(sourceEnvironment(inherited), { PATH: "tools", GOCACHE: "cache", GOPROXY: "proxy",
    GOTOOLCHAIN: "local", GOWORK: "off", GOENV: "off", GOFLAGS: "" });
  assert.equal(inherited.GOFLAGS, "-run=^Missing$");
});

test("owner stages expose independent failures but never execute against failed dependency integrity", () => {
  for (const failures of [[], ["format"], ["vet"], ["test"], ["format", "vet"], ["dependencies"]]) {
    const seen = [];
    const phases = Object.fromEntries(["format", "dependencies", "vet", "test"].map(name => [name, () => {
      seen.push(name);
      if (failures.includes(name)) throw new Error("fixture failure");
      return name;
    }]));
    const execute = () => verifyOwnerPhases(phases, { log() {}, error() {} });
    if (failures.length) assert.throws(execute, new RegExp(failures.join(", ")));
    else assert.equal(execute(), "test");
    assert.deepEqual(seen, failures.includes("dependencies") ? ["format", "dependencies"] : ["format", "dependencies", "vet", "test"]);
  }
});

test("the actual child process receives no inherited Go test selector or owner configuration", () => {
  const result = spawnSync(process.execPath, ["-e",
    'console.log(JSON.stringify({flags:process.env.GOFLAGS,config:process.env.GOENV,owner:process.env.WLT_SANDBOX_DATABASE_URL,cache:process.env.GOCACHE}))'], {
    env: sourceEnvironment({ ...process.env, GOFLAGS: "-run=^TestDoesNotExist$",
      WLT_SANDBOX_DATABASE_URL: "protected-fixture", GOCACHE: "fixture-cache" }),
    encoding: "utf8", timeout: 10000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { flags: "", config: "off", cache: "fixture-cache" });
});

test("native Go outcomes require actual completed tests, not package success or skips", () => {
  const events = (...items) => items.map(item => JSON.stringify({ Package: "owner", ...item })).join("\n");
  const run = { Action: "run", Test: "TestActual" };
  const pass = { Action: "pass", Test: "TestActual" };
  const skip = { Action: "skip", Test: "TestActual" };
  assert.throws(() => admitNativeGoTests(events({ Action: "pass" })), /NATIVE_GO_TEST_EXECUTION_EMPTY/);
  assert.throws(() => admitNativeGoTests(events(run, skip, { Action: "pass" })), /NATIVE_GO_TEST_EXECUTION_EMPTY/);
  assert.throws(() => admitNativeGoTests(events(pass)), /NATIVE_GO_TEST_OUTCOME_WITHOUT_RUN/);
  assert.throws(() => admitNativeGoTests(events(run, { Action: "pass" })), /NATIVE_GO_TEST_EXECUTION_INCOMPLETE/);
  assert.throws(() => admitNativeGoTests(events(run, { Action: "fail", Test: "TestActual" })), /NATIVE_GO_TEST_FAILED/);
  assert.throws(() => admitNativeGoTests("not json"));
  assert.deepEqual(admitNativeGoTests(events(run, pass, { Action: "run", Test: "TestOptional" }, { Action: "skip", Test: "TestOptional" }, { Action: "pass" })), { passed: 1, skipped: 1 });
});

test("native Go coverage requires a single positive measured total", () => {
  for (const value of ["", "total: (statements) 0.0%", "total: (statements) 101.0%", "total: (statements) 1.0%\ntotal: (statements) 2.0%"]) {
    assert.throws(() => admitNativeGoCoverage(value), /NATIVE_GO_COVERAGE_NOT_MEASURED/);
  }
  assert.equal(admitNativeGoCoverage("owner/file.go:10\tfunc\t70.0%\ntotal:\t(statements)\t70.0%\n"), 70);
});
