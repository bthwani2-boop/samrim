import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const files = ["fulfillment-choice", "payment-selection", "recipient-form"];
const compiledFiles = [...files, "delivery-address-review"];
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-customer-checkout-display-"));

let compiled = new Map();
try {
  const args = [
    path.join(root, "node_modules/typescript/bin/tsc"),
    ...compiledFiles.map(file => path.join(directory, [file, ".tsx"].join(""))),
    "--ignoreConfig", "--noResolve", "--noCheck",
    "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx",
    "--inlineSourceMap", "--inlineSources", "--rootDir", directory, "--outDir", temp,
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = new Map(compiledFiles.map(file => [file,
    readFileSync(path.join(temp, [file, ".js"].join("")), "utf8")]));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

// Keep uncached fixture modules alive until Node collects coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
function component(file, overrides = {}) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const mocks = {
    "@bthwani/tamagui-config/appearance": {
      useMobileAppearance: () => ({ theme: { colorSecondary: "#ddeeff" } }),
    },
    "react-native": { Text: "Text" },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
  };
  Object.assign(mocks, overrides);
  const mod = loadMappedRenderFixture(compiled.get(file), path.join(directory, `${file}.tsx`), mocks);
  loadedModules.push(mod);
  return mod.exports.default;
}

for (const file of files) {
  test([file, "shows bounded read-only information in the current theme"].join(" "), () => {
    const render = component(file);
    assert.equal(render({}), null, "absent owner values must not appear");
    assert.equal(render({ label: "" }), null, "empty values must not appear");
    const view = render({ label: "لم يعتمد DSH هذا الحقل بعد" });
    assert.equal(view.type, "Text");
    assert.equal(view.props.children, "لم يعتمد DSH هذا الحقل بعد");
    assert.equal(view.props.style.color, "#ddeeff",
      "checkout information must remain legible in dark mode");
    assert.equal(view.props.style.lineHeight, 24);
    assert.equal(view.props.onPress, undefined, "status is not an actionable permission");
  });
}

const address = { id: "addr-00000000000000000000000000000001", cityId: "sanaa", label: "عنوان اختباري",
  details: "تفاصيل خاصة", latitude: 15.3, longitude: 44.2, version: 2 };
const evaluation = { actorId: "customer-a", storeId: "store-a", addressId: address.id, status: "SERVICEABLE",
  evidence: { storeCityId: "sanaa", addressCityId: "sanaa", addressVersion: 2, policyVersion: 3,
    radiusMetres: 30000, distanceMetres: 1200 } };
const settle = () => new Promise(resolve => setImmediate(resolve));
function addressHarness({ pages, outcome = evaluation } = {}) {
  const hooks = [], reads = [], evaluations = [];
  let index = 0, focus, attached = false;
  const sessionExpiry = () => Date.now() + 60000;
  const defaultPage = () => ({ page: { actorId: "customer-a", items: [address] }, expiresAt: sessionExpiry() });
  const Review = component("delivery-address-review", {
    react: {
      useState(initial) { const at = index++; if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }]; },
      useRef(initial) { const at = index++; hooks[at] ??= { current: initial }; return hooks[at]; },
      useCallback(callback) { return callback; },
      useEffect(callback) { if (!attached) { attached = true; callback(); } },
    },
    "expo-router": { Link: "Link", useFocusEffect(callback) { focus = callback; } },
    "react-native": { AppState: { addEventListener() { return { remove() {} }; } },
      Platform: { OS: "android" }, Pressable: "Pressable", Text: "Text", View: "View" },
    "../location/serviceability": { serviceCityLabel: city => ({ sanaa: "صنعاء", aden: "عدن" })[city] ?? city },
    "../addresses/address-transport": {
      async readVerifiedAddresses(_signal, actor, after) { reads.push([actor, after]); return pages?.shift() ?? defaultPage(); },
      async readVerifiedDeliveryServiceability(actor, store, id) { evaluations.push([actor, store, id]); return outcome; },
      async verifyAddressSession() {},
    },
  });
  return { reads, evaluations, render() { index = 0; return Review({ actorId: "customer-a", storeId: "store-a" }); }, start() { return focus(); } };
}
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  return node && typeof node === "object" ? [node, ...descendants(node.props?.children)] : [];
}
function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? textOf(node.props?.children) : "";
}
async function openAddress(h) {
  await settle();
  const button = descendants(h.render()).find(node => node.type === "Pressable" && textOf(node).includes(address.label));
  assert.ok(button);
  button.props.onPress();
  await settle();
  return h.render();
}

test("geographic eligibility displays the actual owner distance, radius and policy without private coordinates", async () => {
  const h = addressHarness(); h.render(); const cleanup = h.start();
  try {
    const view = await openAddress(h);
    const evidence = descendants(view).find(node => node.props?.testID === "checkout-address-evidence");
    assert.ok(evidence);
    const text = textOf(evidence);
    assert.match(text, /المسافة الجغرافية/);
    assert.match(text, /نطاق المدينة/);
    assert.match(text, /نسخة السياسة/);
    assert.match(text, /١٬٢٠٠|1,200|1200/);
    assert.match(text, /٣٠٬٠٠٠|30,000|30000/);
    assert.match(text, /٣|3/);
    assert.doesNotMatch(textOf(view), /تفاصيل خاصة|15\.3|44\.2/);
    assert.deepEqual(h.evaluations, [["customer-a", "store-a", address.id]]);
  } finally { cleanup(); }
});

test("owner-denied geographic eligibility distinguishes a city mismatch and radius overflow", async () => {
  for (const [evidence, reason] of [
    [{ ...evaluation.evidence, storeCityId: "aden" }, /مدينة المتجر تختلف/],
    [{ ...evaluation.evidence, distanceMetres: 30001 }, /تتجاوز نطاق المدينة/],
  ]) {
    const h = addressHarness({ outcome: { ...evaluation, status: "UNSERVICEABLE", evidence } });
    h.render(); const cleanup = h.start();
    try { assert.match(textOf(await openAddress(h)), reason); } finally { cleanup(); }
  }
});

test("checkout opens the selected verified address in its editor", async () => {
  const h = addressHarness();
  const editLink = view => descendants(view).find(node => node.type === "Link" && textOf(node) === "تعديل العنوان المحدد");
  assert.equal(editLink(h.render()), undefined);
  const cleanup = h.start();
  try {
    const link = editLink(await openAddress(h));
    assert.deepEqual(link?.props.href, { pathname: "/addresses/[id]", params: { id: address.id } });
  } finally { cleanup(); }
  assert.equal(editLink(h.render()), undefined);
});

test("owner unavailable carries no fabricated radius or distance; inconsistent address city fails closed", async () => {
  for (const outcome of [
    { actorId: evaluation.actorId, storeId: evaluation.storeId, addressId: evaluation.addressId, status: "UNAVAILABLE" },
    { ...evaluation, evidence: { ...evaluation.evidence, addressCityId: "aden", storeCityId: "aden" } },
    { ...evaluation, evidence: { ...evaluation.evidence, addressVersion: 3 } },
  ]) {
    const h = addressHarness({ outcome }); h.render(); const cleanup = h.start();
    try {
      const view = await openAddress(h);
      assert.ok(!descendants(view).some(node => node.props?.testID === "checkout-address-evidence"));
      if (outcome.status === "UNAVAILABLE") assert.match(textOf(view), /لا تتوفر أدلة كافية/);
      else { assert.match(textOf(view), /تعذّر التحقق من العنوان/); assert.doesNotMatch(textOf(view), /عنوان اختباري/); }
    } finally { cleanup(); }
  }
});

test("expired continuation removes both the previous and incoming address pages", async () => {
  const next = "addr-00000000000000000000000000000002";
  const h = addressHarness({ pages: [
    { page: { actorId: "customer-a", items: [address], nextCursor: address.id }, expiresAt: Date.now() + 60000 },
    { page: { actorId: "customer-a", items: [{ ...address, id: next, label: "عنوان تالٍ" }] }, expiresAt: Date.now() - 100 },
  ] });
  h.render(); const cleanup = h.start();
  try {
    await settle();
    const more = descendants(h.render()).find(node => node.type === "Pressable" && textOf(node).includes("المزيد من العناوين"));
    assert.ok(more); more.props.onPress(); await settle();
    const text = textOf(h.render());
    assert.doesNotMatch(text, /عنوان اختباري|عنوان تالٍ/);
    assert.match(text, /تعذّر التحقق من العنوان/);
    assert.deepEqual(h.reads, [["customer-a", undefined], ["customer-a", address.id]]);
  } finally { cleanup(); }
});

test("an expired verified-address page never exposes private address labels", async () => {
  const h = addressHarness({ pages: [{ page: { actorId: "customer-a", items: [address] }, expiresAt: Date.now() - 100 }] });
  h.render(); const cleanup = h.start();
  try {
    await settle();
    assert.doesNotMatch(textOf(h.render()), /عنوان اختباري/);
    assert.match(textOf(h.render()), /تعذّر التحقق من العنوان/);
  } finally { cleanup(); }
});
