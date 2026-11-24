import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../../../../..");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-address-web-"));
let compiled;
try {
  const task = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    path.join(import.meta.dirname, "address-editor.tsx"), "--ignoreConfig", "--noResolve", "--noCheck",
    "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp],
  { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(task.status, 0, task.stderr || task.stdout);
  compiled = readFileSync(path.join(temp, "address-editor.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

function find(node, id) {
  if (Array.isArray(node)) return node.map(child => find(child, id)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return node.props?.testID === id ? node : find(node.props?.children, id);
}

function harness(available = true) {
  let index = 0, mounted = true, afterUnmount = 0;
  const hooks = [], effects = [], requests = [], selected = [];
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useState(initial) {
        const i = index++;
        if (!(i in hooks)) hooks[i] = initial;
        return [hooks[i], value => { if (!mounted) afterUnmount++; hooks[i] = value; }];
      },
      useRef(initial) {
        const i = index++;
        if (!(i in hooks)) hooks[i] = { current: initial };
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
    "../../components/capability-unavailable-screen": { default: "Unavailable" },
  };
  const navigator = available ? { geolocation: {
    getCurrentPosition(success, failure, options) { requests.push({ success, failure, options }); },
  } } : {};
  const mod = { exports: {} };
  new Function("require", "module", "exports", "navigator", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected import ${name}`);
    return modules[name];
  }, mod, mod.exports, navigator);
  return {
    requests, selected,
    render() {
      index = 0;
      effects.length = 0;
      const view = mod.exports.default({ onSelect: pin => selected.push(pin) });
      effects.forEach(fn => { fn(); });
      return view;
    },
    unmount() { hooks.forEach(hook => { hook?.cleanup?.(); }); mounted = false; },
    afterUnmount: () => afterUnmount,
  };
}
const click = (h, id) => {
  const node = find(h.render(), id);
  assert.ok(node, `missing accessible action ${id}`);
  node.props.onPress();
};

test("Web address GPS requires an explicit request and a separate confirmation", () => {
  const h = harness();
  h.render();
  assert.equal(h.requests.length, 0);
  click(h, "web-address-location-request");
  assert.equal(h.requests.length, 1);
  h.requests[0].success({ coords: { latitude: 15.4, longitude: 44.2 } });
  assert.deepEqual(h.selected, []);
  click(h, "web-address-location-confirm");
  assert.deepEqual(h.selected, [{ latitude: 15.4, longitude: 44.2 }]);
});

test("Web address GPS rejects invalid fixes and permission errors and allows retry", () => {
  const h = harness();
  click(h, "web-address-location-request");
  h.requests[0].success({ coords: { latitude: 91, longitude: 44 } });
  assert.ok(find(h.render(), "web-address-location-error"));
  assert.equal(find(h.render(), "web-address-location-confirm"), undefined);
  click(h, "web-address-location-request");
  h.requests[1].failure({ code: 1 });
  assert.ok(find(h.render(), "web-address-location-error"));
  click(h, "web-address-location-request");
  h.requests[2].success({ coords: { latitude: 15, longitude: 44 } });
  assert.ok(find(h.render(), "web-address-location-confirm"));
});

test("Web address GPS suppresses repeated requests and ignores replies after unmount", () => {
  const h = harness();
  const action = find(h.render(), "web-address-location-request");
  assert.ok(action);
  action.props.onPress();
  action.props.onPress();
  assert.equal(h.requests.length, 1);
  h.unmount();
  h.requests[0].success({ coords: { latitude: 15, longitude: 44 } });
  assert.equal(h.afterUnmount(), 0);
  assert.deepEqual(h.selected, []);
});

test("a browser without geolocation leaves a recoverable manual-entry message", () => {
  const h = harness(false);
  click(h, "web-address-location-request");
  assert.ok(find(h.render(), "web-address-location-error"));
  assert.deepEqual(h.selected, []);
});

test("the protected address screen exposes Web location and saves only through its DSH adapter", () => {
  const source = readFileSync(new URL("addresses-screen.tsx", import.meta.url), "utf8");
  assert.match(source, /testID="address-location-open"/);
  assert.doesNotMatch(source, /Platform\.OS!=="web"&&!pending/);
  assert.match(source, /writeVerifiedAddress\(/);
  assert.match(source, /<AddressEditor onSelect=/);
});
