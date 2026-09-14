import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const structurePath = path.join(root, "tools/dev/verify-repository-structure.mjs");
const knowledgePath = path.join(root, "tools/dev/verify-agent-knowledge-contract.mjs");

test("service-to-app URL detection accepts only repository tokens", () => {
  const source = fs.readFileSync(structurePath, "utf8");
  const start = source.indexOf("const githubAppPrefixes = [");
  const end = source.indexOf("\nfor (const item of tracked.filter", start);
  assert.notEqual(start, -1, "repository URL matcher must remain source-visible");
  assert.notEqual(end, -1, "repository URL matcher boundary must remain source-visible");

  const sandbox = {};
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.hasGithubAppReference = hasGithubAppReference;`, sandbox);
  const hasReference = sandbox.hasGithubAppReference;

  for (const value of [
    "github.com/bthwani2-boop/samrim/apps/app-client",
    "https://github.com/bthwani2-boop/samrim/apps/app-client",
    "http://github.com/bthwani2-boop/samrim/apps/app-client",
    '"https://github.com/bthwani2-boop/samrim/apps/app-client"',
  ]) assert.equal(hasReference(value), true, `expected repository reference: ${value}`);

  for (const value of [
    "https://evil.example/github.com/bthwani2-boop/samrim/apps/app-client",
    "prefixhttps://github.com/bthwani2-boop/samrim/apps/app-client",
    "https://github.com/bthwani2-boop/samrim/apps",
  ]) assert.equal(hasReference(value), false, `unexpected repository reference: ${value}`);
});

test("repository verifiers retain safe single-read behavior and pass", () => {
  const knowledge = fs.readFileSync(knowledgePath, "utf8");
  assert.match(knowledge, /fs\.readFileSync\(p, "utf8"\)/);
  assert.doesNotMatch(knowledge, /fs\.existsSync\(p\).*fs\.statSync\(p\).*fs\.readFileSync\(p, "utf8"\)/s);
  execFileSync(process.execPath, [structurePath], { cwd: root, stdio: "pipe" });
  execFileSync(process.execPath, [knowledgePath], { cwd: root, stdio: "pipe" });
});
