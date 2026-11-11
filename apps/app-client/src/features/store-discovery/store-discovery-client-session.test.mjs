import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientOrderSessionKey } from "../orders/order-session-scope.ts";

const source = readFileSync(new URL("./store-discovery-client.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-discovery-client.ts", source, ts.ScriptTarget.Latest, true);
const declarations = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    declarations.set(node.name.text, node.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);

function actualClientCalls(runtime) {
  const names = ["tokenForMultiStoreSession", "quoteMultiStoreChildCheckout", "createMultiStoreCheckout", "readOwnMultiStoreCheckout"];
  const original = names.map((name) => {
    assert.ok(declarations.has(name), `missing production DSH boundary: ${name}`);
    return declarations.get(name).replace(/^export\s+/u, "");
  }).join("\n");
  const js = ts.transpileModule(`${original}\n({${names.join(", ")}})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(js, { clientOrderSessionKey, ...runtime });
}

function actor(subject = "client-a", sessionId = "session-1") {
  return { kind: "authenticated", identity: { subject, sessionId, role: "client" } };
}

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

const operations = {
  quote: (client, sessionKey) => client.quoteMultiStoreChildCheckout({ cartId: "cart-a", storeId: "store-a", addressId: "", fulfillmentMode: "CUSTOMER_PICKUP" }, 1, sessionKey),
  create: (client, sessionKey) => client.createMultiStoreCheckout({ id: "checkout-a", children: [] }, "idem-a", "corr-a", sessionKey),
  read: (client, sessionKey) => client.readOwnMultiStoreCheckout("checkout-a", sessionKey),
};

function fixture() {
  let identity = actor();
  const sessionKey = clientOrderSessionKey(identity);
  const tokenGate = deferred();
  const tokenStarted = deferred();
  const calls = [];
  const dsh = {
    quoteCheckout: (...args) => { calls.push(["quote", args]); return { quote: { totalAmountMinor: 200 } }; },
    createMultiStoreCheckout: (...args) => { calls.push(["create", args]); return { checkout: { state: "COMPLETE" } }; },
    readMultiStoreCheckout: (...args) => { calls.push(["read", args]); return { checkout: { state: "COMPLETE" } }; },
  };
  const api = actualClientCalls({
    currentIdentityState: () => identity,
    getUsableIdentityAccessToken: () => { tokenStarted.resolve(); return tokenGate.promise; },
    client: () => dsh,
  });
  return {
    api, sessionKey, calls, tokenStarted, tokenGate,
    renew: () => { identity = actor("client-a", "session-2"); },
    switchActor: () => { identity = actor("client-b", "session-2"); },
  };
}

for (const [name, operation] of Object.entries(operations)) {
  for (const change of ["renew", "switchActor"]) {
    test(`multi-Store ${name} refuses to dispatch after ${change} while obtaining Identity token`, async () => {
      const x = fixture();
      const result = operation(x.api, x.sessionKey);
      await x.tokenStarted.promise;
      x[change]();
      x.tokenGate.resolve("token-from-a-different-session");
      await assert.rejects(result, /CLIENT_STORE_SESSION_CHANGED/u);
      assert.equal(x.calls.length, 0, "no cross-session DSH read/quote/payment/order dispatch");
    });
  }

  test(`multi-Store ${name} uses the acquired token only for the original valid session`, async () => {
    const x = fixture();
    const result = operation(x.api, x.sessionKey);
    await x.tokenStarted.promise;
    x.tokenGate.resolve("client-a-token");
    await result;
    assert.equal(x.calls.length, 1);
    assert.equal(x.calls[0][0], name);
    assert.equal(x.calls[0][1][0], "client-a-token");
  });

  test(`multi-Store ${name} refuses a stale session before token acquisition`, async () => {
    const x = fixture();
    x.renew();
    await assert.rejects(operation(x.api, x.sessionKey), /CLIENT_STORE_SESSION_CHANGED/u);
    assert.equal(x.calls.length, 0);
  });
}

test("checkout screen forwards its exact Identity session key into every DSH quote/create/recovery call", () => {
  const checkout = readFileSync(new URL("../multi-store-checkout/multi-store-checkout.tsx", import.meta.url), "utf8");
  assert.match(checkout, /quoteMultiStoreChildCheckout\([^;]*cart\.version, sessionKey\)/u);
  assert.match(checkout, /createMultiStoreCheckout\(request, attempt\.idempotencyKey, attempt\.correlationID, sessionKey\)/u);
  assert.match(checkout, /createMultiStoreCheckout\(attempt\.request, attempt\.idempotencyKey, attempt\.correlationID, sessionKey\)/u);
  assert.match(checkout, /readOwnMultiStoreCheckout\(attempt\.request\.id, sessionKey\)/u);
  assert.match(checkout, /readOwnMultiStoreCheckout\(attempt\.checkoutID, sessionKey\)/u);
  assert.match(checkout, /resolvePendingMultiStoreAttempt\(attempt, isCurrent, sessionKey\)/u);
});
