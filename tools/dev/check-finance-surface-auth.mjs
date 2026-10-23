#!/usr/bin/env node
// Live local finance-route denial check: no mutation credentials are supplied.
import assert from "node:assert/strict";
const panel=process.env.BTHWANI_CONTROL_PANEL_URL??"http://127.0.0.1:13000";
const mock=process.env.PAYMENT_MOCK_URL??"http://127.0.0.1:18090";
for(const url of [panel,mock]){
 const target=new URL(url);
 if(target.protocol!=="http:"||!["127.0.0.1","localhost"].includes(target.hostname)||target.username||target.password||target.search||target.hash||target.pathname!=="/")
   throw new Error("Finance proof targets must be local loopback");
}
const paths=[
 "/api/finance/payout-requests/test/prepare",
 "/api/finance/payout-requests/test/approve",
 "/api/finance/settlement-batches/test/approve",
 "/api/finance/settlement-batches/test/freeze",
 "/api/finance/settlement-batches/test/transfers",
 "/api/finance/transfers/test/verify",
 "/api/finance/transfers/test/reconcile",
];
for(const path of paths){
 const response=await fetch(panel+path,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",redirect:"manual",signal:AbortSignal.timeout(12000)});
 assert.ok(response.status===401||response.status===403,"Unauthenticated finance action was accessible: "+path+" returned "+response.status);
 console.log("PASS unauthenticated finance mutation denied",path);
}
for(const path of ["/v1/providers/wallet_provider_test_alpha/payouts","/v1/providers/wallet_provider_test_alpha/cash-out"]){
 const response=await fetch(mock+path,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(5000)});
 assert.equal(response.status,404,"Mock exposes forbidden payout endpoint "+path);
 console.log("PASS mock Cash-Out absent",path);
}
console.log("FINANCE_LOCAL_UNAUTHENTICATED_BOUNDARIES=PASS");
