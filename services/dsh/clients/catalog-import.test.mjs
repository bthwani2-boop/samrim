import assert from "node:assert/strict";
import {test} from "node:test";
import {merchantCatalogImport,parseMerchantCatalogImportResult,validMerchantCatalogImportChange} from "./catalog-import.ts";

const actor="merchant-a",store="store-a",run="run-0001",sourceSha256="a".repeat(64);
const change={sourceSha256,rows:[{row:2,name:"Milk",priceYer:"9223372036854775807",stockUnits:"0",offerId:"of-draft",expectedVersion:4},{row:3,name:"Other",priceYer:"",stockUnits:"0"}]};
const initial={actorId:actor,storeId:store,runId:run,sourceSha256,total:2,processed:0,offset:0,outcomes:[]};
const complete={...initial,processed:2,outcomes:[{row:2,status:"ACCEPTED",reason:"UPDATED",offerId:"of-draft",resultVersion:5},{row:3,status:"HELD",reason:"INVALID_VALUES"}]};
test("manifest and result validation reject ambiguous or foreign owner facts",()=>{
  assert.ok(validMerchantCatalogImportChange(change));
  assert.ok(validMerchantCatalogImportChange({...change,rows:[change.rows[0],{...change.rows[1],sourceIssue:"INVALID_ROW"}]}));
  assert.equal(validMerchantCatalogImportChange({...change,rows:[{...change.rows[0],sourceIssue:"INVALID_ROW"}]}),false);
  assert.equal(validMerchantCatalogImportChange({...change,rows:[change.rows[0],{...change.rows[1],sourceIssue:"UNKNOWN"}]}),false);
  for(const bad of [{...change,rows:[{...change.rows[0],row:3}]},{...change,rows:[{...change.rows[0],expectedVersion:0}]},{...change,rows:[{...change.rows[0],priceYer:1}]},{...change,rows:[{...change.rows[0],unexpected:true}]}])assert.equal(validMerchantCatalogImportChange(bad),false);
  assert.deepEqual(parseMerchantCatalogImportResult(complete,actor,store,run),complete);
  for(const bad of [{...complete,actorId:"merchant-b"},{...complete,storeId:"store-b"},{...complete,runId:"run-0002"},{...complete,offset:1},{...complete,outcomes:complete.outcomes.slice(0,1)},{...complete,outcomes:[{...complete.outcomes[0],resultVersion:1},complete.outcomes[1]]},{...complete,outcomes:[complete.outcomes[0],{...complete.outcomes[1],offerId:"of-foreign"}]}])assert.throws(()=>parseMerchantCatalogImportResult(bad,actor,store,run),{code:"OWNER_RESPONSE_INVALID"});
});
test("client binds generated operation and exact manifest, keeps same run on read/advance",async()=>{
  const original=globalThis.fetch,calls=[];
  try{
    globalThis.fetch=async(url,init)=>{calls.push({url:new URL(url),init});const v=init.method==="PUT"?initial:complete;return Response.json(v,{headers:{"Cache-Control":"no-store"}});};
    const signal=new AbortController().signal;
    await merchantCatalogImport("http://127.0.0.1:3202",actor,store,run,"synthetic","PUT",signal,change);
    await merchantCatalogImport("http://127.0.0.1:3202",actor,store,run,"synthetic","PATCH",signal);
    await merchantCatalogImport("http://127.0.0.1:3202",actor,store,run,"synthetic","GET",signal);
    assert.deepEqual(calls.map(c=>c.init.method),["PUT","PATCH","GET"]);
    assert.ok(calls.every(c=>c.url.pathname==="/v1/stores/store-a/catalog-imports/run-0001"&&c.init.headers.Authorization==="Bearer synthetic"));
    assert.deepEqual(JSON.parse(calls[0].init.body),change);
    assert.equal(calls[1].init.body,undefined);
    assert.equal(calls[2].init.body,undefined);
    await assert.rejects(merchantCatalogImport("http://127.0.0.1:3202",actor,store,run,"synthetic","GET",AbortSignal.abort()),{code:"OWNER_RESPONSE_STALE"});
    assert.equal(calls.length,3);
  }finally{globalThis.fetch=original;}
});
