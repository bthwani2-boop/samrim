import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

// Retain uncached modules until Node collects coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);

const require = createRequire(import.meta.url);
const { transformSync } = require("next/dist/build/swc/index.js");
const source = fileURLToPath(new URL("./delivery-policy-preview.tsx",import.meta.url));
const compiled = transformSync(readFileSync(source,"utf8"),{
  filename: source, sourceMaps: "inline", inlineSourcesContent: true,
  jsc:{parser:{syntax:"typescript",tsx:true},target:"es2022",transform:{react:{runtime:"automatic"}}},module:{type:"commonjs"},
}).code;
function harness(actorId = "operator-a", initialPolicy, storage = new Map()) {
  const oldWindow=globalThis.window;
  globalThis.window={sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}};
  const states=[]; let index=0, cleanups=[], denied=0, locked=false, committed=null;
  const jsx=(type,props)=>({type,props});
  const mocks={
    "@bthwani/dsh":require("@bthwani/dsh"),
    react:{
      useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==="function"?initial():initial;return [states[i],v=>{states[i]=typeof v==="function"?v(states[i]):v;}]},
      useRef(initial){const i=index++;if(!(i in states))states[i]={current:initial};return states[i]},
      useEffect(callback){const i=index++;if(!(i in states)){states[i]=true;cleanups.push(callback())}},
    },
    "react/jsx-runtime":{jsx,jsxs:jsx},
    antd:{Alert:"Alert",Button:"Button",Input:"Input",InputNumber:"InputNumber",Space:"Space",Typography:{Title:"Title",Paragraph:"Paragraph",Text:"Text"}},
  };
  const module = loadMappedRenderFixture(compiled, source, mocks);
  loadedModules.push(module);
  function flatten(tree){return !tree||typeof tree!=="object"?[]:Array.isArray(tree)?tree.flatMap(flatten):[tree,...flatten(tree.props?.children)]}
  const policy=initialPolicy ?? {cityId:"sanaa",version:3,radiusMetres:18000,updatedAt:"2026-11-24T05:00:00Z",distanceBands:[{upToMeters:2000,ratePerKmMinor:300},{upToMeters:null,ratePerKmMinor:200}]};
  const render=()=>{index=0;return flatten(module.exports.default({policy,actorId,disabled:false,onDenied:()=>denied++,onLockChange:value=>{locked=value},onCommitted:value=>{committed=value}}))};
  render();
  return {render,cleanup:()=>{for(const cleanup of cleanups)cleanup?.();globalThis.window=oldWindow;},get denied(){return denied},get locked(){return locked},get committed(){return committed}};
}
const settle=()=>new Promise(r=>setImmediate(r));
test("operator edits preview proposal, receives non-payable owner result, invalidates old result and handles denial",async t=>{
  const h=harness(),calls=[];
  let pending;
  t.mock.method(globalThis,"fetch",(url,init)=>{calls.push({url,init});return new Promise(resolve=>{pending=resolve})});
  const number=label=>h.render().find(n=>n.type==="InputNumber"&&n.props["aria-label"]===label);
  const button=()=>h.render().find(n=>n.type==="Button"&&n.props.type==="primary");
  const result=()=>h.render().find(n=>n.type==="Alert"&&n.props.role==="status");
  assert.equal(button().props.disabled,true);
  number("مسافة المعاينة").props.onChange(2001);
  assert.equal(button().props.disabled,false);
  button().props.onClick();
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"/api/policies/cities/sanaa");
  assert.equal(calls[0].init.method,"POST");
  assert.equal(calls[0].init.headers["X-BThwani-Operator"],"operator-a");
  assert.deepEqual(JSON.parse(calls[0].init.body),{expectedVersion:3,radiusMetres:18000,distanceMetres:2001,
    distanceBands:[{upToMeters:2000,ratePerKmMinor:300},{upToMeters:null,ratePerKmMinor:200}]});
  pending(Response.json({cityId:"sanaa",version:3,radiusMetres:18000,distanceMetres:2001,feeYer:"601",payable:false}));await settle();
  assert.ok(result().props.description.includes("لا تحفظ"));
  number("سعر الشريحة 1").props.onChange(400);
  assert.equal(result(),undefined);
  button().props.onClick();pending(Response.json({}, {status:403}));await settle();
  assert.equal(h.denied,1);
  h.cleanup();
});

test("save keeps exact command after unknown reply and verifies independent owner version",async t=>{
 const h=harness(),calls=[];
 let phase=0;
 const bands=[{upToMeters:2000,ratePerKmMinor:300},{upToMeters:null,ratePerKmMinor:200}];
 const current={cityId:"sanaa",version:4,radiusMetres:18000,distanceBands:bands,updatedAt:"2026-11-24T05:01:00Z"};
 t.mock.method(globalThis,"fetch",async(url,init)=>{
  calls.push({url,method:init.method,body:init.body});
  if(init.method==="POST")return Response.json({cityId:"sanaa",version:3,radiusMetres:18000,distanceMetres:2001,feeYer:"601",payable:false});
  if(init.method==="PATCH"){phase++;return phase===1?Response.json({}, {status:503}):Response.json({policy:current,replay:true});}
  return Response.json(current);
 });
 const button=label=>h.render().find(n=>n.type==="Button"&&n.props.children===label);
 h.render().find(n=>n.props?.["aria-label"]==="مسافة المعاينة").props.onChange(2001);
 button("معاينة الحساب من DSH").props.onClick();await settle();
 assert.equal(button("حفظ سياسة التوصيل لدى DSH").props.disabled,true);
 h.render().find(n=>n.props?.["aria-label"]==="سبب تغيير سياسة التوصيل").props.onChange({target:{value:"Reviewed tariff"}});
 button("حفظ سياسة التوصيل لدى DSH").props.onClick();await settle();
 assert.equal(h.locked,true);assert.equal(h.committed,null);
 button("إعادة نفس العملية والتحقق").props.onClick();await settle();
 assert.equal(h.locked,false);assert.deepEqual(h.committed,current);
 assert.deepEqual(calls.map(c=>c.method),["POST","PATCH","PATCH","GET"]);
 assert.equal(calls[1].url,"/api/policies/cities/sanaa?delivery=1");
 assert.equal(calls[1].body,calls[2].body);
 assert.equal(JSON.parse(calls[1].body).reason,"Reviewed tariff");
 h.cleanup();
});

test("first provisioning and ambiguous response survive remount for the same operator and city",async t=>{
 const storage=new Map(), calls=[];
 const h=harness("operator-a",{cityId:"sanaa",version:0},storage);
 const current={cityId:"sanaa",version:1,radiusMetres:10000,updatedAt:"2026-11-24T05:01:00Z",distanceBands:[{upToMeters:null,ratePerKmMinor:100}]};
 let writes=0;
 t.mock.method(globalThis,"fetch",async(url,init)=>{
  calls.push({url,method:init.method,body:init.body});
  if(init.method==="POST")return Response.json({cityId:"sanaa",version:0,radiusMetres:10000,distanceMetres:1000,feeYer:"100",payable:false});
  if(init.method==="PATCH")return ++writes===1?Response.json({}, {status:503}):Response.json({policy:current,replay:true});
  return Response.json(current);
 });
 const num=label=>h.render().find(n=>n.props?.["aria-label"]===label);
 const button=(ui,label)=>ui.render().find(n=>n.type==="Button"&&n.props.children===label);
 assert.equal(num("النطاق المقترح").props.value,null);
 num("النطاق المقترح").props.onChange(10000);
 num("مسافة المعاينة").props.onChange(1000);
 num("سعر الشريحة 1").props.onChange(100);
 button(h,"معاينة الحساب من DSH").props.onClick(); await settle();
 num("سبب تغيير سياسة التوصيل").props.onChange({target:{value:"Synthetic initial policy"}});
 button(h,"حفظ سياسة التوصيل لدى DSH").props.onClick();await settle();
 assert.equal(storage.size,1);
 assert.equal(JSON.parse(calls[1].body).expectedVersion,0);
 h.cleanup();
 const other=harness("operator-b",current,storage);
 assert.equal(button(other,"إعادة نفس العملية والتحقق"),undefined);
 other.cleanup();
 const restored=harness("operator-a",current,storage);
 assert.equal(restored.locked,true);
 assert.equal(calls.length,2);
 button(restored,"إعادة نفس العملية والتحقق").props.onClick();await settle();
 assert.equal(calls[1].body,calls[2].body);
 assert.deepEqual(restored.committed,current);
 assert.equal(storage.size,0);
 restored.cleanup();
});
