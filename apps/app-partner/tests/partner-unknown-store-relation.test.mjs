import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const file = path.resolve(import.meta.dirname, "../src/features/partner-onboarding/partner-more.tsx");
const source = readFileSync(file, "utf8");
const desktopSource = readFileSync(
  path.resolve(import.meta.dirname, "../src/features/partner-onboarding/partner-desktop-home.tsx"), "utf8",
);

function liveRelationFlags(relationModel) {
  const market = source.match(/const marketplace=([^;]+);/);
  const independent = source.match(/const independent=([^;]+);/);
  assert.ok(market && independent, "PartnerMore must derive both explicit relation flags");
  const classify = new Function("selectedStore", [
    "const marketplace=" + market[1] + ";",
    "const independent=" + independent[1] + ";",
    "return { marketplace, independent };",
  ].join("\n"));
  return classify(relationModel === null ? null : { relationModel });
}

test("PartnerMore never classifies a missing or invalid DSH relation as independent", () => {
  for (const value of [undefined, null, "", "UNKNOWN", "BTHWANI_PARTNER "]) {
    assert.deepEqual(liveRelationFlags(value), { marketplace: false, independent: false });
  }
});

test("PartnerMore recognizes each DSH relation only by exact value", () => {
  assert.deepEqual(liveRelationFlags("BTHWANI_PARTNER"), { marketplace: true, independent: false });
  assert.deepEqual(liveRelationFlags("INDEPENDENT_STORE"), { marketplace: false, independent: true });
});

test("desktop and mobile status fail closed rather than interpreting not-marketplace as independent", () => {
  assert.ok(source.includes('independent?"المتجر المستقل قيد الإعداد":"تعذر التحقق من نموذج المتجر"'),
    "desktop status must distinguish independent from unknown");
  assert.ok(source.includes('independent ? "المتجر المستقل قيد الإعداد" : "تعذر التحقق من نموذج المتجر"'),
    "mobile status must distinguish independent from unknown");
  assert.ok(source.includes('independent ? "المتجر مستقل · المعاينة خاصة بالمالك" : "تعذر التحقق من نموذج المتجر"'),
    "desktop banner must not claim independent preview for unsupported relation");
  assert.ok(source.includes('backgroundColor:marketplace&&selectedStore.publicationState==="published"?theme.success:theme.warning'),
    "unknown relation must not receive marketplace-published success color");
});

test("desktop Store setup shows private preview only for a confirmed independent relation", () => {
  assert.match(desktopSource, /const marketplace = isMarketplaceStore\(store\);/);
  assert.match(desktopSource, /const independent = store\.relationModel === "INDEPENDENT_STORE";/);
  assert.doesNotMatch(desktopSource, /!marketplace \? "معاينة خاصة؛ النشر العام غير مفعل"/);
  assert.match(desktopSource, /independent \? "معاينة خاصة؛ النشر العام غير مفعل" : "تعذر التحقق من نموذج المتجر"/);
  assert.match(desktopSource, /independent \? "المنتجات جاهزة للمعاينة الخاصة؛ الطلب المباشر غير مفعل" : "نموذج المتجر غير متحقق؛ الطلب غير متاح"/);
  assert.match(desktopSource, /independent \? "من الكتالوج الخاص؛ ليس نشرًا للعملاء" : "نموذج المتجر غير متحقق؛ لا تعتمد نشر الكتالوج"/);
  assert.match(desktopSource, /const canOrders = marketplace &&/);
  assert.match(desktopSource, /const canFinance = marketplace &&/);
});
