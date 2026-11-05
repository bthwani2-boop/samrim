import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isClientOrderScopeCurrent } from "./order-session-scope.ts";

const source = readFileSync(new URL("./order-detail.tsx", import.meta.url), "utf8");

function callback(name) {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(start, -1, `missing callback ${name}`);
  const end = source.indexOf("\n  const ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("late writes for rating, cancellation, and adjustment cannot overwrite a different order route", () => {
  for (const name of ["submitRating", "requestOperationsCancellation", "cancelOrder", "decideAdjustment"]) {
    const body = callback(name);
    const guards = body.match(/hasCurrentOrderScope\(state\.actorID, state\.order\.id\)/g) ?? [];
    assert.ok(guards.length >= 2, `${name} needs current actor+order guards after both success and failure`);
  }
});

test("same-actor same-order refocus preserves cancellation draft; changed scope clears it", () => {
  assert.match(source, /const cancellationDraftScope = useRef/);
  const start = source.indexOf("const priorDraftScope = cancellationDraftScope.current;");
  const end = source.indexOf("if (!preserveCurrent) {", start);
  assert.ok(start >= 0 && end > start, "scope change must be decided separately from general focus refresh");
  const reset = source.slice(start, end);
  assert.match(reset, /!isClientOrderScopeCurrent\(priorDraftScope.actorID, priorDraftScope.orderID, actorID, orderId\)/);
  for (const stateReset of ["setCancellationReview(null)", "setShowCancellationForm(false)", 'setCancellationReason("")']) {
    assert.ok(reset.includes(stateReset), `changed order/actor must reset ${stateReset}`);
  }
  assert.equal(isClientOrderScopeCurrent("actor-A", "order-A", "actor-A", "order-A"), true);
  assert.equal(isClientOrderScopeCurrent("actor-A", "order-A", "actor-A", "order-B"), false);
  assert.equal(isClientOrderScopeCurrent("actor-A", "order-A", "actor-B", "order-A"), false);
  assert.match(source, /cancellationDraftScope.current = null; setState\(\{ kind: "auth_required" \}\)/);
});

test("a late response for order A is discarded when order B is selected by the same actor", async () => {
  const screen = { actor: "synthetic-client-a", order: "synthetic-order-a", result: null };
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const request = pending.then((result) => {
    if (isClientOrderScopeCurrent("synthetic-client-a", "synthetic-order-a", screen.actor, screen.order)) {
      screen.result = result;
    }
  });
  screen.order = "synthetic-order-b";
  release({ order: "synthetic-order-a" });
  await request;
  assert.equal(screen.result, null);
});
