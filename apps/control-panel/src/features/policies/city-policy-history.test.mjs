import assert from "node:assert/strict";
import { test } from "node:test";
import { readCityPolicyHistory } from "./city-policy-command.ts";

const endpoint = "/api/policies/cities/sanaa";
const page = { cityId: "sanaa", entries: [{ cityId: "sanaa", version: 4, maxPauseSeconds: 120,
  maxPreparationMinutes: 30, changedByActor: "operator-a", changeReason: "Reviewed limits",
  updatedAt: "2026-11-23T12:00:00Z" }] };

test("Operator audit browser request binds city, actor and cursor to the existing BFF", async t => {
  const spy = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, endpoint + "?history=1&limit=10&beforeVersion=5");
    assert.equal(init.method, "GET");
    assert.equal(init.headers["X-BThwani-Operator"], "operator-a");
    assert.equal(init.cache, "no-store");
    return Response.json(page);
  });
  assert.deepEqual(await readCityPolicyHistory(endpoint, "sanaa", "operator-a", "5"), page);
  await assert.rejects(readCityPolicyHistory("/api/policies/cities/aden", "sanaa", "operator-a"));
  await assert.rejects(readCityPolicyHistory(endpoint, "sanaa", "operator-a", "0"));
  assert.equal(spy.mock.callCount(), 1);
});
test("Operator audit browser rejects cross-city, denied and abandoned responses", async t => {
  const spy = t.mock.method(globalThis, "fetch", async () => Response.json({ ...page, cityId: "aden" }));
  await assert.rejects(readCityPolicyHistory(endpoint, "sanaa", "operator-a"));
  spy.mock.mockImplementation(async () => Response.json({ code: "FORBIDDEN" }, { status: 403 }));
  await assert.rejects(readCityPolicyHistory(endpoint, "sanaa", "operator-a"));
  const controller = new AbortController();
  controller.abort();
  spy.mock.mockImplementation(async () => Response.json(page));
  await assert.rejects(readCityPolicyHistory(endpoint, "sanaa", "operator-a", undefined, controller.signal));
});
