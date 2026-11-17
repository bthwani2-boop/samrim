import assert from "node:assert/strict";
import {test} from "node:test";
import {publishActiveMissionFix} from "./mission-location.ts";
import {canEnableBackgroundMissionLocation} from "./mission-location-background.ts";
import {isAcceptableFix,publishLatestPresence} from "./presence-publisher.ts";

const now=1800000000000;
const policy={maxAgeMs:120000,maxFutureSkewMs:1000,maxAccuracyM:50};
const fix={latitude:15.35,longitude:44.2,accuracyM:12,capturedAtMs:now};
test("fix bounds reject stale, future, inaccurate and invalid coordinates",()=>{
  assert.equal(isAcceptableFix(fix,policy,now),true);
  for(const f of [{...fix,capturedAtMs:now-120001},{...fix,capturedAtMs:now+1001},
    {...fix,accuracyM:51},{...fix,latitude:91},{...fix,longitude:Infinity}])
    assert.equal(isAcceptableFix(f,policy,now),false);
});
test("publisher never calls owner without identity, assignment and permission",async()=>{
  let calls=0; const send=async()=>{calls++;};
  const rights={foregroundGranted:true,identityVerified:true,ownerReady:true};
  assert.equal(await publishLatestPresence(fix,policy,{...rights,ownerReady:false},send,now),false);
  const assignment={assignmentId:"task",identityVerified:true,isAssignedCaptain:true,foregroundGranted:true};
  assert.equal(await publishActiveMissionFix(fix,policy,{...assignment,isAssignedCaptain:false},send,now),false);
  assert.equal(calls,0);
  assert.equal(await publishLatestPresence(fix,policy,rights,send,now),true);
  assert.equal(await publishActiveMissionFix(fix,policy,assignment,send,now),true);
  assert.equal(calls,2);
});
test("background mission location requires every gate",()=>{
  const s={foregroundGranted:true,backgroundGranted:true,activeAssignment:true,
    ownerAllowsBackground:true,identityVerified:true,android:true};
  assert.equal(canEnableBackgroundMissionLocation(s),true);
  for(const key of Object.keys(s)) assert.equal(canEnableBackgroundMissionLocation({...s,[key]:false}),false);
});
