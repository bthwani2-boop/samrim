import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const compiler = require("typescript");
const parser = require("typescript-ast");
const repositoryRoot = resolve(import.meta.dirname, "../..");

test("TypeScript 7 builds while the isolated test AST parser keeps its API", () => {
  assert.match(compiler.version, /^7\./);
  assert.match(parser.version, /^6\./);
  assert.equal(typeof parser.createSourceFile, "function");
  assert.ok(parser.ScriptTarget.Latest > 0);
});

const oldAstImports = /(?:import\s+ts\s+from\s*["']typescript["']|(?:const|let|var)\s+ts\s*=\s*require\(["']typescript["']\))/;

test("no tracked JavaScript AST tests import the native compiler without its parser API", () => {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "*.mjs", "*.cjs", "*.js"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  for (const path of tracked) {
    if (!path.endsWith(".test.mjs") && !path.endsWith(".test.js")) continue;
    const text = readFileSync(resolve(repositoryRoot, path), "utf8");
    assert.doesNotMatch(text, oldAstImports, path);
  }
  assert.match('import ts from "typescript";', oldAstImports, "fixture must detect the deprecated import");
});
