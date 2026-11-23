import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { workspaceGroupLabels, workspaceRegistry } from "../src/features/navigation/workspace-registry.ts";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const source = readFileSync(resolve(import.meta.dirname, "../src/features/workspace/home-dashboard.tsx"), "utf8");
const compiled = transformSync(source, {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;
const jsx = (type, props) => ({ type, props: props ?? {} });

function render(grants) {
  const mod = { exports: {} };
  const dependencies = {
    "../navigation/workspace-registry": { workspaceRegistry, workspaceGroupLabels },
    "../operator-shell/operator-shell.module.css": { workspace: "workspace", sectionGrid: "sectionGrid", sectionCard: "sectionCard" },
    "./home-dashboard.module.css": { hero: "hero", rightsSummary: "rights-summary" },
    "../session/operator-permissions": {
      visibleWorkspaceEntries: allowed => workspaceRegistry.filter(entry =>
        entry.href === "/workspace" ? allowed.length > 0 : entry.permission !== null && allowed.includes(entry.permission)),
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports.default({ grants, marketOverview: jsx("section", { "aria-label": "مراجعة بيانات DSH" }) });
}
function walk(node, predicate, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, predicate, out);
  } else if (node && typeof node === "object") {
    if (predicate(node)) out.push(node);
    walk(node.props?.children, predicate, out);
  }
  return out;
}

test("Operator homepage describes only permission-derived sections and no invented business totals", () => {
  const tree = render(["marketing"]);
  assert.equal(walk(tree, node => node.props?.["aria-label"] === "ملخص الصلاحيات الحالية").length, 1);
  const links = walk(tree, node => node.type === "a").map(node => node.props.href);
  assert.ok(links.includes("/marketing"));
  assert.ok(links.includes("/studio"));
  assert.ok(!links.includes("/finance"));
  assert.ok(!links.includes("/merchants"));
  assert.equal(walk(tree, node => node.props?.["aria-label"] === "مراجعة بيانات DSH").length, 1);
});

test("Operator homepage never exposes denied section links to an actor without grants", () => {
  const tree = render([]);
  assert.equal(walk(tree, node => node.type === "a").length, 0);
});
