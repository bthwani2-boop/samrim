import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(path.resolve(
  import.meta.dirname,
  "../src/features/policies/store-type-cancellation-policy-workspace.tsx",
), "utf8");
const saveStart = source.indexOf("  async function save() {");
const saveEnd = source.indexOf("\n\n  return <section", saveStart);
assert.ok(saveStart > 0 && saveEnd > saveStart, "must run actual policy editor save function");
const saveCode = source.slice(saveStart, saveEnd)
  .replace(" as { storeType?: CommercialStoreType; error?: { message?: string } }", "")
  .replace("readJson<{ storeTypes: CommercialStoreType[] }>", "readJson");

const type = (id = "type-a", mode = "OPERATIONS_ONLY", version = 1) => ({
  id, verticalId: "vertical-a", cancellationMode: mode, version,
});
const confirmed = type("type-a", "CLIENT_BEFORE_ACCEPTANCE", 2);
const expected = "CLIENT_BEFORE_ACCEPTANCE";
const nextTick = () => new Promise(resolve => setImmediate(resolve));

function executeSave(fetchImpl, readImpl, { existingError = "", signalAPI = AbortSignal } = {}) {
  const changes = { requests: [], reads: [], types: [], ids: [], notices: [], errors: [], reasons: [], busy: [] };
  const inFlightSave = { current: null };
  const context = {
    current: type(), busy: false, loading: false, error: existingError, mode: expected,
    reason: "Approved test-only change", verticalId: "vertical-a", inFlightSave,
    AbortController, AbortSignal: signalAPI, encodeURIComponent,
    crypto: { randomUUID: () => "request-key-once" },
    fetch: (...args) => {
      changes.requests.push(args);
      return fetchImpl(...args);
    },
    readJson: (...args) => {
      changes.reads.push(args);
      return readImpl(...args);
    },
    setBusy: value => changes.busy.push(value),
    setTypes: value => changes.types.push(value),
    setTypeId: value => changes.ids.push(value),
    setNotice: value => changes.notices.push(value),
    setError: value => changes.errors.push(value),
    setReason: value => changes.reasons.push(value),
  };
  const running = runInNewContext(saveCode + "\n({ operation: save(), repeat: save })", context);
  return { ...running, changes, inFlightSave };
}

const patchResponse = value => ({
  ok: true, json: async () => ({ storeType: value }),
});

test("policy editor is limited to complete operator sessions with platform policy permission", () => {
  assert.match(source, /const \{ state: session \} = useSession\(\)/);
  assert.match(source, /session\.identity\.role === "operator"/);
  assert.match(source, /session\.identity\.permissions\?\.includes\("platform_policies"\) === true/);
  assert.match(source, /Boolean\(session\.identity\.subject && session\.identity\.sessionId\)/);
  assert.match(source, /JSON\.stringify\(\[session\.identity\.subject, session\.identity\.sessionId\]\)/);
  assert.match(source, /<StoreTypeCancellationEditor key=\{sessionKey\}/);
  assert.match(source, /inFlightSave\.current\?\.abort\(\)/);
  assert.match(source, /readJson<\{ verticals: CommerceVertical\[\] \}>\("\/api\/catalog\/verticals", controller\.signal\)/);
  assert.match(source, /encodeURIComponent\(verticalId\)\}.*controller\.signal\)/s);
});

test("PATCH success is displayed only after matching canonical DSH Store Type readback", async () => {
  const run = executeSave(
    async (_url, options) => {
      assert.equal(options.method, "PATCH");
      assert.equal(JSON.parse(options.body).expectedVersion, 1);
      assert.equal(JSON.parse(options.body).mode, expected);
      return patchResponse(confirmed);
    },
    async (url, signal) => {
      assert.equal(url, "/api/catalog/commercial-store-types?verticalId=vertical-a");
      assert.strictEqual(signal, run.changes.requests[0][1].signal);
      return { storeTypes: [confirmed] };
    },
  );
  await run.operation;
  assert.equal(run.changes.requests.length, 1);
  assert.equal(run.changes.reads.length, 1);
  assert.equal(run.changes.types.length, 1);
  assert.equal(run.changes.types[0][0].version, 2);
  assert.equal(run.changes.ids.at(-1), "type-a");
  assert.match(run.changes.notices.at(-1), /تأكيد سياسة الإلغاء الجديدة من DSH/);
  assert.equal(run.changes.errors.at(-1), "");
  assert.equal(run.changes.busy.at(-1), false);
  assert.equal(run.inFlightSave.current, null);
});

test("stale PATCH response after operator session teardown cannot write old policy state", async () => {
  let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const run = executeSave(() => pending, async () => {
    throw new Error("old-session DSH confirmation must never start");
  });
  assert.equal(run.changes.requests.length, 1);
  run.inFlightSave.current.abort();
  deliver(patchResponse(confirmed));
  await run.operation;
  assert.equal(run.changes.reads.length, 0);
  assert.deepEqual(run.changes.types, []);
  assert.deepEqual(run.changes.ids, []);
  assert.deepEqual(run.changes.notices, [""], "no old-session success after abort");
  assert.deepEqual(run.changes.errors, [""]);
  assert.equal(run.inFlightSave.current, null);
});

test("old-session confirmation GET is ignored if Identity changes while DSH responds", async () => {
  let deliverReadback;
  const pending = new Promise(resolve => { deliverReadback = resolve; });
  const run = executeSave(
    async () => patchResponse(confirmed),
    () => pending,
  );
  for (let i = 0; i < 10 && run.changes.reads.length < 1; i += 1) await Promise.resolve();
  assert.equal(run.changes.reads.length, 1);
  run.inFlightSave.current.abort();
  deliverReadback({ storeTypes: [confirmed] });
  await run.operation;
  assert.equal(run.changes.types.length, 0);
  assert.deepEqual(run.changes.notices, [""]);
  assert.deepEqual(run.changes.errors, [""]);
});

test("mismatched DSH confirmation blocks success, clears optimistic Store Type and never retries PATCH", async () => {
  const run = executeSave(
    async () => patchResponse(confirmed),
    async () => ({ storeTypes: [type("type-a", expected, 3)] }),
  );
  await run.operation;
  assert.equal(run.changes.requests.length, 1);
  assert.equal(run.changes.reads.length, 1);
  assert.deepEqual(Array.from(run.changes.types[0]), []);
  assert.equal(run.changes.ids.at(-1), "");
  assert.match(run.changes.errors.at(-1), /أعد قراءة أنواع المتاجر من DSH/);
  assert.deepEqual(run.changes.notices, [""]);
});

test("ambiguous network failure after successful PATCH requires fresh read, without hidden retry", async () => {
  const run = executeSave(
    async () => patchResponse(confirmed),
    async () => { throw new Error("readback unavailable"); },
  );
  await run.operation;
  assert.equal(run.changes.requests.length, 1);
  assert.equal(run.changes.reads.length, 1);
  assert.deepEqual(Array.from(run.changes.types[0]), []);
  assert.match(run.changes.errors.at(-1), /تعذر تأكيد نتيجة الحفظ/);
});

test("rapid duplicate policy submit never sends two PATCH requests", async () => {
  let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const run = executeSave(() => pending, () => ({ storeTypes: [confirmed] }));
  await run.repeat();
  assert.equal(run.changes.requests.length, 1);
  run.inFlightSave.current.abort();
  deliver(patchResponse(confirmed));
  await run.operation;
  assert.equal(run.changes.requests.length, 1);
});

test("the two read loads have distinct busy flags and manual GET-only recovery", () => {
  assert.match(source, /const loading = verticalsLoading \|\| typesLoading;/);
  assert.match(source, /\}, \[verticalId, reload\]\);/);
  assert.match(source, /\}, \[reload\]\);/);
  assert.match(source, /setReload\(value => value \+ 1\)/);
  assert.match(source, /setTypes\(\[\]\);\s*setTypeId\(""\);\s*setError\(/);
  assert.match(source, /disabled=\{busy \|\| loading\}/);
  assert.match(source, /disabled=\{busy \|\| loading \|\| Boolean\(error\)/);
});

function productionReadEffect(marker, trailing, typeAnnotation) {
  const start = source.indexOf(marker);
  const end = source.indexOf(trailing, start);
  assert.ok(start >= 0 && end > start, "find current production read effect");
  return source.slice(start, end + trailing.length).replace(typeAnnotation, "readJson");
}

function runReadEffect(code, readJson, verticalId = "vertical-a") {
  let cleanup;
  const writes = { verticals: [], verticalIds: [], types: [], typeIds: [],
    verticalLoading: [], typesLoading: [], errors: [] };
  runInNewContext(code, {
    AbortController, encodeURIComponent, verticalId, reload: 0,
    useEffect: callback => { cleanup = callback(); },
    readJson,
    setVerticals: value => writes.verticals.push(value),
    setVerticalId: value => writes.verticalIds.push(value),
    setTypes: value => writes.types.push(value),
    setTypeId: value => writes.typeIds.push(value),
    setVerticalsLoading: value => writes.verticalLoading.push(value),
    setTypesLoading: value => writes.typesLoading.push(value),
    setError: value => writes.errors.push(value),
  });
  return { cleanup, writes };
}

test("cancelled DSH vertical GET cannot restore a previous operator's catalog selection", async () => {
  const code = productionReadEffect(
    '  useEffect(() => {\n    const controller = new AbortController();\n    setVerticalsLoading(true);',
    '  }, [reload]);',
    "readJson<{ verticals: CommerceVertical[] }>",
  );
  let finish;
  const deferred = new Promise(resolve => { finish = resolve; });
  const run = runReadEffect(code, () => deferred);
  run.cleanup();
  finish({ verticals: [{ id: "previous-operator-vertical" }] });
  await nextTick();
  assert.deepEqual(run.writes.verticals, []);
  assert.deepEqual(run.writes.verticalIds, []);
  assert.deepEqual(run.writes.verticalLoading, [true]);
});

test("cancelled DSH Store Type GET ignores stale permissions and does not reset new-session fields", async () => {
  const code = productionReadEffect(
    '  useEffect(() => {\n    const controller = new AbortController();\n    setTypes([]);',
    '  }, [verticalId, reload]);',
    "readJson<{ storeTypes: CommercialStoreType[] }>",
  );
  let finish;
  const deferred = new Promise(resolve => { finish = resolve; });
  const run = runReadEffect(code, () => deferred);
  assert.equal(run.writes.types.length, 1);
  assert.deepEqual(Array.from(run.writes.types[0]), []);
  run.cleanup();
  finish({ storeTypes: [confirmed] });
  await nextTick();
  assert.equal(run.writes.types.length, 1, "late Store Type cannot be restored");
  assert.deepEqual(run.writes.typeIds, [""]);
  assert.deepEqual(run.writes.typesLoading, [true]);
});

test("current-session Store Type GET selects only the verified type and honors an empty vertical", async () => {
  const code = productionReadEffect(
    '  useEffect(() => {\n    const controller = new AbortController();\n    setTypes([]);',
    '  }, [verticalId, reload]);',
    "readJson<{ storeTypes: CommercialStoreType[] }>",
  );
  const run = runReadEffect(code, async (_url, signal) => {
    assert.equal(signal.aborted, false);
    return { storeTypes: [type()] };
  });
  await nextTick();
  assert.equal(run.writes.types.length, 2);
  assert.equal(run.writes.typeIds.at(-1), "type-a");
  assert.equal(run.writes.typesLoading.at(-1), false);

  let called = false;
  const empty = runReadEffect(code, async () => { called = true; }, "");
  await nextTick();
  assert.equal(called, false);
  assert.deepEqual(empty.writes.typeIds, [""]);
  assert.equal(empty.writes.typesLoading.at(-1), false);
});

test("pending registry read errors block cancellation policy writes until verified refresh", async () => {
  const run = executeSave(
    () => { throw new Error("PATCH must not run with stale type read"); },
    () => { throw new Error("readback must not start"); },
    { existingError: "تعذرت قراءة المجال" },
  );
  await run.operation;
  assert.equal(run.changes.requests.length, 0);
  assert.equal(run.changes.reads.length, 0);
});

test("unversioned successful PATCH cannot be treated as confirmed policy", async () => {
  const run = executeSave(
    async () => patchResponse({ ...confirmed, version: undefined }),
    async () => { throw new Error("unversioned PATCH must not be confirmed"); },
  );
  await run.operation;
  assert.equal(run.changes.requests.length, 1);
  assert.equal(run.changes.reads.length, 0);
  assert.deepEqual(Array.from(run.changes.types[0]), []);
  assert.match(run.changes.errors.at(-1), /تعذر تأكيد نتيجة الحفظ/);
});

test("DSH readback of a different vertical or malformed list never confirms a policy", async () => {
  for (const readback of [
    { storeTypes: [{ ...confirmed, verticalId: "different-vertical" }] },
    { storeTypes: null },
  ]) {
    const run = executeSave(async () => patchResponse(confirmed), async () => readback);
    await run.operation;
    assert.equal(run.changes.requests.length, 1);
    assert.deepEqual(Array.from(run.changes.types[0]), []);
    assert.deepEqual(run.changes.notices, [""]);
    assert.match(run.changes.errors.at(-1), /أعد قراءة أنواع المتاجر من DSH/);
  }
});

test("DSH Store-Type PATCH with unchanged version must not confirm success or trigger acceptance readback", async () => {
  const staleVersion = { ...confirmed, version: 1 };
  const run = executeSave(
    async () => patchResponse(staleVersion),
    async () => { throw new Error("unchanged-version response must never be accepted"); },
  );
  await run.operation;
  assert.equal(run.changes.requests.length, 1);
  assert.equal(run.changes.reads.length, 0);
  assert.deepEqual(Array.from(run.changes.types[0]), []);
  assert.equal(run.changes.ids.at(-1), "");
  assert.deepEqual(run.changes.notices, [""]);
  assert.match(run.changes.errors.at(-1), /أعد قراءة أنواع المتاجر من DSH/);
});

test("DSH cancellation policy only confirms exactly expectedVersion plus one", () => {
  assert.match(source, /payload\.storeType\.version !== expectedVersion \+ 1/);
  assert.match(source, /confirmed\.version !== payload\.storeType\.version/);
});

function boundedCancellationSignal(expectedMilliseconds) {
  return {
    any: signals => AbortSignal.any(signals),
    timeout: milliseconds => {
      assert.equal(milliseconds, expectedMilliseconds, "production request deadline stays fixed");
      return AbortSignal.timeout(8);
    },
  };
}

test("canonical cancellation-policy catalog GET times out instead of loading indefinitely", async () => {
  const start = source.indexOf("async function readJson<T>(url: string, signal: AbortSignal): Promise<T> {");
  const end = source.indexOf("\n}\n\nexport function", start);
  assert.ok(start >= 0 && end > start);
  const code = source.slice(start, end + 2)
    .replace("async function readJson<T>(url: string, signal: AbortSignal): Promise<T>",
      "async function readJson(url, signal)")
    .replace("await response.json() as T & { error?: { message?: string } }", "await response.json()");
  const requests = [];
  const readJson = runInNewContext(code + "\nreadJson", {
    AbortSignal: boundedCancellationSignal(12_000),
    fetch: (_url, { signal }) => {
      requests.push(signal);
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  const controller = new AbortController();
  await assert.rejects(readJson("/api/catalog/verticals", controller.signal),
    error => error?.name === "TimeoutError");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].aborted, true);
  assert.equal(controller.signal.aborted, false, "GET deadline must not terminate the operator session");
});

test("stalled cancellation PATCH times out with one write and requires read-only recovery", async () => {
  const run = executeSave((_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), async () => { throw new Error("must not read until PATCH replies"); },
  { signalAPI: boundedCancellationSignal(20_000) });
  await run.operation;
  assert.equal(run.changes.requests.length, 1);
  assert.equal(run.changes.requests[0][1].method, "PATCH");
  assert.equal(run.changes.requests[0][1].signal.aborted, true);
  assert.equal(run.changes.reads.length, 0);
  assert.equal(run.changes.notices.at(-1), "");
  assert.deepEqual(Array.from(run.changes.types.at(-1)), []);
  assert.match(run.changes.errors.at(-1), /أعد قراءة أنواع المتاجر من DSH/);
  assert.equal(run.changes.busy.at(-1), false);
  assert.equal(run.inFlightSave.current, null);
});

test("stalled cancellation confirmation read after PATCH is bounded and never confirms stale policy", async () => {
  const run = executeSave(async () => patchResponse(confirmed), (_url, signal) =>
    new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }), { signalAPI: boundedCancellationSignal(20_000) });
  await run.operation;
  assert.equal(run.changes.requests.length, 1, "no automatic PATCH retry");
  assert.equal(run.changes.reads.length, 1);
  assert.strictEqual(run.changes.requests[0][1].signal, run.changes.reads[0][1],
    "same bounded mutation scope covers the canonical DSH readback");
  assert.equal(run.changes.reads[0][1].aborted, true);
  assert.deepEqual(Array.from(run.changes.types.at(-1)), []);
  assert.equal(run.changes.notices.at(-1), "");
  assert.match(run.changes.errors.at(-1), /تعذر تأكيد نتيجة الحفظ/);
  assert.equal(run.changes.busy.at(-1), false);
});
