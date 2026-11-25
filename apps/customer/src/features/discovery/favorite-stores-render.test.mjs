import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../../../../../",import.meta.url));
const entry=fileURLToPath(new URL("./favorite-stores.tsx",import.meta.url));
const temp=mkdtempSync(path.join(tmpdir(),"bthwani-favorite-render-"));
let compiled;
try {
  const result=spawnSync(process.execPath,[path.join(root,"node_modules/typescript/bin/tsc"),entry,
    "--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs","--jsx","react-jsx","--outDir",temp],
    {cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  compiled=readFileSync(path.join(temp,"favorite-stores.js"),"utf8");
} finally {rmSync(temp,{recursive:true,force:true});}

function nodes(tree){
  if(Array.isArray(tree))return tree.flatMap(nodes);
  return tree&&typeof tree==="object"?[tree,...nodes(tree.props?.children)]:[];
}
function harness(storeId){
  const hooks=[], reads=[], writes=[];
  let index=0, focus, cleanup;
  const jsx=(type,props)=>({type,props:props??{}});
  const request=(calls,details)=>new Promise((resolve,reject)=>calls.push({...details,resolve,reject}));
  const modules={
    "@bthwani/dsh":{DshPublicError:Error,getPublicStore:async(_origin,id)=>({id,name:id})},
    "@bthwani/tamagui-config/appearance":{useMobileAppearance:()=>({theme:{}})},
    "expo-router":{Link:"Link",useFocusEffect(callback){focus=callback;}},
    react:{
      useState(initial){const at=index++;if(!(at in hooks))hooks[at]=initial;return [hooks[at],next=>{hooks[at]=typeof next==="function"?next(hooks[at]):next;}];},
      useRef(initial){const at=index++;hooks[at]??={current:initial};return hooks[at];},
      useCallback(callback){index++;return callback;},
      // Focus/read/write behavior only; device and timer lifecycle is not simulated.
      useEffect(){index++;},
    },
    "react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"Fragment"},
    "react-native":{Platform:{OS:"android"},Pressable:"Pressable",Text:"Text",View:"View",AppState:{}},
    "../stores/public-store-origin":{resolvePublicStoreOrigin:()=>""},
    "./favorite-stores-transport":{
      readFavoriteStore:(signal,id)=>request(reads,{signal,id}),
      readFavoriteStores:(signal,actor,after)=>request(reads,{signal,actor,after}),
      writeFavoriteStore:(signal,actor,id,favorite)=>request(writes,{signal,actor,id,favorite}),
      verifyFavoriteSession:async()=>({sessionExpiresAt:"2030-01-01T00:00:00Z"}),
    },
  };
  const mod={exports:{}};
  new Function("require","module","exports",compiled)(name=>{assert.ok(Object.hasOwn(modules,name),name);return modules[name];},mod,mod.exports);
  return {reads,writes,render(){index=0;return mod.exports.default({storeId});},focus(){cleanup?.();cleanup=focus();},blur(){cleanup?.();}};
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
