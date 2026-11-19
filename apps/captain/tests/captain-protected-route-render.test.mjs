import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Execute the actual TSX component using the repository-pinned TypeScript CLI
// with a deterministic hook and native-view harness. No dependency upgrades
// or network-based test runtime are needed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceFile = fileURLToPath(new URL("../src/features/access/protected-route.tsx", import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-captain-route-"));
let compiled;
try {
  const output = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), sourceFile,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", tmp,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(output.status, 0, output.stderr || output.stdout);
  compiled = readFileSync(path.join(tmp, "protected-route.js"), "utf8");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function harness() {
  const hooks = [];
  let index = 0;
  let focus;
  let interval;
  let appChanged;
  let pending = [];
  let tick = 0;
  const protectedChild = { type: "ProtectedScreen", props: { testID: "captain-sensitive-screen" } };
  function hook(create) {
    const at = index++;
    if (!(at in hooks)) hooks[at] = create();
    return { at, value: hooks[at] };
  }
  const react = {
    useState(initial) {
      const { at, value } = hook(() => initial);
      return [value, next => { hooks[at] = typeof next === "function" ? next(hooks[at]) : next; }];
    },
    useRef(initial) { return hook(() => ({ current: initial })).value; },
    useCallback(fn) { index++; return fn; },
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const mocks = {
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({theme: {
      background: "black", color: "white", interactiveText: "white", borderColor: "gray",
    }}) },
    "expo-router": {
      Redirect: "Redirect",
      useFocusEffect(callback) { focus = callback; },
    },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      AppState: {
        currentState: "active",
        addEventListener(_type, handler) {
          appChanged = handler;
          return { remove() {} };
        },
      },
      Pressable: "Pressable",
      SafeAreaView: "SafeAreaView",
      Text: "Text",
      View: "View",
    },
    "./admission-transport": {
      readCaptainAdmission(signal) {
        return new Promise((resolve, reject) => {
          pending.push({ signal, resolve, reject });
        });
      },
    },
    "./captain-session": { hasActiveCaptainSession: session => session.role === "captain" },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout",
    "setInterval", "clearInterval", compiled)(
    name => {
      assert.ok(Object.hasOwn(mocks, name), "unexpected dependency " + name);
      return mocks[name];
    },
    mod, mod.exports,
    (_fn, _duration) => ++tick,
    () => undefined,
    fn => { interval = fn; return ++tick; },
    () => undefined,
  );
  const Component = mod.exports.default;
  const render = () => {
    index = 0;
    return Component({ children: protectedChild });
  };
  const next = () => {
    assert.ok(pending.length, "expected an owner request");
    return pending.shift();
  };
  return {
    render, next, child: protectedChild,
    startFocus: () => focus(),
    periodic: () => interval(),
    appChanged: state => appChanged(state),
  };
}

function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

function approved() {
  return { enabled: true, session: {
    role: "captain", actorId: "synthetic-captain",
    sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  } };
}

test("initial pending, unavailable and background-aborted checks do not mount Captain content", async () => {
  const h = harness();
  assert.ok(!nodes(h.render()).includes(h.child));
  h.startFocus();
  let initial = h.next();
  initial.reject(new Error("owner offline"));
  await settle();
  assert.ok(!nodes(h.render()).includes(h.child), "unavailable initial owner must fail closed");

  h.appChanged("active");
  let aborted = h.next();
  h.appChanged("background");
  assert.equal(aborted.signal.aborted, true);
  aborted.resolve(approved());
  await settle();
  assert.ok(!nodes(h.render()).includes(h.child), "stale aborted approval must not mount content");

  h.appChanged("active");
  const restored = h.next();
  restored.resolve(approved());
  await settle();
  assert.ok(nodes(h.render()).includes(h.child), "fresh approved owner checks mount protected tree");
});

test("periodic revalidation hides but preserves mounted Captain tree until owner confirms", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  h.next().resolve(approved());
  await settle();
  let current = h.render();
  assert.ok(nodes(current).includes(h.child));
  let holder = nodes(current).find(x => x.props?.children === h.child);
  assert.deepEqual(holder.props.style, { flex: 1 });
  assert.equal(holder.props.pointerEvents, "auto");

  h.periodic();
  current = h.render();
  assert.ok(nodes(current).includes(h.child), "revalidation must preserve the mounted subtree");
  holder = nodes(current).find(x => x.props?.children === h.child);
  assert.equal(holder.props.style.display, "none");
  assert.equal(holder.props.pointerEvents, "none");
  assert.equal(holder.props.importantForAccessibility, "no-hide-descendants");

  h.next().resolve(approved());
  await settle();
  current = h.render();
  assert.ok(nodes(current).includes(h.child));
  holder = nodes(current).find(x => x.props?.children === h.child);
  assert.deepEqual(holder.props.style, { flex: 1 });
  assert.equal(holder.props.pointerEvents, "auto");

  h.periodic();
  h.next().reject(new Error("DSH unavailable"));
  await settle();
  current = h.render();
  assert.ok(nodes(current).includes(h.child), "temporary outage may preserve state but must hide it");
  holder = nodes(current).find(x => x.props?.children === h.child);
  assert.equal(holder.props.style.display, "none");
  assert.equal(holder.props.pointerEvents, "none");
});

test("Captain denial after a previously approved session removes protected UI", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  h.next().resolve(approved());
  await settle();
  assert.ok(nodes(h.render()).includes(h.child));
  h.periodic();
  h.next().resolve({ enabled: true, session: null });
  await settle();
  const tree = h.render();
  assert.equal(tree.type, "Redirect");
  assert.ok(!nodes(tree).includes(h.child));
});

test("revalidation never reuses protected component state across Captain actors or renewed expiries", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  const first = approved();
  first.session.actorId = "captain-first";
  h.next().resolve(first);
  await settle();
  const firstHolder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.ok(firstHolder, "first verified Captain mounts protected subtree");

  h.periodic();
  const second = approved();
  second.session.actorId = "captain-second";
  h.next().resolve(second);
  await settle();
  const secondHolder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.ok(secondHolder, "second verified Captain mounts protected subtree");
  assert.notEqual(secondHolder.key, firstHolder.key,
    "different Captain actor must remount instead of retaining another actor's private UI state");

  h.periodic();
  const rotated = approved();
  rotated.session.actorId = "captain-second";
  rotated.session.sessionExpiresAt = new Date(Date.now() + 120_000).toISOString();
  h.next().resolve(rotated);
  await settle();
  const rotatedHolder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.notEqual(rotatedHolder.key, secondHolder.key,
    "a renewed Captain session expiry must not inherit the prior protected UI state");
});

test("the same approved Captain session preserves component state across owner revalidation", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  const stableSession = approved();
  h.next().resolve(stableSession);
  await settle();
  const firstHolder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.ok(firstHolder);
  assert.equal(typeof firstHolder.key, "string");

  h.periodic();
  h.next().resolve(stableSession);
  await settle();
  const checkedHolder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.equal(checkedHolder.key, firstHolder.key,
    "re-reading the same verified session must preserve its protected component state");
});
