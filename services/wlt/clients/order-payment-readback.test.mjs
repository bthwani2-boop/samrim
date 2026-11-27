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

test("WLT actor wire admission follows owner Unicode scalar and whitespace semantics across all readbacks", async () => {
  const { parseCustomerWalletBalance } = await import("./wallet-balance.ts");
  const { parseCustomerFundingHistory } = await import("./funding-history.ts");
  const check = id => [
    () => parseCustomerWalletBalance({actorId:id,currency:"YER",balanceYer:"100",availableYer:"90"}),
    () => parseCustomerFundingHistory({actorId:id,currency:"YER",items:[],hasMore:false,nextCursor:null}),
    () => parseCustomerOrderPaymentReadback({...result,actorId:id},id,checkoutId),
  ];
  for (const id of ["actor", "مستخدم", "a".repeat(128), "\u{1F600}".repeat(128), "\uFEFFactor", "actor\uFEFF", "a b"]) {
    for (const parse of check(id)) assert.equal(parse().actorId,id);
  }
  for (const id of ["",null,42,"a".repeat(129),"\u{1F600}".repeat(129)," actor","actor\u00a0","\u0085actor",
    "actor\u2003","a\u007fb","a\u009fb","a\u0000b","a\ud800b","a\udfffb"]) {
    for (const parse of check(id)) assert.throws(parse,{status:502});
  }
});

test("WLT shared validation rejects malformed wire primitives without coercion and retains exact amounts", async () => {
  const { actorValid, amountValid, fundingIdValid, isolatedNativeWltOrigin } = await import("./validation.ts");
  for (const x of [undefined, {}, ["actor"], new String("actor")]) assert.equal(actorValid(x),false);
  for (const x of [undefined, 12, "", "01", "-1", "1.0", "1e1", "9".repeat(39)]) {
    assert.equal(amountValid(x,false),false);
    assert.equal(amountValid(x,true),false);
  }
  assert.equal(amountValid("0",false),true);
  assert.equal(amountValid("0",true),false);
  assert.equal(amountValid("9".repeat(38),true),true);
  for (const x of [undefined, 12345678, "short", "a".repeat(129), "invalid/id"]) assert.equal(fundingIdValid(x),false);
  assert.equal(fundingIdValid("id._-123"),true);
  const identity = "http://10.0.2.2:1";
  const wallet = "http://10.0.2.2:65535";
  assert.equal(isolatedNativeWltOrigin("android",false,identity,wallet),wallet);
  for (const candidate of [undefined, null, [wallet], new String(wallet), "http://10.0.2.2:65536",
    "http://10.0.2.2:01", identity, "http://127.0.0.1:2"]) {
    assert.equal(isolatedNativeWltOrigin("android",false,identity,candidate),null);
  }
  assert.equal(isolatedNativeWltOrigin("android",false,[identity],wallet),null);
  assert.equal(isolatedNativeWltOrigin("ios",false,identity,wallet),null);
  assert.equal(isolatedNativeWltOrigin("android",true,identity,wallet),null);
});

test("all financial read projections reject substituted required fields", async () => {
  const { parseCustomerWalletBalance } = await import("./wallet-balance.ts");
  const { parseCustomerFundingHistory } = await import("./funding-history.ts");
  const balance = { actorId, currency: "YER", balanceYer: "100", availableYer: "90" };
  const entry = { fundingId: "funding-001", amountYer: "100", postedAt: "2026-11-27T00:00:00Z" };
  const history = { actorId, currency: "YER", items: [entry], hasMore: false, nextCursor: null };
  const substitute = (original, key) => {
    const { [key]: inherited, ...own } = original;
    return Object.assign(Object.create({ [key]: inherited }), own, { unrelated: true });
  };
  for (const [label, original, parser] of [
    ["balance", balance, parseCustomerWalletBalance],
    ["history", history, parseCustomerFundingHistory],
    ["readback", result, parse],
    ["funding entry", entry, value => parseCustomerFundingHistory({ ...history, items: [value] })],
    ["allocation", allocation, value => parse({ ...result, allocation: value })],
  ]) {
    for (const key of Object.keys(original)) {
      assert.throws(() => parser(substitute(original, key)), { status: 502 }, label + ":" + key);
    }
  }
  assert.deepEqual(parseCustomerWalletBalance(balance), balance);
  assert.deepEqual(parseCustomerFundingHistory(history), history);
  assert.deepEqual(parse(result), result);
});
