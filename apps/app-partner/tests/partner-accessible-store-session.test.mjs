import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/partner-onboarding/partner-accessible-store-scopes.ts"), "utf8");
const actor = (subject, sessionId) => ({ kind: "authenticated", identity: { role: "partner", subject, sessionId } });
const scope = state => state.kind === "authenticated" && state.identity?.role === "partner"
  ? JSON.stringify([state.identity.subject, state.identity.sessionId]) : "";

const found = source.match(/queryFn: async \(\{ signal \}\) => \{([\s\S]*?)\n    \},\n    retry: false/);
assert.ok(found, "production Store-scope queryFn must be available to test");
const queryBody = found[1].replace("const stores: PartnerAccessibleStore[] = [];", "const stores = [];");
function executeQuery(stillCurrent, listPartnerAccessibleStores, signal = { aborted: false }) {
  return runInNewContext("const query=async ({signal})=>{" + queryBody + "\n}; query({signal})", {
    stillCurrent, listPartnerAccessibleStores, signal,
  });
}

test("permission-bearing Store query is keyed by actor+session and fails closed while Identity changes", () => {
  assert.match(source, /queryKey: \["partner", "accessible-stores", sessionScope\]/);
  assert.match(source, /enabled: stillCurrent\(\)/);
  assert.match(source, /subscribeIdentitySession\(sync\)/);
  assert.match(source, /setSessionScope\(partnerSetupSessionKey\(currentIdentityState\(\)\)\)/);
  assert.match(source, /const state: StoreScopesState = !stillCurrent\(\) \|\| scopes\.isPending/);
  assert.match(source, /if\(sessionScope&&partnerSetupSessionKey\(currentIdentityState\(\)\)===sessionScope\)await scopes\.refetch\(\)/);
});

test("in-flight Store scope response from old session is rejected even for the same actor", async () => {
  const starting = actor("partner-a", "session-1");
  let current = starting;
  let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const operation = executeQuery(() => scope(current) === scope(starting), () => pending);
  current = actor("partner-a", "session-2");
  deliver({ stores: [{ id: "store-1", owned: true }], nextCursor: "" });
  await assert.rejects(operation, /PARTNER_STORE_SCOPE_CANCELLED/);
});

test("in-flight Store scope response from another actor or logged-out actor is rejected", async () => {
  for (const next of [actor("partner-b", "session-1"), { kind: "unauthenticated" }]) {
    const starting = actor("partner-a", "session-1");
    let current = starting;
    let deliver;
    const operation = executeQuery(
      () => scope(current) !== "" && scope(current) === scope(starting),
      () => new Promise(resolve => { deliver = resolve; }),
    );
    current = next;
    deliver({ stores: [{ id: "store-1" }], nextCursor: "" });
    await assert.rejects(operation, /PARTNER_STORE_SCOPE_CANCELLED/);
  }
});

test("same-session paginated Store scope list succeeds; abort never exposes partial results", async () => {
  const pages = [];
  const success = await executeQuery(
    () => true,
    async cursor => {
      pages.push(cursor);
      return cursor ? { stores: [{ id: "store-b" }], nextCursor: "" }
        : { stores: [{ id: "store-a" }], nextCursor: "page-2" };
    },
  );
  assert.deepEqual(Array.from(success, item => item.id), ["store-a", "store-b"]);
  assert.deepEqual(pages, ["", "page-2"]);

  const signal = { aborted: false };
  let readCount = 0;
  await assert.rejects(executeQuery(
    () => true,
    async () => {
      readCount += 1;
      signal.aborted = true;
      return { stores: [{ id: "store-private" }], nextCursor: "" };
    },
    signal,
  ), /PARTNER_STORE_SCOPE_CANCELLED/);
  assert.equal(readCount, 1);
});
