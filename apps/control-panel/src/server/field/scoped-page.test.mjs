import assert from "node:assert/strict";
import { test } from "node:test";
import { collectScopedPage } from "./scoped-page.ts";

function fixture(values) {
  const calls = [];
  return {
    calls,
    fetchPage: async (limit, cursor) => {
      const offset = cursor ? Number(cursor) : 0;
      calls.push({ limit, offset });
      const end = Math.min(offset + limit, values.length);
      return { items: values.slice(offset, end), nextCursor: end < values.length ? String(end) : undefined };
    },
  };
}

test("fills a city-filtered page past nonmatching Identity cursor pages without skipping actors", async () => {
  const source = fixture([
    { id: "out-1", city: "a" },
    { id: "out-2", city: "a" },
    { id: "in-1", city: "b" },
    { id: "out-3", city: "a" },
    { id: "in-2", city: "b" },
    { id: "in-3", city: "b" },
  ]);
  const enrich = async (item) => ({ ...item, admission: { city: item.city } });
  const matches = (item) => item.admission.city === "b";
  const first = await collectScopedPage({ limit: 2, cursor: "", fetchPage: source.fetchPage, enrich, matches });
  assert.deepEqual(first.items.map((item) => item.id), ["in-1", "in-2"]);
  assert.equal(first.nextCursor, "5");
  const second = await collectScopedPage({ limit: 2, cursor: first.nextCursor, fetchPage: source.fetchPage, enrich, matches });
  assert.deepEqual(second.items.map((item) => item.id), ["in-3"]);
  assert.equal(second.nextCursor, undefined);
  assert.equal(source.calls[1].offset, 2);
});

test("returns a truthful empty terminal result when no scoped actor exists", async () => {
  const source = fixture([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const result = await collectScopedPage({ limit: 2, cursor: "", fetchPage: source.fetchPage, enrich: async (item) => item, matches: () => false });
  assert.deepEqual(result, { items: [], nextCursor: undefined });
});

test("does not scan past the requested page without a city filter", async () => {
  const source = fixture([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const result = await collectScopedPage({ limit: 2, cursor: "", fetchPage: source.fetchPage, enrich: async (item) => item, matches: () => true });
  assert.deepEqual(result.items.map((item) => item.id), ["a", "b"]);
  assert.equal(result.nextCursor, "2");
  assert.equal(source.calls.length, 1);
});

test("rejects cursor cycles and malformed pages rather than claiming the roster is empty", async () => {
  await assert.rejects(
    collectScopedPage({ limit: 1, cursor: "", fetchPage: async () => ({ items: [], nextCursor: "loop" }), enrich: async (item) => item, matches: () => true }),
    /INVALID_SCOPED_ROSTER_CURSOR_CYCLE/,
  );
  await assert.rejects(
    collectScopedPage({ limit: 1, cursor: "", fetchPage: async () => ({ items: [1, 2] }), enrich: async (item) => item, matches: () => true }),
    /INVALID_SCOPED_ROSTER_PAGE/,
  );
  await assert.rejects(
    collectScopedPage({ limit: 1, cursor: "repeat", fetchPage: async () => ({ items: [1], nextCursor: "repeat" }), enrich: async (item) => item, matches: () => true }),
    /INVALID_SCOPED_ROSTER_CURSOR_CYCLE/,
  );
});

test("does not downgrade upstream outages to a successful empty page", async () => {
  await assert.rejects(
    collectScopedPage({ limit: 1, cursor: "", fetchPage: async () => { throw new Error("IDENTITY_DOWN"); }, enrich: async (item) => item, matches: () => true }),
    /IDENTITY_DOWN/,
  );
});
