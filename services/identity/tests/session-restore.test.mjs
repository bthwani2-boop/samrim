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
