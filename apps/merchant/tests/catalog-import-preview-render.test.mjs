import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import * as data from "../src/features/catalog/catalog-import-data.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const source = path.resolve(import.meta.dirname, "../src/features/catalog/catalog-import.tsx");
// Retain uncached fixture modules for original-source coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
const tick = () => new Promise(setImmediate);
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail("preview did not settle");
}
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== "object" ? [] : [tree, ...nodes(tree.props?.children)];
test("CSV preview is owner-scoped and drops the selected file on revocation or account change", async t => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-import-render-"));
  try {
    const result = spawnSync(process.execPath, [path.join(root, "node_modules/@typescript/native/bin/tsc"), source,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", tmp], {cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const code = readFileSync(path.join(tmp, "catalog-import.js"), "utf8");
    let states = [], refs = [], stateIndex = 0, refIndex = 0, cleanup, mounted = false;
    const picks = [], ownerReads = [], revoked = [], files = [];
    const jsx = (type, props, key) => ({type, props: props ?? {}, key});
    const platform = {OS:"web"};
    const react = {
      useState(initial) {
        const i = stateIndex++;
        if (!(i in states)) states[i] = initial;
        return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }];
      },
      useRef(initial) { const i = refIndex++; refs[i] ??= {current:initial}; return refs[i]; },
      useLayoutEffect(fn) { if (!mounted) { mounted = true; cleanup = fn(); } },
    };
    const mocks = {
      "@bthwani/tamagui-config/appearance": {useMobileAppearance:()=>({theme:{}})},
      "expo-document-picker": {getDocumentAsync(options) {
        return new Promise(resolve => picks.push({options,resolve}));
      }},
      react, "react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"Fragment"},
      "react-native": {Platform:platform,Pressable:"Pressable",Text:"Text",View:"View"},
      "../../components/merchant-capability-screen":{__esModule:true,default:"Unavailable"},
      "./catalog-import-data": data,
      "./catalog-import-run": {__esModule:true,default:"BulkRun"},
      "expo-crypto": {CryptoDigestAlgorithm:{SHA256:"SHA256"},digest:async()=>new Uint8Array(32).fill(170).buffer},
      "./merchant-catalog-draft-form": {__esModule:true,default:"DraftForm"},
      "./catalog-transport": {readMerchantCatalogPage(storeId,actorId,signal,options) {
        return new Promise((resolve,reject)=>ownerReads.push({storeId,actorId,signal,options,resolve,reject}));
      }},
      "expo-file-system": {File: class {
        constructor(uri) { this.uri = uri; }
        get size() { return files.at(-1).size; }
        stream() { return files.at(-1).stream(); }
      }},
    };
    t.mock.method(URL, "revokeObjectURL", uri => revoked.push(uri));
    const mod = loadMappedRenderFixture(code, source, mocks);
    loadedModules.push(mod);
    const scope = {actorId:"merchant-a",storeId:"store-a"};
    const screen = () => {stateIndex=0;refIndex=0;const c=mod.exports.default(scope);return c.type(c.props);};
    const button = () => nodes(screen()).find(n=>n.props?.accessibilityLabel==="معاينة ملف المنتجات CSV");
    const select = (i, platformName="web") => {
      const blob = new Blob(["name,price_yer,stock_units\nقهوة,1000,2"]);
      let read = 0;
      const file={size:blob.size,stream(){read++;return blob.stream();}};
      files.push(file);
      picks[i].resolve({canceled:false,assets:[{name:"catalog.csv",size:blob.size,uri:platformName==="web"?"blob:synthetic":"content://synthetic/catalog",file}]});
      return ()=>read;
    };
    assert.equal(mod.exports.default().type,"Unavailable");
    button().props.onPress(); button().props.onPress();
    assert.equal(picks.length,1);
    assert.equal(picks[0].options.copyToCacheDirectory,false);
    const firstRead = select(0);
    await tick();
    assert.deepEqual(ownerReads[0].options,{limit:1});
    assert.equal(ownerReads[0].storeId,"store-a");
    assert.equal(ownerReads[0].actorId,"merchant-a");
    assert.equal(firstRead(),0);
    ownerReads[0].reject(new Error("denied"));
    await tick();
    assert.equal(firstRead(),0);
    assert.equal(revoked.length,1);
    button().props.onPress();
    const secondRead=select(1);
    await tick();
    ownerReads[1].resolve({});
    await until(() => ownerReads.length === 3 || states[2] === false);
    assert.equal(ownerReads.length, 3, "preview must read the verified catalog after parsing");
    assert.deepEqual(ownerReads[2].options,{limit:50});
    const ownerPage = (items, nextCursor) => ({actorId:"merchant-a",storeId:"store-a",items,...(nextCursor ? {nextCursor} : {})});
    const offer = (id,name) => ({id,name,storeId:"store-a",priceYer:"1200",stockUnits:7,published:true});
    ownerReads[2].resolve(ownerPage(Array.from({length:50},(_,i)=>offer("of-a"+String(i).padStart(2,"0"),"منتج "+i)),"of-a49"));
    await until(() => ownerReads.length === 4);
    assert.deepEqual(ownerReads[3].options,{limit:50,cursor:"of-a49"});
    ownerReads[3].resolve(ownerPage([offer("of-b","قهوة")]));
    await until(() => states[2] === false);
    assert.equal(secondRead(),1);
    assert.ok(JSON.stringify(screen()).includes("قهوة"));
    assert.ok(JSON.stringify(screen()).includes("اسم موجود في كتالوج المتجر"));
    assert.ok(JSON.stringify(screen()).includes("المعاينة لا تحفظ أي سجل"));
    assert.ok(JSON.stringify(screen()).includes("1200"));
    assert.ok(!nodes(screen()).some(n=>String(n.props?.accessibilityLabel).includes("مراجعة تعديل المسودة")), "published offers stay held");
    const conflictFilter = nodes(screen()).find(n=>n.props?.accessibilityLabel==="عرض تعارضات المتجر");
    assert.ok(conflictFilter, "conflict filter must be reachable");
    conflictFilter.props.onPress();
    assert.ok(JSON.stringify(screen()).includes("قهوة"));
    const pendingFilter = nodes(screen()).find(n=>n.props?.accessibilityLabel==="عرض ما يحتاج مراجعة");
    pendingFilter.props.onPress();
    assert.ok(JSON.stringify(screen()).includes("لا توجد سجلات مطابقة"));
    button().props.onPress();
    const thirdRead=select(2);
    await tick();
    cleanup();
    assert.equal(ownerReads[4].signal.aborted,true);
    ownerReads[4].resolve({});
    await tick();
    assert.equal(thirdRead(),0);
    assert.notEqual(mod.exports.default(scope).key,mod.exports.default({...scope,actorId:"merchant-b"}).key);
    mounted=false;states=[];refs=[];platform.OS="android";
    button().props.onPress();
    const nativeRead=select(3,"android");
    await tick();
    ownerReads[5].resolve({});
    await until(() => ownerReads.length === 7);
    ownerReads[6].resolve(ownerPage([{
      ...offer("of-draft", "قهوة"), published:false, available:false, productActive:false,
      variantSellable:false, requiredAttributesValid:false, draftVersion:7, productId:"pr-draft", variantId:"va-draft",
    }]));
    await until(() => states[2] === false);
    assert.equal(nativeRead(),1);
    assert.ok(JSON.stringify(screen()).includes("قهوة"));
    assert.ok(!nodes(screen()).some(n=>n.type==="DraftForm"), "no implicit save or selection");
    const resolve = nodes(screen()).find(n=>n.props?.accessibilityLabel==="مراجعة تعديل المسودة للسجل 2");
    assert.ok(resolve, "a unique editable draft can be explicitly reviewed");
    resolve.props.onPress();
    const form = nodes(screen()).find(n=>n.type==="DraftForm");
    assert.equal(form.props.actorId,"merchant-a");
    assert.equal(form.props.storeId,"store-a");
    assert.equal(form.props.draft.id,"of-draft");
    assert.equal(form.props.draft.draftVersion,7);
    assert.equal(form.props.priceStockOnly,true);
    assert.deepEqual(form.props.initialPriceStock,{priceYer:"1000",stockUnits:2});
    assert.ok(!nodes(screen()).some(n=>n.props?.accessibilityLabel==="معاينة ملف المنتجات CSV" && !n.props.disabled));
    form.props.onSaved();
    form.props.onCreated();
    assert.ok(JSON.stringify(screen()).includes("أكد DSH حفظ تعديل المسودة"));
    assert.ok(!nodes(screen()).some(n=>n.type==="DraftForm"));
    assert.ok(!JSON.stringify(screen()).includes("of-draft"));
    platform.OS="web";
    const cancelButton=()=>nodes(screen()).find(n=>n.props?.accessibilityLabel==="إلغاء مراجعة الملف");
    button().props.onPress();
    assert.equal(cancelButton(),undefined,"native picker owns its own cancellation");
    const canceledRead=select(4);
    await tick();
    const pending=ownerReads[7];
    assert.ok(cancelButton(),"review must expose cancel after file choice");
    const oldCancel=cancelButton().props.onPress;
    oldCancel();
    assert.equal(pending.signal.aborted,true);
    assert.equal(button().props.disabled,false);
    assert.equal(cancelButton(),undefined);
    button().props.onPress();
    const retryRead=select(5);
    await tick();
    oldCancel();
    assert.equal(ownerReads[8].signal.aborted,false,"stale cancellation cannot cancel a new attempt");
    pending.resolve({});
    await tick();
    assert.equal(canceledRead(),0);
    assert.equal(button().props.disabled,true,"late canceled read must not clear the retry");
    ownerReads[8].resolve({});
    await until(()=>ownerReads.length===10);
    ownerReads[9].resolve(ownerPage([offer("of-new","قهوة")]));
    await until(()=>states[2]===false);
    assert.equal(retryRead(),1);
    assert.equal(cancelButton(),undefined);
    assert.ok(nodes(screen()).find(n=>n.type==="BulkRun").props.rows.length>0);
  } finally {rmSync(tmp,{recursive:true,force:true});}
});
