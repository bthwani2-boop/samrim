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
const queryBody = found[1]
  .replace("const stores: PartnerAccessibleStore[] = [];", "const stores = [];")
  .replaceAll("new Set<string>()", "new Set()");
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
        : { stores: [{ id: "store-a" }], nextCursor: "store-a" };
    },
  );
  assert.deepEqual(Array.from(success, item => item.id), ["store-a", "store-b"]);
  assert.deepEqual(pages, ["", "store-a"]);

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

test("Store scope pagination fails closed on repeated pages, invalid cursors and duplicate rights", async () => {
  for (const scenario of [
    {
      name: "duplicate Store in second page",
      pages: [
        { stores: [{ id: "store-a" }], nextCursor: "store-a" },
        { stores: [{ id: "store-a" }], nextCursor: "" },
      ],
    },
    {
      name: "repeated cursor with non-advancing page",
      pages: [
        { stores: [{ id: "store-a" }], nextCursor: "store-a" },
        { stores: [{ id: "store-b" }], nextCursor: "store-a" },
      ],
    },
    {
      name: "opaque cursor inconsistent with canonical DSH Store ID",
      pages: [{ stores: [{ id: "store-a" }], nextCursor: "page-2" }],
    },
    {
      name: "empty page with a next cursor",
      pages: [{ stores: [], nextCursor: "store-a" }],
    },
    {
      name: "oversized server page",
      pages: [{ stores: Array.from({ length: 51 }, (_, i) => ({ id: `store-${i}` })), nextCursor: "" }],
    },
    {
      name: "missing page data",
      pages: [{ stores: null, nextCursor: "" }],
    },
    {
      name: "non-string Store ID",
      pages: [{ stores: [{ id: 123 }], nextCursor: "" }],
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      executeQuery(() => true, async () => scenario.pages[calls++ % scenario.pages.length]),
      /PARTNER_STORE_SCOPE_INVALID_PAGE/,
      scenario.name,
    );
    assert.ok(calls <= 2, `${scenario.name}: invalid pagination must terminate`);
  }
});

test("Store scope query supports thousands of unique authorized stores without an arbitrary small page cap", async () => {
  let page = 0;
  const result = await executeQuery(() => true, async cursor => {
    const index = page++;
    if (index > 0) assert.equal(cursor, `store_${String(index * 50 - 1).padStart(5, "0")}`);
    const stores = Array.from({ length: 50 }, (_, i) => ({
      id: `store_${String(index * 50 + i).padStart(5, "0")}`,
    }));
    return { stores, nextCursor: index < 74 ? stores.at(-1).id : "" };
  });
  assert.equal(page, 75);
  assert.equal(result.length, 3750);
  assert.equal(result.at(0).id, "store_00000");
  assert.equal(result.at(-1).id, "store_03749");
});

test("late Identity switch during later Store page discards the full accumulated list", async () => {
  let valid = true;
  const operation = executeQuery(() => valid, async cursor => {
    if (!cursor) return { stores: [{ id: "store-owned" }], nextCursor: "store-owned" };
    valid = false;
    return { stores: [{ id: "store-private" }], nextCursor: "" };
  });
  await assert.rejects(operation, /PARTNER_STORE_SCOPE_CANCELLED/);
});
