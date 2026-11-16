import assert from "node:assert/strict";
import test from "node:test";
import { evaluateService } from "./verify-runtime-provenance.mjs";

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
