import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverModules, listGoFiles, parseArgs, parseVersion, resolvePinnedGo } from "./check-go.mjs";

test("Go CLI modes and service allowlist reject unknown arguments", () => {
  assert.deepEqual(parseArgs([]), { mode: "quick", moduleName: undefined });
  assert.deepEqual(parseArgs(["--ci", "--module=identity"]), { mode: "ci", moduleName: "identity" });
  assert.deepEqual(parseArgs(["--coverage", "--module=dsh"]), { mode: "coverage", moduleName: "dsh" });
  assert.throws(() => parseArgs(["--install"]), /Unknown Go check argument/);
  assert.throws(() => parseArgs(["--module=payments"]), /Unknown Go service/);
});

test("Go pin requires exact stable patch, not a mismatched toolchain", () => {
  assert.equal(parseVersion("go version go1.27.4 windows/amd64"), "1.27.4");
  assert.equal(parseVersion("go version go1.27.1 linux/amd64"), "1.27.1");
  assert.equal(parseVersion("go version go1.28rc1 linux/amd64"), null);
});

test("Go resolver uses the exact installed pin when inherited PATH starts with an older version", () => {
  const seen = [];
  const spawn = (binary, args, options) => {
    seen.push({ binary, args, options });
    if (binary === "where.exe") {
      return { status: 0, stdout: "C:\\stale\\go.exe\r\nC:\\correct\\go.exe\r\n" };
    }
    return { status: 0, stdout: binary.includes("correct")
      ? "go version go1.27.4 windows/amd64"
      : "go version go1.27.3 windows/amd64" };
  };
  const executable = resolvePinnedGo("1.27.4", { PATH: "synthetic" }, spawn, "win32");
  assert.equal(executable, "C:\\correct\\go.exe");
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].args, ["go"]);
  assert.ok(seen.slice(1).every(call => call.options.env.GOTOOLCHAIN === "local"));
  assert.ok(seen.slice(1).every(call => call.options.env.GOPROXY === "off"));
  assert.throws(() => resolvePinnedGo("1.27.5", { PATH: "synthetic" }, spawn, "win32"), /Go version mismatch/);
});

test("Discover only real owner modules; include newly added WLT without placeholders", () => {
  const root = mkdtempSync(join(tmpdir(), "bthwani-go-verify-"));
  try {
    assert.throws(() => discoverModules(root), /No Go backend/);
    const backend = join(root, "services", "dsh", "backend");
    mkdirSync(backend, { recursive: true });
    writeFileSync(join(backend, "go.mod"), "module example.com/dsh\\n");
    writeFileSync(join(backend, "main.go"), "package main\\n");
    assert.deepEqual(discoverModules(root), ["dsh"]);
    assert.deepEqual(discoverModules(root, "dsh"), ["dsh"]);
    assert.throws(() => discoverModules(root, "identity"), /not found/);
    assert.deepEqual(listGoFiles(backend), [join(backend, "main.go")]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Go file listing preserves JS default code-unit path ordering", () => {
  const root = mkdtempSync(join(tmpdir(), "bthwani-go-sort-"));
  try {
    for (const name of ["file2.go", "a.go", "file10.go", "Z.go"]) {
      writeFileSync(join(root, name), "package example\\n");
    }
    writeFileSync(join(root, "ignore.ts"), "ignored");
    assert.deepEqual(listGoFiles(root), [
      join(root, "Z.go"),
      join(root, "a.go"),
      join(root, "file10.go"),
      join(root, "file2.go"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
