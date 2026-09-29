import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "tools", "dev", "check-go-format.mjs");
const scratchRoot = path.join(root, "coverage", "sonar-check-go-format-tests");

function runCheck(argument) {
  return spawnSync(process.execPath, [script, argument], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
}

function makeRepoScratch(prefix) {
  fs.mkdirSync(scratchRoot, { recursive: true });
  return fs.mkdtempSync(path.join(scratchRoot, `${prefix}-`));
}

test("accepts a real directory that resolves inside the repository", () => {
  const directory = makeRepoScratch("valid");
  try {
    fs.writeFileSync(path.join(directory, "sample.go"), "package sample\n", "utf8");
    const result = runCheck(path.relative(root, directory));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /GO_FORMAT_CHECK=PASS/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a lexical path escape before filesystem traversal", () => {
  const result = runCheck(path.join("..", "outside-repository"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /project root must be inside repository/);
});

test("rejects a missing directory inside the repository", () => {
  const missing = path.join(
    "coverage",
    `sonar-missing-go-root-${process.pid}-${Date.now()}`,
  );
  const result = runCheck(missing);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /project root does not exist/);
});

test("rejects a path whose real target escapes the repository", (t) => {
  fs.mkdirSync(scratchRoot, { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "samrim-go-format-outside-"));
  const link = path.join(
    scratchRoot,
    `escape-${process.pid}-${Date.now()}`,
  );

  try {
    try {
      fs.symlinkSync(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      t.skip(`symlink/junction unavailable on this host: ${error.message}`);
      return;
    }

    const result = runCheck(path.relative(root, link));
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /project root must resolve inside repository/);
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});