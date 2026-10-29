import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  "actorID",
  "currentIdentityState",
  "isCurrentCaptainActor",
  "load",
  "setError",
  "console",
  `return (async () => {${catchBody}\n})();`,
);

test("a response failure cannot publish its recovery error after the captain account switches during readback", async () => {
  let subject = "captain-a";
  const errors = [];
  await runRecovery(
    new Error("response failed"),
    "captain-a",
    () => ({ kind: "authenticated", identity: { subject } }),
    (expected, actual) => expected === actual,
    async () => {
      subject = "captain-b";
      return false;
    },
    (message) => errors.push(message),
    { error() {} },
  );
  assert.deepEqual(errors, []);
});

test("a response failure still reports recovery guidance to the same captain", async () => {
  const errors = [];
  await runRecovery(
    new Error("response failed"),
    "captain-a",
    () => ({ kind: "authenticated", identity: { subject: "captain-a" } }),
    (expected, actual) => expected === actual,
    async () => false,
    (message) => errors.push(message),
    { error() {} },
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /لا تعِد إرسال القرار/);
});