import assert from "node:assert/strict";
import { test } from "node:test";
import { hasActiveCaptainSession } from "./captain-session.ts";

test("Captain access check fails closed for non-Captain or expired owner sessions",()=>{
  const now=Date.parse("2026-11-17T00:00:00Z");
  const s={actorId:"captain-1",role:"captain",sessionExpiresAt:"2026-11-18T00:00:00Z"};
  assert.equal(hasActiveCaptainSession(s,now),true);
  for(const bad of [null,{}, {...s,role:"merchant"}, {...s,actorId:" "},
    {...s,sessionExpiresAt:"2026-01-01T00:00:00Z"}, {...s,sessionExpiresAt:"invalid"}])
    assert.equal(hasActiveCaptainSession(bad,now),false);
});
