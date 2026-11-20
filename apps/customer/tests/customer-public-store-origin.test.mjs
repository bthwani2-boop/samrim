import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePublicStoreOrigin } from "../src/features/stores/public-store-origin.ts";

const browser = { hostname: "127.0.0.1", protocol: "http:", origin: "http://127.0.0.1:18101" };

test("native development uses the approved Android reverse tunnel for public Store reads", () => {
  assert.equal(resolvePublicStoreOrigin("", true, undefined), "http://127.0.0.1:18101");
});

test("production without an explicitly configured DSH origin fails closed", () => {
  assert.equal(resolvePublicStoreOrigin("", false, undefined), "");
});

test("web development uses the same-origin discovery route", () => {
  assert.equal(resolvePublicStoreOrigin("", true, browser), browser.origin);
});

test("explicitly configured owner URL takes priority without guesswork", () => {
  assert.equal(resolvePublicStoreOrigin("https://api.example.test", true, undefined), "https://api.example.test");
});

test("non-local web host does not receive a development discovery origin", () => {
  assert.equal(resolvePublicStoreOrigin("", true, {
    hostname: "public.example.test", protocol: "https:", origin: "https://public.example.test",
  }), "");
});
