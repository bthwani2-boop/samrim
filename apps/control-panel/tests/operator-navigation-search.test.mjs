import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import { workspaceRegistry } from "../src/features/navigation/workspace-registry.ts";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
// Retain uncached fixture modules until Node collects coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
const source = resolve(import.meta.dirname, "../src/features/operator-shell/operator-navigation-search.tsx");
const compiled = transformSync(readFileSync(source, "utf8"), {
  filename: source, sourceMaps: "inline", inlineSourcesContent: true,
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;
const jsx = (type, props) => ({ type, props: props ?? {} });
function render(query, entries) {
  const deps = {
    react: {
      useEffect: () => {},
      useRef: () => ({ current: null }),
      useState: () => [query, () => {}],
    },
    "./operator-icon": { OperatorIcon: ({ name }) => jsx("OperatorIcon", { name }) },
    "./operator-shell.module.css": { commandSearch: "search", searchForm: "form", searchResults: "results" },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  };
  const mod = loadMappedRenderFixture(compiled, source, deps);
  loadedModules.push(mod);
  return mod.exports.default({ entries });
}
function walk(node, pred, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, pred, out);
  } else if (node && typeof node === "object") {
    if (pred(node)) out.push(node);
    walk(node.props?.children, pred, out);
  }
  return out;
}
test("navigation search finds only authorized destinations, including a full-document link", () => {
  const allowed = workspaceRegistry.filter(entry => ["/workspace", "/marketing", "/studio"].includes(entry.href));
  const tree = render("التسويق", allowed);
  const found = walk(tree, node => node.type === "a").map(node => node.props.href);
  assert.deepEqual(found, ["/marketing"]);
  const forbidden = render("المالية", allowed);
  assert.deepEqual(walk(forbidden, node => node.type === "a"), []);
  assert.ok(walk(forbidden, node => node.type === "p" && node.props.children === "لا توجد أقسام مسموح بها تطابق البحث.").length);
});
test("empty query exposes no search result links, and search input remains labelled", () => {
  const tree = render("", workspaceRegistry);
  assert.equal(walk(tree, node => node.type === "a").length, 0);
  assert.equal(walk(tree, node => node.type === "input" && node.props["aria-label"] === "بحث عن قسم أو وظيفة مسموح بها").length, 1);
});
