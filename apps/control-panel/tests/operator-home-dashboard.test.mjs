import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import { workspaceGroupLabels, workspaceRegistry } from "../src/features/navigation/workspace-registry.ts";
import { operatorPermissions, visibleWorkspaceEntries } from "../src/features/session/operator-permissions.ts";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
// Retain uncached fixture modules until Node collects coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
const source = resolve(import.meta.dirname, "../src/features/workspace/home-dashboard.tsx");
const compiled = transformSync(readFileSync(source, "utf8"), {
  filename: source, sourceMaps: "inline", inlineSourcesContent: true,
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;
const jsx = (type, props) => ({ type, props: props ?? {} });

function render(grants, originalOperator = false) {
  const dependencies = {
    "../navigation/workspace-registry": { workspaceRegistry, workspaceGroupLabels },
    "../operator-shell/operator-icon": { OperatorIcon: ({ name }) => jsx("OperatorIcon", { name }) },
    "../operator-shell/operator-shell.module.css": { workspace: "workspace", sectionGrid: "sectionGrid", sectionCard: "sectionCard" },
    "./home-dashboard.module.css": { hero: "hero", rightsSummary: "rights-summary" },
    "../session/operator-permissions": { visibleWorkspaceEntries },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  };
  const mod = loadMappedRenderFixture(compiled, source, dependencies);
  loadedModules.push(mod);
  return mod.exports.default({ grants, originalOperator, marketOverview: jsx("section", { "aria-label": "مراجعة بيانات DSH" }) });
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
  assert.equal(walk(tree, node => node.type === "details" &&
    walk(node, child => child.props?.["aria-label"] === "مراجعة بيانات DSH").length > 0).length, 0,
    "verified market data must be immediately visible rather than hidden behind a disclosure");
  assert.equal(walk(tree, node => node.props?.id === "order-trends-heading").length, 0,
    "unavailable order trends must not occupy a dashboard panel");
  assert.equal(walk(tree, node => node.type === "strong" && node.props.children === "—").length, 0,
    "unavailable totals must not be presented as metric cards");
});

test("Operator homepage never exposes denied section links to an actor without grants", () => {
  const tree = render([]);
  assert.equal(walk(tree, node => node.type === "a").length, 0);
});

function sectionLinks(tree, id) {
  const section = walk(tree, node => node.props?.["aria-labelledby"] === id)[0];
  assert.ok(section, id);
  return walk(section, node => node.type === "a").map(node => node.props.href);
}

for (const grants of [["marketing"], ["hr"], operatorPermissions]) {
  test(`all permitted destinations are actionable: ${grants.join(",")}`, () => {
    const expected = visibleWorkspaceEntries(grants).filter(entry => entry.href !== "/workspace").map(entry => entry.href);
    const tree = render(grants);
    assert.deepEqual(sectionLinks(tree, "quick-actions-heading"), expected);
    assert.deepEqual(sectionLinks(tree, "enabled-destinations-heading"), expected);
  });
}

test("original operator access is only displayed for verified original authority", () => {
  for (const id of ["quick-actions-heading", "enabled-destinations-heading"]) {
    assert.ok(!sectionLinks(render(["hr"]), id).includes("/access"));
    assert.ok(sectionLinks(render(["hr"], true), id).includes("/access"));
  }
});

test("quick actions precede optional market data", () => {
  const panels = walk(render(["merchant"]), node => node.props?.id === "quick-actions-heading" || node.props?.["aria-label"] === "مراجعة بيانات DSH");
  assert.equal(panels[0].props.id, "quick-actions-heading");
});

test("empty grant state does not claim verified permissions", () => {
  assert.equal(walk(render([]), node => node.type === "strong" && node.props.children === "مؤكدة").length, 0);
});

const pageSource = resolve(import.meta.dirname, "../app/(workspace)/workspace/page.tsx");
const pageCompiled = transformSync(readFileSync(pageSource, "utf8"), {
  filename: pageSource, sourceMaps: "inline", inlineSourcesContent: true,
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;

async function renderPage(access, original) {
  const dependencies = {
    "../../../src/features/workspace/home-dashboard": () => null,
    "../../../src/features/workspace/public-market-overview": () => null,
    "../../../src/server/current-operator-access": {
      currentOperatorAccess: async () => access,
      currentOriginalOperatorPermissions: async () => original,
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  };
  const mod = loadMappedRenderFixture(pageCompiled, pageSource, dependencies);
  loadedModules.push(mod);
  return mod.exports.default({ searchParams: Promise.resolve({}) });
}

for (const [label, access, original, expected] of [
  ["same actor", { actorId: "actor-a", grants: ["hr"] }, { actorId: "actor-a", permissions: [] }, true],
  ["different actor", { actorId: "actor-a", grants: ["hr"] }, { actorId: "actor-b", permissions: [] }, false],
  ["missing proof", { actorId: "actor-a", grants: ["hr"] }, null, false],
  ["signed out", null, { actorId: "actor-a", permissions: [] }, false],
]) {
  test(`workspace page original authority: ${label}`, async () => {
    const tree = await renderPage(access, original);
    assert.equal(tree.props.originalOperator, expected);
    assert.deepEqual(tree.props.grants, access?.grants ?? []);
  });
}
