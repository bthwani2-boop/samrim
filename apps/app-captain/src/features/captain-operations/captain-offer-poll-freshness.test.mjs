import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = await readFile(new URL("./captain-offers.tsx", import.meta.url), "utf8");
const refreshMatch = source.match(/const refresh = async \(\) => \{\n([\s\S]*?)\n {4}\};/);
assert.ok(refreshMatch, "the CaptainOffers polling callback exists");
const refreshInitializer = `async () => {\n${refreshMatch[1]}\n    }`;
assert.doesNotThrow(() => new Function(`return (${refreshInitializer});`), "the actual polling callback is valid JavaScript");

function createPoll(overrides = {}) {
  const applied = [];
  const deps = {
    busy: false,
    readSequence: { current: 3 },
    sessionKey: captainSessionKey({ kind: "authenticated", identity: { role: "captain", subject: "captain-a", sessionId: "session-a" } }),
    currentIdentityState: () => ({ kind: "authenticated", identity: { role: "captain", subject: "captain-a", sessionId: "session-a" } }),
    captainSessionKey,
    getUsableIdentityAccessToken: async () => "token",
    captainClient: () => ({ listOwnCaptainOffers: async () => ({ offers: ["fresh"] }) }),
    setOffers: (offers) => applied.push(offers),
    ...overrides,
  };
  const factory = new Function("deps", `
    let cancelled = false;
    let refreshInFlight = false;
    const busy = deps.busy;
    const readSequence = deps.readSequence;
    const sessionKey = deps.sessionKey;
    const currentIdentityState = deps.currentIdentityState;
    const captainSessionKey = deps.captainSessionKey;
    const getUsableIdentityAccessToken = deps.getUsableIdentityAccessToken;
    const captainClient = deps.captainClient;
    const setOffers = deps.setOffers;
    const poll = ${refreshInitializer};
    return { poll, cancel: () => { cancelled = true; }, isInFlight: () => refreshInFlight };
  `);
  return { ...factory(deps), applied, deps };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("poll applies a current result and suppresses overlapping timer ticks", async () => {
  const pending = deferred();
  let active = 0;
  let calls = 0;
  const poller = createPoll({ captainClient: () => ({ listOwnCaptainOffers: () => { calls += 1; active += 1; return pending.promise.finally(() => { active -= 1; }); } }) });
  const first = poller.poll();
  const overlap = poller.poll();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(active, 1);
  assert.equal(poller.isInFlight(), true);
  pending.resolve({ offers: ["new authoritative offer set"] });
  await Promise.all([first, overlap]);
  assert.deepEqual(poller.applied, [["new authoritative offer set"]]);
  assert.equal(poller.isInFlight(), false);
});

test("poll cannot overwrite a manual load that started while it was pending", async () => {
  const pending = deferred();
  const poller = createPoll({ captainClient: () => ({ listOwnCaptainOffers: () => pending.promise }) });
  const read = poller.poll();
  poller.deps.readSequence.current += 1;
  pending.resolve({ offers: ["stale poll result"] });
  await read;
  assert.deepEqual(poller.applied, []);
});

test("poll drops results after the authenticated actor changes", async () => {
  const pending = deferred();
  let subject = "captain-a";
  const poller = createPoll({
    currentIdentityState: () => ({ kind: "authenticated", identity: { role: "captain", subject, sessionId: "session-a" } }),
    captainClient: () => ({ listOwnCaptainOffers: () => pending.promise }),
  });
  const read = poller.poll();
  subject = "captain-b";
  pending.resolve({ offers: ["other actor result"] });
  await read;
  assert.deepEqual(poller.applied, []);
});

test("cleanup cancels result application and releases the single-flight guard", async () => {
  const pending = deferred();
  const poller = createPoll({ captainClient: () => ({ listOwnCaptainOffers: () => pending.promise }) });
  const read = poller.poll();
  poller.cancel();
  pending.resolve({ offers: ["cancelled result"] });
  await read;
  assert.deepEqual(poller.applied, []);
  assert.equal(poller.isInFlight(), false);
  await poller.poll();
  assert.deepEqual(poller.applied, []);
});

test("poll rejects a late response after same-actor Identity session renewal", async () => {
  const pending = deferred();
  let sessionId = "session-a";
  const poller = createPoll({
    currentIdentityState: () => ({ kind: "authenticated", identity: { role: "captain", subject: "captain-a", sessionId } }),
    captainClient: () => ({ listOwnCaptainOffers: () => pending.promise }),
  });
  const read = poller.poll();
  await Promise.resolve();
  sessionId = "session-b";
  pending.resolve({ offers: ["previous session only"] });
  await read;
  assert.deepEqual(poller.applied, []);
});
