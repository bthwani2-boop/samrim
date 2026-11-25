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

async function run({ listBinding = "operator-a", omitListBinding = false, detailBinding = "operator-a", status = 200 } = {}, scenario) {
  const hooks = [], effects = new Map(), requests = [];
  let index = 0, scheduled = [];
  const react = {
    useState(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = initial;
      return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }];
    },
    useRef(initial) { const at = index++; hooks[at] ??= { current: initial }; return hooks[at]; },
    useCallback(fn) { index++; return fn; },
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
      Space: "Space", Table: "Table", Tag: "Tag",
      Typography: { Title: "Title", Paragraph: "Paragraph", Text: "Text" } },
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "./captains-read-client": client,
  };
  const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/standing")) {
      if (new Headers(options.headers).get(bindingHeader) !== "operator-a") return response({}, detailBinding, 403);
      return response(standing, detailBinding, status);
    }
    return response({ items: [standing] }, omitListBinding ? undefined : listBinding);
  };
  try {
    const mod = { exports: {} };
    new Function("require", "module", "exports", compiled)(name => {
      assert.ok(Object.hasOwn(imports, name), name); return imports[name];
    }, mod, mod.exports);
    const render = () => {
      index = 0; scheduled = [];
      const tree = mod.exports.default({});
      for (const effect of scheduled) effect();
      return tree;
    };
    render(); await settle();
    const tree = render();
    await scenario({ tree, render, requests });
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
