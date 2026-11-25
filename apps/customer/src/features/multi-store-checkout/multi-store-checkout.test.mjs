import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

test("multi-Store directory lists verified drafts without order orchestration", () => {
  const source = readFileSync(new URL("./multi-store-checkout-screen.tsx", import.meta.url), "utf8");
  assert.match(source, /readVerifiedCartDirectory\(/);
  assert.match(source, /\/cart\/\[storeId\]/);
  assert.match(source, /checkout-confirmation-unavailable/);
  assert.doesNotMatch(source, /createOrder\(|fetch\(|payment\(/);
});

const actor="customer-a";
const bearer=Buffer.alloc(32,14).toString("base64url");
const entry={storeId:"store-a",storeName:"Test Store",version:1,lineCount:1};
const page={actorId:actor,carts:[entry]};
const json=value=>Response.json(value,{headers:{"Cache-Control":"no-store"}});
const session=actorId=>({actorId,role:"customer",sessionExpiresAt:"2030-01-01T00:00:00Z"});
process.env.BTHWANI_SURFACE_PREVIEW="1";
process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN="http://127.0.0.1:3202";
process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN="http://127.0.0.1:3210";
const {handleCustomerCartDirectory}=await import("../cart/cart-directory-bff.ts");
const base="http://localhost/api/customer-auth/carts";
const request=(suffix="",headers={})=>new Request(base+suffix,{headers:{Cookie:"bthwani_surface_customer_auth="+bearer,"X-Customer-Context":actor,...headers}});
test("directory BFF rejects caller-selected actors, cross-site and duplicate cursor without owner dispatch",async t=>{
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw Error("unexpected");});
  for(const [req,status] of [[new Request(base),401],[request("?actorId=customer-b"),400],[request("?after=a&after=b"),400],[request("",{"Sec-Fetch-Site":"cross-site"}),403],[request("",{Origin:"https://other.example"}),403]]) {
    const response=await handleCustomerCartDirectory(req);assert.equal(response.status,status);assert.equal(response.headers.get("Cache-Control"),"no-store");
  }
  assert.equal(calls,0);
});
test("directory BFF checks identity before and after owner read; changed actor cannot receive data",async t=>{
  let calls=[],changed=false,reads=0;
  t.mock.method(globalThis,"fetch",async(url,init)=>{
    calls.push([String(url),init.method]);assert.equal(init.headers.Authorization,"Bearer "+bearer);
    if(String(url).startsWith("http://127.0.0.1:3210")) return json(session(changed&&++reads>1?"customer-b":actor));
    return json(page);
  });
  assert.deepEqual(await (await handleCustomerCartDirectory(request())).json(),page);
  assert.equal(calls[1][0],"http://127.0.0.1:3202/v1/carts");
  changed=true;reads=0;
  const denied=await handleCustomerCartDirectory(request());
  assert.equal(denied.status,401);assert.equal((await denied.json()).carts,undefined);
});
const root=fileURLToPath(new URL("../../../../../",import.meta.url));
const screen=fileURLToPath(new URL("./multi-store-checkout-screen.tsx",import.meta.url));
const temp=mkdtempSync(path.join(tmpdir(),"bthwani-cart-directory-render-"));
let compiled;
try {
  const result=spawnSync(process.execPath,[path.join(root,"node_modules/typescript/bin/tsc"),screen,"--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs","--jsx","react-jsx","--inlineSourceMap","--inlineSources","--outDir",temp],{cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  compiled=readFileSync(path.join(temp,"multi-store-checkout-screen.js"),"utf8");
}finally{rmSync(temp,{recursive:true,force:true});}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==="object"?[tree,...nodes(tree.props?.children)]:[];}
function harness(){
  const hooks=[],reads=[];let index=0,focus,cleanup;
  const jsx=(type,props)=>({type,props:props??{}});
  const modules={
    "@bthwani/dsh":{DshPublicError:Error},
    "@bthwani/tamagui-config/appearance":{useMobileAppearance:()=>({theme:{}})},
    "expo-router":{Link:"Link",useFocusEffect(callback){focus=callback;}},
    react:{
      useState(initial){const at=index++;if(!(at in hooks))hooks[at]=initial;return [hooks[at],next=>{hooks[at]=typeof next==="function"?next(hooks[at]):next;}];},
      useRef(initial){const at=index++;hooks[at]??={current:initial};return hooks[at];},
      useCallback(callback){index++;return callback;},useEffect(){index++;},
    },
    "react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"Fragment"},
    "react-native":{Platform:{OS:"android"},AppState:{currentState:"active"},Pressable:"Pressable",Text:"Text",View:"View",ScrollView:"ScrollView"},
    "react-native-safe-area-context":{SafeAreaView:"SafeAreaView"},
    "../cart/cart-directory-transport":{
      readVerifiedCartDirectory:(signal,after,actorId)=>new Promise((resolve,reject)=>reads.push({signal,after,actorId,resolve,reject})),
      verifyCartDirectorySession:async()=>session(actor),
    },
  };
  const mod=loadMappedRenderFixture(compiled,screen,modules);
  return {reads,render(){index=0;return mod.exports.default();},focus(){cleanup?.();cleanup=focus();},blur(){cleanup?.();}};
}
const settle=()=>new Promise(setImmediate);
const links=tree=>nodes(tree).filter(n=>n.type==="Link"&&n.props.href?.pathname==="/cart/[storeId]");
test("actual screen renders owner Store links, rejects stale continuation and late response after blur",async()=>{
  const h=harness();h.render();h.focus();
  assert.equal(links(h.render()).length,0);
  h.reads[0].resolve({value:{...page,nextCursor:"store-a"},expiresAt:Date.now()+60000});await settle();
  const view=h.render();assert.equal(links(view)[0].props.href.params.storeId,"store-a");
  const next=nodes(view).find(n=>n.type==="Pressable"&&typeof n.props.onPress==="function").props.onPress;
  next();next();assert.equal(h.reads.length,2);assert.equal(h.reads[1].after,"store-a");assert.equal(h.reads[1].actorId,actor);
  h.blur();assert.equal(h.reads[1].signal.aborted,true);
  h.reads[1].resolve({value:{...page,carts:[{...entry,storeId:"store-b"}]},expiresAt:Date.now()+60000});await settle();
  assert.equal(links(h.render()).length,0);
  h.focus();next();assert.equal(h.reads.length,3);
  h.reads[2].resolve({value:{...page,carts:[]},expiresAt:Date.now()+60000});await settle();
  assert.equal(links(h.render()).length,0);h.blur();
});

const buttonByText = (h,label) => nodes(h.render()).find(n=>n.type==="Pressable"&&nodes(n.props.children).some(child=>child.type==="Text"&&child.props.children===label));

test("failed directory continuation retries the same cursor and verified actor; old retry cannot dispatch again",async()=>{
  const h=harness();h.render();h.focus();
  h.reads[0].resolve({value:{...page,nextCursor:"store-a"},expiresAt:Date.now()+60000});await settle();
  buttonByText(h,"المزيد من السلال").props.onPress();
  h.reads[1].reject(new Error("owner temporarily unavailable"));await settle();
  assert.equal(links(h.render()).length,0);
  const retry=buttonByText(h,"إعادة المحاولة").props.onPress;
  retry();retry();
  assert.equal(h.reads.length,3,"retry dispatches once");
  assert.equal(h.reads[2].after,"store-a","retry must not reset to first page");
  assert.equal(h.reads[2].actorId,actor);
  h.reads[2].resolve({value:{...page,carts:[{...entry,storeId:"store-b"}]},expiresAt:Date.now()+60000});await settle();
  assert.equal(links(h.render())[0].props.href.params.storeId,"store-b");
  retry();assert.equal(h.reads.length,3);h.blur();
});

test("return to first page is bound to the verified actor and old callback cannot restart a new focus",async()=>{
  const h=harness();h.render();h.focus();
  h.reads[0].resolve({value:{...page,nextCursor:"store-a"},expiresAt:Date.now()+60000});await settle();
  buttonByText(h,"المزيد من السلال").props.onPress();
  h.reads[1].resolve({value:{...page,carts:[{...entry,storeId:"store-b"}]},expiresAt:Date.now()+60000});await settle();
  const restart=buttonByText(h,"العودة إلى البداية").props.onPress;
  restart();restart();
  assert.equal(h.reads.length,3);
  assert.equal(h.reads[2].after,undefined);
  assert.equal(h.reads[2].actorId,actor);
  h.blur();h.render();h.focus();restart();
  assert.equal(h.reads.length,4,"old callback cannot interrupt new focus");
  h.blur();
});
