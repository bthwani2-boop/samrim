import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isClientOrderScopeCurrent } from "../access/client-session-scope.ts";

const source = readFileSync(new URL("./order-detail.tsx", import.meta.url), "utf8");

function callbackSource(name) {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(start, -1, `missing ${name} callback`);
  const end = source.indexOf("\n  const ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

test("proof, rating, cancellation reads revalidate the live route, not only the actor", () => {
  assert.match(source, /const requestedOrderIDRef = useRef\(orderId\);/);
  assert.match(source, /requestedOrderIDRef\.current = orderId;/);
  for (const name of ["refreshDeliveryProof", "refreshRating"]) {
    const callback = callbackSource(name);
    assert.match(callback, /hasCurrentOrderScope\(actorID, orderId\)/, `${name} must reject a late result after route reuse`);
  }
  assert.match(callbackSource("readCancellationReview"), /hasCurrentOrderScope\(actorID, requestedOrderID\)/);
});

test("delayed reads from order A cannot populate order B when a route reuses one component", async () => {
  const route = { actorID: "client-a", orderID: "order-a" };
  const applied = [];
  function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  }
  const a = ["proof", "rating", "cancellation"].map((type) => {
    const pending = deferred();
    const operation = pending.promise.then((value) => {
      if (isClientOrderScopeCurrent("client-a", "order-a", route.actorID, route.orderID)) {
        applied.push({ type, value });
      }
    });
    return { pending, operation };
  });
  route.orderID = "order-b";
  a.forEach(({ pending }, index) => { pending.resolve(`order-a-result-${index}`); });
  await Promise.all(a.map(({ operation }) => operation));
  assert.deepEqual(applied, [], "old order reads must be ignored even when actor is unchanged");
  assert.equal(isClientOrderScopeCurrent("client-a", "order-b", route.actorID, route.orderID), true);
  route.actorID = "client-b";
  assert.equal(isClientOrderScopeCurrent("client-a", "order-b", route.actorID, route.orderID), false);
});

test("token-backed order reads check the current scope before dispatch", () => {
  for (const [name, operation] of [
    ["refreshDeliveryProof", "readClientDeliveryProof"],
    ["refreshRating", "readClientOrderRating"],
    ["load", "readOrder"],
  ]) {
    const body = callbackSource(name);
    const tokenIndex = body.indexOf("const token = await getUsableIdentityAccessToken();");
    const readIndex = body.indexOf(`createClientDsh().${operation}(`, tokenIndex);
    assert.ok(tokenIndex >= 0 && readIndex > tokenIndex, `${name} must acquire a token for ${operation}`);
    const beforeRead = body.slice(tokenIndex, readIndex);
    if (name === "load") {
      assert.match(beforeRead,
        /if \(sequence !== loadSequence\.current \|\| !hasCurrentOrderScope\(actorID, orderId\)\) return;/,
        "order loading must reject an outdated sequence or route before requesting data");
    } else {
      assert.match(beforeRead, /if \(!hasCurrentOrderScope\(actorID, orderId\)\) return;/,
        `${name} must reject an outdated actor/order before requesting data`);
    }
  }
});
