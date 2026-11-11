import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

// This is an app-level boundary proof: Discovery favorites and Catalog-to-Cart
// mutations use one Identity guard, while DSH remains the cart's only writer.
const functions = new Map();
for (const relativePath of [
  "../src/features/store-discovery/store-discovery-client.ts",
  "../src/features/cart-checkout/cart-client.ts",
  "../src/features/access/client-request-token.ts",
]) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
function productionFunction(name, environment) {
  const declaration = functions.get(name);
  assert.ok(declaration, `${name} must come from the correct authored DSH client owner`);
  const ownerHelpers = ["assertClientActor", "tokenForClientActor"].map((helperName) => {
    const helper = functions.get(helperName);
    assert.ok(helper, `client must implement actor-bound ${helperName}`);
    return helper;
  }).join("\n");
  const code = ts.transpileModule(`${ownerHelpers}\n${declaration}; ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(code, { exports: {}, ...environment });
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("favorite Store must not write under B when actor A's token resolves after A-to-B switch", async () => {
  let actor = "actor-A", writes = 0;
  const token = deferred();
  const run = productionFunction("setFavoriteStore", {
    getUsableIdentityAccessToken: () => token.promise,
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }),
    client: () => ({ addClientFavoriteStore: async () => { writes += 1; return { isFavorite: true }; } }),
  });
  const pending = run("store-A", true, "actor-A");
  actor = "actor-B";
  token.resolve("token-B");
  await assert.rejects(pending, /CLIENT_STORE_SESSION_CHANGED/);
  assert.equal(writes, 0);
});

test("favorite offer must not write if A loses session while identity token refresh is pending", async () => {
  let actor = "actor-A", writes = 0;
  const token = deferred();
  const run = productionFunction("setFavoriteStoreOffer", {
    getUsableIdentityAccessToken: () => token.promise,
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }),
    client: () => ({ addClientFavoriteStoreOffer: async () => { writes += 1; return { isFavorite: true }; } }),
  });
  const pending = run("offer-A", true, "actor-A");
  actor = "";
  token.resolve("token-A");
  await assert.rejects(pending, /CLIENT_STORE_SESSION_CHANGED/);
  assert.equal(writes, 0);
});

test("cart read finishing after A-to-B switch cannot trigger A-context upsert", async () => {
  let actor = "actor-A", writes = 0;
  const cartRead = deferred(), readStarted = deferred();
  const run = productionFunction("addCatalogOfferToCart", {
    getUsableIdentityAccessToken: async () => "token-A",
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }),
    client: () => ({
      readOpenCart: () => { readStarted.resolve(); return cartRead.promise; },
      upsertCartLine: async () => { writes += 1; return { cart: { version: 5 } }; },
    }),
  });
  const pending = run("store-A", { offerId: "offer-A" }, 1, [], "actor-A");
  await readStarted.promise;
  actor = "actor-B";
  cartRead.resolve({ cart: { version: 4 } });
  await assert.rejects(pending, /CLIENT_STORE_SESSION_CHANGED/);
  assert.equal(writes, 0);
});

test("cart 404 recovery after actor switch may not create a cart for wrong actor", async () => {
  let actor = "actor-A", writes = 0;
  const cartRead = deferred(), readStarted = deferred();
  const run = productionFunction("addCatalogOfferToCart", {
    getUsableIdentityAccessToken: async () => "token-A",
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }),
    client: () => ({
      readOpenCart: () => { readStarted.resolve(); return cartRead.promise; },
      upsertCartLine: async () => { writes += 1; return { cart: {} }; },
    }),
  });
  const pending = run("store-A", { offerId: "offer-A" }, 1, [], "actor-A");
  await readStarted.promise;
  actor = "actor-B";
  cartRead.reject({ kind: "http", status: 404 });
  await assert.rejects(pending, /CLIENT_STORE_SESSION_CHANGED/);
  assert.equal(writes, 0);
});

test("same actor can add Store offer after reading canonical cart version", async () => {
  const writes = [];
  const run = productionFunction("addCatalogOfferToCart", {
    getUsableIdentityAccessToken: async () => "token-A",
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: "actor-A" } }),
    client: () => ({
      readOpenCart: async () => ({ cart: { version: 3 } }),
      upsertCartLine: async (token, input, version) => {
        writes.push({ token, input, version });
        return { cart: { version: 4 } };
      },
    }),
  });
  const result = await run("store-A", { offerId: "offer-A" }, 2, [], "actor-A");
  assert.equal(result.cart.version, 4);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].version, 3);
  assert.equal(writes[0].input.storeId, "store-A");
});

test("same actor favorite remains functional", async () => {
  const run = productionFunction("setFavoriteStore", {
    getUsableIdentityAccessToken: async () => "token-A",
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: "actor-A" } }),
    client: () => ({ removeClientFavoriteStore: async () => ({ isFavorite: false }) }),
  });
  assert.equal(await run("store-A", false, "actor-A"), false);
});

const simpleOffer = { storeId: "store-A", offerId: "offer-A", quantityPolicy: "DISCRETE",
  modifierGroups: [], availability: true, quantityMinBaseUnits: 1,
  quantityMaxBaseUnits: 9, quantityStepBaseUnits: 1 };

test("home quantity adjustment cannot write with B's token after actor A loses the session", async () => {
  let actor = "actor-A", writes = 0;
  const token = deferred();
  const run = productionFunction("adjustSimpleOfferQuantity", {
    getUsableIdentityAccessToken: () => token.promise,
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }),
    client: () => ({
      readOpenCart: async () => ({ cart: { lines: [], version: 2 } }),
      upsertCartLine: async () => { writes += 1; return { cart: {} }; },
    }),
  });
  const pending = run("store-A", simpleOffer, 1, "actor-A");
  actor = "actor-B";
  token.resolve("token-B");
  await assert.rejects(pending, /CLIENT_STORE_SESSION_CHANGED/);
  assert.equal(writes, 0);
});

test("home quantity mutation does not write if old actor A cart read finishes in B", async () => {
  let actor = "actor-A", writes = 0;
  const readStarted = deferred(), cartRead = deferred();
  const run = productionFunction("adjustSimpleOfferQuantity", {
    getUsableIdentityAccessToken: async () => "token-A",
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }),
    client: () => ({
      readOpenCart: () => { readStarted.resolve(); return cartRead.promise; },
      upsertCartLine: async () => { writes += 1; return { cart: {} }; },
      removeCartLine: async () => { writes += 1; return { cart: {} }; },
    }),
  });
  const pending = run("store-A", simpleOffer, 1, "actor-A");
  await readStarted.promise;
  actor = "actor-B";
  cartRead.resolve({ cart: { version: 2, lines: [{ storeOfferId: "offer-A", quantityBaseUnits: 2 }] } });
  await assert.rejects(pending, /CLIENT_STORE_SESSION_CHANGED/);
  assert.equal(writes, 0);
});

test("same actor home quantity increase uses canonical cart version", async () => {
  const writes = [];
  const run = productionFunction("adjustSimpleOfferQuantity", {
    getUsableIdentityAccessToken: async () => "token-A",
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: "actor-A" } }),
    client: () => ({
      readOpenCart: async () => ({ cart: { version: 8, lines: [{ storeOfferId: "offer-A", quantityBaseUnits: 2 }] } }),
      upsertCartLine: async (token, line, version) => {
        writes.push({ token, line, version });
        return { cart: { version: 9 } };
      },
    }),
  });
  const result = await run("store-A", simpleOffer, 1, "actor-A");
  assert.equal(result.cart.version, 9);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].version, 8);
  assert.equal(writes[0].line.quantityBaseUnits, 3);
});

test("old actor A cannot remove a cart line after switching to B during cart read", async () => {
  let actor = "actor-A", removes = 0, upserts = 0;
  const started = deferred(), pendingCart = deferred();
  const run = productionFunction("adjustSimpleOfferQuantity", {
    getUsableIdentityAccessToken: async () => "token-A",
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }),
    client: () => ({
      readOpenCart: () => { started.resolve(); return pendingCart.promise; },
      removeCartLine: async () => { removes += 1; return { cart: {} }; },
      upsertCartLine: async () => { upserts += 1; return { cart: {} }; },
    }),
  });
  const oldRemove = run("store-A", simpleOffer, -1, "actor-A");
  await started.promise;
  actor = "actor-B";
  pendingCart.resolve({ cart: {
    version: 3, lines: [{ id: "line-A", storeOfferId: "offer-A", quantityBaseUnits: 1 }],
  } });
  await assert.rejects(oldRemove, /CLIENT_STORE_SESSION_CHANGED/);
  assert.equal(removes, 0, "the old actor may not remove B's line");
  assert.equal(upserts, 0);
});

test("same actor may remove an offer at minimum quantity using the owner cart version", async () => {
  const removals = [];
  const run = productionFunction("adjustSimpleOfferQuantity", {
    getUsableIdentityAccessToken: async () => "token-A",
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: "actor-A" } }),
    client: () => ({
      readOpenCart: async () => ({ cart: {
        version: 7, lines: [{ id: "line-A", storeOfferId: "offer-A", quantityBaseUnits: 1 }],
      } }),
      removeCartLine: async (accessToken, lineID, version) => {
        removals.push({ accessToken, lineID, version });
        return { cart: { version: 8, lines: [] } };
      },
      upsertCartLine: () => { throw new Error("at minimum, remove rather than upsert"); },
    }),
  });
  const result = await run("store-A", simpleOffer, -1, "actor-A");
  assert.equal(result.cart.version, 8);
  assert.equal(removals.length, 1);
  assert.equal(removals[0].lineID, "line-A");
  assert.equal(removals[0].version, 7);
  assert.equal(removals[0].accessToken, "token-A");
});

// Guard the structural refoundation, not just the current visual route:
 // DSH stays the only business writer; Discovery must not regain cart/Order commands.
test("Store discovery cannot become a second Cart/checkout API owner", async () => {
  const discovery = readFileSync(new URL("../src/features/store-discovery/store-discovery-client.ts", import.meta.url), "utf8");
  const cart = readFileSync(new URL("../src/features/cart-checkout/cart-client.ts", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../src/features/multi-store-checkout/multi-store-checkout.tsx", import.meta.url), "utf8");
  for (const name of ["readOwnStoreCart", "addCatalogOfferToCart", "adjustSimpleOfferQuantity",
    "listOwnOpenCarts", "quoteMultiStoreChildCheckout", "createMultiStoreCheckout", "readOwnMultiStoreCheckout"]) {
    assert.ok(!discovery.includes(`export async function ${name}(`), `Discovery must not own ${name}`);
    assert.ok(cart.includes(`export async function ${name}(`), `Cart owner must keep ${name}`);
  }
  assert.ok(cart.includes("export async function readCartForPreview("));
  assert.ok(screen.includes('from "../cart-checkout/cart-client"'));
  assert.ok(!screen.includes("createDshMobileClient("), "checkout screen cannot recreate an independent DSH transport");
  assert.ok(!discovery.includes("export { listOwnDeliveryAddresses }"), "addresses must keep their location owner");
});

test("multi-Store preview reads the canonical DSH Cart with the original acquired token", async () => {
  const called = [];
  const read = productionFunction("readCartForPreview", {
    client: () => ({ readOpenCart: async (...args) => {
      called.push(args);
      return { cart: { id: "cart-a", version: 2 } };
    } }),
  });
  const cart = await read("captured-client-token", "store-a");
  assert.equal(cart.id, "cart-a");
  assert.equal(cart.version, 2);
  assert.equal(called.length, 1);
  assert.equal(called[0][0], "captured-client-token");
  assert.equal(called[0][1], "store-a");
});
