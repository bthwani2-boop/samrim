import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DshPublicError } from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { serviceCityLabel } from "./serviceability.ts";

const root = path.resolve(import.meta.dirname, "../../../../..");
const entry = path.join(import.meta.dirname, "service-city-scope.tsx");
const loadedModules = [];
process.once("exit", () => loadedModules.length);
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-city-scope-"));
let compiled;
try {
  const task = spawnSync(process.execPath, [path.join(root, "node_modules/@typescript/native/bin/tsc"),
    path.join(import.meta.dirname, "service-city-scope.tsx"), "--ignoreConfig", "--noResolve", "--noCheck",
    "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temp],
  { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(task.status, 0, task.stderr || task.stdout);
  compiled = readFileSync(path.join(temp, "service-city-scope.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

function harness(disabled = false) {
  let index = 0;
  const hooks = [], effects = [], requests = [], selected = [];
  const jsx = (type, props) => ({ type, props });
  const queueEffect = (fn, deps) => {
    const i = index++;
    if (!deps || !hooks[i] || deps.some((value, j) => !Object.is(value, hooks[i].deps[j]))) effects.push(() => {
      hooks[i]?.cleanup?.();
      hooks[i] = { cleanup: fn(), deps };
    });
  };
  const modules = {
    "@bthwani/dsh": { DshPublicError, listPublicCities(origin, options) {
      return new Promise((resolve, reject) => requests.push({ origin, ...options, resolve, reject }));
    } },
    react: {
      useState(initial) {
        const i = index++;
        if (!(i in hooks)) hooks[i] = initial;
        return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }];
      },
      useRef(initial) {
        const i = index++;
        if (!(i in hooks)) hooks[i] = { current: initial };
        return hooks[i];
      },
      useCallback(fn, deps) {
        const i = index++;
        if (!hooks[i] || deps.some((value, j) => !Object.is(value, hooks[i].deps[j]))) hooks[i] = { fn, deps };
        return hooks[i].fn;
      },
      useEffect: queueEffect,
      useLayoutEffect: queueEffect,
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", View: "View" },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "./serviceability": { serviceCityLabel },
  };
  const mod = loadMappedRenderFixture(compiled, entry, modules);
  loadedModules.push(mod);
  return {
    requests, selected,
    render(origin = "test", isDisabled = disabled, currentCity = "sanaa") {
      index = 0;
      effects.length = 0;
      const view = mod.exports.default({ origin, currentCity, disabled: isDisabled, onApply: city => selected.push(city) });
      effects.forEach(fn => { fn(); });
      return view;
    },
    unmount() { hooks.forEach(hook => { hook?.cleanup?.(); }); },
  };
}
const button = (view, label) => find(view, node => node.type === "Pressable" && node.props.children?.props?.children === label);
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const [status, code] of [[400, "INVALID_CURSOR"], [409, "STALE_CURSOR"], [502, "OWNER_RESPONSE_INVALID"]]) {
  test(`city selector resets the snapshot after ${code} and retries the first page`, async () => {
    const h = harness();
    h.render();
    h.requests[0].resolve({ items: ["sanaa"], revision: 1, nextCursor: "page2" });
    await settle();
    button(h.render(), "عرض المزيد من المدن").props.onPress();
    h.requests[1].reject(new DshPublicError(status, code));
    await settle();
    assert.equal(button(h.render(), "صنعاء"), undefined);
    button(h.render(), "إعادة المحاولة").props.onPress();
    assert.equal(h.requests[2].cursor, undefined);
    h.requests[2].resolve({ items: ["aden"], revision: 2 });
    await settle();
    button(h.render(), "عدن").props.onPress();
    assert.deepEqual(h.selected, ["aden"]);
  });
}

test("a repeated continuation cursor never remains selectable", async () => {
  const h = harness();
  h.render();
  h.requests[0].resolve({ items: ["sanaa"], revision: 1, nextCursor: "page2" });
  await settle();
  button(h.render(), "عرض المزيد من المدن").props.onPress();
  h.requests[1].resolve({ items: ["aden"], revision: 1, nextCursor: "page2" });
  await settle();
  assert.equal(button(h.render(), "صنعاء"), undefined);
  assert.equal(button(h.render(), "عدن"), undefined);
  assert.ok(button(h.render(), "إعادة المحاولة"));
});

test("a temporary failure keeps a valid prior page and retries its original cursor", async () => {
  const h = harness();
  h.render();
  h.requests[0].resolve({ items: ["sanaa"], revision: 1, nextCursor: "page2" });
  await settle();
  button(h.render(), "عرض المزيد من المدن").props.onPress();
  h.requests[1].reject(new DshPublicError(503, "OWNER_UNAVAILABLE"));
  await settle();
  assert.ok(button(h.render(), "صنعاء"));
  button(h.render(), "إعادة المحاولة").props.onPress();
  assert.equal(h.requests[2].cursor, "page2");
});

test("address mutation pending disables the shared city picker", async () => {
  const h = harness(true);
  h.render();
  h.requests[0].resolve({ items: ["aden"], revision: 1 });
  await settle();
  const city = button(h.render(), "عدن");
  assert.equal(city.props.disabled, true);
  city.props.onPress();
  assert.deepEqual(h.selected, []);
});

test("address forms reuse the existing owner-backed city selector instead of maintaining their own directory", () => {
  const source = readFileSync(new URL("../addresses/addresses-screen.tsx", import.meta.url), "utf8");
  assert.match(source, /<ServiceCityScope/);
  assert.doesNotMatch(source, /listPublicCities\(|moreCities\(/);
  assert.match(source, /writeVerifiedAddress\(/);
});

test("changing owner origin hides old city options before effects and aborts the old continuation", async () => {
  const h = harness();
  h.render("first");
  h.requests[0].resolve({ items: ["sanaa"], revision: 1, nextCursor: "page2" });
  await settle();
  button(h.render("first"), "عرض المزيد من المدن").props.onPress();
  const oldPage = h.requests[1];
  const switched = h.render("second");
  assert.equal(oldPage.signal.aborted, true);
  assert.equal(h.requests[2].origin, "second");
  assert.equal(h.requests[2].cursor, undefined);
  assert.equal(button(switched, "صنعاء"), undefined);
  oldPage.resolve({ items: ["sanaa"], revision: 1 });
  await settle();
  assert.equal(button(h.render("second"), "صنعاء"), undefined);
  h.requests[2].resolve({ items: ["aden"], revision: 2 });
  await settle();
  button(h.render("second"), "عدن").props.onPress();
  assert.deepEqual(h.selected, ["aden"]);
});

test("superseded city and continuation callbacks cannot change the new origin", async () => {
  const h = harness();
  h.render("first");
  h.requests[0].resolve({ items: ["sanaa"], revision: 1, nextCursor: "old-page" });
  await settle();
  const old = h.render("first");
  h.render("second");
  h.requests[1].resolve({ items: ["aden"], revision: 2 });
  await settle();
  const current = h.render("second");
  button(old, "صنعاء").props.onPress();
  button(old, "عرض المزيد من المدن").props.onPress();
  assert.deepEqual(h.selected, []);
  assert.equal(h.requests.length, 2);
  button(current, "عدن").props.onPress();
  assert.deepEqual(h.selected, ["aden"]);
});

test("old city callbacks cannot dispatch after the current view becomes disabled or unmounts", async () => {
  const h = harness();
  h.render();
  h.requests[0].resolve({ items: ["sanaa"], revision: 1, nextCursor: "page2" });
  await settle();
  const old = h.render();
  h.render("test", true);
  button(old, "صنعاء").props.onPress();
  button(old, "عرض المزيد من المدن").props.onPress();
  assert.deepEqual(h.selected, []);
  assert.equal(h.requests.length, 1);
  const current = h.render();
  button(current, "صنعاء").props.onPress();
  assert.deepEqual(h.selected, ["sanaa"]);
  h.unmount();
  button(current, "صنعاء").props.onPress();
  button(current, "عرض المزيد من المدن").props.onPress();
  assert.deepEqual(h.selected, ["sanaa"]);
  assert.equal(h.requests.length, 1);
});

test("a stale directory invalidation revokes prior city callbacks even within the same origin", async () => {
  const h = harness();
  h.render();
  h.requests[0].resolve({ items: ["sanaa"], revision: 1, nextCursor: "page2" });
  await settle();
  const old = h.render();
  button(old, "عرض المزيد من المدن").props.onPress();
  h.requests[1].reject(new DshPublicError(409, "STALE_CURSOR"));
  await settle();
  const recovery = h.render();
  button(old, "صنعاء").props.onPress();
  assert.deepEqual(h.selected, []);
  button(recovery, "إعادة المحاولة").props.onPress();
  assert.equal(h.requests[2].cursor, undefined);
  h.requests[2].resolve({ items: ["aden"], revision: 2 });
  await settle();
  button(h.render(), "عدن").props.onPress();
  assert.deepEqual(h.selected, ["aden"]);
});


test("city choices expose mutually exclusive checked states to Web and Android", async () => {
  const h = harness();
  h.render();
  h.requests[0].resolve({ items: ["sanaa", "aden"], revision: 1 });
  await settle();
  const view = h.render();
  for (const [label, checked] of [["صنعاء", true], ["عدن", false]]) {
    const choice = button(view, label);
    assert.equal(choice.props.accessibilityRole, "radio");
    assert.equal(choice.props["aria-checked"], checked);
    assert.equal(choice.props.accessibilityState.checked, checked);
  }
  assert.ok(find(view, node => node.props?.accessibilityRole === "radiogroup"));
  button(view, "عدن").props.onPress();
  assert.deepEqual(h.selected, ["aden"]);
  const next = h.render("test", false, "aden");
  assert.equal(button(next, "صنعاء").props["aria-checked"], false);
  assert.equal(button(next, "عدن").props["aria-checked"], true);
});

test("duplicate first-page cities are rejected before any choice becomes available", async () => {
  const h = harness();
  h.render();
  h.requests[0].resolve({ items: ["sanaa", "sanaa"], revision: 1 });
  await settle();
  const view = h.render();
  assert.equal(button(view, "صنعاء"), undefined);
  assert.ok(button(view, "إعادة المحاولة"));
});

for (const page of [
  { items: ["aden"], revision: 2 },
  { items: ["sanaa"], revision: 1 },
]) {
  test("city continuation rejects a changed revision or repeated city", async () => {
    const h = harness();
    h.render();
    h.requests[0].resolve({ items: ["sanaa"], revision: 1, nextCursor: "page2" });
    await settle();
    button(h.render(), "عرض المزيد من المدن").props.onPress();
    h.requests[1].resolve(page);
    await settle();
    assert.equal(button(h.render(), "صنعاء"), undefined);
    assert.equal(button(h.render(), "عدن"), undefined);
  });
}

test("empty and unavailable city directories never claim a selected choice", async () => {
  const h = harness();
  h.render();
  h.requests[0].reject(new Error("network unavailable"));
  await settle();
  const error = h.render();
  assert.ok(find(error, node => node.props?.accessibilityRole === "alert"));
  button(error, "إعادة المحاولة").props.onPress();
  h.requests[1].resolve({ items: [], revision: 1 });
  await settle();
  const empty = h.render();
  assert.equal(find(empty, node => node.props?.accessibilityRole === "radio"), undefined);
  assert.ok(find(empty, node => node.props?.children === "لا توجد مدن متاحة للتسوّق حاليًا."));
});
