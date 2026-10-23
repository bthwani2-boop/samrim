import test from "node:test";
import assert from "node:assert/strict";
import { operationalStageElapsed } from "./operational-stage-elapsed.ts";

const now = Date.parse("2026-10-23T12:00:00Z");
test("elapsed stage age reads only a proven transition timestamp", () => {
  assert.equal(operationalStageElapsed(undefined, now), null);
  assert.equal(operationalStageElapsed(null, now), null);
  assert.equal(operationalStageElapsed("not-a-date", now), null);
  assert.equal(operationalStageElapsed("2026-10-23T12:05:00Z", now), null);
  assert.match(operationalStageElapsed("2026-10-23T11:35:00Z", now) ?? "", /25|٢٥|۲۵/);
  assert.match(operationalStageElapsed("2026-10-23T10:00:00Z", now) ?? "", /ساع/);
});
