import assert from "node:assert/strict";
import test from "node:test";
import {captainPresenceIntervalMs, shouldPublishCaptainPresence} from "./captain-presence-policy.ts";
test("presence is periodic, never continuous",()=>{
    assert.equal(captainPresenceIntervalMs,300000);
});
test("no location for background, sign-out, denial or off-shift",()=>{
    for(const flags of [[false,true,true,true,false],[true,false,true,true,false],[true,true,false,true,false],[true,true,true,false,false]]){
        assert.equal(shouldPublishCaptainPresence(...flags.slice(0,4)),false);
    }
    assert.equal(shouldPublishCaptainPresence(true,true,true,true),true);
    assert.equal(shouldPublishCaptainPresence(true,true,true,false),false);
});
