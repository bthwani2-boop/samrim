import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverModules, listGoFiles, parseArgs, parseVersion } from "./check-go.mjs";

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
