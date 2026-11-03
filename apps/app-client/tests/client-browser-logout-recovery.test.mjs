import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/features/account/account.tsx", import.meta.url), "utf8");

test("Client account keeps authenticated browser on screen when logout cannot be confirmed", () => {
  const logout = source.split("async function logout() {")[1]?.split("async function changeCity()", 1)[0];
  assert.ok(logout, "account logout handler exists");
  assert.match(logout, /currentIdentityState\(\)\.kind === "authenticated"/);
  assert.match(logout, /تعذر تسجيل الخروج/);
  assert.doesNotMatch(logout, /finally\s*\{[^}]*router\.replace/s, "do not navigate away while sign-out failed");
  assert.match(logout, /if \(.*\) router\.replace\("\/\?returnTo=\/account"/);
});
