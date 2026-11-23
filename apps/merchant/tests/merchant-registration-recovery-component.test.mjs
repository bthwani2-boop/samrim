import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  matchingPendingMerchantRegistration,
  parsePendingMerchantRegistration,
} from "../src/features/onboarding/merchant-registration-attempt.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fileURLToPath(new URL("../src/features/onboarding/merchant-store-registration.tsx", import.meta.url));
const helper = fileURLToPath(new URL("../src/features/onboarding/merchant-registration-attempt.ts", import.meta.url));
const relationSource = fileURLToPath(new URL("../src/features/onboarding/store-relation-choice.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-merchant-registration-recovery-"));
let formCode, relationCode;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), source, helper, relationSource,
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

function createHarness({ storage, actorId = "actor-a", onCreate, failWrite = false, platform = "web" }) {
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
  globalThis.window = { localStorage };
  class DshPublicError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const crypto = {
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async (_alg, value) =>
      createHash("sha256").update(value).digest("hex"),
    randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
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
      async readMerchantStoreRegistrationOptions() { return options; },
      async createMerchantStore(actor, input, signal) {
        createCount++;
        assert.equal(actor, actorId);
        assert.equal(signal.aborted, false);
        return onCreate(input, DshPublicError, createCount);
      },
    },
    "./merchant-registration-attempt": {
      parsePendingMerchantRegistration,
      matchingPendingMerchantRegistration,
    },
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
  function fill(name = "متجر اختبار") {
    const radios = allNodes(render()).filter(x => x.props?.accessibilityRole === "radio");
    assert.equal(radios.length, 2, "one city/relation choice and one activity");
    radios[0].props.onPress();
    radios[1].props.onPress();
    enter("الاسم التجاري للمتجر", name);
    enter("خط عرض موقع المتجر", "15.3694");
    enter("خط طول موقع المتجر", "44.191");
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
  assert.equal(storage.size, 0);
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
  assert.equal(storage.size, 0);
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
