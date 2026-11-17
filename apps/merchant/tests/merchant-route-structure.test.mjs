import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const path = (file) => resolve(root, file);
const read = (file) => readFileSync(path(file), "utf8");

test("Merchant has one app root, four tabs and no historical Store-owner naming", () => {
  for (const file of ["app/index.tsx", "app/_layout.tsx",
    "app/(tabs)/_layout.tsx"]) assert.ok(existsSync(path(file)), file);
  for (const name of ["orders", "products", "wallet", "more"]) {
    assert.ok(existsSync(path(`app/(tabs)/${name}/index.tsx`)));
    assert.ok(read("app/(tabs)/_layout.tsx").includes(`name="${name}"`));
  }
  assert.equal(existsSync(path("src/app")), false);
});

test("Merchant private navigation stays closed until Identity and DSH are ready", () => {
  const boundary = read("app/_layout.tsx");
  assert.match(boundary, /<Stack\.Protected guard=\{false\} redirectTo="\/">/);
  assert.match(boundary, /<Stack.Screen name="\(tabs\)" \/>/);
  assert.match(read("app/index.tsx"), /MerchantIdentityGate/);
  const gate = read("src/features/access/identity-gate.tsx");
  assert.match(gate, /لم يتم تفعيل تسجيل الدخول للتاجر/);
  assert.doesNotMatch(gate, /setSession\(|fetch\(/);
  for (const name of ["orders", "products", "wallet", "more"]) {
    const route = read(`app/(tabs)/${name}/index.tsx`);
    assert.match(route, /MerchantCapabilityScreen/);
    assert.doesNotMatch(route, /fetch\(|mutate\(|credit\(/);
  }
});
