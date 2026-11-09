import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/stores/store-workspace.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("store-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "readInternalPhotos") callback = node.initializer;
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(callback, "Store workspace must own one production internal-photo reader for initial load and retry");
const compiled = ts.transpileModule("const readInternalPhotos = " + callback.getText(tree) + "; readInternalPhotos;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const valid = (id) => ({ id, contentType: "image/jpeg", createdAt: "2026-11-09T03:00:00Z" });

function harness(plans) {
  const events = { photos: [], errors: [], loading: [], urls: [] };
  const sequence = { current: 0 };
  const readInternalPhotos = runInNewContext(compiled, {
    storeId: "store-a",
    photoRequestSequence: sequence,
    useCallback: (fn) => fn,
    setInternalPhotos: (value) => events.photos.push(value),
    setInternalPhotosError: (value) => events.errors.push(value),
    setInternalPhotosLoading: (value) => events.loading.push(value),
    partnerErrorMessage: async () => "رفضت الخدمة قراءة الصور.",
    fetch: async (url, options) => {
      events.urls.push({ url, options });
      const plan = plans.shift();
      assert.ok(plan, "every request needs an explicit response");
      if (plan.hold) await new Promise((resolve) => { plan.release = resolve; });
      return plan.response;
    },
  });
  return { readInternalPhotos, events, sequence };
}

test("valid Store-scoped owner images load and never read another Store route", async () => {
  const h = harness([{ response: { ok: true, json: async () => ({ photos: [valid("photo-a")] }) } }]);
  await h.readInternalPhotos();
  assert.equal(h.events.photos.at(-1)?.[0]?.id, "photo-a");
  assert.equal(h.events.loading.at(-1), false);
  assert.equal(h.events.urls.length, 1);
  assert.equal(h.events.urls[0].url, "/api/stores/store-a/internal-photos");
  assert.equal(h.events.urls[0].options.cache, "no-store");
  assert.ok(!h.events.errors.some(Boolean));
});

test("403 on retry fails closed without installing an error body as photos", async () => {
  const h = harness([{ response: { ok: false, status: 403, json: async () => ({ error: { code: "FORBIDDEN" } }) } }]);
  await h.readInternalPhotos();
  assert.equal(h.events.photos.at(-1)?.length, 0);
  assert.match(h.events.errors.at(-1), /رفضت الخدمة/);
  assert.equal(h.events.loading.at(-1), false);
});

test("malformed and unrenderable image responses never enter the gallery", async () => {
  for (const body of [{ error: { code: "BAD" } }, { photos: null }, { photos: [{ id: "x", contentType: "text/html", createdAt: "bad-date" }] }]) {
    const h = harness([{ response: { ok: true, json: async () => body } }]);
    await h.readInternalPhotos();
    assert.equal(h.events.photos.at(-1)?.length, 0);
    assert.match(h.events.errors.at(-1), /غير صالحة/);
  }
});

test("late stale image GET cannot replace newer successful retry", async () => {
  const first = { hold: true, response: { ok: true, json: async () => ({ photos: [valid("old")] }) } };
  const second = { response: { ok: true, json: async () => ({ photos: [valid("new")] }) } };
  const h = harness([first, second]);
  const pending = h.readInternalPhotos();
  await h.readInternalPhotos();
  first.release();
  await pending;
  assert.equal(h.events.photos.length, 1);
  assert.equal(h.events.photos[0][0].id, "new");
});

test("aborted Store read after session/route unmount cannot paint private images", async () => {
  const delayed = { hold: true, response: { ok: true, json: async () => ({ photos: [valid("old")] }) } };
  const h = harness([delayed]);
  const controller = new AbortController();
  const pending = h.readInternalPhotos(controller.signal);
  controller.abort();
  h.sequence.current += 1;
  delayed.release();
  await pending;
  assert.equal(h.events.photos.length, 0);
  assert.match(source, /photoRequestSequence\.current \+= 1; controller\.abort\(\)/);
  assert.match(source, /onClick=\{\(\) => void readInternalPhotos\(\)\}/, "retry must use the same verified owner reader");
});
