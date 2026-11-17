import assert from "node:assert/strict";
import {test} from "node:test";
import {mayPresentOfferResponse} from "./offer-response.ts";

test("dispatch presentation rejects expired, wrong-actor and already-assigned offers",()=>{
  const now=Date.parse("2026-11-17T00:00:00Z");
  const offer={captainId:"a",offerId:"o",expiresAt:"2026-11-17T00:01:00Z",status:"OFFERED"};
  const ctx={captainId:"a",hasActiveAssignment:false,sessionVerified:true};
  assert.equal(mayPresentOfferResponse(offer,ctx,now),true);
  assert.equal(mayPresentOfferResponse({...offer,captainId:"b"},ctx,now),false);
  assert.equal(mayPresentOfferResponse({...offer,status:"EXPIRED"},ctx,now),false);
  assert.equal(mayPresentOfferResponse(offer,{...ctx,sessionVerified:false},now),false);
  assert.equal(mayPresentOfferResponse(offer,{...ctx,hasActiveAssignment:true},now),false);
  assert.equal(mayPresentOfferResponse(offer,ctx,now+60000),false);
});
