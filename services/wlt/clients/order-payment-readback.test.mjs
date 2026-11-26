import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { parseCustomerOrderPaymentReadback, readCurrentCustomerOrderPaymentAllocation } from "./order-payment-readback.ts";

const checkoutId = "checkout-0001";
const actorId = "wallet-one";
const allocation = {
  storeId:"store-a", method:"MIXED", totalYer:"9007199254740993", walletYer:"9007199254740992",
  cashYer:"1", currency:"YER",state:"ALLOCATED",
};
const result = { actorId, checkoutId, allocation };
const parse = value => parseCustomerOrderPaymentReadback(value,actorId,checkoutId);
test("exact and released allocations and explicit absence",()=>{
  assert.deepEqual(parse(result),result);
  for (const valid of [
    {...allocation,state:"RELEASED"},
    {...allocation,method:"COD",walletYer:"0",cashYer:allocation.totalYer},
    {...allocation,method:"WALLET",walletYer:allocation.totalYer,cashYer:"0"},
  ]) assert.deepEqual(parse({...result,allocation:valid}),{...result,allocation:valid});
  assert.deepEqual(parse({...result,allocation:null}),{...result,allocation:null});
});
test("rejects wrong owner, checkout and malformed financial states",()=>{
  for(const value of [
    null,[],{...result,actorId:"wallet-two"},{...result,checkoutId:"checkout-0002"},{...result,extra:true},
    {...result,allocation:null,other:true},{...result,allocation:[]},{...result,allocation:undefined},
    ...[
      {storeId:"../bad"},{method:"UNKNOWN"},{currency:"USD"},{state:"CAPTURED"},{quoteDigest:"private"},
      {totalYer:9007199254740992},{totalYer:"0"},{totalYer:"9223372036854775808"},
      {walletYer:"-1"},{cashYer:"01"},{cashYer:"2"},{method:"COD"},{method:"WALLET"},
      {method:"MIXED",walletYer:"0",cashYer:allocation.totalYer},
      {method:"MIXED",walletYer:allocation.totalYer,cashYer:"0"},
    ].map(change=>({...result,allocation:{...allocation,...change}})),
  ]) assert.throws(()=>parse(value));
});
test("SDK binds current actor and checkout; no caller-selected actor in the request",async()=>{
  const bearer=Buffer.alloc(32,9).toString("base64url");
  let reply=result;
  let status=200;
  const owner=createServer((req,res)=>{
    assert.equal(req.method,"GET");
    assert.equal(req.url,"/v1/wallets/me/order-payment-allocations/"+checkoutId);
    assert.equal(req.headers.authorization,"Bearer "+bearer);
    res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
    res.end(JSON.stringify(reply));
  });
  await new Promise((resolve,reject)=>{owner.once("error",reject);owner.listen(0,"127.0.0.1",resolve);});
  try {
    const origin="http://127.0.0.1:"+owner.address().port;
    const read=(actor=actorId,key=checkoutId)=>readCurrentCustomerOrderPaymentAllocation(origin,bearer,actor,key,AbortSignal.timeout(1000));
    assert.deepEqual(await read(),result);
    await assert.rejects(()=>read("","../bad"));
    await assert.rejects(()=>read(actorId,"../wallet"));
    reply={...result,actorId:"wallet-two"};
    await assert.rejects(()=>read());
    status=401;
    await assert.rejects(()=>read(),error=>error.status===401);
  } finally {await new Promise(resolve=>owner.close(resolve));}
});
