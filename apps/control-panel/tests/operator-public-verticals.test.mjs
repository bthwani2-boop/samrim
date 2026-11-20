import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as query from "../src/features/stores/public-store-query.ts";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");

const source = readFileSync(fileURLToPath(
  new URL("../app/(workspace)/merchants/public-stores/page.tsx", import.meta.url),
), "utf8");
const compiled = transformSync(source, {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;

const store = Object.freeze({
  id: "market-sanaa", name: "متجر أ", cityId: "sanaa", verticalId: "grocery",
  orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
});
const jsx = (type, props) => ({ type, props: props ?? {} });
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
function harness({ permitted = true, failVertical = false, failStores = false } = {}) {
  const calls = [];
  const imports = {
    "@bthwani/dsh": {
      async listPublicStores(origin, city, opts) {
        calls.push({ kind: "stores", origin, city, opts });
        if (failStores) throw new Error("DSH Stores unavailable");
        return { items: [store], revision: 3 };
      },
      async listPublicVerticals(origin, city, opts) {
        calls.push({ kind: "verticals", origin, city, opts });
        if (failVertical) throw new Error("DSH verticals unavailable");
        return { items: [{ id: "grocery", storeCount: 2 }], revision: 3 };
      },
    },
    "../../../../src/features/operator-shell/operator-shell.module.css": { workspace: "workspace" },
    "../../../../src/features/operator-shell/workspace-unavailable": () => null,
    "../../../../src/features/stores/public-store-query": {
      ...query, resolvePublicDshOrigin: () => "http://127.0.0.1:3202",
    },
    "../../../../src/server/current-operator-access": {
      currentOperatorAccess: async () => permitted ? { grants: ["merchant"] } : null,
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    name => {
      assert.ok(Object.hasOwn(imports, name), `unapproved import: ${name}`);
      return imports[name];
    }, mod, mod.exports,
  );
  return {
    calls,
    render: (params = { city: "sanaa", vertical: "grocery" }) =>
      mod.exports.default({ searchParams: Promise.resolve(params) }),
  };
}

test("unverified Operator never reads DSH Stores or vertical taxonomy", async () => {
  const page = harness({ permitted: false });
  const view = await page.render();
  assert.equal(page.calls.length, 0);
  assert.equal(find(view, node => node.type === "datalist"), undefined);
});

test("authorized Operator renders actual DSH verticals as suggestions without bypassing Store scope", async () => {
  const page = harness();
  const view = await page.render();
  assert.deepEqual(page.calls.map(call => call.kind).sort(), ["stores", "verticals"]);
  assert.ok(page.calls.every(call => call.origin === "http://127.0.0.1:3202" && call.city === "sanaa"));
  assert.equal(page.calls.find(call => call.kind === "stores").opts.verticalId, "grocery");
  assert.equal(page.calls.find(call => call.kind === "verticals").opts.limit, 50);
  const input = find(view, node => node.type === "input" && node.props?.name === "vertical");
  assert.equal(input.props.list, "operator-public-vertical-options");
  assert.equal(input.props.defaultValue, "grocery");
  const dropdown = find(view, node => node.type === "datalist");
  assert.equal(dropdown.props.id, "operator-public-vertical-options");
  assert.equal(find(dropdown, node => node.type === "option")?.props.value, "grocery");
  assert.ok(find(view, node => node.type === "strong" && node.props.children === "متجر أ"));
});

test("vertical owner outage keeps DSH Store results and provides a manual filter", async () => {
  const page = harness({ failVertical: true });
  const view = await page.render();
  assert.ok(find(view, node => node.type === "strong" && node.props.children === "متجر أ"));
  assert.ok(find(view, node => node.type === "input" && node.props.name === "vertical"));
  assert.ok(find(view, node => node.props?.role === "status" &&
    typeof node.props.children === "string" && node.props.children.includes("تعذّر تحميل خيارات")));
});

test("Store owner outage never displays invented Stores despite valid vertical choices", async () => {
  const page = harness({ failStores: true });
  const view = await page.render();
  assert.equal(find(view, node => node.type === "strong"), undefined);
  assert.ok(find(view, node => node.type === "datalist"));
  assert.ok(find(view, node => node.props?.role === "alert"));
});
