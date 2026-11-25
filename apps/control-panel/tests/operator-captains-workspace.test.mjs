import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as client from "../src/features/captains/captains-read-client.ts";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const compiled = transformSync(readFileSync(new URL("../src/features/captains/captains-workspace.tsx", import.meta.url), "utf8"), {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;
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
    const mod = { exports: {} };
    new Function("require", "module", "exports", component)(name => {
      assert.ok(Object.hasOwn(imports, name), name); return imports[name];
    }, mod, mod.exports);
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
  const bffCode = transformSync(readFileSync(new URL("../src/features/captains/captains-read-bff.ts", import.meta.url), "utf8"), {
    jsc: { parser: { syntax: "typescript" }, target: "es2022" }, module: { type: "commonjs" },
  }).code;
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
  const mod = { exports: {} };
  new Function("require", "module", "exports", bffCode)(name => {
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  }, mod, mod.exports);
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


const detailCompiled = transformSync(readFileSync(new URL("../src/features/captains/captain-standing-detail.tsx", import.meta.url), "utf8"), {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;

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
