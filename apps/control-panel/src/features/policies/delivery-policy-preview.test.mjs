import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

// Retain uncached modules until Node collects coverage.
const privateReply = (body, init = {}) => Response.json(body, {
  ...init, headers: { "Cache-Control": "no-store", ...init.headers },
});

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
    "./policy-owner-web.ts":require("./policy-owner-web.ts"),
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
  pending(privateReply({cityId:"sanaa",version:3,radiusMetres:18000,distanceMetres:2001,feeYer:"601",payable:false}));await settle();
  assert.ok(result().props.description.includes("لا تحفظ"));
  number("سعر الشريحة 1").props.onChange(400);
  assert.equal(result(),undefined);
  button().props.onClick();pending(privateReply({code:"FORBIDDEN"}, {status:403}));await settle();
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
  if(init.method==="POST")return privateReply({cityId:"sanaa",version:3,radiusMetres:18000,distanceMetres:2001,feeYer:"601",payable:false});
  if(init.method==="PATCH"){phase++;return phase===1?privateReply({}, {status:503}):phase===2?privateReply({code:"VERSION_CONFLICT"}, {status:409}):privateReply({policy:current,replay:true});}
  return privateReply(current);
 });
 const button=label=>h.render().find(n=>n.type==="Button"&&n.props.children===label);
 h.render().find(n=>n.props?.["aria-label"]==="مسافة المعاينة").props.onChange(2001);
 button("معاينة الحساب من DSH").props.onClick();await settle();
 assert.equal(button("حفظ سياسة التوصيل لدى DSH").props.disabled,true);
 h.render().find(n=>n.props?.["aria-label"]==="سبب تغيير سياسة التوصيل").props.onChange({target:{value:"Reviewed tariff"}});
 button("حفظ سياسة التوصيل لدى DSH").props.onClick();await settle();
 assert.equal(h.locked,true);assert.equal(h.committed,null);
 button("إعادة نفس العملية والتحقق").props.onClick();await settle();
 assert.equal(h.locked,true);assert.equal(h.committed,null);
 assert.ok(button("إعادة نفس العملية والتحقق"));
 button("إعادة نفس العملية والتحقق").props.onClick();await settle();
 assert.equal(h.locked,false);assert.deepEqual(h.committed,current);
 assert.deepEqual(calls.map(c=>c.method),["POST","PATCH","PATCH","PATCH","GET"]);
 assert.equal(calls[1].body,calls[3].body);
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
  if(init.method==="POST")return privateReply({cityId:"sanaa",version:0,radiusMetres:10000,distanceMetres:1000,feeYer:"100",payable:false});
  if(init.method==="PATCH")return ++writes===1?privateReply({}, {status:503}):privateReply({policy:current,replay:true});
  return privateReply(current);
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

test("delivery preview rejects malformed and conflicting replies, owns band edits and abandons late work",async t=>{
  const h=harness();
  let reply=()=>privateReply({cityId:"aden",version:3,radiusMetres:18000,distanceMetres:2001,feeYer:"601",payable:false});
  const calls=t.mock.method(globalThis,"fetch",async()=>reply());
  const button=label=>h.render().find(n=>n.type==="Button"&&n.props.children===label);
  const number=label=>h.render().find(n=>n.props?.["aria-label"]===label);
  const alert=()=>h.render().find(n=>n.props?.role==="alert");
  try{
    button("معاينة الحساب من DSH").props.onClick();await settle();
    assert.equal(calls.mock.callCount(),0);
    button("إضافة شريحة").props.onClick();
    number("نهاية الشريحة 2").props.onChange(3000);
    number("سعر الشريحة 2").props.onChange(250);
    button("حذف الشريحة").props.onClick();
    assert.equal(number("نهاية الشريحة 2"),undefined);
    number("نهاية الشريحة 1").props.onChange(2000);
    number("مسافة المعاينة").props.onChange(2001);
    button("معاينة الحساب من DSH").props.onClick();await settle();
    assert.ok(alert());
    reply=()=>privateReply({code:"INVALID_REQUEST"},{status:400});
    button("معاينة الحساب من DSH").props.onClick();await settle();
    assert.ok(alert());
    reply=()=>privateReply({code:"VERSION_CONFLICT"},{status:409});
    button("معاينة الحساب من DSH").props.onClick();await settle();
    assert.equal(button("معاينة الحساب من DSH").props.disabled,true);
    assert.match(alert().props.message,/تغير إصدار/);
  }finally{h.cleanup();}
});

test("delivery first-save refusals are definitive only after valid preview; uncertain readback remains recoverable",async t=>{
  let resultStatus=400;
  let readStatus=200;
  const bands=[{upToMeters:2000,ratePerKmMinor:300},{upToMeters:null,ratePerKmMinor:200}];
  const current={cityId:"sanaa",version:4,radiusMetres:18000,distanceBands:bands,updatedAt:"2026-11-24T05:01:00Z"};
  const calls=t.mock.method(globalThis,"fetch",async(_url,init)=>{
    if(init.method==="POST")return privateReply({cityId:"sanaa",version:3,radiusMetres:18000,distanceMetres:2001,feeYer:"601",payable:false});
    if(init.method==="PATCH")return resultStatus===200?privateReply({policy:current,replay:true}):
      privateReply({code:({400:"INVALID_REQUEST",403:"FORBIDDEN",409:"VERSION_CONFLICT"})[resultStatus]},{status:resultStatus});
    return readStatus===200?privateReply(current):privateReply({code:"FORBIDDEN"},{status:403});
  });
  function button(h,label){return h.render().find(n=>n.type==="Button"&&n.props.children===label);}
  async function prepare(h){
    h.render().find(n=>n.props?.["aria-label"]==="مسافة المعاينة").props.onChange(2001);
    button(h,"معاينة الحساب من DSH").props.onClick();await settle();
    h.render().find(n=>n.props?.["aria-label"]==="سبب تغيير سياسة التوصيل").props.onChange({target:{value:"Reviewed tariff"}});
  }
  for(const status of [400,403,409]){
    resultStatus=status;
    const storage=new Map();const h=harness("operator-a",undefined,storage);
    try{
      await prepare(h);button(h,"حفظ سياسة التوصيل لدى DSH").props.onClick();await settle();
      assert.equal(storage.size,0);assert.equal(h.locked,false);assert.equal(h.committed,null);
      assert.equal(h.denied,status===403?1:0);
      if(status===409)assert.equal(button(h,"معاينة الحساب من DSH").props.disabled,true);
    }finally{h.cleanup();}
  }
  resultStatus=200;readStatus=403;
  const storage=new Map(),h=harness("operator-a",undefined,storage);
  try{
    await prepare(h);button(h,"حفظ سياسة التوصيل لدى DSH").props.onClick();await settle();
    assert.equal(storage.size,1);assert.equal(h.committed,null);assert.equal(h.denied,1);
    readStatus=200;resultStatus=403;
    button(h,"إعادة نفس العملية والتحقق").props.onClick();await settle();
    assert.equal(storage.size,1);assert.equal(h.denied,2);
    resultStatus=200;
    button(h,"إعادة نفس العملية والتحقق").props.onClick();await settle();
    assert.equal(storage.size,0);assert.deepEqual(h.committed,current);
  }finally{h.cleanup();}
  const broken=new Map([["bthwani:delivery-policy:pending:operator-a:sanaa","{bad"]]);
  const blocked=harness("operator-a",undefined,broken);
  try{
    assert.equal(button(blocked,"معاينة الحساب من DSH").props.disabled,true);
    const before=calls.mock.callCount();
    button(blocked,"معاينة الحساب من DSH").props.onClick();await settle();
    assert.equal(calls.mock.callCount(),before);
  }finally{blocked.cleanup();}
});

test("delivery cannot dispatch a write if durable browser attempt storage fails",async t=>{
  const storage=new Map();storage.set=()=>{throw Error("quota");};
  const h=harness("operator-a",undefined,storage);
  const calls=t.mock.method(globalThis,"fetch",async()=>privateReply({cityId:"sanaa",version:3,radiusMetres:18000,distanceMetres:2001,feeYer:"601",payable:false}));
  try{
    const button=label=>h.render().find(n=>n.type==="Button"&&n.props.children===label);
    button("حفظ سياسة التوصيل لدى DSH").props.onClick();await settle();
    h.render().find(n=>n.props?.["aria-label"]==="مسافة المعاينة").props.onChange(2001);
    button("معاينة الحساب من DSH").props.onClick();await settle();
    h.render().find(n=>n.props?.["aria-label"]==="سبب تغيير سياسة التوصيل").props.onChange({target:{value:"Reviewed tariff"}});
    button("حفظ سياسة التوصيل لدى DSH").props.onClick();await settle();
    assert.equal(calls.mock.callCount(),1);
    assert.equal(storage.size,0);assert.equal(h.committed,null);
    assert.ok(h.render().find(n=>n.props?.role==="alert"));
  }finally{h.cleanup();}
});
