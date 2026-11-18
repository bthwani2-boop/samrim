import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const captain = resolve(import.meta.dirname, "..");
const app = resolve(captain, "app");
const read = (path) => readFileSync(resolve(app, path), "utf8");
const source = (path) => readFileSync(resolve(captain, path), "utf8");

const routes = ["_layout.tsx", "index.tsx", "(tabs)/_layout.tsx", "(tabs)/home.tsx", "(tabs)/deliveries.tsx",
  "(tabs)/wallet.tsx", "(tabs)/account.tsx", "offers.tsx", "notifications.tsx",
  "delivery/[id].tsx", "health.tsx"];

test("approved Captain routes use one Expo Router root", () => {
  for (const file of routes) assert.ok(existsSync(resolve(app, file)), file);
  assert.equal(existsSync(resolve(app, "(app)")), false);
  assert.equal(existsSync(resolve(captain, "src/app")), false);
});

test("Captain entry is gated by current Identity role and DSH approval", () => {
  assert.ok(read("index.tsx").includes("identity-gate"));
  const gate = source("src/features/access/identity-gate.tsx");
  const admission = source("src/features/access/admission-transport.ts");
  assert.ok(gate.includes("verifyCaptainCode"));
  assert.ok(gate.includes("hasActiveCaptainSession"));
  assert.ok(gate.includes("captain-admission-pending"));
  assert.ok(gate.includes("captain-admission-verified"));
  assert.ok(admission.includes("readApprovedCaptainStanding"));
  assert.ok(admission.includes("resumeCurrentCustomerCaptainSession"));
  assert.ok(!admission.includes("setRole("));
});

test("four primary Captain destinations and one home map", () => {
  const screen = source("src/components/captain-capability-screen.tsx");
  for (const path of ["/home", "/deliveries", "/wallet", "/account"])
    assert.ok(screen.includes(`href="${path}"`), path);
  assert.ok(read("(tabs)/home.tsx").includes("captain-home-screen"));
  const home = source("src/features/dispatch/captain-home-screen.tsx");
  assert.ok(home.includes("الخريطة"));
  assert.ok(home.includes("غير مفعّلة"));
  assert.ok(!home.includes("watchPosition"));
});

test("protected and financial routes fail closed without owners", () => {
  for (const file of ["(tabs)/deliveries.tsx", "(tabs)/wallet.tsx", "(tabs)/account.tsx",
    "offers.tsx", "notifications.tsx", "delivery/[id].tsx"]) {
    const route = read(file);
    assert.ok(route.includes("CaptainCapabilityScreen"), file);
    assert.ok(!route.includes("fetch("), file);
    assert.ok(!route.includes("acceptOffer("), file);
    assert.ok(!route.includes("completeDelivery("), file);
  }
  const screen = source("src/components/captain-capability-screen.tsx");
  assert.ok(screen.includes("غير مفعّلة"));
  assert.ok(screen.includes("دون تأكيد"));
});

test("Captain has one tab route for each primary URL", () => {
  const tabs = read("(tabs)/_layout.tsx");
  assert.match(tabs, /<Tabs/);
  for (const name of ["home", "deliveries", "wallet", "account"]) {
    assert.ok(tabs.includes('name="' + name + '"'));
    assert.equal(existsSync(resolve(app, name + ".tsx")), false);
  }
});

test("direct links and nested Captain routes cannot render before live owner verification", () => {
  const guard = source("src/features/access/protected-route.tsx");
  assert.ok(guard.includes("readCaptainAdmission("));
  assert.ok(guard.includes("hasActiveCaptainSession("));
  assert.ok(guard.includes("useFocusEffect("));
  assert.ok(guard.includes('href="/"'));
  for (const path of ["(tabs)/_layout.tsx", "offers.tsx", "notifications.tsx", "delivery/[id].tsx"]) {
    const route = read(path);
    assert.ok(route.includes("CaptainProtectedRoute"), path);
    assert.ok(route.includes("<CaptainProtectedRoute"), path);
  }
});
