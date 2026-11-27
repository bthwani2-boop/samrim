import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DshPublicError } from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

const actor = "customer-a";
const bearer = Buffer.alloc(32, 14).toString("base64url");
const entry = { storeId: "store-a", storeName: "Test Store", version: 1, lineCount: 1 };
const page = { actorId: actor, carts: [entry] };
const json = value => Response.json(value, { headers: { "Cache-Control": "no-store" } });
const session = (actorId = actor, expiresAt = Date.now() + 120_000) =>
  ({ actorId, role: "customer", sessionExpiresAt: new Date(expiresAt).toISOString() });
process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW = "1";
process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN = "http://127.0.0.1:3202";
process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN = "http://127.0.0.1:3201";
const { handleCustomerCartDirectory } = await import("../cart/cart-directory-bff.ts");
const base = "http://localhost/api/customer-auth/carts";
const request = (suffix = "", headers = {}) => new Request(base + suffix, {
  headers: { Cookie: "bthwani_customer_auth=" + bearer, "X-Customer-Context": actor, ...headers },
});

test("directory BFF rejects caller-selected actors, cross-site and duplicate cursor without owner dispatch", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw Error("unexpected"); });
  for (const [req, status] of [
    [new Request(base), 401], [request("?actorId=customer-b"), 400], [request("?after=a&after=b"), 400],
    [request("", { "Sec-Fetch-Site": "cross-site" }), 403], [request("", { Origin: "https://other.example" }), 403],
  ]) {
    const response = await handleCustomerCartDirectory(req);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(calls, 0);
});

test("directory BFF checks identity before and after owner read; changed actor cannot receive data", async t => {
  const calls = [];
  let changed = false, reads = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push([String(url), init.method]);
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    if (String(url).startsWith("http://127.0.0.1:3201")) return json(session(changed && ++reads > 1 ? "customer-b" : actor));
    return json(page);
  });
  assert.deepEqual(await (await handleCustomerCartDirectory(request())).json(), page);
  assert.equal(calls[1][0], "http://127.0.0.1:3202/v1/carts");
  changed = true; reads = 0;
  const denied = await handleCustomerCartDirectory(request());
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).carts, undefined);
});

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const screen = fileURLToPath(new URL("./multi-store-checkout-screen.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-cart-directory-render-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/@typescript/native/bin/tsc"), screen,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temp],
    { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "multi-store-checkout-screen.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

test("directory remains a read-only owner view without order orchestration", () => {
  const source = readFileSync(screen, "utf8");
  assert.match(source, /readVerifiedCartDirectory\(/);
  assert.match(source, /\/cart\/\[storeId\]/);
  assert.match(source, /checkout-confirmation-unavailable/);
  assert.doesNotMatch(source, /createOrder\(|fetch\(|payment\(/);
});

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
}
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const settle = () => new Promise(setImmediate);
const links = tree => nodes(tree).filter(n => n.type === "Link" && n.props.href?.pathname === "/cart/[storeId]");
const text = tree => nodes(tree).filter(n => n.type === "Text").flatMap(n => n.props.children).join(" ");
const login = tree => nodes(tree).some(n => n.type === "Link" && n.props.href === "/login");
const button = (tree, label) => nodes(tree).find(n => n.type === "Pressable" &&
  nodes(n.props.children).some(child => child.type === "Text" && child.props.children === label));

/* Execute the original TSX, including its effects, with controlled platform
 * events and a deterministic clock. Owner responses remain synthetic here;
 * actual authenticated device and PostgreSQL proof are separate gates. */
function harness(t, os = "android", initial = "active") {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: new Date("2026-11-26T00:00:00Z") });
  const hooks = [], reads = [], polls = [], cleanups = [], effects = [];
  const windowEvents = new Map(), documentEvents = new Map();
  let index = 0, focus, focusCleanup, appListener;
  let visible = initial === "active", hasFocus = visible;
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = map => ({
    addEventListener(name, callback) { map.set(name, callback); },
    removeEventListener(name, callback) { if (map.get(name) === callback) map.delete(name); },
  });
  if (os === "web") {
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      ...events(documentEvents), get visibilityState() { return visible ? "visible" : "hidden"; },
      hasFocus: () => hasFocus,
    } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events(windowEvents) });
  }
  const appState = {
    currentState: initial,
    addEventListener(_name, callback) {
      appListener = callback;
      return { remove() { if (appListener === callback) appListener = undefined; } };
    },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const modules = {
    "@bthwani/dsh": { DshPublicError },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "expo-router": { Link: "Link", useFocusEffect(callback) { focus = callback; } },
    react: {
      useState(initialValue) {
        const at = index++;
        if (!(at in hooks)) hooks[at] = initialValue;
        return [hooks[at], next => { hooks[at] = typeof next === "function" ? next(hooks[at]) : next; }];
      },
      useRef(initialValue) { const at = index++; hooks[at] ??= { current: initialValue }; return hooks[at]; },
      useCallback(callback, deps) {
        const at = index++;
        if (!same(hooks[at]?.deps, deps)) hooks[at] = { deps, callback };
        return hooks[at].callback;
      },
      useEffect(callback, deps) {
        const at = index++;
        if (!same(hooks[at]?.deps, deps)) {
          hooks[at] = { deps };
          effects.push(() => { cleanups[at]?.(); cleanups[at] = callback(); });
        }
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Platform: { OS: os }, AppState: appState, Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../cart/cart-directory-transport": {
      readVerifiedCartDirectory: (signal, after, actorId) => new Promise((resolve, reject) => reads.push({ signal, after, actorId, resolve, reject })),
      verifyCartDirectorySession: (signal, actorId) => new Promise((resolve, reject) => polls.push({ signal, actorId, resolve, reject })),
    },
  };
  const mod = loadMappedRenderFixture(compiled, screen, modules);
  const render = () => {
    index = 0;
    const tree = mod.exports.default();
    for (const effect of effects.splice(0)) effect();
    return tree;
  };
  const blur = () => { focusCleanup?.(); focusCleanup = undefined; };
  t.after(() => {
    blur();
    for (const cleanup of cleanups) cleanup?.();
    if (os === "web") {
      for (const [name, prior] of [["document", priorDocument], ["window", priorWindow]]) {
        if (prior) Object.defineProperty(globalThis, name, prior);
        else delete globalThis[name];
      }
    }
  });
  return {
    reads, polls, render, blur,
    focus() { blur(); focusCleanup = focus(); },
    app(value) { appState.currentState = value; appListener?.(value); },
    windowFocus(value) { hasFocus = value; windowEvents.get(value ? "focus" : "blur")?.(); },
    visibility(value) { visible = value; documentEvents.get("visibilitychange")?.(); },
    async tick(ms) { t.mock.timers.tick(ms); await settle(); },
    async respond(at, value = page, expiresAt = Date.now() + 60_000) {
      reads[at].resolve({ value, expiresAt }); await settle(); return render();
    },
  };
}

test("actual screen renders verified Store links, rejects duplicate continuation and late response after blur", async t => {
  const h = harness(t);
  h.render(); h.focus();
  assert.equal(links(h.render()).length, 0);
  const view = await h.respond(0, { ...page, nextCursor: "store-a" });
  assert.equal(links(view)[0].props.href.params.storeId, "store-a");
  const next = button(view, "المزيد من السلال").props.onPress;
  next(); next();
  assert.equal(h.reads.length, 2);
  assert.equal(h.reads[1].after, "store-a");
  assert.equal(h.reads[1].actorId, actor);
  h.blur();
  assert.equal(h.reads[1].signal.aborted, true);
  await h.respond(1, { ...page, carts: [{ ...entry, storeId: "store-b" }] });
  assert.equal(links(h.render()).length, 0);
  h.focus(); next();
  assert.equal(h.reads.length, 3);
  const empty = await h.respond(2, { ...page, carts: [] });
  assert.equal(links(empty).length, 0);
  assert.match(text(empty), /لا توجد سلال محفوظة/);
});

test("failed continuation retries the same cursor and verified actor; old retry cannot dispatch again", async t => {
  const h = harness(t); h.render(); h.focus();
  const view = await h.respond(0, { ...page, nextCursor: "store-a" });
  button(view, "المزيد من السلال").props.onPress();
  h.reads[1].reject(new Error("owner temporarily unavailable")); await settle();
  assert.equal(links(h.render()).length, 0);
  const retry = button(h.render(), "إعادة المحاولة").props.onPress;
  retry(); retry();
  assert.equal(h.reads.length, 3);
  assert.equal(h.reads[2].after, "store-a");
  assert.equal(h.reads[2].actorId, actor);
  const restored = await h.respond(2, { ...page, carts: [{ ...entry, storeId: "store-b" }] });
  assert.equal(links(restored)[0].props.href.params.storeId, "store-b");
  retry(); assert.equal(h.reads.length, 3);
});

test("return to first page is bound to the actor and old callbacks cannot interrupt a new focus", async t => {
  const h = harness(t); h.render(); h.focus();
  button(await h.respond(0, { ...page, nextCursor: "store-a" }), "المزيد من السلال").props.onPress();
  const restart = button(await h.respond(1, { ...page, carts: [{ ...entry, storeId: "store-b" }] }), "العودة إلى البداية").props.onPress;
  restart(); restart();
  assert.equal(h.reads.length, 3);
  assert.equal(h.reads[2].after, undefined);
  assert.equal(h.reads[2].actorId, actor);
  h.blur(); h.render(); h.focus(); restart();
  assert.equal(h.reads.length, 4);
});

test("shortened verified session expiry conceals cart data before the original deadline", async t => {
  const h = harness(t); h.render(); h.focus();
  await h.respond(0);
  await h.tick(15_000);
  assert.equal(h.polls.length, 1);
  assert.equal(h.polls[0].actorId, actor);
  h.polls[0].resolve(session(actor, Date.now() + 2_000)); await settle(); h.render();
  assert.equal(links(h.render()).length, 1);
  await h.tick(2_000);
  const hidden = h.render();
  assert.equal(links(hidden).length, 0, "shorter verified grant must immediately control visibility");
  assert.equal(login(hidden), true);
  assert.equal(h.reads[0].signal.aborted, true);
});

test("newer longer session cannot extend the original cart visibility lease", async t => {
  const h = harness(t); h.render(); h.focus();
  await h.respond(0, page, Date.now() + 19_000);
  await h.tick(15_000);
  h.polls[0].resolve(session(actor, Date.now() + 120_000)); await settle();
  await h.tick(4_000);
  assert.equal(links(h.render()).length, 0);
  assert.equal(login(h.render()), true);
});

test("read deadline conceals data, retry starts a fresh lease, late result never restores it", async t => {
  const h = harness(t); h.render(); h.focus();
  await h.tick(12_000);
  assert.equal(h.reads[0].signal.aborted, true);
  button(h.render(), "إعادة المحاولة").props.onPress();
  await h.respond(0);
  assert.equal(links(h.render()).length, 0);
  assert.equal(links(await h.respond(1)).length, 1);
});

test("bounded revalidation timeout cancels the owner lease, exposes retry, and ignores late admission", async t => {
  const h = harness(t); h.render(); h.focus(); await h.respond(0);
  await h.tick(15_000);
  await h.tick(5_000);
  assert.equal(h.polls[0].signal.aborted, true);
  assert.equal(links(h.render()).length, 0);
  assert.ok(button(h.render(), "إعادة المحاولة"));
  h.polls[0].resolve(session()); await settle();
  assert.equal(links(h.render()).length, 0);
  button(h.render(), "إعادة المحاولة").props.onPress();
  assert.equal(h.reads[1].actorId, actor);
  assert.equal(links(await h.respond(1)).length, 1);
});

test("401 and mismatched owner on continuation or revalidation conceal the page", async t => {
  const h = harness(t); h.render(); h.focus();
  h.reads[0].reject(new DshPublicError(401, "UNAUTHORIZED")); await settle();
  assert.equal(login(h.render()), true);
  h.blur(); h.focus();
  button(await h.respond(1, { ...page, nextCursor: "store-a" }), "المزيد من السلال").props.onPress();
  await h.respond(2, { ...page, actorId: "customer-b" });
  assert.equal(links(h.render()).length, 0);
  assert.equal(login(h.render()), true);
  h.blur(); h.focus(); await h.respond(3);
  await h.tick(15_000);
  h.polls[0].resolve(session("customer-b")); await settle();
  assert.equal(links(h.render()).length, 0);
  assert.equal(login(h.render()), true);
});

test("expired and malformed initial owner deadlines are never rendered", async t => {
  const h = harness(t); h.render(); h.focus();
  await h.respond(0, page, Date.now());
  assert.equal(links(h.render()).length, 0);
  h.blur(); h.focus();
  await h.respond(1, page, Infinity);
  assert.equal(links(h.render()).length, 0);
});

test("Android background cancels read and timers; only a fresh foreground scope can display data", async t => {
  const h = harness(t, "android", "background"); h.render(); h.focus();
  assert.equal(h.reads.length, 0);
  h.app("active"); h.app("active");
  assert.equal(h.reads.length, 1);
  const view = await h.respond(0);
  const link = links(view)[0];
  h.app("background");
  let prevented = false;
  link.props.onPress({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(links(h.render()).length, 0);
  await h.tick(60_000);
  assert.equal(h.polls.length, 0);
  h.app("active");
  assert.equal(h.reads.length, 2);
  assert.equal(links(await h.respond(1)).length, 1);
});

test("Web blur and visibility both conceal the page; an unfocused visible document cannot dispatch", async t => {
  const h = harness(t, "web"); h.render(); h.focus();
  await h.respond(0);
  h.windowFocus(false);
  assert.equal(h.reads[0].signal.aborted, true);
  assert.equal(links(h.render()).length, 0);
  h.visibility(false); h.visibility(true);
  assert.equal(h.reads.length, 1);
  h.windowFocus(true);
  h.visibility(true);
  assert.equal(h.reads.length, 2, "foreground events coalesce under one owner lease");
  await h.respond(1);
  h.visibility(false);
  assert.equal(links(h.render()).length, 0);
  assert.equal(h.reads[1].signal.aborted, true);
});
