import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DshPublicError, isCustomerAddressId, validCustomerAddressChange } from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

const source=file=>readFileSync(new URL(file,import.meta.url),"utf8");
test("address screens read and save through the verified DSH adapter; map choice is not a write",()=>{
  assert.match(source("addresses-screen.tsx"),/readVerifiedAddresses\(/);
  assert.match(source("addresses-screen.tsx"),/writeVerifiedAddress\(/);
  assert.match(source("address-transport.ts"),/withVerifiedNativeCustomerRead/);
  assert.match(source("address-transport.ts"),/readCustomerAdmission/);
  assert.doesNotMatch(source("addresses-screen.tsx"),/fetch\(|AsyncStorage|SecureStore/);
  assert.doesNotMatch(source("address-editor.native.tsx"),/fetch\(|writeVerifiedAddress|saveCustomerAddress/);
  assert.match(source("address-editor.native.tsx"),/onSelect\(pin\)/);
});

const root = path.resolve(import.meta.dirname, "../../../../..");
const renderSource = path.join(import.meta.dirname, "addresses-screen.tsx");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-address-draft-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    renderSource, "--ignoreConfig", "--noResolve", "--noCheck",
    "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temp],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "addresses-screen.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

function harness(t, routeId) {
  let index = 0, focus, cleanup, counter = 0;
  const hooks = [], pages = [], writes = [];
  let ownerAddress = null;
  let sessionError;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = initial;
      return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }];
    },
    useRef(initial) { const at = index++; hooks[at] ??= { current: initial }; return hooks[at]; },
    useCallback(fn) { index++; return fn; },
    useEffect(fn) { const at = index++; if (!(at in hooks)) hooks[at] = fn(); },
  };
  const deps = {
    "@bthwani/dsh": { DshPublicError, isCustomerAddressId, validCustomerAddressChange },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "expo-crypto": { randomUUID: () => (++counter).toString(16).padStart(32, "0") },
    "expo-router": { Link: "Link", useFocusEffect: cb => { focus = cb; }, useLocalSearchParams: () => ({ id: routeId }) },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: "android" },
      Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../location/service-city-scope": { __esModule: true, default: "ServiceCityScope" },
    "../location/serviceability": { serviceCityLabel: city => city },
    "../stores/public-store-origin": { resolvePublicStoreOrigin: () => "http://127.0.0.1:3202" },
    "./address-editor": { __esModule: true, default: "AddressEditor" },
    "./address-transport": {
      readVerifiedAddresses(signal, actor, cursor) { return new Promise((resolve, reject) => pages.push({ signal, actor, cursor, resolve, reject })); },
      async readVerifiedAddress(_signal, actor, id) {
        if (ownerAddress?.actor === actor && ownerAddress.address.id === id) {
          return { address: ownerAddress.address, expiresAt: Date.now() + 60000 };
        }
        throw new DshPublicError(404, "NOT_FOUND");
      },
      async verifyAddressSession() { if (sessionError) throw sessionError; return { sessionExpiresAt: new Date(Date.now() + 60000).toISOString() }; },
      writeVerifiedAddress(actor, id, change, signal) { return new Promise((resolve, reject) => writes.push({ actor, id, change, signal, resolve, reject })); },
    },
  };
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const mod = loadMappedRenderFixture(compiled, renderSource, deps);
  function render() { index = 0; return mod.exports.default(); }
  return {
    render, writes, pages,
    owner(actor, address) { ownerAddress = { actor, address }; },
    sessionFailure(error) { sessionError = error; },
    focus() { cleanup?.(); render(); cleanup = focus(); },
    close() { cleanup?.(); },
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function words(tree) {
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(words).join(" ");
  return tree && typeof tree === "object" ? words(tree.props?.children) : "";
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const page = (actor, items = []) => ({ page: { actorId: actor, items }, expiresAt: Date.now() + 60000 });
function button(h, label) { return nodes(h.render()).find(n => n.type === "Pressable" && words(n) === label); }
function field(h, label) { return nodes(h.render()).find(n => n.type === "TextInput" && n.props.accessibilityLabel === label); }
function enterNew(h) {
  button(h, "إضافة عنوان").props.onPress();
  nodes(h.render()).find(n => n.type === "ServiceCityScope").props.onApply("sanaa");
  for (const [label, value] of [["اسم العنوان", "Test home"], ["تفاصيل الوصول", "Synthetic detail"], ["خط العرض", "15.3"], ["خط الطول", "44.2"]]) {
    field(h, label).props.onChangeText(value);
  }
}

test("unsent address draft is hidden on outage, restored only to the same verified actor", async t => {
  const h = harness(t);
  h.focus(); h.pages.shift().resolve(page("actor-a")); await settle();
  enterNew(h);
  assert.equal(field(h, "اسم العنوان").props.value, "Test home");
  h.focus(); h.pages.shift().reject(new DshPublicError(503, "OWNER_UNAVAILABLE")); await settle();
  assert.equal(field(h, "اسم العنوان"), undefined);
  h.focus(); h.pages.shift().resolve(page("actor-a")); await settle();
  assert.equal(field(h, "اسم العنوان")?.props.value, "Test home");
  h.focus(); h.pages.shift().resolve(page("actor-b")); await settle();
  assert.equal(field(h, "اسم العنوان"), undefined);
  h.focus(); h.pages.shift().resolve(page("actor-a")); await settle();
  assert.equal(field(h, "اسم العنوان"), undefined, "a different actor invalidates the prior private draft");
  h.close();
});

test("uncertain address save reads owner state before exposing an exact retry or clearing committed draft", async t => {
  const h = harness(t);
  h.focus(); h.pages.shift().resolve(page("actor-a")); await settle();
  enterNew(h);
  button(h, "حفظ لدى DSH").props.onPress();
  const first = h.writes.shift();
  assert.ok(first);
  h.sessionFailure(new DshPublicError(503, "OWNER_UNAVAILABLE"));
  first.reject(new DshPublicError(503, "OPERATION_RESULT_UNKNOWN")); await settle();
  assert.equal(field(h, "اسم العنوان"), undefined);
  h.sessionFailure(undefined);
  h.focus(); h.pages.shift().resolve(page("actor-a")); await settle();
  assert.ok(button(h, "إعادة نفس الحفظ"), "uncommitted exact versioned command remains retryable");
  button(h, "إعادة نفس الحفظ").props.onPress();
  const retry = h.writes.shift();
  assert.deepEqual({ actor: retry.actor, id: retry.id, change: retry.change }, { actor: first.actor, id: first.id, change: first.change });
  h.sessionFailure(new DshPublicError(503, "OWNER_UNAVAILABLE"));
  retry.reject(new DshPublicError(503, "OPERATION_RESULT_UNKNOWN")); await settle();
  const committed = { id: retry.id, cityId: retry.change.cityId, label: retry.change.label, details: retry.change.details,
    latitude: retry.change.latitude, longitude: retry.change.longitude, version: 1 };
  h.owner("actor-a", committed);
  h.sessionFailure(undefined);
  h.focus(); h.pages.shift().resolve(page("actor-a", [committed])); await settle();
  assert.equal(button(h, "إعادة نفس الحفظ"), undefined, "owner readback confirms prior write; never issue a second one");
  assert.equal(h.writes.length, 0);
  h.close();
});

const addressFixture = (suffix, version = 1) => ({
  id: "addr-" + suffix.repeat(32), cityId: "sanaa", label: "Home " + suffix,
  details: "Synthetic address", latitude: 15.3, longitude: 44.2, version,
});

test("address pagination retains verified actor, cursor and existing entries; denial hides them", async t => {
  const h = harness(t);
  const first = addressFixture("a"), second = addressFixture("b");
  h.focus();
  h.pages.shift().resolve({ ...page("actor-a", [first]), page: { actorId: "actor-a", items: [first], nextCursor: "next-page" } });
  await settle();
  button(h, "المزيد من العناوين").props.onPress();
  const request = h.pages.shift();
  assert.equal(request.actor, "actor-a");
  assert.equal(request.cursor, "next-page");
  request.resolve({ ...page("actor-a", [second]), page: { actorId: "actor-a", items: [second], nextCursor: "last-page" } });
  await settle();
  assert.match(words(h.render()), /Home a/);
  assert.match(words(h.render()), /Home b/);
  button(h, "المزيد من العناوين").props.onPress();
  h.pages.shift().reject(new DshPublicError(403, "FORBIDDEN"));
  await settle();
  assert.doesNotMatch(words(h.render()), /Home [ab]/);
  h.close();
});

test("direct address route loads owner detail and rejects a missing or foreign address", async t => {
  const entry = addressFixture("a");
  const h = harness(t, entry.id);
  h.owner("actor-a", entry);
  h.focus(); h.pages.shift().resolve(page("actor-a")); await settle();
  assert.equal(field(h, "اسم العنوان").props.value, entry.label);
  h.focus(); h.pages.shift().resolve(page("actor-b")); await settle();
  assert.equal(field(h, "اسم العنوان"), undefined);
  assert.match(words(h.render()), /هذا العنوان غير متاح في حسابك/);
  h.close();
});

test("map selection changes only draft coordinates; version conflict discards the stale draft", async t => {
  const h = harness(t);
  const entry = addressFixture("a", 3);
  h.focus(); h.pages.shift().resolve(page("actor-a", [entry])); await settle();
  nodes(h.render()).find(n => n.type === "Pressable" && words(n).includes(entry.label)).props.onPress();
  nodes(h.render()).find(n => n.props?.testID === "address-location-open").props.onPress();
  nodes(h.render()).find(n => n.type === "AddressEditor").props.onSelect({ latitude: 15.4, longitude: 44.3 });
  assert.equal(h.writes.length, 0);
  assert.equal(field(h, "خط العرض").props.value, "15.4");
  button(h, "حفظ لدى DSH").props.onPress();
  const request = h.writes.shift();
  assert.equal(request.change.expectedVersion, 3);
  assert.equal(request.change.latitude, 15.4);
  request.reject(new DshPublicError(409, "ADDRESS_VERSION_CONFLICT"));
  await settle();
  assert.equal(field(h, "اسم العنوان"), undefined);
  h.focus(); h.pages.shift().resolve(page("actor-a", [{ ...entry, version: 4 }])); await settle();
  assert.equal(field(h, "اسم العنوان"), undefined);
  assert.equal(h.writes.length, 0);
  h.close();
});
