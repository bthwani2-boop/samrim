import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const { transformSync } = require("next/dist/build/swc/index.js");
const compiled = transformSync(readFileSync(new URL("./delivery-policy-preview.tsx",import.meta.url),"utf8"),{
  jsc:{parser:{syntax:"typescript",tsx:true},target:"es2022",transform:{react:{runtime:"automatic"}}},module:{type:"commonjs"},
}).code;
function harness() {
  const states=[]; let index=0, cleanup, denied=0;
  const jsx=(type,props)=>({type,props});
  const mocks={
    "@bthwani/dsh":require("@bthwani/dsh"),
    react:{
      useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==="function"?initial():initial;return [states[i],v=>{states[i]=typeof v==="function"?v(states[i]):v;}]},
      useRef(initial){const i=index++;if(!(i in states))states[i]={current:initial};return states[i]},
      useEffect(callback){const i=index++;if(!(i in states)){states[i]=true;cleanup=callback()}},
    },
    "react/jsx-runtime":{jsx,jsxs:jsx},
    antd:{Alert:"Alert",Button:"Button",InputNumber:"InputNumber",Space:"Space",Typography:{Title:"Title",Paragraph:"Paragraph",Text:"Text"}},
  };
  const module={exports:{}};
  new Function("require","module","exports",compiled)(name=>{assert.ok(Object.hasOwn(mocks,name),name);return mocks[name]},module,module.exports);
  function flatten(tree){return !tree||typeof tree!=="object"?[]:Array.isArray(tree)?tree.flatMap(flatten):[tree,...flatten(tree.props?.children)]}
  const policy={cityId:"sanaa",version:3,radiusMetres:18000,updatedAt:"2026-11-24T05:00:00Z",distanceBands:[{upToMeters:2000,ratePerKmMinor:300},{upToMeters:null,ratePerKmMinor:200}]};
  const render=()=>{index=0;return flatten(module.exports.default({policy,actorId:"operator-a",disabled:false,onDenied:()=>denied++}))};
  return {render,cleanup:()=>cleanup?.(),get denied(){return denied}};
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
