import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validMerchantStoreProfileChange } from "@bthwani/dsh";

test("Store profile displays owner readback, retries the exact command and denies published edits",async()=>{
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const src=fileURLToPath(new URL("../src/features/stores/store-profile.tsx",import.meta.url));
  const temp=mkdtempSync(path.join(tmpdir(),"merchant-profile-"));
  try {
    const compiled=spawnSync(process.execPath,[path.join(root,"node_modules/typescript/bin/tsc"),src,"--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs","--jsx","react-jsx","--outDir",temp],{cwd:root,encoding:"utf8",timeout:20000});
    assert.equal(compiled.status,0,compiled.stderr||compiled.stdout);
    let index=0,scheduled=[],hooks=[],effects=[],commands=[],updated=0,fail=true;
    let profile={storeId:"store-a",actorId:"merchant-a",name:"متجر",description:"وصف",version:1,published:false};
    const react={
      useState(initial){const n=index++;if(!(n in hooks))hooks[n]=initial;return [hooks[n],next=>{hooks[n]=typeof next==="function"?next(hooks[n]):next;}]},
      useRef(initial){const n=index++;if(!(n in hooks))hooks[n]={current:initial};return hooks[n]},
      useEffect(fn,deps){const n=index++;const old=effects[n];if(!old||deps.some((v,i)=>v!==old.deps[i]))scheduled.push(()=>{old?.cleanup?.();effects[n]={deps,cleanup:fn()}})}
    };
    const jsx=(type,props)=>({type,props});
    const mocks={
      react,"react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"Fragment"},
      "react-native":Object.fromEntries(["ActivityIndicator","Pressable","Text","TextInput","View"].map(x=>[x,x])),
      "@bthwani/dsh":{validMerchantStoreProfileChange},
      "@bthwani/tamagui-config/appearance":{useMobileAppearance:()=>({theme:{}})},
      "expo-crypto":{randomUUID:()=>"operation-profile-test"},
      "./store-profile-transport":{
        readStoreProfile:async()=>({...profile}),
        saveStoreProfile:async(_store,_actor,cmd)=>{
          commands.push({...cmd});
          if(fail){fail=false;throw new Error("unknown response")}
          profile={...profile,name:cmd.name,description:cmd.description,version:cmd.expectedVersion+1};
        }
      }
    };
    const mod={exports:{}};
    new Function("require","module","exports",readFileSync(path.join(temp,"store-profile.js"),"utf8"))(name=>{assert.ok(Object.hasOwn(mocks,name),name);return mocks[name]},mod,mod.exports);
    const nodes=tree=>!tree||typeof tree!=="object"?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
    const render=(actor="merchant-a",store="store-a")=>{index=0;scheduled=[];const tree=nodes(mod.exports.default({actorId:actor,storeId:store,onUpdated:()=>updated++}));scheduled.forEach(fn=>{fn()});return tree};
    const flush=async()=>{await new Promise(resolve=>setImmediate(resolve))};
    render();await flush();
    const input=()=>render().find(n=>n.type==="TextInput"&&n.props.accessibilityLabel==="اسم المتجر");
    assert.equal(input().props.value,"متجر");
    input().props.onChangeText("متجر جديد");
    const button=label=>render().find(n=>n.type==="Pressable"&&n.props.children?.props?.children===label);
    button("حفظ بيانات المتجر").props.onPress();await flush();
    assert.equal(input(),undefined);
    assert.equal(updated,0);
    button("التحقق من الحفظ السابق").props.onPress();await flush();
    assert.deepEqual(commands[0],commands[1]);
    assert.equal(input().props.value,"متجر جديد");assert.equal(updated,1);
    profile={...profile,published:true};
    button("تحديث بيانات المتجر").props.onPress();render();await flush();
    assert.equal(input().props.editable,false);
    assert.equal(button("حفظ بيانات المتجر"),undefined);
    assert.ok(!render("merchant-b","store-b").some(n=>n.type==="TextInput"));
    for(const e of effects)e?.cleanup?.();
    hooks=[];effects=[];
  }finally{rmSync(temp,{recursive:true,force:true})}
});