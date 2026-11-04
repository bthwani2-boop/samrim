import assert from "node:assert/strict";
import { test } from "node:test";
import { activityActor, activityContext, activityTitle } from "../src/features/central-catalog/catalog-activity-presentation.ts";

test("catalog activity summarizes a shared product without exposing IDs", () => {
  const item = { action: "created", kind: "product", subject: "حامل هاتف للسيارة", storeName: "" };
  assert.equal(activityTitle(item), "تمت إضافة المنتج «حامل هاتف للسيارة»");
  assert.equal(activityContext(item), "الكتالوج المشترك");
  assert.equal(activityActor("act_ce02nqOsptMzxPZZy94paaVV"), "بواسطة حساب مسجل");
});

test("store offer activity uses a readable store name and meaningful action", () => {
  const item = { action: "updated", kind: "offer", subject: "حامل هاتف", storeName: "متجر التجربة" };
  assert.equal(activityTitle(item), "تم تعديل عرض المنتج «حامل هاتف»");
  assert.equal(activityContext(item), "المتجر: متجر التجربة");
  assert.equal(activityActor("system:catalog-migration"), "بواسطة النظام");
});

test("missing labels stay explicit rather than inventing names or showing internal IDs", () => {
  const item = { action: "migrated", kind: "offer", subject: "", storeName: "" };
  assert.equal(activityTitle(item), "تم نقل بيانات عرض المنتج «اسم غير متاح»");
  assert.equal(activityContext(item), "المتجر: اسم المتجر غير متاح");
  assert.equal(activityActor(""), "المنفّذ غير متاح");
});
