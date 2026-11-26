import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const source = resolve(import.meta.dirname, "../src/features/operator-shell/workspace-unavailable.tsx");
const compiled = transformSync(readFileSync(source, "utf8"), {
  filename: source, sourceMaps: "inline", inlineSourcesContent: true,
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;
const jsx = (type, props) => ({ type, props: props ?? {} });
const Title = "Title", Paragraph = "Paragraph", Alert = "Alert";
const modules = {
  antd: { Alert, Typography: { Title, Paragraph } },
  "./workspace-unavailable.module.css": { workspace: "workspace", card: "card", kicker: "kicker", description: "description", warning: "warning", footer: "footer", returnLink: "returnLink" },
  "react/jsx-runtime": { jsx, jsxs: jsx },
};
const m = loadMappedRenderFixture(compiled, source, modules);
// Retain the uncached fixture until Node collects coverage.
process.once("exit", () => m.exports);
function walk(node, pred, all = []) {
  if (Array.isArray(node)) { for (const child of node) walk(child, pred, all); }
  else if (node && typeof node === "object") {
    if (pred(node)) all.push(node);
    walk(node.props?.children, pred, all);
  }
  return all;
}
test("Unavailable page remains an honest accessible owner-backed disabled state", () => {
  const tree = m.exports.default({ title: "المالية", description: "عرض الحالة المالية", owner: "WLT" });
  assert.equal(tree.type, "main");
  assert.equal(tree.props["aria-labelledby"], "workspace-title");
  assert.equal(walk(tree, n => n.type === Title && n.props.level === 1 && n.props.id === "workspace-title").length, 1);
  assert.equal(walk(tree, n => n.type === Alert && n.props.type === "warning").length, 1);
  assert.equal(walk(tree, n => n.type === "a" && n.props.href === "/workspace").length, 1);
  assert.match(JSON.stringify(tree), /WLT/);
});
