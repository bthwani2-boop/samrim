import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as data from "../src/features/catalog/catalog-import-data.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const source = path.resolve(import.meta.dirname, "../src/features/catalog/catalog-import.tsx");
const tick = () => new Promise(setImmediate);
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail("preview did not settle");
}
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== "object" ? [] : [tree, ...nodes(tree.props?.children)];
test("CSV preview is owner-scoped and drops the selected file on revocation or account change", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-import-render-"));
  try {
    const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), source,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--outDir", tmp], {cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
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
      useRef(initial) { const i = refIndex++; return refs[i] ?? (refs[i] = {current:initial}); },
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
      "./catalog-transport": {readMerchantCatalogPage(storeId,actorId,signal,options) {
        return new Promise((resolve,reject)=>ownerReads.push({storeId,actorId,signal,options,resolve,reject}));
      }},
      "expo-file-system": {File: class {
        constructor(uri) { this.uri = uri; }
        get size() { return files.at(-1).size; }
        stream() { return files.at(-1).stream(); }
      }},
    };
    const mod = {exports:{}};
    new Function("require","module","exports","URL",code)(
      name=>{assert.ok(Object.hasOwn(mocks,name), name);return mocks[name];},
      mod,mod.exports,{revokeObjectURL:uri=>revoked.push(uri)});
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
    await until(() => states[2] === false);
    assert.equal(secondRead(),1);
    assert.ok(JSON.stringify(screen()).includes("قهوة"));
    button().props.onPress();
    const thirdRead=select(2);
    await tick();
    cleanup();
    assert.equal(ownerReads[2].signal.aborted,true);
    ownerReads[2].resolve({});
    await tick();
    assert.equal(thirdRead(),0);
    assert.notEqual(mod.exports.default(scope).key,mod.exports.default({...scope,actorId:"merchant-b"}).key);
    mounted=false;states=[];refs=[];platform.OS="android";
    button().props.onPress();
    const nativeRead=select(3,"android");
    await tick();
    ownerReads[3].resolve({});
    await until(() => states[2] === false);
    assert.equal(nativeRead(),1);
    assert.ok(JSON.stringify(screen()).includes("قهوة"));
  } finally {rmSync(tmp,{recursive:true,force:true});}
});
