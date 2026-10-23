import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const partner = readFileSync(new URL("../../app-partner/src/features/store-offer/store-promotions.tsx", import.meta.url), "utf8");
const operator = readFileSync(new URL("../src/features/marketing/marketing-promotions-workspace.tsx", import.meta.url), "utf8");

test("partner and operator promotion screens parse", () => {
  for (const [name, source] of [["partner", partner], ["operator", operator]]) {
    const parsed = ts.createSourceFile(name + ".tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(parsed.parseDiagnostics.length, 0, name + " malformed TSX");
  }
});
test("partner cannot opt in to unbounded partner funding", () => {
  assert.match(partner, /campaign\.promotion\.fundingSource !== "BTHWANI" && !campaign\.promotion\.discountBudgetLimitMinor/);
  assert.match(partner, /موافقة التمويل غير متاحة: لا يوجد سقف معلن للخصومات/);
  assert.match(partner, /لا يمكن الموافقة على تمويل خصومات دون سقف مالي معتمد/);
  assert.match(partner, /الحد الأقصى لقيمة الخصومات/);
});
test("operator must set budget before inviting partners to fund a campaign", () => {
  assert.match(operator, /promotionForm\.fundingSource !== "BTHWANI" && budgetLimit === null/);
  assert.match(operator, /حدد سقفًا إجماليًا للخصومات قبل دعوة الشركاء/);
  assert.match(operator, /promotionForm\.fundingSource !== "BTHWANI" && !promotionForm\.discountBudgetLimitMinor\.trim\(\)/);
  assert.match(operator, /سقف مجموع الخصومات \(إلزامي لتمويل الشركاء/);
});
