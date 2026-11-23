import assert from "node:assert/strict";
import test from "node:test";
import { differingKeys, selectOwners, assertSameHashes, isolatedTestEnv } from "./reconcile-owner-runtime.mjs";

test("runtime reconciliation never rebuilds unaffected owners", () => {
  assert.deepEqual(selectOwners({ candidates: [], activateCaptain: false, currentCaptain: true }), []);
  assert.deepEqual(selectOwners({ candidates: ["dsh"], activateCaptain: false, currentCaptain: true }), ["dsh"]);
  assert.deepEqual(selectOwners({ candidates: ["identity"], activateCaptain: false, currentCaptain: false }), ["identity"]);
  assert.deepEqual(selectOwners({ candidates: ["wlt"], activateCaptain: false, currentCaptain: true }), ["wlt"]);
});
test("explicit Captain activation replaces both contract peers and never implicitly activates", () => {
  assert.deepEqual(selectOwners({ candidates: [], activateCaptain: true, currentCaptain: false }), ["dsh","identity"]);
  assert.deepEqual(selectOwners({ candidates: ["wlt"], activateCaptain: true, currentCaptain: false }), ["dsh","identity","wlt"]);
  assert.deepEqual(selectOwners({ candidates: [], activateCaptain: true, currentCaptain: true }), []);
});
test("configuration comparison detects differing or absent keys without leaking their values", () => {
  assert.deepEqual(differingKeys({ A: "secret-old", B: "unchanged" }, { A: "secret-new", B: "unchanged", C: "extra" }), ["A","C"]);
  assert.doesNotThrow(() => assertSameHashes({ identity: "same", dsh: "unchanged" }, { dsh: "unchanged", identity: "same" }));
  assert.throws(() => assertSameHashes({ identity: "secret-old" }, { identity: "secret-new" }), e => !e.message.includes("secret-") && /refusing replacement/.test(e.message));
});

test("owner tests cannot inherit live database or synthetic activation configuration", () => {
  assert.deepEqual(isolatedTestEnv({ PATH:"toolchain", BTHWANI_ISOLATED_TEST_MODE:"true", BTHWANI_CAPTAIN_TEST_DATABASE_URL:"private", REF_POSTGRES_PASSWORD:"private", PGHOST:"private", DATABASE_URL:"private", GOTOOLCHAIN:"auto" }), {PATH:"toolchain",GOTOOLCHAIN:"local"});
});
