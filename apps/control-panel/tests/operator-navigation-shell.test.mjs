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

function shellHarness(grants, pathname = "/marketing") {
  const states = [], effects = [], requests = [], redirects = [];
  let index = 0, poll;
  const events = new Map();
  const doc = { visibilityState: "visible", addEventListener: (name, fn) => events.set(name, fn), removeEventListener: () => {} };
  const win = { location: { replace: url => redirects.push(url) }, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: () => {} };
  const deadline = new Date(Date.now() + 300000).toISOString();
  const mod = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval", compiled)(name => {
    const deps = {
      "next/navigation": { usePathname: () => pathname },
      react: {
        useState(initial) { const at = index++; if (!(at in states)) states[at] = initial; return [states[at], next => { states[at] = typeof next === "function" ? next(states[at]) : next; }]; },
        useEffect(fn) { index++; effects.push(fn); },
        useRef(initial) { const at = index++; states[at] ??= { current: initial }; return states[at]; },
      },
      "../navigation/workspace-registry": {
        workspaceRegistry, workspaceGroupLabels, workspaceSubsections,
        findWorkspaceEntry: path => workspaceRegistry.find(entry => entry.href === path) ?? null,
      },
      "../session/operator-browser-session": { withOperatorBrowserSession: action => action(),
        notifyOperatorSessionChanged() {}, subscribeOperatorSessionChanged(fn) { events.set("session-change", fn); return () => {}; } },
      "../session/operator-permissions": {
        visibleWorkspaceEntries: current => current.includes("marketing")
          ? workspaceRegistry.filter(entry => ["/workspace", "/marketing", "/studio"].includes(entry.href))
          : [],
        canEnterOperatorWorkspace: () => false,
      },
      "./operator-icon": { OperatorIcon: ({ name }) => jsx("OperatorIcon", { name }) },
      "./operator-navigation-search": { default: ({ entries }) => jsx("NavigationSearch", { entries }) },
      "./operator-shell.module.css": {
        shell: "shell", publicShell: "public", sidebar: "sidebar", publicBar: "public-bar",
        brand: "brand", navigation: "navigation", groupLabel: "group-label",
        lockedNavigationItem: "locked", content: "content", logout: "logout",
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
    };
    assert.ok(Object.hasOwn(deps, name), `unexpected ${name}`);
    return deps[name];
  }, mod, mod.exports, win, doc, (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
    () => 1, () => {}, fn => { poll = fn; return 2; }, () => {});
  return {
    requests, redirects, deadline, events, doc,
    render() {
      index = 0; effects.length = 0;
      return mod.exports.default({ children: jsx("p", { children: "protected" }),
        verifiedGrants: grants, originalOperator: false, verifiedActorId: grants ? "operator-a" : null,
        verifiedExpiresAt: grants ? deadline : null,
        appearanceControl: jsx("AppearanceControl", { "aria-label": "اختيار المظهر" }) });
    },
    mount() { for (const fn of effects) fn(); },
    poll() { poll?.(); },
  };
}
function render(grants, pathname = "/marketing") { return shellHarness(grants, pathname).render(); }

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
  assert.ok(locked.some(node => JSON.stringify(node.props.children).includes("المالية")));
  assert.ok(locked.some(node => JSON.stringify(node.props.children).includes("التجار")));
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
  assert.deepEqual(links.filter(href => href.startsWith("/")).sort(), ["/", "/health"]);
  assert.ok(links.includes("#operator-content"), "the public screen retains a keyboard skip link");
  assert.equal(walk(tree, node => node.type === "span" && node.props["aria-disabled"] === "true").length, 0);
});


test("verified operator has a unified accessible toolbar with current location and appearance control", () => {
  const tree = render(["marketing"], "/marketing");
  const bars = walk(tree, node => node.type === "section" && node.props["aria-label"] === "شريط أدوات لوحة التحكم");
  assert.equal(bars.length, 1);
  assert.equal(walk(bars[0], node => node.type === "AppearanceControl").length, 1);
  assert.equal(walk(bars[0], node => node.type === "span" && node.props.children === "التسويق والتصميم").length, 1);
  assert.equal(walk(tree, node => node.type === "section" && node.props["aria-label"] === "التسويق والتصميم").length, 1);
  assert.ok(walk(tree, node => node.type === "a" && node.props.href === "#operator-content").length === 1);
  assert.ok(walk(tree, node => node.props.id === "operator-content").length === 1);
});

test("unauthenticated entry does not render a privileged toolbar or appearance controls", () => {
  for (const path of ["/", "/marketing"]) {
    const tree = render(null, path);
    assert.equal(walk(tree, node => node.type === "section" && node.props["aria-label"] === "شريط أدوات لوحة التحكم").length, 0);
    assert.equal(walk(tree, node => node.type === "AppearanceControl").length, 0);
  }
});

test("active Operator silently revalidates the same actor and scopes, conceals on outage and refuses changed actor", async () => {
  const h = shellHarness(["marketing"]);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const visible = () => !walk(h.render(), n => n.type === "aside")[0].props.hidden;
  h.render(); h.mount();
  await settle();
  assert.equal(h.requests.length, 1, "active workspace must read the owner without a manual click");
  const verified = { authenticated: true, actorId: "operator-a", role: "operator", originalOperator: false, grants: ["marketing"], sessionExpiresAt: new Date(Date.now() + 300000).toISOString() };
  h.requests.shift().resolve(Response.json(verified)); await settle();
  assert.equal(visible(), true); assert.deepEqual(h.redirects, []);
  h.poll(); h.requests.shift().resolve(Response.json({ code: "OWNER_UNAVAILABLE" }, { status: 503 })); await settle();
  assert.equal(visible(), false);
  h.poll(); h.requests.shift().resolve(Response.json(verified)); await settle();
  assert.equal(visible(), true); assert.deepEqual(h.redirects, []);
  h.events.get("session-change")();
  assert.equal(visible(), false, "other tab change conceals before owner reply");
  h.requests.shift().resolve(Response.json({ ...verified, actorId: "operator-b" })); await settle();
  assert.equal(walk(h.render(), n => n.type === "aside").length, 0); assert.deepEqual(h.redirects, ["/"]);
});

test("changed verified Operator scopes never reuse the old workspace", async () => {
  const h = shellHarness(["marketing"]);
  h.render(); h.mount(); await new Promise(resolve => setImmediate(resolve));
  h.requests.shift().resolve(Response.json({ authenticated: true, actorId: "operator-a", role: "operator", originalOperator: false,
    grants: ["operations"], sessionExpiresAt: new Date(Date.now() + 300000).toISOString() }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(walk(h.render(), n => n.type === "aside").length, 0);
  assert.deepEqual(h.redirects, ["/"]);
});

test("Operator changes in original-owner authority discard the previous workspace even with identical grants", async () => {
  const h = shellHarness(["marketing"]);
  h.render(); h.mount(); await new Promise(resolve => setImmediate(resolve));
  h.requests.shift().resolve(Response.json({ authenticated: true, actorId: "operator-a", role: "operator",
    originalOperator: true, grants: ["marketing"], sessionExpiresAt: new Date(Date.now() + 300000).toISOString() }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(walk(h.render(), n => n.type === "aside").length, 0);
  assert.deepEqual(h.redirects, ["/"]);
});
