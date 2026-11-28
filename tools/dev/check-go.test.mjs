import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { admitNativeGoCoverage, admitNativeGoTests, checkOwners, discoverModules, listGoFiles, main, parseArgs, parseVersion, prepareSourceGo, requireModeEnvironment, resolvePinnedGo, services, sourceEnvironment, verifyOwnerPhases } from "./check-go.mjs";

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

test("Go resolver admits native Unix lookup and checked fallback only", () => {
  const calls = [];
  const lookup = (binary, args) => {
    calls.push([binary, args]);
    if (binary === "which") return { status: 0, stdout: "/old/go\n/old/go\n/current/go\n" };
    if (binary === "/old/go") return { status: 1 };
    return { status: 0, stdout: "go version go1.27.4 linux/amd64" };
  };
  assert.equal(resolvePinnedGo("1.27.4", {}, lookup, "linux"), "/current/go");
  assert.deepEqual(calls, [["which", ["-a", "go"]], ["/old/go", ["version"]], ["/current/go", ["version"]]]);
  const fallback = binary => binary === "which" ? { status: 1 } : { status: 0, stdout: "go version go1.27.4 linux/amd64" };
  assert.equal(resolvePinnedGo("1.27.4", {}, fallback, "linux"), "go");
  assert.throws(() => resolvePinnedGo("1.27.4", {}, () => ({ status: 1 }), "linux"), /found unavailable/);
  assert.throws(() => resolvePinnedGo("1.27.4", {}, binary => binary === "which" ? { status: 0, stdout: "/unknown/go" } : { status: 0 }, "linux"), /found unavailable/);
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
    DSH_DB_HOST: "protected", PGHOST: "protected", IDENTITY_TEST_DATABASE_URL: "protected", REF_IDENTITY_ENABLE_CAPTAIN_ADMISSION: "protected", ref_dsh_image_tag: "protected", GOROOT: "other", GOAMD64: "v4", GOCACHEPROG: "external-cache", CGO_ENABLED: "1", GOWORK: "other", GOTOOLCHAIN: "auto", DATABASE_URL: "protected", BTHWANI_CAPTAIN_TEST_DATABASE_URL: "protected", REF_POSTGRES_PASSWORD: "protected" };
  assert.deepEqual(sourceEnvironment(inherited), { PATH: "tools", GOCACHE: "cache", GOPROXY: "proxy", CGO_ENABLED: "1",
    GOTOOLCHAIN: "local", GOWORK: "off", GOENV: "off", GOFLAGS: "" });
  assert.equal(inherited.GOFLAGS, "-run=^Missing$");
});

test("source toolchain reads only configured native caches and refuses incomplete cache evidence", () => {
  const calls = [];
  const inherited = { PATH: "tools", GOENV: "fixture-config", GOFLAGS: "-run=^OnlyOne$", REF_IDENTITY_ENABLE_CAPTAIN_ADMISSION: "fixture" };
  const spawn = (executable, args, options) => {
    calls.push({ executable, args, env: options.env });
    if (executable === "where.exe") return { status: 0, stdout: "C:\\go\\bin\\go.exe" };
    if (args[0] === "version") return { status: 0, stdout: "go version go1.27.4 windows/amd64" };
    return { status: 0, stdout: JSON.stringify({ GOCACHE: "native-build-cache", GOMODCACHE: "native-module-cache" }) };
  };
  const { executable, env } = prepareSourceGo("1.27.4", "fixture-root", inherited, spawn, "win32");
  assert.equal(executable, "C:\\go\\bin\\go.exe");
  assert.deepEqual(calls.map(call => call.args), [["go"], ["version"], ["env", "-json", "GOCACHE", "GOMODCACHE"]]);
  assert.equal(calls[2].env.GOENV, "fixture-config");
  assert.equal(calls[2].env.GOFLAGS, "-mod=readonly");
  assert.ok(calls.every(call => !Object.hasOwn(call.env, "REF_IDENTITY_ENABLE_CAPTAIN_ADMISSION")));
  assert.deepEqual(env, { PATH: "tools", GOTOOLCHAIN: "local", GOWORK: "off", GOENV: "off", GOFLAGS: "", GOCACHE: "native-build-cache", GOMODCACHE: "native-module-cache" });
  assert.throws(() => prepareSourceGo("1.27.4", "fixture-root", inherited, (binary, args, options) =>
    args[0] === "env" ? { status: 0, stdout: "{}" } : spawn(binary, args, options), "win32"), /Incomplete native Go cache configuration/);
});

test("source Go rejects native cache lookup errors and incomplete paths", () => {
  const pin = "1.27.4";
  const env = { PATH: "fixture" };
  const prepare = result => prepareSourceGo(pin, "fixture-root", env, (binary, args, options) => {
    if (binary === "which") return { status: 0, stdout: "/native/go\n" };
    if (args[0] === "version") return { status: 0, stdout: "go version go1.27.4 linux/amd64" };
    assert.equal(options.env.GOFLAGS, "-mod=readonly");
    assert.equal(Object.hasOwn(options.env, "GOENV"), false);
    return result;
  }, "linux");
  const failure = new Error("native lookup failed");
  assert.throws(() => prepare({ error: failure }), error => error === failure);
  assert.throws(() => prepare({ status: 1 }), /Unable to resolve native Go cache configuration/);
  for (const caches of [{ GOCACHE: "", GOMODCACHE: "module" }, { GOCACHE: "build" }, { GOCACHE: "build", GOMODCACHE: "" }]) {
    assert.throws(() => prepare({ status: 0, stdout: JSON.stringify(caches) }), /Incomplete native Go cache configuration/);
  }
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
    'console.log(JSON.stringify({flags:process.env.GOFLAGS,config:process.env.GOENV,owner:process.env.WLT_SANDBOX_DATABASE_URL,activation:process.env.REF_IDENTITY_ENABLE_CAPTAIN_ADMISSION,cache:process.env.GOCACHE}))'], {
    env: sourceEnvironment({ ...process.env, GOFLAGS: "-run=^TestDoesNotExist$",
      WLT_SANDBOX_DATABASE_URL: "protected-fixture", REF_IDENTITY_ENABLE_CAPTAIN_ADMISSION: "fixture", GOCACHE: "fixture-cache" }),
    encoding: "utf8", timeout: 10000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { flags: "", config: "off", cache: "fixture-cache" });
});

test("native Go evidence requires a complete, ordered package and test lifecycle", () => {
  const encode = (...items) => items.map(item => JSON.stringify({ Package: "owner", ...item })).join("\n");
  const start = { Action: "start" };
  const finish = { Action: "pass" };
  const run = { Action: "run", Test: "TestActual" };
  const pass = { Action: "pass", Test: "TestActual" };
  const skip = { Action: "skip", Test: "TestActual" };
  assert.throws(() => admitNativeGoTests(encode(start, finish)), /NATIVE_GO_TEST_EXECUTION_EMPTY/);
  assert.throws(() => admitNativeGoTests(encode(start, run, skip, finish)), /NATIVE_GO_TEST_EXECUTION_EMPTY/);
  assert.throws(() => admitNativeGoTests(encode(start, pass, finish)), /NATIVE_GO_TEST_OUTCOME_WITHOUT_RUN/);
  assert.throws(() => admitNativeGoTests(encode(start, run, finish)), /NATIVE_GO_TEST_EXECUTION_INCOMPLETE/);
  assert.throws(() => admitNativeGoTests(encode(start, run, { Action: "fail", Test: "TestActual" })), /NATIVE_GO_TEST_FAILED/);
  assert.throws(() => admitNativeGoTests("not json"));
  for (const event of [null, {}, { Action: 1 }, { Action: "start" }, { Action: "build-output" }, { Action: "build-output", ImportPath: "owner" }]) {
    assert.throws(() => admitNativeGoTests(JSON.stringify(event)), /NATIVE_GO_TEST_EVENT_INVALID/);
  }
  assert.throws(() => admitNativeGoTests(encode({ Action: "build-fail" })), /NATIVE_GO_TEST_FAILED/);
  const complete = [start, run, pass, finish];
  const invalid = [
    [run, pass, finish], [start, run, pass], [start, start, run, pass, finish],
    [start, run, run, pass, finish], [start, run, pass, run, pass, finish],
    [...complete, finish], [...complete, { Action: "output" }],
    [start, run, pass, { Action: "skip" }],
    [start, { Action: "unknown" }, run, pass, finish],
    [start, { Action: "start", Test: "TestActual" }, run, pass, finish],
    [start, run, { Action: "unknown", Test: "TestActual" }, pass, finish],
    [start, { Action: "run" }, finish],
    [start, { Action: "run", Test: 0 }, run, pass, finish],
    [start, run, pass, finish, { Package: "second", Action: "start" }],
    [start, run, { Action: "cont", Test: "TestActual" }, pass, finish],
    [start, run, { Action: "pause", Test: "TestActual" }, pass, finish],
    [start, run, pass, { Action: "output", Test: "TestUnknown" }, finish],
  ];
  for (const events of invalid) assert.throws(() => admitNativeGoTests(encode(...events)), /NATIVE_GO_TEST_/);
  assert.deepEqual(admitNativeGoTests(encode({ Action: "build-output", ImportPath: "dependency", Output: "compiler diagnostic" },
    ...complete) + "\n\n"), { passed: 1, skipped: 0 });
  assert.deepEqual(admitNativeGoTests(encode(start, { Package: "empty", Action: "start" }, run,
    { Action: "pause", Test: "TestActual" }, { Package: "empty", Action: "skip" },
    { Action: "cont", Test: "TestActual" }, pass, { Action: "run", Test: "TestOptional" },
    { Action: "skip", Test: "TestOptional" }, finish)), { passed: 1, skipped: 1 });
});
test("native Go coverage requires a single positive measured total", () => {
  for (const value of ["", "total: (statements) 0.0%", "total: (statements) 101.0%", "total: (statements) 1.0%\ntotal: (statements) 2.0%"]) {
    assert.throws(() => admitNativeGoCoverage(value), /NATIVE_GO_COVERAGE_NOT_MEASURED/);
  }
  assert.equal(admitNativeGoCoverage("owner/file.go:10\tfunc\t70.0%\ntotal:\t(statements)\t70.0%\n"), 70);
});

test("Go Race admission is CI-only and rejects before toolchain or filesystem access", () => {
  const hosted = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" };
  const rejected = [{}, { ...hosted, GITHUB_ACTIONS: "false" }, { ...hosted, RUNNER_ENVIRONMENT: "self-hosted" }, { ...hosted, RUNNER_OS: "Windows" }];
  for (const env of rejected) {
    assert.throws(() => requireModeEnvironment("ci", env, "linux"), /GO_RACE_REQUIRES_HOSTED_LINUX_CI/);
    for (const mode of ["quick", "coverage"]) assert.doesNotThrow(() => requireModeEnvironment(mode, env, "win32"));
  }
  assert.throws(() => requireModeEnvironment("ci", hosted, "win32"), /GO_RACE_REQUIRES_HOSTED_LINUX_CI/);
  assert.doesNotThrow(() => requireModeEnvironment("ci", hosted, "linux"));
  const root = mkdtempSync(join(tmpdir(), "bthwani-go-race-admission-"));
  try {
    const script = 'import {main} from "./tools/dev/check-go.mjs"; main(["--ci"], process.argv[1]);';
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, root], {
      cwd: new URL("../..", import.meta.url), env: { ...process.env, GITHUB_ACTIONS: "false", RUNNER_ENVIRONMENT: "self-hosted" },
      encoding: "utf8", timeout: 10000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GO_RACE_REQUIRES_HOSTED_LINUX_CI/);
    assert.doesNotMatch(result.stderr, /ENOENT/);
    assert.equal(result.stdout, "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The JS-only CI job does not provision the pinned Go toolchain. Exercise
// this native integration wherever that exact toolchain is available; the
// separate mandatory Go producer always executes the real owner CLI.
test("native owner CLI admits measured coverage and rejects incomplete or failed owner evidence", { timeout: 180000 }, t => {
  const pin = readFileSync(new URL("../../.go-version", import.meta.url), "utf8").trim();
  try {
    resolvePinnedGo(pin, sourceEnvironment());
  } catch (error) {
    if (!error.message.startsWith("Go version mismatch:")) throw error;
    t.skip("Exact native Go toolchain not installed; native Go producer owns this proof");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "bthwani-native-go-cli-"));
  const source = "package fixture\n\nfunc Value() int {\n\treturn 7\n}\n";
  const tests = 'package fixture\n\nimport "testing"\n\nfunc TestValue(t *testing.T) {\n\tif Value() != 7 {\n\t\tt.Fatal("value")\n\t}\n}\n';
  try {
    writeFileSync(join(root, ".go-version"), pin + "\n");
    for (const owner of services) {
      const dir = join(root, "services", owner, "backend");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "go.mod"), "module example.invalid/" + owner + "\ngo " + pin + "\n");
      writeFileSync(join(dir, "value.go"), source);
      writeFileSync(join(dir, "value_test.go"), tests);
    }
    const dsh = join(root, "services", "dsh", "backend");
    const coverage = join(root, "coverage");
    main(["--quick", "--module=dsh"], root);
    main(["--coverage", "--sonar-report"], root);
    assert.deepEqual(readdirSync(coverage).sort(), services.map(name => name + "-go.out").sort());
    for (const name of services) assert.match(readFileSync(join(coverage, name + "-go.out"), "utf8"), /^mode: atomic\n/);
    assert.throws(() => main(["--coverage", "--sonar-report"], root), /Refusing existing Sonar Go coverage output/);
    main(["--coverage", "--module=dsh"], root);
    writeFileSync(join(dsh, "value_test.go"), tests.replace("Value() != 7", "Value() != 8"));
    assert.throws(() => main(["--quick", "--module=dsh"], root), /Go owner verification failed: dsh/);
    writeFileSync(join(dsh, "value_test.go"), tests);
    writeFileSync(join(dsh, "value.go"), "package fixture\nfunc Value() int {return 7}\n");
    assert.throws(() => main(["--quick", "--module=dsh"], root), /Go owner verification failed: dsh/);
    rmSync(join(dsh, "value.go"));
    rmSync(join(dsh, "value_test.go"));
    assert.throws(() => main(["--quick", "--module=dsh"], root), /Go owner verification failed: dsh/);
    writeFileSync(join(dsh, "value.go"), source);
    writeFileSync(join(dsh, "value_test.go"), tests);
    mkdirSync(join(dsh, "vendor"));
    mkdirSync(join(dsh, ".git"));
    mkdirSync(join(dsh, "nested"));
    writeFileSync(join(dsh, "nested", "nested.go"), "package nested\n");
    assert.equal(listGoFiles(dsh).length, 3);
    const link = join(root, "linked");
    symlinkSync(dsh, link, "junction");
    assert.throws(() => listGoFiles(link), /Unsafe Go owner directory/);
    const linkedChild = join(dsh, "linked");
    symlinkSync(join(dsh, "nested"), linkedChild, "junction");
    assert.throws(() => listGoFiles(dsh), /Linked Go owner source/);
    rmSync(linkedChild);
    rmSync(link);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});