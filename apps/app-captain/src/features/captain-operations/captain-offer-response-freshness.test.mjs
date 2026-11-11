import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = await readFile(new URL("./captain-offers.tsx", import.meta.url), "utf8");
const respondStart = source.indexOf("async function respond(");
const renderStart = source.indexOf("\n\n  if (popup)", respondStart);
assert.notEqual(respondStart, -1, "the offer response handler exists");
assert.notEqual(renderStart, -1, "the offer response handler ends before rendering");
const respondSource = source.slice(respondStart, renderStart);
const catchStart = respondSource.indexOf("} catch (cause) {");
const finallyStart = respondSource.indexOf("\n    } finally {", catchStart);
assert.notEqual(catchStart, -1, "the offer response recovery handler exists");
assert.notEqual(finallyStart, -1, "the offer response cleanup exists");
const catchBody = respondSource.slice(catchStart + "} catch (cause) {".length, finallyStart);
const runRecovery = new Function(
  "cause",
  "isCurrent",
  "load",
  "setError",
  "console",
  `return (async () => {${catchBody}\n})();`,
);

function sessionKey(subject, sessionId) {
  return captainSessionKey({ kind: "authenticated", identity: { role: "captain", subject, sessionId } });
}

test("a response failure cannot publish its recovery error after the captain account switches during readback", async () => {
  let subject = "captain-a";
  const originalSession = sessionKey(subject, "session-1");
  const errors = [];
  await runRecovery(
    new Error("response failed"),
    () => sessionKey(subject, "session-1") === originalSession,
    async () => {
      subject = "captain-b";
      return false;
    },
    (message) => errors.push(message),
    { error() {} },
  );
  assert.deepEqual(errors, []);
});

test("a response failure cannot publish a former-session recovery error after same-actor renewal", async () => {
  let sessionId = "session-1";
  const originalSession = sessionKey("captain-a", sessionId);
  const errors = [];
  await runRecovery(
    new Error("response failed"),
    () => sessionKey("captain-a", sessionId) === originalSession,
    async () => {
      sessionId = "session-2";
      return false;
    },
    (message) => errors.push(message),
    { error() {} },
  );
  assert.deepEqual(errors, []);
});

test("a response failure still reports recovery guidance to the same Captain Identity session", async () => {
  const errors = [];
  const originalSession = sessionKey("captain-a", "session-1");
  await runRecovery(
    new Error("response failed"),
    () => sessionKey("captain-a", "session-1") === originalSession,
    async () => false,
    (message) => errors.push(message),
    { error() {} },
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /لا تعِد إرسال القرار/);
});

test("confirmed insufficient wallet balance retains the specific recovery instruction", async () => {
  const errors = [];
  let logged = false;
  await runRecovery(
    { code: "INSUFFICIENT_FUNDS" },
    () => true,
    async () => true,
    (message) => errors.push(message),
    { error() { logged = true; } },
  );
  assert.equal(logged, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /رصيد محفظتك المتاح لا يكفي/);
});
