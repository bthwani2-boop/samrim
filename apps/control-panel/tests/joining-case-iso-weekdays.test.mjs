import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { joiningCaseIsoWeekdayLabels } from "../src/features/partner-onboarding/joining-case-weekdays.ts";

const contract = await readFile(new URL("../../../services/dsh/contracts/openapi/dsh.openapi.yaml", import.meta.url), "utf8");

test("joining-case working hours follow DSH ISO Monday-to-Sunday indexing", () => {
  assert.ok(contract.includes("description: ISO weekday (Monday=1 through Sunday=7)."));
  assert.deepEqual(joiningCaseIsoWeekdayLabels, [
    "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد",
  ]);
  assert.equal(joiningCaseIsoWeekdayLabels[1 - 1], "الاثنين");
  assert.equal(joiningCaseIsoWeekdayLabels[7 - 1], "الأحد");
});

test("all intake and store profile consumers share the ISO weekday labels", async () => {
  for (const [path, alias] of [
    ["../src/features/partner-onboarding/joining-case-create.tsx", "weekdays"],
    ["../src/features/partner-onboarding/joining-case-detail.tsx", "weekdays"],
    ["../src/features/stores/store-profile-tabs.tsx", "intakeWeekdays"],
    ["../src/features/stores/store-profile-detail-panels.tsx", "intakeWeekdays"],
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.ok(source.includes(`import { joiningCaseIsoWeekdayLabels as ${alias} } from "`), path);
    assert.ok(!source.includes("const weekdays = [") && !source.includes("const intakeWeekdays = ["), path);
  }
});
