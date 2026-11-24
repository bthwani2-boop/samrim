import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DshPublicError } from "@bthwani/dsh";
import { serviceCityLabel } from "./serviceability.ts";

const root = path.resolve(import.meta.dirname, "../../../../..");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-city-scope-"));
let compiled;
try {
  const task = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    path.join(import.meta.dirname, "service-city-scope.tsx"), "--ignoreConfig", "--noResolve", "--noCheck",
    "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp],
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
      useCallback(fn) {
        const i = index++;
        hooks[i] ??= fn;
        return hooks[i];
      },
      useEffect(fn) {
        const i = index++;
        if (!(i in hooks)) effects.push(() => { hooks[i] = { cleanup: fn() }; });
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", View: "View" },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "./serviceability": { serviceCityLabel },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected import ${name}`);
    return modules[name];
  }, mod, mod.exports);
  return {
    requests, selected,
    render() {
      index = 0;
      effects.length = 0;
      const view = mod.exports.default({ origin: "test", currentCity: "sanaa", disabled, onApply: city => selected.push(city) });
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
