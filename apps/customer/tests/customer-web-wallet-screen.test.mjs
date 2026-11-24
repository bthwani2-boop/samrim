import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { formatExactYer } from "../src/components/format-exact-yer.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = fileURLToPath(new URL("../src/features/wallet/wallet-screen.web.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-customer-web-wallet-"));
let compiled;
try {
  const tsc = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], {cwd:root, encoding:"utf8", timeout:20000, windowsHide:true});
  assert.equal(tsc.status, 0, tsc.stderr || tsc.stdout);
  compiled = readFileSync(path.join(temp, "wallet-screen.web.js"), "utf8");
} finally {
  rmSync(temp, {recursive:true, force:true});
}

const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
const ready = actorId => ({
  kind:"ready",
  balance:{actorId, currency:"YER", balanceYer:"9007199254740993"},
  expiresAt:Date.now()+60000,
});
const funding = fundingId => ({fundingId, amountYer:"17", postedAt:"2026-11-21T00:00:00Z"});
const history = (actorId, items, nextCursor=null) => ({
  kind:"ready",
  history:{actorId,currency:"YER",items,hasMore:nextCursor!==null,nextCursor},
  expiresAt:Date.now()+60000,
});

function harness() {
  let index=0, focusEffect, cleanup, focus=true, visibility="visible";
  const hooks=[], pending=[], timers=new Map(), intervals=new Map(), docEvents=new Map(), winEvents=new Map();
  let nextTimer=0;
  const jsx=(type,props)=>({type,props:props??{}});
  const document={
    get visibilityState(){return visibility;},
    hasFocus(){return focus;},
    addEventListener(name,cb){docEvents.set(name,cb);},
    removeEventListener(name,cb){if(docEvents.get(name)===cb)docEvents.delete(name);},
  };
  const window={
    addEventListener(name,cb){winEvents.set(name,cb);},
    removeEventListener(name,cb){if(winEvents.get(name)===cb)winEvents.delete(name);},
  };
  const mockTimer=(list,fn,delay)=>{const n=++nextTimer;list.set(n,{fn,delay});return n;};
  const mocks={
    "@bthwani/tamagui-config/appearance":{useMobileAppearance:()=>({theme:{}})},
    "expo-router":{Link:"Link",useFocusEffect(cb){focusEffect=cb;}},
    react:{
      useCallback(cb){return cb;},
      useState(initial){
        const slot=index++;
        if(!(slot in hooks))hooks[slot]=initial;
        return [hooks[slot], v=>{hooks[slot]=typeof v==="function"?v(hooks[slot]):v;}];
      },
      useRef(initial){const slot=index++;hooks[slot]??={current:initial};return hooks[slot];},
    },
    "react/jsx-runtime":{jsx,jsxs:jsx},
    "react-native":Object.fromEntries(["Pressable","SafeAreaView","ScrollView","Text","View"].map(t=>[t,t])),
    "../../components/format-exact-yer": { formatExactYer },
    "../access/customer-session-transport":{readCustomerAdmission(){}},
    "./wallet-read.web":{
      readVerifiedWallet(admission,signal){
        assert.equal(typeof admission,"function");
        return new Promise((resolve,reject)=>pending.push({kind:"balance",signal,resolve,reject}));
      },
      readVerifiedWalletTransactions(admission,signal,cursor,expectedActorId){
        assert.equal(typeof admission,"function");
        return new Promise((resolve,reject)=>pending.push({
          kind:"history",signal,cursor,expectedActorId,resolve,reject,
        }));
      },
    },
  };
  const mod={exports:{}};
  new Function("require","module","exports","document","window",
    "setTimeout","clearTimeout","setInterval","clearInterval",compiled)(
    name=>{assert.ok(Object.hasOwn(mocks,name),"unknown import "+name);return mocks[name];},
    mod,mod.exports,document,window,
    (fn,delay)=>mockTimer(timers,fn,delay),id=>timers.delete(id),
    (fn,delay)=>mockTimer(intervals,fn,delay),id=>intervals.delete(id),
  );
  function render(){index=0;return mod.exports.default();}
  return {
    mount(){const view=render();assert.equal(typeof focusEffect,"function");cleanup=focusEffect();return view;},
    render,
    read(kind){const i=pending.findIndex(p=>p.kind===kind);assert.notEqual(i,-1,"expected "+kind);return pending.splice(i,1)[0];},
    event(name){if(name==="blur")focus=false;else if(name==="focus")focus=true;winEvents.get(name)?.();},
    visibility(value){visibility=value;docEvents.get("visibilitychange")?.();},
    expire(){const next=[...timers.values()].find(t=>t.delay>0);assert.ok(next);next.fn();},
    unmount(){cleanup?.();cleanup=null;},
  };
}
function walk(node,needle) {
  if(Array.isArray(node))return node.map(n=>walk(n,needle)).find(Boolean) ?? null;
  if(node===null||typeof node!=="object")return null;
  if(needle(node))return node;
  return walk(node.props?.children,needle);
}
const find=(tree,testID)=>walk(tree,n=>n.props?.testID===testID);
const textOf=node=>typeof node==="string"||typeof node==="number"?String(node):
  Array.isArray(node)?node.map(textOf).join(" "):node&&typeof node==="object"?
    textOf(node.props?.children):"";
const clickMore=tree=>walk(tree,n=>n.type==="Pressable"&&
  Object.hasOwn(n.props??{},"disabled")&&typeof n.props?.onPress==="function");

test("Web wallet screen renders exact owner YER and paginates only under same customer",async()=>{
  const h=harness();try{
    h.mount();assert.equal(find(h.render(),"wallet-balance"),null);
    h.read("balance").resolve(ready("actor-a"));await settle();
    const first=h.read("history");assert.equal(first.expectedActorId,"actor-a");
    first.resolve(history("actor-a",[funding("funding-a")],"page-next"));await settle();
    assert.ok(textOf(find(h.render(),"wallet-balance")).length>0);
    clickMore(h.render()).props.onPress();
    const page=h.read("history");assert.equal(page.cursor,"page-next");
    assert.equal(page.expectedActorId,"actor-a");
    page.resolve(history("actor-a",[funding("funding-b")]));await settle();
    assert.equal(textOf(h.render()).includes("funding-b"),false,"raw IDs are not displayed");
    assert.equal(clickMore(h.render()),null,"final page must remove more action");
  } finally{h.unmount();}
});

test("Web wallet hides funds on blur and rejects late history and revoked session",async()=>{
  const h=harness();try{
    h.mount();h.read("balance").resolve(ready("actor-a"));await settle();
    const pending=h.read("history");
    assert.ok(find(h.render(),"wallet-balance"));
    h.event("blur");
    assert.equal(pending.signal.aborted,true);
    assert.equal(find(h.render(),"wallet-balance"),null);
    pending.resolve(history("actor-a",[funding("late-secret")]));await settle();
    assert.equal(find(h.render(),"wallet-balance"),null);
    h.event("focus");
    h.read("balance").resolve({kind:"signed-out"});await settle();
    assert.equal(find(h.render(),"wallet-balance"),null);
    const login=walk(h.render(),n=>n.type==="Link"&&n.props.href?.pathname==="/login");
    assert.deepEqual(login?.props.href,{pathname:"/login",params:{returnTo:"/wallet"}});
  }finally{h.unmount();}
});

test("Web wallet refuses a continuation that repeats the old cursor and permits retry",async()=>{
  const h=harness();try{
    h.mount();h.read("balance").resolve(ready("actor-a"));await settle();
    h.read("history").resolve(history("actor-a",[funding("funding-a")],"page-next"));await settle();
    const more=clickMore(h.render());assert.ok(more);
    const originalDisplay=textOf(h.render());
    more.props.onPress();
    h.read("history").resolve(history("actor-a",
      Array.from({length:10},(_,i)=>funding(`funding-next-${i}`)),"page-next"));await settle();
    assert.notEqual(textOf(h.render()),originalDisplay,"stalled cursor must display a retry error");
    assert.ok(clickMore(h.render()),"bad page must leave original retry action");
    clickMore(h.render()).props.onPress();
    const retry=h.read("history");
    assert.equal(retry.cursor,"page-next","cursor must not advance to same cursor");
    retry.resolve(history("actor-a",[funding("funding-b")]));await settle();
    assert.equal(clickMore(h.render()),null);
  }finally{h.unmount();}
});
