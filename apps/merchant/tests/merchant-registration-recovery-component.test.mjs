import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { withMutationRecoveryLock } from "../src/features/mutation-recovery/recovery-lock.ts";
import {
  parseStoredMerchantRegistration,
  sameRegistrationGeneration,
} from "../src/features/onboarding/merchant-registration-attempt.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fileURLToPath(new URL("../src/features/onboarding/merchant-store-registration.tsx", import.meta.url));
const helper = fileURLToPath(new URL("../src/features/onboarding/merchant-registration-attempt.ts", import.meta.url));
const relationSource = fileURLToPath(new URL("../src/features/onboarding/store-relation-choice.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-merchant-registration-recovery-"));
let formCode, relationCode;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/@typescript/native/bin/tsc"), source, helper, relationSource,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  formCode = readFileSync(path.join(temp, "merchant-store-registration.js"), "utf8");
  relationCode = readFileSync(path.join(temp, "store-relation-choice.js"), "utf8");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const options = {
  choices: [{ cityId: "sanaa", relation: "MARKETPLACE", policyVersion: 1,
    termsVersion: "v1", termsText: "شروط الاختبار المعزول" }],
  verticals: ["grocery"],
};

const settle = async () => {
  for (let i = 0; i < 18; i++) await Promise.resolve();
};
function allNodes(node) {
  if (Array.isArray(node)) return node.flatMap(allNodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...allNodes(node.props?.children)];
}

function createHarness({ storage, actorId = "actor-a", onCreate, failWrite = false, platform = "web", registrationOptions = options, webLocks = true, operationId = "123e4567-e89b-42d3-a456-426614174000" }) {
  const hooks = [];
  let hookIndex = 0;
  const effects = [];
  let createCount = 0;
  let created = 0;
  let relationChoice;
  const jsx = (type, props, key) => type === relationChoice && relationChoice ? relationChoice(props) : ({ type, props: props ?? {}, key });
  const react = {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], value => {
        hooks[index] = typeof value === "function" ? value(hooks[index]) : value;
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(fn) { hookIndex++; effects.push(fn); },
  };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) {
      if (failWrite) throw new Error("storage blocked");
      storage.set(key, value);
    },
    removeItem: key => storage.delete(key),
  };
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage, navigator: webLocks ? { locks: { request: (_key, action) => action() } } : {} };
  class DshPublicError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const crypto = {
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async (_alg, value) =>
      createHash("sha256").update(value).digest("hex"),
    randomUUID: () => operationId,
  };
  const mocks = {
    "@bthwani/dsh": { DshPublicError },
    "@bthwani/tamagui-config/appearance": {
      useMobileAppearance: () => ({ theme: {
        surface: "white", background: "white", color: "black",
        colorSecondary: "gray", borderColor: "gray", interactiveText: "blue",
        actionSoft: "lightgray", warningText: "red",
      } }),
    },
    "expo-crypto": crypto,
    "expo-secure-store": {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device",
      async getItemAsync(key) { return localStorage.getItem(key); },
      async setItemAsync(key, value) { return localStorage.setItem(key, value); },
      async deleteItemAsync(key) { return localStorage.removeItem(key); },
    },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      Platform: { OS: platform },
      Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
    },
    "./store-registration-transport": {
      async readMerchantStoreRegistrationOptions() { return registrationOptions; },
      async createMerchantStore(actor, input, signal) {
        createCount++;
        assert.equal(actor, actorId);
        assert.equal(signal.aborted, false);
        return onCreate(input, DshPublicError, createCount);
      },
    },
    "./merchant-registration-attempt": { parseStoredMerchantRegistration, sameRegistrationGeneration },
    "../mutation-recovery/recovery-lock": { withMutationRecoveryLock },
  };
  const relationModule = { exports: {} };
  new Function("require", "module", "exports", relationCode)(
    name => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected relation dependency ${name}`);
      return mocks[name];
    }, relationModule, relationModule.exports,
  );
  relationChoice = relationModule.exports.default;
  mocks["./store-relation-choice"] = relationModule.exports;
  const mod = { exports: {} };
  new Function("require", "module", "exports", formCode)(
    name => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
      return mocks[name];
    }, mod, mod.exports,
  );
  function render() {
    hookIndex = 0;
    effects.length = 0;
    return mod.exports.default({ actorId, onCreated: () => { created++; } });
  }
  function find(role, label) {
    const node = allNodes(render()).find(x =>
      x.props?.accessibilityRole === role &&
      (label === undefined || x.props.accessibilityLabel === label));
    assert.ok(node, `missing ${role}: ${label}`);
    return node;
  }
  async function mount() {
    render();
    assert.equal(effects.length, 2);
    for (const effect of effects) effect();
    await settle();
    render();
  }
  function enter(label, value) {
    const input = allNodes(render()).find(x =>
      x.type === "TextInput" && x.props.accessibilityLabel === label);
    assert.ok(input, `missing input ${label}`);
    assert.equal(input.props.editable, true, `field ${label} should be editable`);
    input.props.onChangeText(value);
  }
  function fill(name = "متجر اختبار", latitude = "15.3694", longitude = "44.191") {
    const radios = allNodes(render()).filter(x => x.props?.accessibilityRole === "radio");
    assert.equal(radios.length, 2, "one city/relation choice and one activity");
    radios[0].props.onPress();
    radios[1].props.onPress();
    enter("الاسم التجاري للمتجر", name);
    enter("خط عرض موقع المتجر", latitude);
    enter("خط طول موقع المتجر", longitude);
    find("checkbox").props.onPress();
  }
  async function submit() {
    const button = allNodes(render()).find(x =>
      x.props?.accessibilityRole === "button" &&
      ["إنشاء متجر غير منشور", "إعادة نفس العملية دون تكرار"].includes(x.props.accessibilityLabel));
    assert.ok(button, "expected fresh or recovered Store registration action");
    assert.equal(button.props.disabled, false);
    button.props.onPress();
    await settle();
  }
  return {
    mount, fill, submit, render, get createCount() { return createCount; },
    get created() { return created; },
    close() { globalThis.window = previousWindow; },
  };
}

test("registration distinguishes missing commercial activities from closed city policy, on Web and Android", async () => {
  for (const platform of ["web", "android"]) {
    for (const registrationOptions of [{ choices: [], verticals: [] }, { choices: options.choices, verticals: [] }]) {
      const h = createHarness({ storage: new Map(), platform, registrationOptions, onCreate() { assert.fail("must not submit"); } });
      try {
        await h.mount();
        const tree = allNodes(h.render());
        assert.ok(tree.some(n => n.props?.testID === "merchant-registration-no-activities"));
        assert.ok(tree.some(n => n.props?.accessibilityLabel === "إعادة التحقق من إتاحة التسجيل" && !n.props.disabled));
        assert.ok(!tree.some(n => n.type === "TextInput" || n.props?.accessibilityRole === "checkbox"));
        assert.equal(h.createCount, 0);
      } finally { h.close(); }
    }
  }
});

test("real Web component recovers the same DSH operation ID after a failed request and remount", async t => {
  const storage = new Map();
  const submitted = [];
  const onCreate = (input, DshPublicError, count) => {
    submitted.push(input);
    if (count === 1) throw new DshPublicError(503, "OPERATION_RESULT_UNKNOWN");
    return { store: { id: "store-a", published: false }, replay: true };
  };
  // Different component instances simulate restart and have independent in-memory hooks.
  let count = 0;
  const create = (input, Err) => onCreate(input, Err, ++count);
  const first = createHarness({ storage, onCreate: create });
  t.after(() => first.close());
  await first.mount();
  first.fill();
  await first.submit();
  assert.equal(first.createCount, 1);
  assert.equal(storage.size, 1);
  const persisted = JSON.parse([...storage.values()][0]);
  assert.equal(persisted.operationId, submitted[0].operationId);
  assert.equal(persisted.fingerprint.length, 64);
  assert.ok(!JSON.stringify(persisted).includes("متجر"));
  const second = createHarness({ storage, onCreate: create });
  t.after(() => second.close());
  await second.mount();
  second.fill();
  await second.submit();
  assert.equal(second.createCount, 1);
  assert.equal(submitted[1].operationId, submitted[0].operationId);
  assert.equal(second.created, 1);
  assert.equal(JSON.parse([...storage.values()][0]).settled, true);
});

test("Web storage failure prevents sending any Store registration write", async t => {
  const storage = new Map();
  const instance = createHarness({
    storage, failWrite: true,
    onCreate: () => assert.fail("owner write must not run when retry key cannot be persisted"),
  });
  t.after(() => instance.close());
  await instance.mount();
  instance.fill();
  await instance.submit();
  assert.equal(instance.createCount, 0);
  assert.equal(storage.size, 0);
});

test("Android SecureStore recovery reuses the original command without a second Store", async t => {
  const storage = new Map();
  const submitted = [];
  let count = 0;
  const create = (input, Err) => {
    submitted.push(input);
    if (++count === 1) throw new Err(503, "OPERATION_RESULT_UNKNOWN");
    return { store: { id: "store-a", published: false }, replay: true };
  };
  const first = createHarness({ storage, onCreate: create, platform: "android" });
  t.after(() => first.close());
  await first.mount();
  first.fill();
  await first.submit();
  assert.equal(first.createCount, 1);
  assert.equal(storage.size, 1);
  const restarted = createHarness({ storage, onCreate: create, platform: "android" });
  t.after(() => restarted.close());
  await restarted.mount();
  restarted.fill();
  await restarted.submit();
  assert.equal(restarted.createCount, 1);
  assert.equal(submitted[0].operationId, submitted[1].operationId);
  assert.equal(restarted.created, 1);
  assert.equal(JSON.parse([...storage.values()][0]).settled, true);
});

test("changed Store details cannot replay an ambiguous prior write under its ID", async t => {
  const storage = new Map();
  let calls = 0;
  const create = (_input, Err) => {
    calls++;
    throw new Err(503, "OPERATION_RESULT_UNKNOWN");
  };
  const first = createHarness({ storage, onCreate: create });
  t.after(() => first.close());
  await first.mount();
  first.fill();
  await first.submit();
  assert.equal(calls, 1);
  const original = [...storage.values()][0];
  const restarted = createHarness({ storage, onCreate: create });
  t.after(() => restarted.close());
  await restarted.mount();
  restarted.fill("متجر آخر");
  await restarted.submit();
  assert.equal(calls, 1, "mismatched retry must not contact DSH");
  assert.equal([...storage.values()][0], original, "uncertain command must remain recoverable");
});

for (const platform of ["web", "android"]) {
  test(`Published Store replay recovers the original registration on ${platform}`, async t => {
    const storage = new Map();
    const submitted = [];
    const create = (input, Err) => {
      submitted.push(input);
      if (submitted.length === 1) throw new Err(503, "OPERATION_RESULT_UNKNOWN");
      return { store: { id: "store-a", published: true }, replay: true };
    };
    const first = createHarness({ storage, onCreate: create, platform });
    t.after(() => first.close());
    await first.mount();
    first.fill();
    await first.submit();
    assert.equal(storage.size, 1);
    const restarted = createHarness({ storage, onCreate: create, platform });
    t.after(() => restarted.close());
    await restarted.mount();
    restarted.fill();
    await restarted.submit();
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[1], submitted[0]);
    assert.equal(restarted.created, 1);
    assert.equal(JSON.parse([...storage.values()][0]).settled, true);
  });
}

test("Arabic coordinates use the same owner payload and retry fingerprint as ASCII", async t => {
  const storage = new Map();
  const submitted = [];
  const create = (input, Err) => {
    submitted.push(input);
    if (submitted.length === 1) throw new Err(503, "OPERATION_RESULT_UNKNOWN");
    return { store: { id: "store-a", published: false }, replay: true };
  };
  const first = createHarness({ storage, onCreate: create });
  t.after(() => first.close());
  await first.mount();
  first.fill("متجر اختبار", "١٥٫٣٦٩٤", "۴۴٫۱۹۱");
  await first.submit();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].latitude, 15.3694);
  assert.equal(submitted[0].longitude, 44.191);
  const restarted = createHarness({ storage, onCreate: create });
  t.after(() => restarted.close());
  await restarted.mount();
  restarted.fill();
  await restarted.submit();
  assert.deepEqual(submitted[1], submitted[0]);
  assert.equal(restarted.created, 1);
  assert.equal(JSON.parse([...storage.values()][0]).settled, true);
});

test("fresh published registration remains uncertain", async t => {
  const storage = new Map();
  const instance = createHarness({ storage, onCreate: () => ({ store: { id: "store-a", published: true }, replay: false }) });
  t.after(() => instance.close());
  await instance.mount();
  instance.fill();
  await instance.submit();
  assert.equal(instance.created, 0);
  assert.equal(storage.size, 1);
});

for (const [name, latitude, longitude] of [
  ["a".repeat(121), "15.3694", "44.191"],
  ["متجر\nاختبار", "15.3694", "44.191"],
  ["متجر", "0xF", "44.191"],
  ["متجر", "1.5e1", "44.191"],
  ["متجر", "91", "44.191"],
  ["متجر", "15.3694", "181"],
]) {
  test(`Malformed registration does not persist or reach the owner: ${JSON.stringify([name, latitude, longitude])}`, async t => {
    const storage = new Map();
    const instance = createHarness({ storage, onCreate: () => assert.fail("invalid owner write") });
    t.after(() => instance.close());
    await instance.mount();
    instance.fill(name, latitude, longitude);
    await instance.submit();
    assert.equal(instance.createCount, 0);
    assert.equal(storage.size, 0);
    assert.ok(allNodes(instance.render()).some(n => n.props?.accessibilityRole === "alert"));
  });
}

test("Store relation choices express shared private sales and additional marketplace eligibility", async () => {
  for (const platform of ["web", "android"]) {
    const registrationOptions = { ...options, choices: [
      options.choices[0], { ...options.choices[0], relation: "DIRECT" },
    ] };
    const h = createHarness({ storage: new Map(), platform, registrationOptions,
      onCreate() { assert.fail("viewing choices must not create a Store"); } });
    try {
      await h.mount();
      const nodes = allNodes(h.render());
      const market = nodes.find(n => n.props?.testID === "merchant-relation-MARKETPLACE-sanaa");
      const direct = nodes.find(n => n.props?.testID === "merchant-relation-DIRECT-sanaa");
      assert.ok(market && direct);
      const content = node => allNodes(node).filter(n => n.type === "Text")
        .flatMap(n => [n.props.children].flat(Infinity)).filter(x => typeof x === "string").join(" ");
      assert.match(content(market), /البيع الخاص المباشر/);
      assert.match(content(market), /البيع عبر سوق بثواني/);
      assert.match(content(direct), /البيع الخاص المباشر/);
      assert.match(content(direct), /لا يظهر في سوق بثواني/);
      for (const choice of [market, direct]) {
        assert.match(content(choice), /بعد النشر/);
        assert.match(content(choice), /بعد اعتماد/);
      }
      assert.equal(h.createCount, 0);
    } finally { h.close(); }
  }
});

for (const platform of ["web", "android"]) {
  test("a stale registration form cannot replace a newer attempt on "+platform, async () => {
    const storage = new Map();
    const first = createHarness({ storage, platform, onCreate(_input, Err) { throw new Err(503, "OPERATION_RESULT_UNKNOWN"); } });
    const second = createHarness({ storage, platform, operationId: "123e4567-e89b-42d3-a456-426614174001",
      onCreate() { return { store: { id: "store-duplicate", published: false }, replay: false }; } });
    try {
      await first.mount(); await second.mount();
      first.fill(); second.fill("متجر آخر");
      await first.submit();
      assert.equal(first.createCount, 1);
      const original = [...storage.values()][0];
      await second.submit();
      assert.equal(second.createCount, 0, "stale opened form must not send a new operation");
      assert.equal([...storage.values()][0], original, "newer uncertain attempt must survive");
    } finally { second.close(); first.close(); }
  });

  test("a stale form cannot mint a new registration after another form confirms on "+platform, async () => {
    const storage = new Map();
    const create = () => ({ store: { id: "store-a", published: false }, replay: false });
    const first = createHarness({ storage, platform, onCreate: create });
    const second = createHarness({ storage, platform, operationId: "123e4567-e89b-42d3-a456-426614174001", onCreate: create });
    try {
      await first.mount(); await second.mount();
      first.fill(); second.fill();
      await first.submit();
      assert.equal(first.created, 1);
      await second.submit();
      assert.equal(second.createCount, 0, "old form must not create a second Store after settlement");
    } finally { second.close(); first.close(); }
  });
}

test("Store registration refuses a Web write without cross-tab exclusion", async () => {
  const storage = new Map();
  const form = createHarness({ storage, webLocks: false, onCreate: () => ({ store: { id: "store-a", published: false }, replay: false }) });
  try {
    await form.mount(); form.fill(); await form.submit();
    assert.equal(form.createCount, 0, "no native lock, no owner dispatch");
    assert.equal(storage.size, 0);
  } finally { form.close(); }
});

test("fresh registration after settlement can create a distinct intentional Store", async () => {
  const storage = new Map();
  const create = () => ({ store: { id: "store-a", published: false }, replay: false });
  const first = createHarness({ storage, onCreate: create });
  const nextId = "123e4567-e89b-42d3-a456-426614174002";
  let next;
  try {
    await first.mount(); first.fill(); await first.submit();
    const settled = JSON.parse([...storage.values()][0]);
    assert.equal(settled.settled, true);
    next = createHarness({ storage, operationId: nextId, onCreate(input) {
      assert.equal(input.operationId, nextId);
      return { store: { id: "store-b", published: false }, replay: false };
    } });
    await next.mount(); next.fill("متجر جديد"); await next.submit();
    assert.equal(next.created, 1);
    assert.deepEqual(Object.keys(JSON.parse([...storage.values()][0])).sort(), ["fingerprint", "operationId", "settled"]);
  } finally { next?.close(); first.close(); }
});
for (const platform of ["web", "android"]) {
  test("late owner acknowledgement cannot settle a newer generation on "+platform, async () => {
    const storage = new Map();
    const newer = { fingerprint: "b".repeat(64), operationId: "123e4567-e89b-42d3-a456-426614174099" };
    const form = createHarness({ storage, platform, onCreate() {
      storage.set([...storage.keys()][0], JSON.stringify(newer));
      return { store: { id: "store-a", published: false }, replay: false };
    } });
    try {
      await form.mount(); form.fill(); await form.submit();
      assert.equal(form.created, 1);
      assert.deepEqual(JSON.parse([...storage.values()][0]), newer);
    } finally { form.close(); }
  });

  for (const [status, code, definitive] of [
    [403, "STORE_REGISTRATION_CLOSED", true],
    [409, "STORE_REGISTRATION_POLICY_CHANGED", true],
    [503, "STORE_REGISTRATION_CLOSED", false],
    [400, "STORE_REGISTRATION_POLICY_CHANGED", false],
  ]) {
    test("registration retains uncertainty unless owner rejection is definitive: "+platform+" "+status+" "+code, async () => {
      const storage = new Map();
      const form = createHarness({ storage, platform, onCreate(_input, Err) { throw new Err(status, code); } });
      try {
        await form.mount(); form.fill(); await form.submit();
        assert.equal(form.created, 0);
        assert.equal(form.createCount, 1);
        const record = JSON.parse([...storage.values()][0]);
        assert.equal(record.settled === true, definitive);
      } finally { form.close(); }
    });
  }
}
