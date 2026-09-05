import assert from "node:assert/strict";

import { IdentitySessionManager } from "../clients/session.ts";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  async getItem(key) {
    return this.values.get(key) ?? null;
  }

  async setItem(key, value) {
    this.values.set(key, value);
  }

  async removeItem(key) {
    this.values.delete(key);
  }
}

const oldPair = {
  accessToken: "access-old-12345678901234567890",
  refreshToken: "refresh-old-12345678901234567890",
  accessExpiresAt: "2026-09-05T05:00:00Z",
  identity: {
    subject: "act_test",
    sessionId: "session_test",
    role: "client",
    surface: "app-client",
    expiresAt: "2026-09-05T05:00:00Z",
  },
};

const freshPair = {
  accessToken: "access-fresh-12345678901234567890",
  refreshToken: "refresh-fresh-12345678901234567890",
  accessExpiresAt: "2026-09-05T06:00:00Z",
  identity: {
    subject: "act_test",
    sessionId: "session_test",
    role: "client",
    surface: "app-client",
    expiresAt: "2026-09-05T06:00:00Z",
  },
};

function unauthenticated() {
  return { kind: "http", status: 401, code: "UNAUTHENTICATED", message: "authentication failed" };
}

{
  const storage = new MemoryStorage();
  const logoutCalls = [];
  const refreshCalls = [];
  const client = {
    async logout(accessToken) {
      logoutCalls.push(accessToken);
      if (logoutCalls.length === 1) throw unauthenticated();
    },
    async refresh(request) {
      refreshCalls.push(request);
      return freshPair;
    },
  };
  const manager = new IdentitySessionManager(
    client,
    storage,
    async () => "device-fingerprint-1234567890",
    "client",
    "app-client",
    "test-success",
  );

  await manager.adopt(oldPair);
  await manager.logout();

  assert.deepEqual(logoutCalls, [oldPair.accessToken, freshPair.accessToken]);
  assert.deepEqual(refreshCalls, [{
    refreshToken: oldPair.refreshToken,
    deviceFingerprint: "device-fingerprint-1234567890",
  }]);
  assert.equal(manager.state.kind, "signed_out");
  assert.equal(await storage.getItem("test-success.identity.session.v1"), null);
}

{
  const storage = new MemoryStorage();
  const networkFailure = { kind: "network", message: "identity unavailable" };
  const client = {
    async logout() {
      throw unauthenticated();
    },
    async refresh() {
      throw networkFailure;
    },
  };
  const manager = new IdentitySessionManager(
    client,
    storage,
    async () => "device-fingerprint-1234567890",
    "client",
    "app-client",
    "test-failure",
  );

  await manager.adopt(oldPair);
  let observed = null;
  try {
    await manager.logout();
  } catch (error) {
    observed = error;
  }

  assert.equal(observed, networkFailure);
  assert.equal(manager.state.kind, "signed_out");
  assert.equal(await storage.getItem("test-failure.identity.session.v1"), null);
}

console.log("IDENTITY_SESSION_MANAGER_TEST=PASS");
