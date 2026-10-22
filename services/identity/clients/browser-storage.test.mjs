import assert from "node:assert/strict";
import test from "node:test";

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("browser identity remains private memory; preferences persist and dev intents recover", async () => {
  const localStorage = fakeStorage();
  const sessionStorage = fakeStorage();
  globalThis.window = { localStorage, sessionStorage };
  globalThis.__DEV__ = true;
  const storage = await import("./browser-storage.ts");
  const identityKey = "bthwani.client.identity.session.v1";
  const cityKey = "samrim.app-client.service-city";
  const checkoutKey = "bthwani.client.checkout.pending";

  await storage.setItemAsync(identityKey, "secret");
  assert.equal(await storage.getItemAsync(identityKey), "secret");
  assert.equal(localStorage.getItem(identityKey), null);
  assert.equal(sessionStorage.getItem(identityKey), null);

  await storage.setItemAsync(cityKey, "city_sanaa");
  assert.equal(localStorage.getItem(cityKey), "city_sanaa");
  assert.equal(await storage.getItemAsync(cityKey), "city_sanaa");

  await storage.setItemAsync(checkoutKey, "test-intent");
  assert.equal(sessionStorage.getItem(checkoutKey), "test-intent");
  await storage.deleteItemAsync(checkoutKey);
  assert.equal(sessionStorage.getItem(checkoutKey), null);

  globalThis.__DEV__ = false;
  await assert.rejects(() => storage.setItemAsync(checkoutKey, "unsafe"), /WEB_TRANSACTION_STORAGE_REQUIRES_SERVER_SESSION/);
  assert.equal(await storage.getItemAsync(cityKey), "city_sanaa");
  await storage.deleteItemAsync(identityKey);
  assert.equal(await storage.getItemAsync(identityKey), null);
});
