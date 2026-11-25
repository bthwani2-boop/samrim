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
  const logouts = [];
  let tick = 0;
  const timeouts = new Map();
  const protectedChild = { type: "ProtectedScreen", props: { testID: "captain-sensitive-screen" } };
  function hook(create) {
    const at = index++;
    if (!(at in hooks)) hooks[at] = create();
    return { at, value: hooks[at] };
  }
  const react = {
    createContext() { return { Provider: "CaptainWorkspaceProvider" }; },
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
      Text: "Text",
      View: "View",
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "./admission-transport": {
      readCaptainAdmission(signal) {
        return new Promise((resolve, reject) => {
          pending.push({ signal, resolve, reject });
        });
      },
      leaveCaptainAdmission(signal, actorId) {
        return new Promise((resolve, reject) => logouts.push({ signal, actorId, resolve, reject }));
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
    (fn, delay) => { const id = ++tick; timeouts.set(id, { fn, delay }); return id; },
    id => timeouts.delete(id),
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
    render, next, child: protectedChild, logouts,
    reads: () => pending.length,
    startFocus: () => focus(),
    periodic: () => interval(),
    expire: () => { const entry = [...timeouts.entries()].find(([, timer]) => timer.delay > 20000); assert.ok(entry); timeouts.delete(entry[0]); entry[1].fn(); },
    deadline: () => { const entry = [...timeouts.entries()].find(([, timer]) => timer.delay === 20000); assert.ok(entry, "protected read must have its own deadline"); timeouts.delete(entry[0]); entry[1].fn(); },
    pendingDeadlines: () => [...timeouts.values()].filter(timer => timer.delay === 20000).length,
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

function approved(actorId = "synthetic-captain") {
  return {
    enabled: true,
    session: {
      role: "captain", actorId,
      sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    standing: { actorId, status: "APPROVED", version: 2 },
  };
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

test("healthy periodic revalidation keeps Captain tree visible and deduplicates pending reads", async () => {
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
  assert.deepEqual(holder.props.style, { flex: 1 });
  assert.equal(holder.props.pointerEvents, "auto");
  assert.equal(holder.props.importantForAccessibility, "auto");
  h.periodic();
  assert.equal(h.reads(), 1, "a slow periodic check must not spawn another owner read");

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

test("a stalled initial Captain read times out, allows retry, and ignores late approval", async () => {
  const h = harness();
  h.render();
  const cleanup = h.startFocus();
  const stale = h.next();
  h.deadline();
  assert.equal(stale.signal.aborted, true);
  assert.ok(!nodes(h.render()).includes(h.child));
  const retry = nodes(h.render()).find(item => item.type === "Pressable");
  assert.ok(retry);
  retry.props.onPress();
  const fresh = h.next();
  stale.resolve(approved());
  await settle();
  assert.ok(!nodes(h.render()).includes(h.child));
  assert.equal(h.pendingDeadlines(), 1);
  fresh.resolve(approved());
  await settle();
  assert.equal(h.pendingDeadlines(), 0);
  assert.equal(nodes(h.render()).find(x => x.props?.children === h.child).props.pointerEvents, "auto");
  h.periodic();
  const pending = h.next();
  cleanup();
  assert.equal(pending.signal.aborted, true);
  assert.equal(h.pendingDeadlines(), 0);
});

test("a stalled Captain polling read conceals private content and releases periodic recovery", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  h.next().resolve(approved());
  await settle();
  h.periodic();
  const stale = h.next();
  h.deadline();
  assert.equal(stale.signal.aborted, true);
  assert.equal(nodes(h.render()).find(x => x.props?.children === h.child).props.pointerEvents, "none");
  h.periodic();
  const fresh = h.next();
  stale.resolve(approved());
  await settle();
  assert.equal(nodes(h.render()).find(x => x.props?.children === h.child).props.pointerEvents, "none");
  fresh.resolve({ enabled: true, session: null });
  await settle();
  assert.equal(h.render().type, "Redirect");
  assert.equal(h.pendingDeadlines(), 0);
});

test("Captain background and logout cancel the owned read deadline without reviving private access", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  const initial = h.next();
  h.appChanged("background");
  assert.equal(initial.signal.aborted, true);
  assert.equal(h.pendingDeadlines(), 0);
  h.appChanged("active");
  h.next().resolve(approved());
  await settle();
  h.periodic();
  const pending = h.next();
  const provider = nodes(h.render()).find(item => item.type === "CaptainWorkspaceProvider");
  provider.props.value.signOut();
  assert.equal(pending.signal.aborted, true);
  assert.equal(h.pendingDeadlines(), 0);
  assert.equal(h.logouts.length, 1);
  pending.resolve(approved());
  await settle();
  assert.ok(!nodes(h.render()).includes(h.child));
  h.logouts.shift().resolve();
  await settle();
  assert.equal(h.render().type, "Redirect");
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

test("revalidation preserves Captain state on verified renewal, not across actors or standing revisions", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  const first = approved("captain-first");
  h.next().resolve(first);
  await settle();
  const firstHolder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.ok(firstHolder, "first verified Captain mounts protected subtree");

  h.periodic();
  const second = approved("captain-second");
  h.next().resolve(second);
  await settle();
  const secondHolder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.ok(secondHolder, "second verified Captain mounts protected subtree");
  assert.notEqual(secondHolder.key, firstHolder.key,
    "different Captain actor must remount instead of retaining another actor's private UI state");

  h.periodic();
  const rotated = approved("captain-second");
  rotated.session.sessionExpiresAt = new Date(Date.now() + 120_000).toISOString();
  h.next().resolve(rotated);
  await settle();
  const rotatedHolder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.equal(rotatedHolder.key, secondHolder.key,
    "renewing the same approved Captain must not remount the workspace");
  h.periodic();
  const changedStanding = approved("captain-second");
  changedStanding.standing.version = 3;
  h.next().resolve(changedStanding);
  await settle();
  const changedHolder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.notEqual(changedHolder.key, rotatedHolder.key, "a changed DSH revision resets protected screen state");
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

test("Captain logout conceals private screens immediately and retries the same actor after uncertainty", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  const decision = approved();
  h.next().resolve(decision);
  await settle();
  const provider = nodes(h.render()).find(item => item.type === "CaptainWorkspaceProvider");
  assert.equal(provider.props.value.session.actorId, decision.session.actorId);
  provider.props.value.signOut();
  provider.props.value.signOut();
  assert.equal(h.logouts.length, 1);
  assert.ok(!nodes(h.render()).includes(h.child));
  const attempt = h.logouts.shift();
  assert.equal(attempt.actorId, decision.session.actorId);
  h.periodic();
  assert.equal(h.reads(), 0, "periodic owner reads cannot reopen a signing-out workspace");
  attempt.reject(new Error("Identity unavailable"));
  await settle();
  nodes(h.render()).find(item => item.type === "Pressable").props.onPress();
  const retry = h.logouts.shift();
  assert.equal(retry.actorId, decision.session.actorId);
  retry.resolve();
  await settle();
  assert.equal(h.render().type, "Redirect");
});

test("Captain route rejects an Identity-only session or an unrelated, revoked or invalid DSH approval", async () => {
  const reference = approved();
  const rejected = [
    { enabled: true, session: reference.session },
    { ...approved(), standing: undefined },
    { ...approved(), standing: { ...reference.standing, actorId: "another-captain" } },
    { ...approved(), standing: { ...reference.standing, status: "SUSPENDED" } },
    { ...approved(), standing: { ...reference.standing, version: 0 } },
    { ...approved(), standing: { ...reference.standing, version: NaN } },
  ];
  for (const [index, result] of rejected.entries()) {
    const h = harness();
    h.render();
    h.startFocus();
    h.next().resolve(result);
    await settle();
    const tree = h.render();
    assert.equal(tree.type, "Redirect", "unsafe DSH standing at variant " + index);
    assert.ok(!nodes(tree).includes(h.child), "no protected subtree for unsafe standing " + index);
  }
});


test("access expiry rechecks the owner instead of redirecting before refresh", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  h.next().resolve(approved());
  await settle();
  h.expire();
  assert.notEqual(h.render().type, "Redirect");
  const holder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.equal(holder.props.pointerEvents, "none");
  h.next().resolve(approved());
  await settle();
  assert.equal(nodes(h.render()).find(x => x.props?.children === h.child).props.pointerEvents, "auto");
});

test("expiry during a pending periodic check conceals the workspace without starting another request", async () => {
  const h = harness();
  h.render();
  h.startFocus();
  h.next().resolve(approved());
  await settle();
  h.periodic();
  assert.equal(h.reads(), 1);
  const pending = h.next();
  h.expire();
  const holder = nodes(h.render()).find(x => x.props?.children === h.child);
  assert.equal(holder.props.pointerEvents, "none");
  assert.equal(holder.props.importantForAccessibility, "no-hide-descendants");
  assert.equal(pending.signal.aborted, false);
  h.periodic();
  assert.equal(h.reads(), 0);
  pending.resolve(approved());
  await settle();
  assert.equal(nodes(h.render()).find(x => x.props?.children === h.child).props.pointerEvents, "auto");
});
