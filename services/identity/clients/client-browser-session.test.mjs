import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// Node's TypeScript stripping does not resolve extensionless TS imports by default.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./generated/identity-operations") {
      return nextResolve("./generated/identity-operations.ts", context);
    }
    return nextResolve(specifier, context);
  },
});
const { createIdentityClient } = await import("./client.ts");

test("Client browser session uses a cookie-only restore path and credentialed requests", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ path: new URL(url).pathname, method: options.method, credentials: options.credentials, hasAuthorization: Boolean(options.headers?.Authorization) });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = createIdentityClient("http://localhost:18082", 1000, "client");
    const restored = await client.restoreClientBrowserSession();
    assert.equal(typeof restored.refreshToken, "string");
    assert.match(restored.refreshToken, /cookie/i, "the client uses a non-secret marker for cookie-managed refresh");
    await client.refresh({ refreshToken: "ignored-in-browser", clientInstanceId: "ignored-in-browser", refreshRequestId: "ignored-in-browser" });
    await client.loginClient({ phone: "000", password: "not-real", clientInstanceId: "test-client-id" });
    await client.logout("test-access-token");
    assert.deepEqual(requests.map(({path}) => path), [
      "/auth/web/client/session",
      "/auth/web/client/session",
      "/auth/client/login",
      "/auth/web/client/logout",
    ]);
    assert.ok(requests.every((r) => r.credentials === "include"));
    assert.equal(requests[0].hasAuthorization, false);
    assert.equal(requests[1].hasAuthorization, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Native clients retain bearer refresh/logout and never send browser cookies", async () => {
  const paths = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    paths.push({ path: new URL(url).pathname, credentials: options.credentials });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = createIdentityClient("http://localhost:18082");
    await client.refresh({ refreshToken: "native", clientInstanceId: "native-test", refreshRequestId: "native-test-refresh" });
    await client.logout("native-test-access-token");
    assert.deepEqual(paths.map(x=>x.path), ["/auth/refresh","/auth/logout"]);
    assert.ok(paths.every(x=>x.credentials === undefined));
  } finally { globalThis.fetch=prevFetch; }
});
