import assert from "node:assert/strict";
import { test } from "node:test";
import { DshPublicError, endpoint } from "../../services/dsh/clients/client-core.ts";
import { privateOwnerRequest } from "../../services/dsh/clients/private-owner-request.ts";
import { getPublicStore } from "../../services/dsh/clients/public-discovery.ts";

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
