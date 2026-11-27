import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkOwners, discoverModules, listGoFiles, parseArgs, parseVersion, resolvePinnedGo, services } from "./check-go.mjs";

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
