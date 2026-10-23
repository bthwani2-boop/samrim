import assert from "node:assert/strict";
import test from "node:test";
import { formatOperatorCaseAge } from "./operator-case-age.ts";

const start="2026-10-23T10:00:00Z";
const now=Date.parse(start);
test("case age stays neutral before client hydration and never claims SLA",()=>{
 assert.equal(formatOperatorCaseAge(start,null),"");
 assert.equal(formatOperatorCaseAge(start,now),"الآن");
 assert.equal(formatOperatorCaseAge(start,now+10*60_000),"منذ 10 د");
 assert.equal(formatOperatorCaseAge(start,now+90*60_000),"منذ 1 س");
 assert.equal(formatOperatorCaseAge(start,now+3*24*60*60_000),"منذ 3 يوم");
});
test("future or invalid case event timestamps are never reported as elapsed",()=>{
 assert.equal(formatOperatorCaseAge("not-a-timestamp",now),"المدة غير مؤكدة");
 assert.equal(formatOperatorCaseAge(start,now-120_000),"المدة غير مؤكدة");
});
