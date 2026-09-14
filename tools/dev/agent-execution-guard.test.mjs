import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluate,
  pathAllowedByScopes,
  readOnlyShell,
  repoRoot,
  statePath,
} from "./agent-execution-guard.mjs";

const fingerprint = Object.freeze({
  repository: "bthwani2-boop/samrim",
  branch: "feature",
  head: "a".repeat(40),
  agentsBlob: "b".repeat(40),
  knowledgeBlob: "c".repeat(40),
  governanceSha: "d".repeat(40),
});

function state(extra = {}) {
  return {
    schema: 2,
    ownerSessionId: "session-a",
    bootstrapPass: true,
    mutationReady: false,
    proofReady: false,
    closureReady: false,
    bootstrapFingerprint: fingerprint,
    readyFingerprint: null,
    candidateFingerprint: null,
    readyHead: null,
    proofHead: null,
    closedHead: null,
    mutationScope: ["tools/dev"],
    runtimeRequired: false,
    ...extra,
  };
}

test("scope matching rejects sibling prefix and repository escape", () => {
  assert.equal(pathAllowedByScopes(path.join(repoRoot, "tools/dev/a.mjs"), ["tools/dev"]), true);
  assert.equal(pathAllowedByScopes(path.join(repoRoot, "tools/development/a.mjs"), ["tools/dev"]), false);
  assert.equal(pathAllowedByScopes(path.resolve(repoRoot, "../escape.txt"), ["tools/dev"]), false);
});

test("scope matching rejects symlink or junction escape", (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guard-outside-"));
  const link = path.join(repoRoot, "tools", "dev", "guard-link-test");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    fs.rmSync(outside, { recursive: true, force: true });
    t.skip(`link unavailable: ${error.message}`);
    return;
  }
  try {
    assert.equal(pathAllowedByScopes(path.join(link, "payload.txt"), ["tools/dev"]), false);
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("read-only shell fast path rejects composition", () => {
  assert.equal(readOnlyShell("git status --short"), true);
  assert.equal(readOnlyShell("Get-Content AGENTS.md"), true);
  assert.equal(readOnlyShell("node tools/dev/agent-execution-guard.mjs status"), true);
  assert.equal(readOnlyShell("git status | cat"), false);
  assert.equal(readOnlyShell("git status > out.txt"), false);
});

test("read discovery remains available before bootstrap", () => {
  assert.equal(evaluate({ name: "Read", input: { file_path: "AGENTS.md" }, state: null, current: fingerprint, session: null }).decision, "allow");
});

test("direct guard lifecycle is internal and available without pnpm aliases", () => {
  assert.equal(evaluate({ name: "Bash", input: { command: "node tools/dev/agent-execution-guard.mjs bootstrap" }, state: null, current: fingerprint, session: null }).decision, "allow");
  assert.equal(evaluate({ name: "Bash", input: { command: "node tools/dev/agent-execution-guard.mjs status" }, state: null, current: fingerprint, session: null }).decision, "allow");
  assert.equal(evaluate({ name: "Bash", input: { command: "node tools/dev/agent-execution-guard.mjs ready --scope tools/dev" }, state: state(), current: fingerprint, session: "session-a" }).decision, "allow");
  assert.equal(evaluate({ name: "Bash", input: { command: "node tools/dev/agent-execution-guard.mjs verify" }, state: state(), current: fingerprint, session: "session-b" }).decision, "deny");
});

test("identified owner makes missing or foreign session fail closed", () => {
  const ready = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "tools/dev/x.mjs") }, state: ready, current: fingerprint, session: null }).decision, "deny");
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "tools/dev/x.mjs") }, state: ready, current: fingerprint, session: "session-b" }).decision, "deny");
});

test("guard state is machine-owned", () => {
  const ready = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "Write", input: { file_path: statePath }, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
});

test("ready mutation is constrained to exact baseline and declared scope", () => {
  const ready = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "tools/dev/x.mjs") }, state: ready, current: fingerprint, session: "session-a" }).decision, "allow");
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "apps/x.ts") }, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "Edit", input: { file_path: path.join(repoRoot, "tools/dev/x.mjs") }, state: ready, current: { ...fingerprint, head: "f".repeat(40) }, session: "session-a" }).decision, "deny");
});

test("raw promotion is denied and safe push requires exact closure", () => {
  const ready = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "Bash", input: { command: "git push origin HEAD" }, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm safe:push" }, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
  const closed = state({
    mutationReady: true,
    proofReady: true,
    closureReady: true,
    readyHead: fingerprint.head,
    readyFingerprint: fingerprint,
    candidateFingerprint: fingerprint,
    proofHead: fingerprint.head,
    closedHead: fingerprint.head,
  });
  assert.equal(evaluate({ name: "Bash", input: { command: "git push origin HEAD" }, state: closed, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm safe:push" }, state: closed, current: fingerprint, session: "session-a" }).decision, "allow");
});

test("free-form shell is denied while repository-owned mutators remain explicit", () => {
  const ready = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "Bash", input: { command: "node arbitrary-mutator.mjs" }, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm theme:generate" }, state: ready, current: fingerprint, session: "session-a" }).decision, "allow");
  assert.equal(evaluate({ name: "Bash", input: { command: "pnpm theme:generate && touch x" }, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
});

test("remote repository mutation, opaque commit and unknown tools fail closed", () => {
  const ready = state({ mutationReady: true, readyHead: fingerprint.head, readyFingerprint: fingerprint });
  assert.equal(evaluate({ name: "GitHub.update_file", input: { path: "tools/dev/x.mjs" }, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "create_commit", input: {}, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
  assert.equal(evaluate({ name: "mystery_capability", input: {}, state: ready, current: fingerprint, session: "session-a" }).decision, "deny");
});
