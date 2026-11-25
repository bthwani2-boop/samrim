import assert from "node:assert/strict";
import { test } from "node:test";
import { listCompanyEmployees, listMerchantEmployees, parseEmployeePage } from "./employees.ts";

const id="00000000-0000-4000-8000-000000000001";
const record={id,displayName:"Synthetic",department:"Ops",jobTitle:"Staff",startDate:"2026-01-01",endDate:null};
const ended={...record,endDate:"2027-01-01"};
const owner="http://127.0.0.1:3202";
const token=Buffer.alloc(32,7).toString("base64url");
const envelope=item=>({items:[item],nextCursor:null});
test("two employee routes preserve a recorded end-date selector and current cursor",async t=>{
 const calls=[];
 t.mock.method(globalThis,"fetch",async(url,opts)=>{
  const target=new URL(url);calls.push(target.pathname+target.search);
  assert.equal(opts.method,"GET");assert.equal(opts.headers.Authorization,"Bearer "+token);
  return Response.json(envelope(target.searchParams.get("endState")==="HAS_END_DATE"?ended:record),{headers:{"Cache-Control":"no-store"}});
 });
 assert.deepEqual(await listCompanyEmployees(owner,token,undefined,undefined,"NO_END_DATE"),envelope(record));
 assert.deepEqual(await listMerchantEmployees(owner,token,"store-a",undefined,undefined,"HAS_END_DATE"),envelope(ended));
 assert.deepEqual(await listCompanyEmployees(owner,token,"00000000-0000-4000-8000-000000000000",undefined,"NO_END_DATE"),envelope(record));
 assert.deepEqual(calls,["/v1/operators/employees?endState=NO_END_DATE","/v1/stores/store-a/employees?endState=HAS_END_DATE","/v1/operators/employees?cursor=00000000-0000-4000-8000-000000000000&endState=NO_END_DATE"]);
 for(const invalid of ["","ACTIVE","NO_END_DATE&employerId=other",null]){
  await assert.rejects(()=>listCompanyEmployees(owner,token,undefined,undefined,invalid),error=>error.status===400);
 }
 assert.equal(calls.length,3);
});
test("a valid but mismatched owner page fails closed; future end date is recorded, not employment status",()=>{
 assert.throws(()=>parseEmployeePage(envelope(ended),undefined,"NO_END_DATE"),error=>error.status===502);
 assert.throws(()=>parseEmployeePage(envelope(record),undefined,"HAS_END_DATE"),error=>error.status===502);
 assert.deepEqual(parseEmployeePage(envelope(ended),undefined,"HAS_END_DATE"),envelope(ended));
 assert.deepEqual(parseEmployeePage(envelope(record)),envelope(record));
});