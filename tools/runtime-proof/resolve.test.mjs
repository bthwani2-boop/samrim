import assert from "node:assert/strict";
import test from "node:test";
import { laneOrder, resolveFromAffected } from "./resolve.mjs";

function configs(entries) {
  return new Map(entries.map(([name, tags]) => [name, { name, tags }]));
}

test("control-only change selects only control runtime lane", () => {
  const result = resolveFromAffected(
    ["control-panel"],
    configs([["control-panel", ["type:app", "runtime:control"]]]),
  );
  assert.deepEqual(result.lanes, ["control"]);
  assert.deepEqual(result.targets, ["control-panel:browser-live-proof"]);
  assert.equal(result.needsBrowser, true);
});

test("WLT change selects WLT proof without unrelated lanes", () => {
  const result = resolveFromAffected(
    ["wlt", "wlt-backend"],
    configs([
      ["wlt", ["type:service", "runtime:wlt"]],
      ["wlt-backend", ["type:service", "runtime:wlt"]],
    ]),
  );
  assert.deepEqual(result.lanes, ["wlt"]);
  assert.deepEqual(result.targets, ["wlt-backend:financial-invariants"]);
});

test("Nx-expanded cross-service cone composes lanes once", () => {
  const result = resolveFromAffected(
    ["wlt", "dsh-backend"],
    configs([
      ["wlt", ["type:service", "runtime:wlt"]],
      ["dsh-backend", ["type:service", "runtime:dsh"]],
    ]),
  );
  assert.deepEqual(result.lanes, ["wlt", "dsh"]);
  assert.deepEqual(result.targets, [
    "wlt-backend:financial-invariants",
    "dsh-backend:baseline-proof",
    "dsh-backend:runtime-proof",
  ]);
});

test("infra or runtime-routing change escalates explicitly to full", () => {
  const result = resolveFromAffected(
    ["infra"],
    configs([["infra", ["type:infra", "runtime:full"]]]),
  );
  assert.deepEqual(result.lanes, laneOrder);
  assert.match(result.reasons[0], /^full-escalation:/);
});

test("static-only tooling can remain runtime-unaffected", () => {
  const result = resolveFromAffected(
    ["workspace-tooling"],
    configs([["workspace-tooling", ["type:tool"]]]),
  );
  assert.equal(result.run, false);
  assert.deepEqual(result.lanes, []);
});

test("runtime-sensitive owner without classification fails closed", () => {
  assert.throws(
    () => resolveFromAffected(
      ["new-service"],
      configs([["new-service", ["type:service"]]]),
    ),
    /lack runtime classification/,
  );
});

test("scheduled/full regression selects every canonical lane", () => {
  const result = resolveFromAffected([], new Map(), true);
  assert.deepEqual(result.lanes, laneOrder);
  assert.equal(result.run, true);
});
