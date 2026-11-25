import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DshPublicError } from "../../../services/dsh/clients/client-core.ts";
import * as captainSdk from "../../../services/dsh/clients/operator-captains.ts";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import * as client from "../src/features/captains/captains-read-client.ts";
import { isTrustedOperatorLoopbackTarget } from "../src/server/operator-passkey-config.ts";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
// Node evicts source maps when their uncached CommonJS module is collected.
// Retain these test-worker-local instances until coverage is collected.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
function loadFixture(fixture, imports) {
  const mod = loadMappedRenderFixture(fixture.code, fixture.source, imports);
  loadedModules.push(mod);
  return mod;
}
function compileFixture(name, tsx = true) {
  const source = fileURLToPath(new URL(`../src/features/captains/${name}`, import.meta.url));
  const code = transformSync(readFileSync(source, "utf8"), {
    filename: source, sourceMaps: "inline", inlineSourcesContent: true,
    jsc: { parser: { syntax: "typescript", tsx }, target: "es2022",
      ...(tsx ? { transform: { react: { runtime: "automatic" } } } : {}) },
    module: { type: "commonjs" },
  }).code;
  return { source, code };
}
const compiled = compileFixture("captains-workspace.tsx");
const jsx = (type, props) => ({ type, props: props ?? {} });
const standing = { actorId: "captain-a", status: "PENDING", version: 1 };
const bindingHeader = "X-BThwani-Operator";
const response = (body, binding, status = 200) => new Response(JSON.stringify(body), {
  status, headers: binding === undefined ? {} : { [bindingHeader]: binding },
});
const settle = () => new Promise(resolve => setImmediate(resolve));
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

async function run({ listBinding = "operator-a", omitListBinding = false, detailBinding = "operator-a", status = 200, listReply, detailReply, component = compiled, props = {} } = {}, scenario) {
  const hooks = [], effects = new Map(), requests = [], listeners = new Map();
  let index = 0, scheduled = [];
  const react = {
    useState(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = initial;
      return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }];
    },
    useRef(initial) { const at = index++; hooks[at] ??= { current: initial }; return hooks[at]; },
    useCallback(fn, deps) {
      const at = index++;
      const previous = hooks[at];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) hooks[at] = { fn, deps };
      return hooks[at].fn;
    },
    useEffect(fn, deps) {
      const at = index++;
      const old = effects.get(at);
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        scheduled.push(() => { old?.cleanup?.(); effects.set(at, { deps, cleanup: fn() }); });
      }
    },
  };
  const imports = {
    antd: { Alert: "Alert", Button: "Button", Card: "Card", Select: "Select",
      Input: { TextArea: "TextArea" }, Popconfirm: "Popconfirm", Spin: "Spin",
      Space: "Space", Table: "Table", Tag: "Tag",
      Typography: { Title: "Title", Paragraph: "Paragraph", Text: "Text" } },
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "./captains-read-client": client,
  };
  const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const events = { addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); } };
  globalThis.window = events;
  globalThis.document = { visibilityState: "visible", ...events };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/standing")) {
      if (detailReply) return detailReply(url, options);
      if (new Headers(options.headers).get(bindingHeader) !== "operator-a") return response({}, detailBinding, 403);
      return response(standing, detailBinding, status);
    }
    if (listReply) return listReply(new URL(url, "http://localhost").searchParams, options);
    return response({ items: [standing] }, omitListBinding ? undefined : listBinding);
  };
  try {
    const mod = loadFixture(component, imports);
    const render = () => {
      index = 0; scheduled = [];
      const tree = mod.exports.default(props);
      for (const effect of scheduled) effect();
      return tree;
    };
    render(); await settle();
    const tree = render();
    await scenario({ tree, render, requests, listeners });
  } finally {
    for (const effect of effects.values()) effect.cleanup?.();
    globalThis.fetch = originals.fetch;
    if (originals.window === undefined) delete globalThis.window; else globalThis.window = originals.window;
    if (originals.document === undefined) delete globalThis.document; else globalThis.document = originals.document;
  }
}
const table = tree => find(tree, n => n.type === "Table");
const detail = tree => find(tree, n => n.type === "Card" && n.props.title === "الحالة الحالية للكابتن");
function quickRead(tree) {
  const list = table(tree);
  assert.equal(list.props.dataSource[0].actorId, standing.actorId);
  const action = list.props.columns.find(column => column.key === "action").render(null, standing);
  find(action, n => n.type === "Button").props.onClick();
}

test("quick standing read uses the verified list operator and renders the owner result", async () => {
  await run({}, async ({ tree, render, requests }) => {
    quickRead(tree); await settle();
    assert.equal(new Headers(requests[1].options.headers).get(bindingHeader), "operator-a");
    assert.ok(detail(render()));
  });
});

test("a list without an operator binding cannot expose rows or initiate a quick read", async () => {
  await run({ omitListBinding: true }, async ({ tree, requests }) => {
    assert.equal(table(tree), undefined);
    assert.ok(find(tree, n => n.type === "Alert"));
    assert.equal(requests.length, 1);
  });
});

test("a changed operator binding or revoked operator never renders the quick standing", async () => {
  for (const options of [{ detailBinding: "operator-b" }, { status: 403 }]) {
    await run(options, async ({ tree, render, requests }) => {
      quickRead(tree); await settle();
      assert.equal(new Headers(requests[1].options.headers).get(bindingHeader), "operator-a");
      const after = render();
      assert.equal(detail(after), undefined);
      assert.ok(find(after, n => n.type === "Alert"));
    });
  }
});

for (const [status, message] of [
  [401, /انتهت جلسة/],
  [403, /لا تملك صلاحية/],
  [404, /لا يوجد/],
  [503, /تعذّر قراءة/],
]) {
  test(`Captain client rejects HTTP ${status} before exposing owner data`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => response(standing, "operator-a", status));
    await assert.rejects(client.readCaptainJson("/api/captains/captain-a/standing", new AbortController().signal, "operator-a"), { message });
  });
}

test("Captain client rejects absent or changed operator binding even with valid standing data", async (t) => {
  let binding;
  t.mock.method(globalThis, "fetch", async () => response(standing, binding));
  const signal = new AbortController().signal;
  await assert.rejects(client.readCaptainPage("/api/captains", signal));
  await assert.rejects(client.readCaptainJson("/api/captains/captain-a/standing", signal, "operator-a"));
  binding = "operator-b";
  await assert.rejects(client.readCaptainJson("/api/captains/captain-a/standing", signal, "operator-a"));
});

test("Captain client propagates malformed JSON and cancellation without fallback data", async (t) => {
  const signal = new AbortController().signal;
  const transport = t.mock.method(globalThis, "fetch", async () => new Response("not-json", {
    headers: { [bindingHeader]: "operator-a" },
  }));
  await assert.rejects(client.readCaptainJson("/api/captains/captain-a/standing", signal, "operator-a"), SyntaxError);
  const controller = new AbortController();
  controller.abort();
  transport.mock.mockImplementation(async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    options.signal.throwIfAborted();
  });
  await assert.rejects(client.readCaptainPage("/api/captains", controller.signal), { name: "AbortError" });
});

test("Captain standing rejects malformed actor identity, status and version", () => {
  for (const value of [
    null, {}, { ...standing, actorId: 1 }, { ...standing, actorId: "" },
    { ...standing, status: "INVALID" }, { ...standing, version: 0 },
    { ...standing, version: 1.5 }, { ...standing, version: NaN },
    { ...standing, version: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.equal(client.isCaptainStanding(value), false);
  }
  assert.equal(client.isCaptainStanding(standing), true);
});


function queueButton(tree, label) {
  return find(tree, node => node.type === "Button" && node.props.children === label);
}

test("Captain continuation binds the request and response to the verified operator", async (t) => {
  const transport = t.mock.method(globalThis, "fetch", async () => response({ items: [] }, "operator-b"));
  const signal = new AbortController().signal;
  await assert.rejects(client.readCaptainPage("/api/captains?cursor=page2", signal, "operator-a"));
  assert.equal(new Headers(transport.mock.calls[0].arguments[1].headers).get(bindingHeader), "operator-a");
  transport.mock.mockImplementation(async () => response({ items: [] }, "operator-a"));
  assert.equal((await client.readCaptainPage("/api/captains?cursor=page2", signal, "operator-a")).operatorBinding, "operator-a");
});

test("Captain queue returns from an empty final page with a fresh bound read and the same filter", async () => {
  await run({
    listReply: params => response(params.has("cursor") ? { items: [] } : { items: [standing], nextCursor: "page2" }, "operator-a"),
  }, async ({ tree, render, requests }) => {
    queueButton(tree, "الصفحة التالية").props.onClick();
    render(); await settle();
    const last = render();
    assert.deepEqual(table(last).props.dataSource, []);
    const previous = queueButton(last, "الصفحة السابقة");
    assert.ok(previous, "empty final page must offer previous navigation");
    assert.equal(new URL(requests[1].url, "http://localhost").searchParams.get("cursor"), "page2");
    assert.equal(new Headers(requests[1].options.headers).get(bindingHeader), "operator-a");
    previous.props.onClick();
    render(); await settle();
    assert.equal(table(render()).props.dataSource[0].actorId, standing.actorId);
    const back = new URL(requests.at(-1).url, "http://localhost").searchParams;
    assert.equal(back.get("status"), "PENDING");
    assert.equal(back.has("cursor"), false);
    assert.equal(new Headers(requests.at(-1).options.headers).get(bindingHeader), "operator-a");
  });
});

test("Captain queue cancels a pending quick read immediately and rejects stale row callbacks on filter change", async () => {
  let finish;
  await run({
    detailReply: () => new Promise(resolve => { finish = resolve; }),
    listReply: params => response({ items: params.get("status") === "PENDING" ? [standing] : [] }, "operator-a"),
  }, async ({ tree, render, requests }) => {
    quickRead(tree);
    const oldDetail = requests[1].options.signal;
    find(tree, node => node.type === "Select").props.onChange("APPROVED");
    assert.equal(oldDetail.aborted, true, "filter change must cancel before the next render");
    quickRead(tree);
    assert.equal(requests.length, 2, "stale row action must not issue a request");
    finish(response(standing, "operator-a"));
    render(); await settle();
    assert.equal(detail(render()), undefined);
    assert.deepEqual(table(render()).props.dataSource, []);
  });
});

test("Captain BFF rejects a missing or switched continuation binding before contacting DSH", async () => {
  const bff = compileFixture("captains-read-bff.ts", false);
  let ownerReads = 0;
  const imports = {
    "server-only": {},
    "@bthwani/dsh": {
      captainStandingStatuses: ["PENDING", "APPROVED", "SUSPENDED", "REVOKED"],
      DshPublicError: Error,
      listOperatorCaptainStandings: async (_owner, _bearer, params) => {
        ownerReads++;
        assert.equal(params.status, "PENDING");
        return { items: [standing] };
      },
    },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "A".repeat(43) }) }) },
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "../../server/operator-passkey-bff": {
      isTrustedOperatorLoopbackTarget: () => true, OPERATOR_COOKIE: "operator",
      readVerifiedOperatorAccess: async () => ({ actorId: "operator-a", grants: ["operations"] }),
      resolveIsolatedOperatorConfig: () => ({ browserOrigin: "http://localhost" }),
    },
    "../stores/public-store-query": { isolatedPublicDshOrigin: () => "http://localhost" },
  };
  const mod = loadFixture(bff, imports);
  for (const binding of [undefined, "operator-b"]) {
    const res = await mod.exports.readCaptainReview(new Request("http://localhost/api/captains?cursor=page2", {
      headers: binding ? { [bindingHeader]: binding } : {},
    }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { code: "FORBIDDEN" });
    assert.equal(ownerReads, 0);
  }
  const res = await mod.exports.readCaptainReview(new Request("http://localhost/api/captains?cursor=page2", {
    headers: { [bindingHeader]: "operator-a" },
  }));
  assert.equal(res.status, 200);
  assert.equal(ownerReads, 1);
  assert.match(res.headers.get("Cache-Control"), /no-store/);
  assert.equal(res.headers.get(bindingHeader), "operator-a");
});



const decision = { status: "APPROVED", expectedVersion: 1, operationId: "synthetic-operation", reason: "synthetic review" };
const approvedStanding = { ...standing, status: "APPROVED", version: 2 };
const browserOrigin = "http://localhost:13000";
const ownerOrigin = "http://127.0.0.1:18102";
const decisionURL = `${browserOrigin}/api/captains/captain-a/standing`;

function captainMutationFixture(t, { access = { actorId: "operator-a", grants: ["operations"] }, bearer = "A".repeat(43), ownerReply = () => Response.json(approvedStanding, { headers: { "Cache-Control": "no-store" } }) } = {}) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return ownerReply();
  });
  const mod = loadFixture(compileFixture("captains-read-bff.ts", false), {
    "server-only": {},
    "@bthwani/dsh": { ...captainSdk, DshPublicError },
    "next/headers": { cookies: async () => ({ get: () => bearer ? { value: bearer } : undefined }) },
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "../../server/operator-passkey-bff": {
      isTrustedOperatorLoopbackTarget, OPERATOR_COOKIE: "operator",
      readVerifiedOperatorAccess: async () => access,
      resolveIsolatedOperatorConfig: () => ({ browserOrigin }),
    },
    "../stores/public-store-query": { isolatedPublicDshOrigin: () => ownerOrigin },
  });
  const mutate = (body = JSON.stringify(decision), headers = {}, actorId = standing.actorId) =>
    mod.exports.readCaptainReview(new Request(decisionURL, {
      method: "PATCH", body,
      headers: { host: "localhost:13000", origin: browserOrigin, "content-type": "application/json",
        [bindingHeader]: "operator-a", ...headers },
    }), actorId);
  return { mutate, requests };
}

async function assertCaptainMutationError(reply, status, code) {
  assert.equal(reply.status, status);
  assert.deepEqual(await reply.json(), { code });
  assert.match(reply.headers.get("Cache-Control"), /no-store/);
  assert.equal(reply.headers.has(bindingHeader), false);
}

test("Captain BFF forwards a bound versioned decision to the actual DSH client", async t => {
  const { mutate, requests } = captainMutationFixture(t);
  const reply = await mutate();
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), approvedStanding);
  assert.match(reply.headers.get("Cache-Control"), /no-store/);
  assert.equal(reply.headers.get(bindingHeader), "operator-a");
  assert.equal(requests.length, 1);
  const { url, options } = requests[0];
  assert.equal(url, `${ownerOrigin}/v1/operators/captains/captain-a/standing`);
  assert.equal(options.method, "PATCH");
  assert.deepEqual(JSON.parse(options.body), decision);
  assert.equal(new Headers(options.headers).get("Authorization"), `Bearer ${"A".repeat(43)}`);
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
});

test("Captain BFF refuses origin, operator binding and forged authority before owner mutation", async t => {
  const { mutate, requests } = captainMutationFixture(t);
  for (const headers of [
    { origin: "http://localhost:9999" }, { [bindingHeader]: "operator-b" },
    { "content-type": "text/plain" }, { "sec-fetch-site": "cross-site" },
    { "x-actor-id": "operator-a" }, { "x-forwarded-host": "localhost:9999" },
  ]) {
    await assertCaptainMutationError(await mutate(undefined, headers), 403, "FORBIDDEN");
  }
  assert.equal(requests.length, 0);
});

test("Captain BFF refuses a missing or revoked session and missing operations grant", async t => {
  for (const [name, config, status, code] of [
    ["missing cookie", { bearer: "" }, 401, "UNAUTHORIZED"],
    ["revoked access", { access: null }, 401, "UNAUTHORIZED"],
    ["wrong scope", { access: { actorId: "operator-a", grants: ["merchant"] } }, 403, "FORBIDDEN"],
  ]) {
    await t.test(name, async sub => {
      const { mutate, requests } = captainMutationFixture(sub, config);
      await assertCaptainMutationError(await mutate(), status, code);
      assert.equal(requests.length, 0);
    });
  }
});

test("Captain BFF rejects malformed and wrongly typed decisions before contacting DSH", async t => {
  const { mutate, requests } = captainMutationFixture(t);
  for (const body of [
    "{", "null", "[]", JSON.stringify({ ...decision, actorId: "captain-b" }),
    JSON.stringify({ ...decision, expectedVersion: "1" }),
    JSON.stringify({ ...decision, reason: "x".repeat(2100) }),
    JSON.stringify({ ...decision, operationId: 12345678 }),
    JSON.stringify({ ...decision, operationId: ["synthetic-operation"] }),
  ]) {
    await assertCaptainMutationError(await mutate(body), 400, "INVALID_REQUEST");
    assert.equal(requests.length, 0);
  }
});

test("Captain BFF distinguishes definite conflicts from uncertain owner responses", async t => {
  for (const [name, ownerReply, status, code] of [
    ["conflict", () => Response.json({ code: "VERSION_CONFLICT" }, { status: 409 }), 409, "CONFLICT"],
    ["server failure", () => Response.json({ code: "UNAVAILABLE" }, { status: 503 }), 503, "OPERATION_RESULT_UNKNOWN"],
    ["wrong actor", () => Response.json({ ...approvedStanding, actorId: "captain-b" }, { headers: { "Cache-Control": "no-store" } }), 503, "OPERATION_RESULT_UNKNOWN"],
    ["lost reply", () => { throw new TypeError("synthetic network failure"); }, 503, "OPERATION_RESULT_UNKNOWN"],
  ]) {
    await t.test(name, async sub => {
      const { mutate, requests } = captainMutationFixture(sub, { ownerReply });
      await assertCaptainMutationError(await mutate(), status, code);
      assert.equal(requests.length, 1, "no implicit write retry");
    });
  }
});

const detailCompiled = compileFixture("captain-standing-detail.tsx");

const confirmation = tree => find(tree, node => node.type === "Popconfirm");
const reviewReason = (tree, value) => find(tree, node => node.type === "TextArea").props.onChange({ target: { value } });
const patchesSent = requests => requests.filter(request => request.options.method === "PATCH");

async function runStandingReview(scenario) {
  const pending = [];
  let ownerStanding = standing;
  await run({
    component: detailCompiled,
    props: { actorId: standing.actorId, operatorId: "operator-a" },
    detailReply: (_url, options) => options.method === "PATCH"
      ? new Promise(resolve => pending.push(resolve))
      : response(ownerStanding, "operator-a"),
  }, async ({ tree, render, requests, listeners }) => {
    reviewReason(tree, "synthetic reason");
    try {
      await scenario({ ready: render(), render, requests, listeners,
        reject: (status = 400) => pending.shift()(response({}, "operator-a", status)),
        approve: () => {
          ownerStanding = { ...standing, status: "APPROVED", version: standing.version + 1 };
          pending.shift()(response(ownerStanding, "operator-a"));
        } });
    } finally {
      for (const resolve of pending.splice(0)) resolve(response({}, "operator-a", 400));
      await settle();
    }
  });
}

test("Captain decision confirmation is single-flight before React rerenders", async () => {
  await runStandingReview(async ({ ready, requests, reject, render }) => {
    const confirm = confirmation(ready).props.onConfirm;
    confirm(); confirm();
    assert.equal(patchesSent(requests).length, 1);
    reject(); await settle();
    confirm();
    assert.equal(patchesSent(requests).length, 1, "old confirmation cannot retry a definite rejection");
    confirmation(render()).props.onConfirm();
    assert.equal(patchesSent(requests).length, 2, "new explicit confirmation can retry");
  });
});

test("foreground revalidation immediately invalidates an old standing confirmation", async () => {
  await runStandingReview(async ({ ready, requests, listeners, render }) => {
    const confirm = confirmation(ready).props.onConfirm;
    listeners.get("focus")();
    confirm();
    assert.equal(patchesSent(requests).length, 0);
    await settle();
    const fresh = render();
    reviewReason(fresh, "new confirmed reason");
    confirmation(render()).props.onConfirm();
    assert.equal(patchesSent(requests).length, 1);
  });
});

test("changing the review draft immediately invalidates a captured confirmation", async () => {
  await runStandingReview(async ({ ready, requests, render }) => {
    const confirm = confirmation(ready).props.onConfirm;
    reviewReason(ready, "updated reason");
    confirm();
    assert.equal(patchesSent(requests).length, 0);
    confirmation(render()).props.onConfirm();
    assert.equal(JSON.parse(patchesSent(requests)[0].options.body).reason, "updated reason");
  });
});

test("uncertain decision result blocks repeated confirmation, including captured actions", async () => {
  await runStandingReview(async ({ ready, requests, reject, render }) => {
    const confirm = confirmation(ready).props.onConfirm;
    confirm();
    reject(503); await settle();
    confirm();
    assert.equal(patchesSent(requests).length, 1);
    assert.ok(find(render(), node => node.type === "Alert"));
  });
});


test("confirmed Captain decision requires a fresh owner read before a new decision", async () => {
  await runStandingReview(async ({ ready, requests, approve, render }) => {
    const confirm = confirmation(ready).props.onConfirm;
    confirm();
    const sent = patchesSent(requests)[0];
    assert.equal(JSON.parse(sent.options.body).expectedVersion, 1);
    assert.equal(new Headers(sent.options.headers).get(bindingHeader), "operator-a");
    approve(); await settle();
    assert.equal(requests.length, 3, "confirmed PATCH must be followed by a current owner GET");
    confirm();
    assert.equal(patchesSent(requests).length, 1);
    const fresh = render();
    assert.equal(find(fresh, node => node.type === "Select").props.value, "SUSPENDED");
    assert.equal(find(fresh, node => node.type === "TextArea").props.value, "");
    reviewReason(fresh, "new review");
    confirmation(render()).props.onConfirm();
    assert.equal(JSON.parse(patchesSent(requests)[1].options.body).expectedVersion, 2);
  });
});

test("a denied Captain review immediately withdraws the standing and old confirmation", async () => {
  await runStandingReview(async ({ ready, requests, reject, render }) => {
    const confirm = confirmation(ready).props.onConfirm;
    confirm();
    reject(403); await settle();
    confirm();
    assert.equal(patchesSent(requests).length, 1);
    assert.equal(confirmation(render()), undefined);
    assert.ok(find(render(), node => node.type === "Alert"));
  });
});
