import assert from "node:assert/strict";
import { test } from "node:test";
import { captureMailpitMessageIds } from "./mailpit-challenge.mjs";

test("Mailpit requests cannot leave localhost through a malformed port", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), redirect: options?.redirect });
    return new Response(JSON.stringify({ messages: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    for (const port of ["80@attacker.example", "65536", "0", "18026/path"]) {
      await assert.rejects(
        captureMailpitMessageIds({ port, phone: "+967700000000", purpose: "managed_activate" }),
        /Invalid local Mailpit port/,
      );
    }
    assert.deepEqual(requests, []);
    assert.deepEqual(
      await captureMailpitMessageIds({ port: "18026", phone: "+967700000000", purpose: "managed_activate" }),
      [],
    );
    assert.deepEqual(requests, [{
      url: "http://127.0.0.1:18026/api/v1/messages?limit=50",
      redirect: "error",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
