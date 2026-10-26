import assert from "node:assert/strict";
import test from "node:test";
import {captainPresenceIntervalMs, shouldPublishCaptainPresence} from "./captain-presence-policy.ts";
test("presence is periodic, never continuous",()=>{
    assert.equal(captainPresenceIntervalMs,300000);
});
test("presence requires foreground, permission, active eligible actor and enabled GPS",()=>{
    for(const flags of [[false,true,true,true,true],[true,false,true,true,true],[true,true,false,true,true],[true,true,true,false,true],[true,true,true,true,false]]){
        assert.equal(shouldPublishCaptainPresence(...flags),false);
    }
    assert.equal(shouldPublishCaptainPresence(true,true,true,true,true),true);
});
