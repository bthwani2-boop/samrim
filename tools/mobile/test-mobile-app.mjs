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
  "localization",
], `${app}: nativeCapabilities drifted`);

// 2. Targeted dependency regression verification.
// This is intentionally not a complete unused-package census; dependency
// liveness remains a repository-wide review concern.
const pkgPath = path.join(appDir, "package.json");
assert.ok(fs.existsSync(pkgPath), `${app}: missing package.json`);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
assert.equal(allDeps["expo-localization"], "~57.0.1", `${app}: static RTL requires expo-localization`);

const forbiddenDependencyRegressions = [
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

for (const forbidden of forbiddenDependencyRegressions) {
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

const { defineSamrimExpoApp } = await import(pathToFileURL(path.join(root, "tools/mobile/define-samrim-expo-app.cjs")).href);
const expoConfig = defineSamrimExpoApp(app);
const localizationPlugin = expoConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-localization");
assert.deepEqual(localizationPlugin, [
  "expo-localization",
  {
    supportedLocales: { ios: ["ar"], android: ["ar"] },
    forcesRTL: true,
    allowDynamicLocaleChangesAndroid: false,
  },
], `${app}: native localization config must be Arabic-only and statically RTL`);
console.log(`MOBILE_AR_RTL_NATIVE_CONFIG=PASS app=${app} locale=ar forcesRTL=true`);

// Remote EAS environments may retain provider variables after a native dependency
// has been intentionally removed. Provider variables alone must not re-admit a
// native config plugin that is absent from the current app dependency graph.
{
  const sentryKeys = ["SENTRY_ORG", "SENTRY_PROJECT", "EXPO_PUBLIC_SENTRY_DSN"];
  const previous = Object.fromEntries(sentryKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    process.env.EXPO_PUBLIC_SENTRY_DSN = "https://public@example.invalid/1";

    const providerConfiguredExpo = defineSamrimExpoApp(app);
    const sentryPlugin = providerConfiguredExpo.plugins.find(
      (plugin) =>
        (Array.isArray(plugin) ? plugin[0] : plugin) === "@sentry/react-native/expo",
    );

    assert.equal(sentryPlugin, undefined, `${app}: stale EAS Sentry variables must not admit a missing native dependency`);
    assert.equal(providerConfiguredExpo.extra.sentry.enabled, false, `${app}: Sentry must remain disabled without its dependency`);
    assert.equal(providerConfiguredExpo.extra.sentry.nativeConfigured, false, `${app}: Sentry native config must remain disabled without its dependency`);
    assert.equal(providerConfiguredExpo.extra.sentry.nativeDependencyInstalled, false, `${app}: Sentry dependency census drifted`);
  } finally {
    for (const key of sentryKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}
console.log(`MOBILE_PROVIDER_ENV_GATING=PASS app=${app} provider=sentry`);

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
