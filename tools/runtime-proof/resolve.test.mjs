import assert from "node:assert/strict";
import test from "node:test";
import { laneOrder, resolveFromAffected } from "./resolve.mjs";

function configs(entries) {
  return new Map(entries.map(([name, tags]) => [name, { name, tags }]));
}

test("control-only change selects only control runtime lane", () => {
  const result = resolveFromAffected(
    ["control-panel"],
    configs([["control-panel", ["scope:control-panel", "type:app"]]]),
  );
  assert.deepEqual(result.lanes, ["control"]);
  assert.deepEqual(result.targets, ["control-panel:browser-live-proof"]);
  assert.equal(result.needsBrowser, true);
});

test("identity scope selects only identity runtime lane", () => {
  const result = resolveFromAffected(
    ["identity-backend"],
    configs([["identity-backend", ["scope:identity-backend", "type:service"]]]),
  );
  assert.deepEqual(result.lanes, ["identity"]);
  assert.deepEqual(result.targets, ["identity-backend:migration-proof", "identity-backend:runtime-proof"]);
});

test("WLT scopes select WLT proof without unrelated lanes", () => {
  const result = resolveFromAffected(
    ["wlt", "wlt-backend", "wlt-database"],
    configs([
      ["wlt", ["scope:wlt", "type:service"]],
      ["wlt-backend", ["scope:wlt-backend", "type:service"]],
      ["wlt-database", ["scope:wlt-db", "type:database"]],
    ]),
  );
  assert.deepEqual(result.lanes, ["wlt"]);
  assert.deepEqual(result.targets, ["wlt-backend:financial-invariants"]);
});

test("Nx-expanded cross-service cone composes lanes once", () => {
  const result = resolveFromAffected(
    ["wlt", "dsh-backend", "dsh-database"],
    configs([
      ["wlt", ["scope:wlt", "type:service"]],
      ["dsh-backend", ["scope:dsh-backend", "type:service"]],
      ["dsh-database", ["scope:dsh-db", "type:database"]],
    ]),
  );
  assert.deepEqual(result.lanes, ["wlt", "dsh"]);
  assert.deepEqual(result.targets, [
    "wlt-backend:financial-invariants",
    "dsh-backend:baseline-proof",
    "dsh-backend:runtime-proof",
  ]);
});

test("infra scope escalates explicitly to full", () => {
  const result = resolveFromAffected(
    ["infra"],
    configs([["infra", ["scope:infra", "type:infra"]]]),
  );
  assert.deepEqual(result.lanes, laneOrder);
  assert.match(result.reasons[0], /^full-escalation:/);
});

test("runtime routing owner escalates its own implementation changes to full", () => {
  const result = resolveFromAffected(
    ["runtime-proof-routing"],
    configs([["runtime-proof-routing", ["scope:runtime-proof-routing", "type:tool"]]]),
  );
  assert.deepEqual(result.lanes, laneOrder);
  assert.match(result.reasons[0], /^full-escalation:/);
});

test("static-only tooling can remain runtime-unaffected", () => {
  const result = resolveFromAffected(
    ["workspace-tooling"],
    configs([["workspace-tooling", ["scope:workspace-tooling", "type:tool"]]]),
  );
  assert.equal(result.run, false);
  assert.deepEqual(result.lanes, []);
});

test("runtime:none explicitly suppresses runtime for a classified helper", () => {
  const result = resolveFromAffected(
    ["identity-generated-helper"],
    configs([["identity-generated-helper", ["scope:identity-helper", "type:library", "runtime:none"]]]),
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
