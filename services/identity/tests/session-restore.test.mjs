import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(outputText, filename);
};

const { IdentitySessionManager } = require("../clients/session.ts");
const { createManagedMobileIdentityBinding } = require("../clients/mobile.ts");

for (const role of ["partner", "captain", "field"]) {
  test(`${role}: first password setup, new-device login and recovery preserve role boundaries`, async (t) => {
    globalThis.__DEV__ = false;
    const storageValues = new Map([["unrelated.identity.session.v1", "keep"]]);
    const requests = [];
    let rejectRecovery = false;
    const pair = {
      accessToken: "isolated-test-access-token-1234567890",
      refreshToken: "isolated-test-refresh-token-1234567890",
      identity: { subject: "isolated-actor", sessionId: "isolated-session", role, surface: `app-${role}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    };
    t.mock.method(globalThis, "fetch", async (url, options) => {
      const pathname = new URL(url).pathname;
      const body = JSON.parse(options.body);
      requests.push({ pathname, body });
      assert.equal(body.role, role);
      if (pathname.endsWith("/request")) return Response.json({ challengeId: "isolated-challenge" }, { status: 201 });
      if (pathname.endsWith("/recover")) {
        return rejectRecovery
          ? Response.json({ error: { code: "UNAUTHENTICATED", message: "invalid proof" } }, { status: 401 })
          : Response.json({ status: "recovery_complete" });
      }
      return Response.json(pair);
    });
    const makeBinding = (namespace) => createManagedMobileIdentityBinding({
      role, surface: `app-${role}`, namespace, allowDevelopmentSessionFallback: false,
      explicitApiUrl: "http://identity.test",
      cryptoRandomUUID: () => "isolated-device-instance-123",
      secureStorage: {
        getItem: async (key) => storageValues.get(key) ?? null,
        setItem: async (key, value) => { storageValues.set(key, value); },
        removeItem: async (key) => { storageValues.delete(key); },
      },
    });
    const first = makeBinding(`first.${role}`);
    assert.equal((await first.restoreIdentitySession()).kind, "signed_out");
    await first.requestManagedActivation("777000101");
    assert.equal((await first.activateManagedIdentity("777000101", "123456", "Te5t!a9Q")).kind, "authenticated");
    const newDevice = makeBinding(`second.${role}`);
    assert.equal((await newDevice.loginManagedIdentity("+967777000101", "Te5t!a9Q")).kind, "authenticated");
    assert.deepEqual(requests.slice(0, 3).map(({ pathname }) => pathname), ["/auth/managed/activation/request", "/auth/managed/activate", "/auth/managed/login"]);
    assert.equal(requests[0].body.phone, "777000101");
    assert.equal(requests[2].body.phone, "+967777000101");
    await newDevice.requestManagedRecovery("777000101");
    rejectRecovery = true;
    await assert.rejects(newDevice.recoverManagedIdentity("777000101", "654321", "Ne7w!p2R"), (error) => error.code === "UNAUTHENTICATED");
    assert.equal(newDevice.currentIdentityState().kind, "authenticated", "failed proof must preserve the current session");
    rejectRecovery = false;
    assert.deepEqual(await newDevice.recoverManagedIdentity("777000101", "654321", "Ne7w!p2R"), { status: "recovery_complete" });
    assert.deepEqual(newDevice.currentIdentityState(), { kind: "signed_out", reason: "recovery" });
    assert.equal((await newDevice.restoreIdentitySession()).kind, "signed_out", "recovery must not automatically sign in");
    assert.equal(storageValues.get("unrelated.identity.session.v1"), "keep");
    assert.equal(first.currentIdentityState().kind, "authenticated", "local recovery must not mutate another device's storage");
  });
}

test("restore preserves an authenticated session without rereading storage", async () => {
  const identity = {
    subject: "client-1",
    sessionId: "session-1",
    role: "client",
    surface: "app-client",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  let stored = JSON.stringify({ accessToken: "access-token-1234567890", refreshToken: "refresh-token-1234567890" });
  let storageReads = 0;
  let sessionRequests = 0;
  let logoutRequests = 0;
  const storage = {
    async getItem() {
      storageReads += 1;
      return stored;
    },
    async setItem(_key, value) {
      stored = value;
    },
    async removeItem() {
      stored = null;
    },
  };
  const client = {
    async session() {
      sessionRequests += 1;
      return identity;
    },
    async logout() {
      logoutRequests += 1;
    },
  };
  const manager = new IdentitySessionManager(client, storage, async () => "client-instance-123", "client", "app-client", "test");
  const states = [];
  manager.subscribe((state) => states.push(state.kind));

  const coldRestore = await manager.restore();

  assert.equal(coldRestore.kind, "authenticated");
  assert.deepEqual(states, ["restoring", "authenticated"]);
  assert.equal(storageReads, 1);
  assert.equal(sessionRequests, 1);

  const warmRestore = await manager.restore();

  assert.equal(warmRestore, coldRestore);
  assert.deepEqual(states, ["restoring", "authenticated"]);
  assert.equal(storageReads, 1);
  assert.equal(sessionRequests, 1);

  await manager.logout();

  assert.equal(logoutRequests, 1);
  assert.equal(stored, null);
  assert.deepEqual(manager.state, { kind: "signed_out", reason: "explicit_logout" });
  await assert.rejects(manager.getUsableAccessToken(), /IDENTITY_ACCESS_TOKEN_UNAVAILABLE/);
});
