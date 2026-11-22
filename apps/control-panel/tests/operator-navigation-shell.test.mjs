import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { workspaceGroupLabels, workspaceRegistry, workspaceSubsections } from "../src/features/navigation/workspace-registry.ts";

const root = resolve(import.meta.dirname, "..");
const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const jsx = (type, props) => ({ type, props: props ?? {} });
const source = readFileSync(resolve(root, "src/features/operator-shell/operator-shell.tsx"), "utf8");
const compiled = transformSync(source, {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;

function render(grants, pathname = "/marketing") {
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    const deps = {
      "next/navigation": { usePathname: () => pathname },
      react: { useState: () => ["idle", () => {}] },
      "../navigation/workspace-registry": {
        workspaceRegistry, workspaceGroupLabels, workspaceSubsections,
        findWorkspaceEntry: path => workspaceRegistry.find(entry => entry.href === path) ?? null,
      },
      "../session/operator-permissions": {
        visibleWorkspaceEntries: current => current.includes("marketing")
          ? workspaceRegistry.filter(entry => ["/workspace", "/marketing", "/studio"].includes(entry.href))
          : [],
        canEnterOperatorWorkspace: () => false,
      },
      "./operator-shell.module.css": {
        shell: "shell", publicShell: "public", sidebar: "sidebar", publicBar: "public-bar",
        brand: "brand", navigation: "navigation", groupLabel: "group-label",
        lockedNavigationItem: "locked", content: "content", logout: "logout",
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
    };
    assert.ok(Object.hasOwn(deps, name), `unexpected ${name}`);
    return deps[name];
  }, mod, mod.exports);
  return mod.exports.default({ children: jsx("p", { children: "protected" }),
    verifiedGrants: grants, originalOperator: false });
}

function walk(node, predicate, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, predicate, out);
  } else if (node && typeof node === "object") {
    if (predicate(node)) out.push(node);
    walk(node.props?.children, predicate, out);
  }
  return out;
}

test("verified Marketing-only operator sees all section labels without unauthorized navigation links", () => {
  const tree = render(["marketing"]);
  const allowed = walk(tree, node => node.type === "a").map(node => node.props.href);
  assert.ok(allowed.includes("/marketing"));
  assert.ok(allowed.includes("/studio"));
  assert.ok(allowed.includes("/workspace"));
  assert.ok(!allowed.includes("/finance"));
  assert.ok(!allowed.includes("/access"));
  assert.ok(!allowed.includes("/merchants"));
  const locked = walk(tree, node => node.type === "span" && node.props["aria-disabled"] === "true");
  assert.ok(locked.some(node => String(node.props.children).includes("المالية")));
  assert.ok(locked.some(node => String(node.props.children).includes("التجار")));
});

test("login screen renders only its form before authentication, without navigation or sidebar", () => {
  const tree = render(null, "/");
  assert.equal(tree.props.className, undefined);
  assert.equal(walk(tree, node => node.type === "aside").length, 0);
  assert.equal(walk(tree, node => node.type === "nav").length, 0);
  assert.equal(walk(tree, node => node.type === "a").length, 0);
  assert.ok(walk(tree, node => node.type === "p" && node.props.children === "protected").length === 1);
});

test("unauthenticated visitor sees no privileged links or locked admin items", () => {
  const tree = render(null);
  const links = walk(tree, node => node.type === "a").map(node => node.props.href);
  assert.deepEqual(links.sort(), ["/", "/health"]);
  assert.equal(walk(tree, node => node.type === "span" && node.props["aria-disabled"] === "true").length, 0);
});
