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
assert.deepEqual(config.nativeCapabilities, [
  "router",
  "updates",
  "constants",
  "crypto",
  "splashScreen",
  "secureStore",
], `${app}: nativeCapabilities drifted`);

// 2. Supply-Chain & Dependency Hygiene Verification (Zero Unused Packages)
const pkgPath = path.join(appDir, "package.json");
assert.ok(fs.existsSync(pkgPath), `${app}: missing package.json`);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

const forbiddenUnused = [
  "@react-native-community/netinfo",
  "@sentry/react-native",
  "expo-document-picker",
  "expo-file-system",
  "expo-haptics",
  "expo-image",
  "expo-location",
  "expo-notifications",
  "expo-sharing",
  "expo-video",
  "expo-web-browser",
  "react-native-maps",
];

for (const forbidden of forbiddenUnused) {
  assert.ok(!allDeps[forbidden], `${app}: contains unused dependency: ${forbidden}`);
}

const identityPath = path.join(appDir, "src", "identity.ts");
assert.ok(fs.existsSync(identityPath), `${app}: missing src/identity.ts`);
const identityContent = fs.readFileSync(identityPath, "utf8");
assert.ok(identityContent.includes(`const role = "${role}"`), `${app}: wrong role in src/identity.ts`);
assert.ok(identityContent.includes(`const surface = "${surface}"`), `${app}: wrong surface in src/identity.ts`);

const entryPath = path.join(appDir, "app", "index.tsx");
assert.ok(fs.existsSync(entryPath), `${app}: missing app/index.tsx`);

import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL(path.join(root, "tools/dev/ts-resolver.mjs")).href, import.meta.url);
const { IdentitySessionManager } = await import(pathToFileURL(path.join(root, "services/identity/clients/session.ts")).href);

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
  actorId: "act_test_001",
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
  assert.equal(res.identity.actorId, "act_test_001");
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

// Test 5: Service unavailable -> preserves tokens, returns service_unavailable
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
  assert.equal(res.kind, "service_unavailable");
  assert.ok(await storage.getItem(`test.${app}.identity.session.v1`));
}

// Test 6: REFRESH_STALE race condition -> preserves tokens, returns refresh_conflict
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
      err.status = 409;
      err.code = "REFRESH_STALE";
      throw err;
    },
  };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "refresh_conflict");
  assert.ok(await storage.getItem(`test.${app}.identity.session.v1`));
}

// Test 7: Adopt credentials -> stores tokens and authenticated
{
  const storage = new MockStorage();
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.adopt(samplePair);
  assert.equal(res.kind, "authenticated");
  assert.ok(await storage.getItem(`test.${app}.identity.session.v1`));
}

// Test 8: Logout -> calls remote and clears local storage
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

console.log(`MOBILE_TEST=PASS app=${app} cases=8`);
