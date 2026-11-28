import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

const root=fileURLToPath(new URL("../../../../../",import.meta.url));
const entry=fileURLToPath(new URL("./favorite-stores.tsx",import.meta.url));
const temp=mkdtempSync(path.join(tmpdir(),"bthwani-favorite-render-"));
let compiled;
try {
  const result=spawnSync(process.execPath,[path.join(root,"node_modules/@typescript/native/bin/tsc"),entry,
    "--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs","--jsx","react-jsx","--inlineSourceMap","--inlineSources","--outDir",temp],
    {cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  compiled=readFileSync(path.join(temp,"favorite-stores.js"),"utf8");
} finally {rmSync(temp,{recursive:true,force:true});}

function nodes(tree){
  if(Array.isArray(tree))return tree.flatMap(nodes);
  return tree&&typeof tree==="object"?[tree,...nodes(tree.props?.children)]:[];
}
function harness(storeId, { lifecycle = false, platform = "android", deferredVerification = false } = {}) {
  const hooks=[], reads=[], writes=[], verifications=[];
  const dependencies = new Map(), effects = new Map(), effectCleanups = new Map();
  let index=0, focus, cleanup, appState;
  const changed = (at, next) => !dependencies.has(at) || next.some((value, i) => value !== dependencies.get(at)[i]);
  const jsx=(type,props)=>({type,props:props??{}});
  const request=(calls,details)=>new Promise((resolve,reject)=>calls.push({...details,resolve,reject}));
  const modules={
    "@bthwani/dsh":{DshPublicError:Error,getPublicStore:async(_origin,id)=>({id,name:id})},
    "@bthwani/tamagui-config/appearance":{useMobileAppearance:()=>({theme:{}})},
    "expo-router":{Link:"Link",useFocusEffect(callback){focus=callback;}},
    react:{
      useState(initial){const at=index++;if(!(at in hooks))hooks[at]=initial;return [hooks[at],next=>{hooks[at]=typeof next==="function"?next(hooks[at]):next;}];},
      useRef(initial){const at=index++;hooks[at]??={current:initial};return hooks[at];},
      useCallback(callback, next) {
        const at = index++;
        if (!lifecycle) return callback;
        if (changed(at, next)) { dependencies.set(at, next); hooks[at] = callback; }
        return hooks[at];
      },
      useEffect(effect, next) {
        const at = index++;
        if (lifecycle && changed(at, next)) { dependencies.set(at, next); effects.set(at, effect); }
      },
    },
    "react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"Fragment"},
    "react-native": { Platform: { OS: platform }, Pressable:"Pressable", Text:"Text", View:"View",
      AppState: { addEventListener(_event, callback) { appState = callback; return { remove() { appState = undefined; } }; } } },
    "../stores/public-store-origin":{resolvePublicStoreOrigin:()=>""},
    "./favorite-stores-transport":{
      readFavoriteStore:(signal,id)=>request(reads,{signal,id}),
      readFavoriteStores:(signal,actor,after)=>request(reads,{signal,actor,after}),
      writeFavoriteStore:(signal,actor,id,favorite)=>request(writes,{signal,actor,id,favorite}),
      verifyFavoriteSession: (signal, actor) => deferredVerification ? request(verifications, { signal, actor }) :
        Promise.resolve({ sessionExpiresAt: "2030-01-01T00:00:00Z" }),
    },
  };
  const mod=loadMappedRenderFixture(compiled,entry,modules);
  return {
    reads, writes, verifications,
    render() {
      index=0;
      const tree=mod.exports.default({storeId});
      for (const [at, effect] of effects) { effectCleanups.get(at)?.(); effectCleanups.set(at, effect()); }
      effects.clear();
      return tree;
    },
    focus(){cleanup?.();cleanup=focus();},
    blur(){cleanup?.();},
    resume(state) { appState?.(state); },
    dispose() { cleanup?.(); for (const effectCleanup of effectCleanups.values()) effectCleanup?.(); },
  };
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const action=view=>nodes(view).find(n=>n.type==="Pressable"&&n.props.accessibilityState);
const state=favorite=>({value:{actorId:"customer-a",storeId:"store-a",favorite},expiresAt:Date.now()+60000});

test("favorite detail uses confirmed owner state and never assumes an uncertain mutation succeeded",async()=>{
  const h=harness("store-a");
  h.render();h.focus();
  assert.equal(action(h.render()),undefined);
  h.reads[0].resolve(state(false));await settle();
  assert.equal(action(h.render()).props.accessibilityState.selected,false);
  action(h.render()).props.onPress();
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].actor,"customer-a");
  assert.equal(h.writes[0].favorite,true);
  assert.equal(action(h.render()).props.disabled,true);
  assert.equal(action(h.render()).props.accessibilityState.selected,false);
  h.writes[0].resolve(state(true));await settle();
  assert.equal(action(h.render()).props.accessibilityState.selected,true);
  action(h.render()).props.onPress();
  h.writes[1].reject(new Error("lost acknowledgement"));await settle();
  const view=h.render();
  assert.equal(action(view),undefined);
  assert.ok(nodes(view).some(n=>n.props.accessibilityRole==="alert"));
  h.blur();
});

test("account lists owner-provided stores and discards reads after leaving focus",async()=>{
  const h=harness();
  h.render();h.focus();
  h.reads[0].resolve({value:{actorId:"customer-a",storeIds:["store-a"]},expiresAt:Date.now()+60000});await settle();
  assert.deepEqual(nodes(h.render()).filter(n=>n.type==="Link").map(n=>n.props.href.params.storeId),["store-a"]);
  h.blur();
  h.render();h.focus();
  const pending=h.reads[1];
  h.blur();
  assert.equal(pending.signal.aborted,true);
  pending.resolve({value:{actorId:"customer-a",storeIds:["store-b"]},expiresAt:Date.now()+60000});await settle();
  assert.equal(nodes(h.render()).filter(n=>n.type==="Link").length,0);
});

test("revoked detail callback cannot write after focus loss or subsequent focus",async()=>{
  const h=harness("store-a");
  h.render();h.focus();
  h.reads[0].resolve(state(false));await settle();
  const stale=action(h.render()).props.onPress;
  h.blur();
  stale();
  assert.equal(h.writes.length,0,"blurred button must not dispatch a favorite write");
  h.render();h.focus();
  h.reads[1].resolve(state(true));await settle();
  stale();
  assert.equal(h.writes.length,0,"old callback must not act in new focus scope");
  action(h.render()).props.onPress();
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].favorite,false);
  h.blur();
});

test("revoked list continuation cannot read after focus loss or subsequent focus",async()=>{
  const h=harness();
  const next=()=>nodes(h.render()).find(n=>n.type==="Pressable"&&n.props.accessibilityLabel==="عرض المزيد");
  h.render();h.focus();
  h.reads[0].resolve({value:{actorId:"customer-a",storeIds:["store-a"],nextCursor:"store-a"},expiresAt:Date.now()+60000});await settle();
  const stale=next().props.onPress;
  h.blur();stale();
  assert.equal(h.reads.length,1,"blurred list must not dispatch continuation");
  h.render();h.focus();
  h.reads[1].resolve({value:{actorId:"customer-a",storeIds:["store-b"],nextCursor:"store-b"},expiresAt:Date.now()+60000});await settle();
  stale();
  assert.equal(h.reads.length,2,"old cursor must not act in new focus scope");
  next().props.onPress();
  assert.equal(h.reads.length,3);
  assert.equal(h.reads[2].after,"store-b");
  h.blur();
});

test("favorite pagination refuses an expired verified view even before expiry timer runs",async(t)=>{
  const h=harness();
  const now=Date.now();
  t.mock.method(Date,"now",()=>now);
  h.render();h.focus();
  h.reads[0].resolve({value:{actorId:"customer-a",storeIds:["store-a"],nextCursor:"store-a"},expiresAt:now+1000});await settle();
  const next=nodes(h.render()).find(n=>n.type==="Pressable"&&n.props.accessibilityLabel==="عرض المزيد");
  assert.ok(next);
  t.mock.method(Date,"now",()=>now+1001);
  next.props.onPress();
  assert.equal(h.reads.length,1,"expired view must not dispatch a continuation");
  h.blur();
});

test("superseded favorite toggle is rejected even within the same focus before rerender",async()=>{
  const h=harness("store-a"); h.render(); h.focus(); h.reads[0].resolve(state(false)); await settle();
  const old=action(h.render()).props.onPress; old(); old(); assert.equal(h.writes.length,1);
  h.writes[0].resolve(state(true)); await settle(); old(); assert.equal(h.writes.length,1,"superseded callback must not dispatch before rerender");
  const fresh=action(h.render()).props.onPress; old(); assert.equal(h.writes.length,1,"superseded callback must not dispatch after rerender");
  fresh(); assert.equal(h.writes.length,2); assert.equal(h.writes[1].favorite,false); h.blur();
});
test("superseded favorite continuation cannot reuse an old cursor within the same focus",async()=>{
  const h=harness(); const next=()=>nodes(h.render()).find(n=>n.type==="Pressable"&&n.props.accessibilityLabel==="عرض المزيد");
  const page=(id)=>({value:{actorId:"customer-a",storeIds:[id],nextCursor:id},expiresAt:Date.now()+60000});
  h.render(); h.focus(); h.reads[0].resolve(page("store-a")); await settle();
  const old=next().props.onPress; old(); old(); assert.equal(h.reads.length,2);
  h.reads[1].resolve(page("store-b")); await settle(); old(); assert.equal(h.reads.length,2,"old cursor must not dispatch before rerender");
  const fresh=next().props.onPress; old(); assert.equal(h.reads.length,2,"old cursor must not dispatch after rerender");
  fresh(); assert.equal(h.reads.length,3); assert.equal(h.reads[2].after,"store-b");
  assert.deepEqual(nodes(h.render()).filter(n=>n.type==="Link").map(n=>n.props.href.params.storeId),["store-a","store-b"]); h.blur();
});

const removeButton = (h, id) => nodes(h.render()).find(n => n.type === "Pressable" && n.props.accessibilityLabel === "إزالة " + id + " من المفضلة");
const favoritePage = (ids, nextCursor) => ({value:{actorId:"customer-a",storeIds:ids,...(nextCursor?{nextCursor}:{})},expiresAt:Date.now()+60000});
const listIds = h => nodes(h.render()).filter(n => n.type === "Link").map(n => n.props.href.params.storeId);

test("favorite list removes only the selected store after confirmed owner receipt and preserves pagination", async () => {
  const h = harness();
  h.render(); h.focus();
  h.reads[0].resolve(favoritePage(["store-a","store-b"],"store-b")); await settle();
  const remove = removeButton(h,"store-a");
  assert.ok(remove,"list requires a distinct accessible remove action");
  const old = remove.props.onPress;
  old(); old();
  assert.equal(h.writes.length,1);
  assert.deepEqual({actor:h.writes[0].actor,id:h.writes[0].id,favorite:h.writes[0].favorite},{actor:"customer-a",id:"store-a",favorite:false});
  assert.deepEqual(listIds(h),["store-a","store-b"],"do not remove optimistically");
  assert.equal(removeButton(h,"store-b").props.disabled,true);
  h.writes[0].resolve({value:{actorId:"customer-a",storeId:"store-a",favorite:false},expiresAt:Date.now()+60000}); await settle();
  assert.deepEqual(listIds(h),["store-b"]);
  old(); assert.equal(h.writes.length,1);
  const more=nodes(h.render()).find(n=>n.type==="Pressable"&&n.props.accessibilityLabel==="عرض المزيد");
  assert.ok(more); more.props.onPress();
  assert.equal(h.reads[1].after,"store-b");
  h.reads[1].resolve(favoritePage(["store-c"])); await settle();
  assert.deepEqual(listIds(h),["store-b","store-c"]); h.blur();
});

test("favorite list hides an uncertain removal and only rereads; stale callback cannot write again", async () => {
  const h = harness();
  h.render();h.focus();h.reads[0].resolve(favoritePage(["store-a"]));await settle();
  const remove = removeButton(h,"store-a");
  assert.ok(remove,"list requires a remove action");
  const old=remove.props.onPress;
  old();h.writes[0].reject(new Error("lost acknowledgement"));await settle();
  assert.deepEqual(listIds(h),[]);
  assert.ok(nodes(h.render()).some(n=>n.props.accessibilityRole==="alert"));
  old();assert.equal(h.writes.length,1);
  h.render();h.focus();h.reads[1].resolve(favoritePage([]));await settle();
  assert.deepEqual(listIds(h),[]);assert.equal(h.writes.length,1);h.blur();
});

test("favorite list rejects removal after blur, expiry and a different verified view", async t => {
  const h=harness();const now=Date.now();t.mock.method(Date,"now",()=>now);
  h.render();h.focus();h.reads[0].resolve(favoritePage(["store-a"]));await settle();
  const remove=removeButton(h,"store-a");assert.ok(remove,"list requires a remove action");
  const old=remove.props.onPress;
  t.mock.method(Date,"now",()=>now+60001);old();assert.equal(h.writes.length,0);
  h.blur();old();assert.equal(h.writes.length,0);
  h.render();h.focus();h.reads[1].resolve(favoritePage(["store-b"]));await settle();
  old();assert.equal(h.writes.length,0);h.blur();
});
test("expired favorite proof cannot render private list or selected state even before timer callback", async t => {
  const clock = Date.now();
  let now = clock;
  t.mock.method(Date, "now", () => now);
  const detail = harness("store-a"), list = harness();
  detail.render(); detail.focus(); list.render(); list.focus();
  detail.reads[0].resolve({ ...state(true), expiresAt: clock + 1000 });
  list.reads[0].resolve({ ...favoritePage(["store-a"]), expiresAt: clock + 1000 });
  await settle();
  assert.equal(action(detail.render()).props.accessibilityState.selected, true);
  assert.deepEqual(listIds(list), ["store-a"]);
  now = clock + 1001;
  assert.equal(action(detail.render()), undefined);
  assert.deepEqual(listIds(list), []);
  detail.blur(); list.blur();
});

test("late initial and continuation results cannot publish an expired favorite proof", async t => {
  const clock = Date.now();
  let now = clock;
  t.mock.method(Date, "now", () => now);
  const detail = harness("store-a");
  detail.render(); detail.focus();
  now = clock + 1001;
  detail.reads[0].resolve({ ...state(true), expiresAt: clock + 1000 });
  await settle();
  assert.equal(action(detail.render()), undefined);
  assert.ok(nodes(detail.render()).some(n => n.props.accessibilityRole === "alert"));
  detail.blur();
  const list = harness();
  list.render(); list.focus();
  list.reads[0].resolve({ ...favoritePage(["store-a"], "store-a"), expiresAt: now + 1000 });
  await settle();
  const more = nodes(list.render()).find(n => n.props.accessibilityLabel === "عرض المزيد");
  more.props.onPress();
  assert.equal(list.reads.length, 2);
  now += 1001;
  list.reads[1].resolve(favoritePage(["store-b"]));
  await settle();
  assert.deepEqual(listIds(list), []);
  assert.ok(nodes(list.render()).some(n => n.props.accessibilityRole === "alert"));
  list.blur();
});

test("late confirmed favorite mutation does not extend the original expired view", async t => {
  const clock = Date.now();
  let now = clock;
  t.mock.method(Date, "now", () => now);
  const detail = harness("store-a");
  detail.render(); detail.focus();
  detail.reads[0].resolve({ ...state(false), expiresAt: clock + 1000 });
  await settle();
  action(detail.render()).props.onPress();
  assert.equal(detail.writes.length, 1);
  now = clock + 1001;
  detail.writes[0].resolve(state(true));
  await settle();
  assert.equal(action(detail.render()), undefined);
  assert.ok(nodes(detail.render()).some(n => n.props.accessibilityRole === "alert"));
  detail.blur();
});

test("native lifecycle expires owner proof, rejects stale timer results, and hides on background", async t => {
  const clock = Date.now();
  let now = clock;
  t.mock.method(Date, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness("store-a", { lifecycle: true, deferredVerification: true });
  try {
    h.render(); h.focus();
    h.reads[0].resolve({ ...state(false), expiresAt: clock + 60000 });
    await settle();
    h.render();
    t.mock.timers.tick(15000);
    assert.equal(h.verifications.length, 1);
    assert.equal(h.verifications[0].actor, "customer-a");
    action(h.render()).props.onPress();
    h.writes[0].resolve(state(true)); await settle(); h.render();
    h.verifications[0].reject(new Error("older session read")); await settle();
    assert.equal(action(h.render()).props.accessibilityState.selected, true);
    now = clock + 60001;
    t.mock.timers.tick(15000);
    assert.equal(action(h.render()), undefined);
    h.focus();
    h.reads[1].resolve(state(false)); await settle(); h.render();
    h.resume("background");
    assert.equal(action(h.render()), undefined);
    h.resume("active");
    h.focus();
    h.reads[2].resolve(state(true)); await settle(); h.render();
    t.mock.timers.tick(15000);
    h.verifications.at(-1).reject(new Error("current session revoked")); await settle();
    assert.equal(action(h.render()), undefined);
    assert.ok(nodes(h.render()).some(n => n.props.accessibilityRole === "alert"));
  } finally { h.dispose(); }
});

test("web lifecycle hides private favorites on blur and visibility loss and removes listeners", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const windowMock = new EventTarget();
  const documentMock = new EventTarget();
  documentMock.visibilityState = "visible";
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowMock });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentMock });
  const h = harness("store-a", { lifecycle: true, platform: "web" });
  try {
    h.render(); h.focus(); h.reads[0].resolve(state(true)); await settle(); h.render();
    windowMock.dispatchEvent(new Event("blur"));
    assert.equal(action(h.render()), undefined);
    windowMock.dispatchEvent(new Event("focus"));
    h.focus(); h.reads[1].resolve(state(false)); await settle(); h.render();
    documentMock.visibilityState = "hidden";
    documentMock.dispatchEvent(new Event("visibilitychange"));
    assert.equal(action(h.render()), undefined);
    documentMock.visibilityState = "visible";
    documentMock.dispatchEvent(new Event("visibilitychange"));
    h.focus(); h.reads[2].resolve(state(true)); await settle(); h.render();
    t.mock.timers.tick(60001);
    assert.equal(action(h.render()), undefined);
  } finally {
    h.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  }
});
