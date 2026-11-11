import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/full-storefront.tsx"), "utf8");
const begin = source.indexOf("const openMarketRoute = async (path: Href) => {");
const end = source.indexOf("\n  const marketplacePath =", begin);
assert.ok(begin >= 0 && end > begin, "extract the real Storefront navigation callback");
const callbackSource = source.slice(begin, end).replace("async (path: Href)", "async (path)");

function navigationHarness({ savedCityID = "sanaa", selectCity = async () => {} } = {}) {
  const pushes = [];
  const busy = [];
  const errors = [];
  const openingMarketRef = { current: false };
  const scope = {
    selectedCityID: "sanaa",
    savedCityID,
    openingMarket: false,
    openingMarketRef,
    readID: { current: 1 },
    selectCity,
    router: { push: path => pushes.push(path) },
    setOpeningMarket: value => busy.push(value),
    setMarketCityError: value => errors.push(value),
  };
  const navigate = runInNewContext(callbackSource + "\nopenMarketRoute", scope);
  return { navigate, pushes, busy, errors, openingMarketRef };
}

test("two immediate same-city taps cannot push the Marketplace route twice", async () => {
  const h = navigationHarness();
  await Promise.all([h.navigate("/cart"), h.navigate("/cart")]);
  assert.deepEqual(h.pushes, ["/cart"]);
  assert.equal(h.openingMarketRef.current, true, "hold the lock until the navigation focus changes");
});

test("a pending city change blocks duplicate navigation and can be retried after a failure", async () => {
  let finish;
  let fail = true;
  const h = navigationHarness({
    savedCityID: "aden",
    selectCity: () => fail
      ? Promise.reject(new Error("city not available"))
      : new Promise(resolve => { finish = resolve; }),
  });
  await h.navigate("/cart");
  assert.deepEqual(h.pushes, []);
  assert.equal(h.openingMarketRef.current, false, "failed city selection releases the lock");
  fail = false;
  const first = h.navigate("/cart");
  const duplicate = h.navigate("/cart");
  assert.equal(typeof finish, "function");
  finish();
  await Promise.all([first, duplicate]);
  assert.deepEqual(h.pushes, ["/cart"]);
});
