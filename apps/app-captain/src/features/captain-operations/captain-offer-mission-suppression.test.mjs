import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./captain-offers.tsx", import.meta.url), "utf8");
const loadMatch = source.match(/const load = useCallback\(async \(\): Promise<boolean> => \{([\s\S]*?)\n  \}, \[\]\);/);
const effectMatch = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[activeActorID, load, suppressed\]\);/);
assert.ok(loadMatch, "the actual offer-read callback exists");
assert.ok(effectMatch, "the actual actor and suppression effect exists");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("mission suppression invalidates a pending captain read and the next actor gets a clean retry", async () => {
  const oldActorRead = deferred();
  const state = { subject: "captain-a", offers: ["previous"], loadedActorID: "captain-a", loading: false, error: "old error" };
  const readSequence = { current: 0 };
  const loadPromises = [];
  let readCount = 0;
  const deps = {
    readSequence,
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: state.subject } }),
    getUsableIdentityAccessToken: async () => "token",
    captainClient: () => ({ listOwnCaptainOffers: () => {
      readCount += 1;
      return readCount === 1 ? oldActorRead.promise : Promise.resolve({ offers: ["captain-b-current"] });
    } }),
    isCurrentCaptainActor: (expected, actual) => expected === actual,
    setOffers: (value) => { state.offers = value; },
    setLoadedActorID: (value) => { state.loadedActorID = value; },
    setLoading: (value) => { state.loading = value; },
    setError: (value) => { state.error = value; },
    activeActorID: "captain-a",
    suppressed: false,
    load: null,
  };
  const runLoad = new Function("deps", `
    const { readSequence, currentIdentityState, getUsableIdentityAccessToken, captainClient,
      isCurrentCaptainActor, setOffers, setLoadedActorID, setLoading, setError } = deps;
    return async () => {${loadMatch[1]}\n    };
  `)(deps);
  deps.load = () => { const promise = runLoad(); loadPromises.push(promise); return promise; };
  const runEffect = new Function("deps", `
    const { activeActorID, load, readSequence, setOffers, setLoadedActorID, setLoading,
      setError, suppressed } = deps;
    return (() => {${effectMatch[1]}\n    })();
  `);

  runEffect(deps);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(readCount, 1, "captain A's offer request is in flight");

  deps.suppressed = true;
  runEffect(deps);
  assert.deepEqual(state.offers, [], "mission activation immediately clears the old offer view");
  assert.equal(state.loadedActorID, "");
  assert.equal(readSequence.current, 2, "mission activation invalidates the pending read after its request sequence");

  state.subject = "captain-b";
  deps.activeActorID = "captain-b";
  deps.suppressed = false;
  runEffect(deps);
  await loadPromises[1];
  assert.deepEqual(state.offers, ["captain-b-current"], "the new actor can recover with a fresh read");
  assert.equal(state.loadedActorID, "captain-b");

  oldActorRead.resolve({ offers: ["captain-a-stale-offer"] });
  await loadPromises[0];
  assert.deepEqual(state.offers, ["captain-b-current"], "the late old-actor result cannot replace the retry");
  assert.equal(state.loadedActorID, "captain-b");
});