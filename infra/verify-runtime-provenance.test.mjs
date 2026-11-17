import assert from "node:assert/strict";
import test from "node:test";
import { evaluateService, main, readService } from "./verify-runtime-provenance.mjs";

const sha = "a".repeat(40);
const good = {
  owner: "dsh", service: "dsh", project: "bthwani-refoundation",
  running: true, health: "healthy",
  imageId: "sha256:123", containerImageId: "sha256:123",
  revisionPrimary: sha, revisionFallback: sha,
  committedAncestor: true, ownerChanges: [], localOwnerChanges: [],
};

test("accept source parity only when the running isolated owner has health, matching image, and clean unchanged source", () => {
  assert.deepEqual(evaluateService(good), { revision: sha, errors: [], passed: true });
});

test("reject a committed but stale Go or contract image", () => {
  const result = evaluateService({ ...good, ownerChanges: ["services/dsh/backend/cmd/dsh/main.go"] });
  assert.equal(result.passed, false);
  assert.ok(result.errors.includes("owner source changed since image build"));
});

test("reject missing and contradictory source revision labels", () => {
  assert.equal(evaluateService({ ...good, revisionPrimary: "", revisionFallback: "" }).passed, false);
  assert.ok(evaluateService({ ...good, revisionFallback: "b".repeat(40) })
    .errors.includes("conflicting image source labels"));
});

test("reject a healthy-looking container from another environment or service", () => {
  assert.equal(evaluateService({ ...good, project: "donor" }).passed, false);
  assert.equal(evaluateService({ ...good, service: "identity" }).passed, false);
});

test("reject unproven health, stopped service, and wrong runtime image", () => {
  for (const change of [
    { health: "NOT_CONFIGURED" },
    { running: false },
    { imageId: "sha256:other" },
  ]) assert.equal(evaluateService({ ...good, ...change }).passed, false);
});

test("reject revision outside history and owner-local uncommitted edits", () => {
  assert.equal(evaluateService({ ...good, committedAncestor: false }).passed, false);
  assert.equal(evaluateService({ ...good, localOwnerChanges: ["?? services/dsh/new.go"] }).passed, false);
});

// These tests verify the command/attestation parser. They deliberately do not
// claim that a real Docker runtime or source revision has been attested.
function serviceRecords({
  owner = "dsh", project = "bthwani-refoundation", imageId = "sha256:123",
  revision = sha, fallback = sha, running = "true", health = "healthy",
  sourceDiff = "", localStatus = "", malformed = "",
} = {}) {
  const calls = [];
  const execute = (command, args) => {
    calls.push({ command, args });
    if (command === "docker" && args[2] === "inspect") {
      if (malformed === "container") return "not-a-container-record";
      return [imageId, project, owner, running, health].join("|");
    }
    if (command === "docker" && args[2] === "image" && args[3] === "inspect") {
      if (malformed === "image") return "not-an-image-record";
      return [imageId, revision || "<no value>", fallback || "<no value>"].join("|");
    }
    if (command === "git" && args[0] === "diff") return sourceDiff;
    if (command === "git" && args[0] === "status") return localStatus;
    throw new Error("unexpected verification command");
  };
  return { execute, calls };
}

test("runtime attestation checks actual owner metadata, SHA ancestry and scoped Git queries", () => {
  const fixture = serviceRecords();
  const verified = readService("dsh", "isolated", sha, fixture.execute, () => true);
  assert.deepEqual(verified, { revision: sha, errors: [], passed: true });
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(fixture.calls.filter((c) => c.command === "git").map((c) => c.args), [
    ["diff", "--name-only", sha, sha, "--", "services/dsh"],
    ["status", "--porcelain", "--", "services/dsh"],
  ]);
  assert.ok(fixture.calls.filter((c) => c.command === "docker")
    .every((c) => c.args[0] === "--context" && c.args[1] === "isolated"));
});

test("runtime attestation rejects a changed owner, a dirty checkout and non-ancestor images", () => {
  const changed = serviceRecords({ sourceDiff: "services/dsh/backend/cmd/dsh/main.go" });
  assert.ok(readService("dsh", "isolated", sha, changed.execute, () => true)
    .errors.includes("owner source changed since image build"));
  const dirty = serviceRecords({ owner: "identity", localStatus: " M services/identity/backend/main.go" });
  assert.ok(readService("identity", "isolated", sha, dirty.execute, () => true)
    .errors.includes("owner worktree is not clean"));
  const ancestorRejected = serviceRecords();
  assert.ok(readService("dsh", "isolated", sha, ancestorRejected.execute, () => false)
    .errors.includes("source is not an ancestor of HEAD"));
  assert.equal(ancestorRejected.calls.some((c) => c.command === "git" && c.args[0] === "diff"), false);
});

test("runtime attestation fails closed for missing, conflicting and invalid image revisions", () => {
  for (const revisions of [
    { revision: "", fallback: "" },
    { revision: "unsafe", fallback: "" },
    { revision: sha, fallback: "b".repeat(40) },
  ]) {
    const fixture = serviceRecords(revisions);
    const result = readService("dsh", "isolated", sha, fixture.execute, () => true);
    assert.equal(result.passed, false);
    if (revisions.revision === "unsafe") {
      assert.equal(fixture.calls.some((c) => c.command === "git" && c.args[0] === "diff"), false);
    }
  }
});

test("malformed container and image metadata cannot be treated as a passing runtime", () => {
  for (const malformed of ["container", "image"]) {
    const fixture = serviceRecords({ malformed });
    assert.throws(() => readService("dsh", "isolated", sha, fixture.execute, () => true),
      /unexpected (?:container|image) metadata/);
  }
});

test("runtime command-line refuses unsafe or incomplete Docker context names before execution", () => {
  assert.throws(() => main(["--context"]), /Usage/);
  assert.throws(() => main(["--once"]), /Usage/);
  assert.throws(() => main(["--context", "../unsafe"]), /invalid Docker context/);
  assert.throws(() => main(["--context", "a;whoami"]), /invalid Docker context/);
});
