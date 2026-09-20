import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const app = process.argv[2];
if (!app) {
  console.error("Usage: node test-mobile-app.mjs <app-name>");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(root, "apps", app);

const role =
  app === "app-client" ? "client" :
  app === "app-partner" ? "partner" :
  app === "app-captain" ? "captain" :
  app === "app-field" ? "field" : null;

if (!role) {
  console.error(`Unknown mobile app: ${app}`);
  process.exit(1);
}

const surface = app;

// 1. Structural and Configuration Verification
const configPath = path.join(appDir, "mobile.config.json");
assert.ok(fs.existsSync(configPath), `${app}: missing mobile.config.json`);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
assert.equal(Object.prototype.hasOwnProperty.call(config, "nativeCapabilities"), false, `${app}: nativeCapabilities shadow registry survived`);

// 2. Current native/config contract verification.
const pkgPath = path.join(appDir, "package.json");
assert.ok(fs.existsSync(pkgPath), `${app}: missing package.json`);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
assert.equal(allDeps["expo-localization"], "~57.0.2", `${app}: static RTL requires expo-localization`);

  const identityPath = path.join(appDir, "src", "bootstrap", "identity.ts");
  assert.ok(fs.existsSync(identityPath), `${app}: missing src/bootstrap/identity.ts`);
const identityContent = fs.readFileSync(identityPath, "utf8");
assert.ok(identityContent.includes(`const role = "${role}"`), `${app}: wrong role in src/bootstrap/identity.ts`);
assert.ok(identityContent.includes(`const surface = "${surface}"`), `${app}: wrong surface in src/bootstrap/identity.ts`);

const entryPath = path.join(appDir, "app", "index.tsx");
assert.ok(fs.existsSync(entryPath), `${app}: missing app/index.tsx`);

// The authenticated application must be a real route tree. The identity
// surface remains the unauthenticated entry point; it must not own the
// authenticated workflow body or act as a navigation substitute.
const routePaths =
  app === "app-client" ? ["home.tsx", "orders.tsx", "orders/[orderId].tsx", "cart/[storeId].tsx", "account.tsx"] :
  app === "app-partner" ? ["store.tsx", "orders.tsx", "onboarding.tsx", "account.tsx"] :
  app === "app-captain" ? ["home.tsx", "offers.tsx", "deliveries.tsx", "account.tsx"] :
  ["home.tsx", "cases.tsx", "new-case.tsx", "account.tsx"];
const appRouteDir = path.join(appDir, "app", "(app)");
assert.ok(fs.existsSync(path.join(appRouteDir, "_layout.tsx")), `${app}: missing authenticated route layout`);
assert.ok(fs.readFileSync(path.join(appRouteDir, "_layout.tsx"), "utf8").includes("AuthenticatedMobileBoundary"), `${app}: authenticated routes must be session guarded`);
for (const routePath of routePaths) assert.ok(fs.existsSync(path.join(appRouteDir, routePath)), `${app}: missing route ${routePath}`);
if (app === "app-client") assert.ok(fs.existsSync(path.join(appDir, "app", "store", "[storeId].tsx")), `${app}: missing public store catalog route`);
const shellPath = path.join(appDir, "src", "shell", `${role}-shell.tsx`);
assert.ok(fs.existsSync(shellPath), `${app}: missing actor-specific application shell`);
const shellContent = fs.readFileSync(shellPath, "utf8");
assert.ok(!shellContent.includes('accessibilityRole="tablist"'), `${app}: manual bottom navigation must not remain beside the canonical Tabs owner`);
assert.ok(!shellContent.includes("<Slot />"), `${app}: application shell must not own a parallel Expo Router slot`);
  assert.ok(shellContent.includes('flexDirection: "row"'), `${app}: application shell must use the native logical row direction`);
  assert.ok(!shellContent.includes("direction:"), `${app}: application shell must not duplicate Expo RTL direction ownership`);
  assert.ok(!shellContent.includes("textAlign:"), `${app}: application shell must not duplicate text alignment ownership`);
  const navigationStyle = shellContent.match(/navigation:\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(!navigationStyle.includes("direction:") && !navigationStyle.includes("flexDirection:") && !navigationStyle.includes("row-reverse"), `${app}: native tab bar must use Expo Router route order, not a manual direction override`);
  assert.ok(!navigationStyle.includes("paddingBottom:") && !navigationStyle.includes("paddingVertical:"), `${app}: native tab bar must own the bottom safe-area inset; do not override it in tabBarStyle`);
const layoutContent = fs.readFileSync(path.join(appRouteDir, "_layout.tsx"), "utf8");
assert.ok(layoutContent.includes("Tabs"), `${app}: authenticated layout must declare stable Expo Router JS Tabs`);
assert.ok(layoutContent.includes("<Tabs"), `${app}: authenticated layout must compose route content through Expo Router Tabs`);
const tabRoutes =
  app === "app-client" ? ["home", "orders", "account", "cart/[storeId]", "orders/[orderId]"] :
  app === "app-partner" ? ["store", "orders", "account", "onboarding"] :
  app === "app-captain" ? ["home", "offers", "deliveries", "account"] :
  ["home", "cases", "account", "new-case"];
 let previousTabRouteIndex = -1;
 for (const tabRoute of tabRoutes) {
   const tabRouteIndex = layoutContent.indexOf(`<Tabs.Screen name="${tabRoute}"`);
   assert.ok(tabRouteIndex >= 0, `${app}: missing canonical Tabs route ${tabRoute}`);
   assert.ok(tabRouteIndex > previousTabRouteIndex, `${app}: canonical Tabs route order drifted at ${tabRoute}`);
   previousTabRouteIndex = tabRouteIndex;
 }
const identityGatePath = path.join(appDir, "src", "features", "access", "identity-gate.tsx");
const identityGateContent = fs.readFileSync(identityGatePath, "utf8");
if (app === "app-client") {
  assert.ok(!identityGateContent.includes("LocationCore"), `${app}: identity gate must not own the account workflow`);
  assert.ok(!identityGateContent.includes("ClientOrders"), `${app}: identity gate must not own the orders workflow`);
} else {
  assert.ok(identityGateContent.includes("authenticatedContent={<Redirect"), `${app}: managed identity gate must redirect into the authenticated route tree`);
}
console.log(`MOBILE_ROUTE_TREE=PASS app=${app} routes=${routePaths.join(",")}`);

import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL(path.join(root, "tools/dev/ts-resolver.mjs")).href, import.meta.url);
const { IdentitySessionManager } = await import(pathToFileURL(path.join(root, "services/identity/clients/session.ts")).href);
const { identitySessionSignOutMessage } = await import(pathToFileURL(path.join(root, "services/identity/clients/errors.ts")).href);

const { defineSamrimExpoApp } = await import(pathToFileURL(path.join(root, "tools/mobile/define-samrim-expo-app.cjs")).href);
const expectsForegroundLocation = app === "app-client" || app === "app-partner";
const expoConfig = defineSamrimExpoApp(app, expectsForegroundLocation ? { locationMode: "foreground" } : {});
assert.equal(expoConfig.extra.nativeCapabilities, undefined, `${app}: Expo config must not expose native capability shadow truth`);
assert.equal(expoConfig.android.blockedPermissions, undefined, `${app}: manual RECORD_AUDIO workaround must be absent`);
assert.equal(expoConfig.android.config, undefined, `${app}: manual Android provider config must be absent`);
assert.equal(expoConfig.ios.config, undefined, `${app}: manual iOS provider config must be absent`);
const localizationPlugin = expoConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-localization");
assert.deepEqual(localizationPlugin, [
  "expo-localization",
  {
    supportedLocales: { ios: ["ar"], android: ["ar"] },
    forcesRTL: true,
    allowDynamicLocaleChangesAndroid: false,
  },
], `${app}: native localization config must be Arabic-only and statically RTL`);
const locationPlugin = expoConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-location");
if (expectsForegroundLocation) {
  assert.equal(allDeps["expo-location"], "~57.0.19", `${app}: foreground location requires the Expo location module`);
  assert.ok(locationPlugin, `${app}: foreground location must be owned by expo-location`);
  assert.deepEqual(locationPlugin, [
    "expo-location",
    {
      locationWhenInUsePermission: "نحتاج الوصول إلى موقعك عند طلب التقاط موقع العنوان أو أصل المتجر.",
    },
  ], `${app}: foreground location must be owned by expo-location`);
} else {
  assert.equal(allDeps["expo-location"], undefined, `${app}: unadmitted location must not be a direct dependency`);
  assert.equal(locationPlugin, undefined, `${app}: location permissions must not be inferred without an explicit app-owned request`);
}
assert.equal(expoConfig.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-image-picker"), false, `${app}: image-picker plugin must not be inferred from package presence`);
assert.equal(expoConfig.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "react-native-maps"), false, `${app}: maps plugin must not be inferred from package presence`);
assert.equal(expoConfig.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-notifications"), false, `${app}: notifications plugin must not be inferred from package presence`);
console.log(`MOBILE_AR_RTL_NATIVE_CONFIG=PASS app=${app} locale=ar forcesRTL=true`);

for (const reason of ["no_local_session", "corrupt_local_session", "terminal_invalidated", "surface_mismatch", "local_proof_invalid", "explicit_logout", "recovery"]) {
  assert.ok(identitySessionSignOutMessage(reason).length > 0, `${app}: missing sign-out reason message: ${reason}`);
}
console.log(`MOBILE_SESSION_REASON_COPY=PASS app=${app}`);

// 3. Behavioral Unit Tests for Mobile Session State Machine
class MockStorage {
  constructor(initial = {}) {
    this.store = new Map(Object.entries(initial));
  }
  async getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  async setItem(key, value) {
    this.store.set(key, value);
  }
  async removeItem(key) {
    this.store.delete(key);
  }
}

const sampleIdentity = {
  subject: "usr_test_001",
  role,
  surface,
  state: "active",
};

const samplePair = {
  accessToken: "token_access_valid_len_32_characters_ok",
  refreshToken: "token_refresh_valid_len_32_characters_ok",
  identity: sampleIdentity,
};

// Test 1: Clean storage -> signed_out
{
  const storage = new MockStorage();
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "signed_out");
}

// Test 2: Corrupt storage -> clears and signed_out
{
  const storage = new MockStorage({ [`test.${app}.identity.session.v1`]: "not-valid-json" });
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "signed_out");
  assert.equal(await storage.getItem(`test.${app}.identity.session.v1`), null);
}

// Test 3: Valid stored tokens -> authenticated
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  const client = { async session() { return sampleIdentity; } };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "authenticated");
  assert.equal(res.identity.subject, "usr_test_001");
}

// Test 4: Role/surface mismatch -> clears storage and signs out
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  const client = { async session() { return { ...sampleIdentity, role: "other_role" }; } };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "signed_out");
  assert.equal(await storage.getItem(`test.${app}.identity.session.v1`), null);
}

// Test 5: Service unavailable -> preserves tokens, returns degraded(service_unavailable)
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  const client = {
    async session() {
      const err = new Error("gateway timeout");
      err.kind = "http";
      err.status = 504;
      throw err;
    },
  };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, "service_unavailable");
  assert.ok(await storage.getItem(`test.${app}.identity.session.v1`));
}

// Test 6: The live 401 REFRESH_STALE contract is non-terminal and preserves the durable session intent.
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  const client = {
    async session() {
      const err = new Error("token expired");
      err.kind = "http";
      err.status = 401;
      throw err;
    },
    async refresh() {
      const err = new Error("stale refresh token");
      err.kind = "http";
      err.status = 401;
      err.code = "REFRESH_STALE";
      throw err;
    },
  };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, "refresh_conflict");
  assert.ok(await storage.getItem(`test.${app}.identity.session.v1`));
}

// Test 7: Non-terminal refresh failures preserve session material and remain fail-closed.
for (const [status, code, reason] of [[429, "RATE_LIMITED", "rate_limited"], [503, "IDENTITY_UNAVAILABLE", "service_unavailable"], [409, "CONFLICT", "unexpected_http"]]) {
  const key = `test.${app}.identity.session.v1`;
  const storage = new MockStorage({ [key]: JSON.stringify({ accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken }) });
  const client = {
    async session() {
      const err = new Error("access unavailable");
      err.kind = "http";
      err.status = 401;
      throw err;
    },
    async refresh() {
      const err = new Error(code);
      err.kind = "http";
      err.status = status;
      err.code = code;
      throw err;
    },
  };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, reason);
  assert.ok(await storage.getItem(key));
}

// Test 8: Unknown restore failures do not fabricate sign-out or authentication.
{
  const key = `test.${app}.identity.session.v1`;
  const storage = new MockStorage({ [key]: JSON.stringify({ accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken }) });
  const client = { async session() { throw new Error("unexpected restore failure"); } };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, "unknown");
  assert.ok(await storage.getItem(key));
}

// Test 9: SecureStore read failure is recoverable and preserves opaque session material.
{
  const storage = {
    async getItem() { throw new Error("secure storage is temporarily unavailable"); },
    async setItem() {},
    async removeItem() {},
  };
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, "storage_read");
}

// Test 10: A committed rotation whose response is lost is reconstructed by a new manager from durable state.
{
  const key = `test.${app}.identity.session.v1`;
  const storage = new MockStorage({ [key]: JSON.stringify({ accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken }) });
  const rotatedPair = { ...samplePair, accessToken: "token_access_rotated_len_32_characters_ok", refreshToken: "token_refresh_rotated_len_32_characters_ok" };
  let refreshCalls = 0;
  let requestId;
  const client = {
    async session(token) {
      if (token === rotatedPair.accessToken) return sampleIdentity;
      const err = new Error("expired"); err.kind = "http"; err.status = 401; throw err;
    },
    async refresh(request) {
      refreshCalls += 1;
      if (!requestId) {
        requestId = request.refreshRequestId;
        const err = new Error("response lost after remote commit"); err.kind = "network"; throw err;
      }
      assert.equal(request.refreshRequestId, requestId);
      return rotatedPair;
    },
  };
  const firstManager = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "a".repeat(36));
  const first = await firstManager.restore();
  assert.equal(first.kind, "degraded");
  assert.equal(first.reason, "network");
  assert.match(await storage.getItem(key), /pendingRefresh/);
  const restartedManager = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "b".repeat(36));
  const recovered = await restartedManager.restore();
  assert.equal(recovered.kind, "authenticated");
  assert.equal(refreshCalls, 2);
  assert.equal(JSON.parse(await storage.getItem(key)).pendingRefresh, undefined);
}

// Test 11: A write that committed but reported failure is recovered after complete manager/process loss.
{
  const key = `test.${app}.identity.session.v1`;
  const durableStorage = new MockStorage({ [key]: JSON.stringify({ accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken }) });
  const rotatedPair = { ...samplePair, accessToken: "token_access_pending_len_32_characters_ok", refreshToken: "token_refresh_pending_len_32_characters_ok" };
  let writeCount = 0;
  let refreshCalls = 0;
  const client = {
    async session(token) {
      if (token === rotatedPair.accessToken) return sampleIdentity;
      const err = new Error("expired"); err.kind = "http"; err.status = 401; throw err;
    },
    async refresh() { refreshCalls += 1; return rotatedPair; },
  };
  const uncertainStorage = {
    async getItem(keyName) { return durableStorage.getItem(keyName); },
    async setItem(keyName, value) {
      writeCount += 1;
      await durableStorage.setItem(keyName, value);
      if (writeCount === 2) throw new Error("secure storage reported after commit");
    },
    async removeItem(keyName) { return durableStorage.removeItem(keyName); },
  };
  const firstManager = new IdentitySessionManager(client, uncertainStorage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "c".repeat(36));
  const first = await firstManager.restore();
  assert.equal(first.kind, "degraded");
  assert.equal(first.reason, "storage_write");
  const pendingAfterUnknownWrite = JSON.parse(await durableStorage.getItem(key));
  assert.equal(pendingAfterUnknownWrite.accessToken, rotatedPair.accessToken);
  assert.equal(pendingAfterUnknownWrite.pendingRefresh.previous.accessToken, samplePair.accessToken);
  const restartedManager = new IdentitySessionManager(client, durableStorage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "d".repeat(36));
  const recovered = await restartedManager.restore();
  assert.equal(recovered.kind, "authenticated");
  assert.equal(refreshCalls, 1);
  assert.equal(JSON.parse(await durableStorage.getItem(key)).pendingRefresh, undefined);
}

// Test 12: Adopt credentials -> stores tokens and authenticated
{
  const storage = new MockStorage();
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.adopt(samplePair);
  assert.equal(res.kind, "authenticated");
  assert.ok(await storage.getItem(`test.${app}.identity.session.v1`));
}

// Test 13: Logout -> calls remote and clears local storage
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  let loggedOut = false;
  const client = {
    async logout(tok) {
      assert.equal(tok, samplePair.accessToken);
      loggedOut = true;
    },
  };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  await mgr.logout();
  assert.equal(mgr.state.kind, "signed_out");
  assert.equal(await storage.getItem(`test.${app}.identity.session.v1`), null);
  assert.ok(loggedOut);
}

// Test 14: Development fallback authenticates a fresh runtime with no stored session
{
  const storage = new MockStorage();
  let developmentCalls = 0;
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "e".repeat(36), async () => {
    developmentCalls += 1;
    return samplePair;
  });
  const restored = await mgr.restore();
  assert.equal(restored.kind, "authenticated");
  assert.equal(developmentCalls, 1);
}

// Test 15: Explicit logout remains signed out in the same runtime
{
  const storage = new MockStorage({[`test.${app}.identity.session.v1`]: JSON.stringify({accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken})});
  let developmentCalls = 0;
  const mgr = new IdentitySessionManager({async logout() {}}, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "f".repeat(36), async () => {
    developmentCalls += 1;
    return samplePair;
  });
  await mgr.logout();
  const restored = await mgr.restore();
  assert.equal(restored.kind, "signed_out");
  assert.equal(restored.reason, "explicit_logout");
  assert.equal(developmentCalls, 0);
}

// Test 16: Recovery intent remains signed out in the same runtime
{
  const storage = new MockStorage();
  let developmentCalls = 0;
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "g".repeat(36), async () => {
    developmentCalls += 1;
    return samplePair;
  });
  await mgr.adopt(samplePair);
  const cleared = await mgr.clearLocalSession();
  assert.equal(cleared.kind, "signed_out");
  assert.equal(cleared.reason, "recovery");
  const restored = await mgr.restore();
  assert.equal(restored.kind, "signed_out");
  assert.equal(restored.reason, "recovery");
  assert.equal(developmentCalls, 0);
}

// Test 17: A new runtime can use development continuity again
{
  const storage = new MockStorage();
  let developmentCalls = 0;
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "h".repeat(36), async () => {
    developmentCalls += 1;
    return samplePair;
  });
  const restored = await mgr.restore();
  assert.equal(restored.kind, "authenticated");
  assert.equal(developmentCalls, 1);
}

console.log(`MOBILE_TEST=PASS app=${app} cases=19+`);
