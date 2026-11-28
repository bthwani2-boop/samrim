import assert from "node:assert/strict";
import { test } from "node:test";
import { readApprovedCaptainStanding, requestCaptainApplication } from "./captain-standing.ts";
import { DshPublicError, endpoint } from "./client-core.ts";
import { readCurrentCustomerCart, readCurrentCustomerCartMerchandiseEstimate } from "./customer-cart.ts";
import { readMerchantDSHStanding } from "./merchant-standing.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";
import { getPublicStore, publicStorefrontUrl } from "./public-discovery.ts";

function denied(action) {
  assert.throws(action, error => error instanceof DshPublicError &&
    error.status === 0 && error.code === "DSH_ENDPOINT_UNSAFE");
}

test("DSH endpoint accepts only a configured HTTPS or local development origin", () => {
  for (const root of ["https://dsh.example", "https://dsh.example/",
    "http://localhost:3202", "http://127.0.0.1:3202", "http://10.0.2.2:3202"]) {
    assert.equal(endpoint(root, "/v1/public/stores").pathname, "/v1/public/stores");
  }
  assert.equal(endpoint("https://dsh.example", "/v1/operators/captains?status=PENDING&limit=2").search,
    "?status=PENDING&limit=2");
  const selected = encodeURIComponent("تجربة");
  assert.equal(endpoint("https://dsh.example", "/v1/operators/captains/" + selected + "/standing").pathname,
    "/v1/operators/captains/" + selected + "/standing");
});

test("DSH endpoint rejects root URLs with credentials, paths, search, fragments or unsafe schemes", () => {
  for (const baseUrl of [
    "https://operator:password@dsh.example",
    "https://dsh.example/private",
    "https://dsh.example/private/",
    "https://dsh.example/?token=from-old-session",
    "https://dsh.example/#old-owner",
    "http://dsh.example",
    "file:///etc/private",
    "ftp://dsh.example",
  ]) denied(() => endpoint(baseUrl, "/v1/public/stores"));
});

test("DSH endpoint rejects absolute, network-path, backslash and traversal owner paths", () => {
  for (const path of [
    "https://outside.example/v1/public/stores",
    "//outside.example/v1/public/stores",
    "/\\outside.example/v1/public/stores",
    "v1/public/stores",
    "/v1/../admin",
    "/v1/%2e%2e/admin",
    "/v1/.%2e/admin",
    "/v1/./admin",
    "/v1/public/stores#private",
    "/v1/public/stores\n",
  ]) denied(() => endpoint("https://dsh.example", path));
});

test("unsafe DSH root never dispatches an owner authenticated GET or public discovery", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unsafe dispatch");
  });
  await assert.rejects(
    () => privateOwnerRequest("https://dsh.example/?old=secret",
      "/v1/stores/store-a/availability", "token", "GET"),
    { code: "DSH_ENDPOINT_UNSAFE", status: 0 },
  );
  await assert.rejects(
    () => getPublicStore("https://dsh.example/private", "store-a"),
    { code: "DSH_ENDPOINT_UNSAFE", status: 0 },
  );
  assert.equal(calls, 0);
});

test("unsafe path never dispatches even with a valid owner root and bearer", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("not allowed"); });
  await assert.rejects(
    () => privateOwnerRequest("http://localhost:3202",
      "//external.example/private", "token", "GET"),
    { code: "DSH_ENDPOINT_UNSAFE", status: 0 },
  );
  assert.equal(calls, 0);
});

test("raw origin admission never normalizes hidden path or authority syntax", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected transport");
  });
  const bearer = "A".repeat(43);
  const bad = [
    "https://dsh.example/a/..", "https://dsh.example/%2e",
    "https:dsh.example", " https://dsh.example ", "https://@dsh.example",
    "https://dsh.example/?", "https://dsh.example/#", "https://dsh.example/.",
    "http://2130706433:3202", "http://127.1:3202", "https://dsh.example:443",
    "https://dsh.example\\",
  ];
  for (const origin of bad) {
    denied(() => endpoint(origin, "/v1/public/stores"));
    assert.equal(publicStorefrontUrl("store-a", origin), null, origin);
    await assert.rejects(readApprovedCaptainStanding(origin, bearer, "captain", "actor-1"),
      { status: 0, code: "DSH_ENDPOINT_UNSAFE" });
    await assert.rejects(requestCaptainApplication(origin, bearer, "actor-1"),
      { status: 0, code: "DSH_ENDPOINT_UNSAFE" });
    await assert.rejects(readMerchantDSHStanding(origin, bearer),
      { status: 503, code: "OWNER_UNAVAILABLE" });
  }
  let coercions = 0;
  const object = { toString() { coercions++; return "http://127.0.0.1:3202"; } };
  for (const origin of [object, ["http://127.0.0.1:3202"], new URL("https://dsh.example"), 42]) {
    assert.throws(() => endpoint(origin, "/v1/public/stores"), { code: "DSH_ENDPOINT_INVALID" });
    assert.equal(publicStorefrontUrl("store-a", origin), null);
    await assert.rejects(readApprovedCaptainStanding(origin, bearer, "captain", "actor-1"),
      { status: 0, code: "DSH_ENDPOINT_INVALID" });
    await assert.rejects(readMerchantDSHStanding(origin, bearer), { status: 503, code: "OWNER_UNAVAILABLE" });
    await assert.rejects(readCurrentCustomerCart(origin, bearer, "store-a", "actor-1", new AbortController().signal),
      { status: 503, code: "OWNER_UNAVAILABLE" });
  }
  for (const id of [null, undefined, ["store-a"], 123, object]) {
    await assert.rejects(readCurrentCustomerCart("http://127.0.0.1:3202", bearer, id, "actor-1", new AbortController().signal),
      { status: 503, code: "OWNER_UNAVAILABLE" });
  }
  assert.equal(coercions, 0);
  assert.equal(calls, 0);
});

test("canonical origin policy preserves the narrower storefront and cart audiences", async t => {
  const bearer = "A".repeat(43);
  assert.equal(publicStorefrontUrl("store-a", "http://10.0.2.2:3202"), null);
  assert.equal(publicStorefrontUrl("store-a", "https://dsh.example/"), "https://dsh.example/storefront/store-a");
  assert.equal(endpoint("http://10.0.2.2:3202", "/v1/public/stores").href,
    "http://10.0.2.2:3202/v1/public/stores");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected transport"); });
  for (const origin of ["https://dsh.example", "http://localhost:3202", "http://127.0.0.1",
    "http://127.0.0.1:65536", "http://127.0.0.1:80", "http://127.0.0.1:3202/"]) {
    await assert.rejects(readCurrentCustomerCart(origin, bearer, "store-a", "actor-1", new AbortController().signal),
      { status: 503, code: "OWNER_UNAVAILABLE" });
  }
  for (const origin of ["", "not a URL"]) {
    await assert.rejects(readApprovedCaptainStanding(origin, bearer, "captain", "actor-1"),
      { status: 0, code: "DSH_ENDPOINT_INVALID" });
    await assert.rejects(readMerchantDSHStanding(origin, bearer), { status: 503, code: "OWNER_UNAVAILABLE" });
  }
  for (const version of [undefined, -1, 1.5]) {
    await assert.rejects(readCurrentCustomerCartMerchandiseEstimate(
      "http://127.0.0.1:3202", bearer, "store-a", "actor-1", version, new AbortController().signal),
      { status: 400, code: "INVALID_REQUEST" });
  }
  assert.equal(calls, 0);
});
