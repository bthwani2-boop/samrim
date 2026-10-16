import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

test("store record uses the wide RTL reference composition without losing navigation or context", async ({ page }, testInfo) => {
  const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140"><rect width="140" height="140" fill="#eff7f1"/><circle cx="70" cy="70" r="40" fill="#168a52"/></svg>');
  const cover = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260"><rect width="600" height="260" fill="#304453"/><path d="M0 200L180 45L420 165L600 30V260H0" fill="#688577"/></svg>');
  const store = {
    id: "reference-store", partnerActorId: "partner-actor", name: "سوبر ماركت الاختبار",
    partnerName: "شريك الاختبار", serviceCityName: "صنعاء", primaryVerticalName: "البقالة",
    serviceCityId: null, primaryVerticalId: null, commercialStoreTypeId: null, deliveryOrigin: null,
    publicationState: "published", publicationReadiness: { ready: true, blockedReason: null },
    fulfillmentModes: ["BTHWANI_CAPTAIN"], version: 1,
    storeProfileImage: { role: "primary", uri: icon }, storeCoverImage: { role: "cover", uri: cover },
    createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-16T07:00:00Z",
  };
  let currentStore = store;
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.route("**/api/auth/session**", route => route.fulfill({ json: {
    identity: { subject: "operator", sessionId: "session", role: "operator", permissions: ["partners", "operations"],
      surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  await page.route("**/api/notifications**", route => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/partners/registry**", route => route.fulfill({ json: {
    rows: [{ kind: "store", store, partnerRole: null }], nextCursor: "",
  } }));
  await page.route("**/api/stores/reference-store/publication**", route => route.fulfill({ json: { store: currentStore } }));
  await page.route("**/api/stores/reference-store/fulfillment-modes**", route => {
    const body = route.request().postDataJSON() as { fulfillmentModes: string[]; expectedVersion: number };
    expect(body.expectedVersion).toBe(currentStore.version);
    currentStore = { ...currentStore, fulfillmentModes: body.fulfillmentModes, version: currentStore.version + 1 };
    return route.fulfill({ json: { storeId: store.id, fulfillmentModes: body.fulfillmentModes } });
  });
  const uploadBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgaLD4DwADFAHAKW63BQAAAABJRU5ErkJggg==", "base64");
  const uploadHash = createHash("sha256").update(uploadBytes).digest("hex");
  let allowImageSave = false;
  let imageUploaded = false;
  await page.route("**/api/stores/reference-store/images**", route => {
    if (route.request().method() === "POST") {
      if (!allowImageSave) return route.fulfill({ status: 503, json: { error: { code: "DSH_STORAGE_UNAVAILABLE", message: "Temporary failure" } } });
      imageUploaded = true;
    }
    return route.fulfill({ json: {
      storeId: store.id, version: imageUploaded ? 2 : 1,
      storeProfileImage: imageUploaded ? { ...store.storeProfileImage, contentSha256: uploadHash,
        provenance: { creator: "مصور تجريبي", sourceDescription: "بيانات اختبار", rightsStatement: "حقوق تصوير تجريبية",
          sourceUri: "", rightsUri: "", attestedAt: "2026-10-16T07:00:00Z" },
      } : store.storeProfileImage, storeCoverImage: store.storeCoverImage,
    } });
  });
  await page.route("**/api/operations?**", route => route.fulfill({ json: { operations: [], summary: {
    totalCount: 0, actionableCount: 0, awaitingDispatchCount: 0, activeCount: 0, deliveredCount: 0, measuredAt: "2026-10-16T07:00:00Z",
  } } }));
  await page.route("**/api/partners/roster/partner-actor**", route => route.fulfill({ json: {
    partner: { actorId: "partner-actor", phoneE164: "+967777000000", enabled: true, securityEnabled: true,
      activatedAt: "2026-10-10T10:00:00Z" }, joiningCase: {
      id: "joining-case-opaque-fixture", businessName: "بقالة الاختبار", ownerFullName: "مالك الاختبار", state: "approved",
    },
  } }));
  await page.route("**/api/stores/reference-store/offers**", route => route.fulfill({ json: { offers: [] } }));
  let availability = {
    storeId: store.id, scheduleMode: "ALWAYS_OPEN" as "ALWAYS_OPEN" | "WEEKLY",
    scheduleTimezone: "Asia/Aden", weeklySchedule: [] as Array<{ dayOfWeek: number; opensAtMinute: number; closesAtMinute: number }>,
    paused: false, pauseReason: null as string | null, pauseUntil: null as string | null,
    preparationMinutes: 15 as number | null, unavailableFulfillmentModes: [] as string[],
    version: 1, updatedByActorId: "operator", updatedAt: "2026-10-16T07:00:00Z",
  };
  await page.route("**/api/stores/reference-store/operational-availability**", route => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as typeof availability & { expectedVersion: number };
      expect(body.expectedVersion).toBe(availability.version);
      availability = { ...availability, ...body, version: availability.version + 1 };
    }
    return route.fulfill({ json: { availability, orderabilityByMode: [] } });
  });
  await page.goto("/partners/stores?inspect=reference-store&q=test");
  const inspector = page.getByRole("region", { name: "تفاصيل المتجر" });
  await expect(inspector).toBeVisible();
  await expect(inspector).not.toContainText("reference-store");
  await inspector.getByRole("button", { name: "توسيع ملف السجل" }).click();
  await expect(page.locator(".adaptive-record-workspace")).toHaveAttribute("data-full", "true");
  await expect(inspector.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "true");
  await expect(inspector).not.toContainText("joining-case-opaque-fixture");
  await expect(inspector.locator(".store-profile-kpi")).toHaveCount(5);
  await expect(inspector.getByText(/0 طلب مطابق/)).toBeVisible();
  await expect(inspector.getByText("لا توجد عروض مسجلة لهذا المتجر في هذه الصفحة.")).toBeVisible();
  await expect(inspector.getByRole("img", { name: "غلاف متجر سوبر ماركت الاختبار" })).toBeVisible();
  const hero = await inspector.locator(".store-profile-hero").boundingBox();
  const overview = await inspector.locator(".store-profile-overview").boundingBox();
  const nav = await page.getByRole("navigation").first().boundingBox();
  expect(hero).not.toBeNull();
  expect(overview).not.toBeNull();
  expect(hero!.width).toBeGreaterThan(1000);
  expect(overview!.y).toBeGreaterThan(hero!.y);
  expect(nav).not.toBeNull();
  await inspector.getByRole("tab", { name: "الوثائق والاعتمادات" }).click();
  await expect(inspector).not.toContainText("joining-case-opaque-fixture");
  await inspector.getByRole("tab", { name: "نظرة عامة" }).click();
  await page.screenshot({ path: testInfo.outputPath("store-reference-desktop.png"), fullPage: false });
  await inspector.getByRole("button", { name: "تغيير غلاف المتجر" }).click();
  const imageEditor = page.getByRole("dialog", { name: "تغيير صورة الغلاف" });
  await expect(imageEditor).toBeVisible();
  await expect(imageEditor.getByRole("group", { name: "نوع الصورة" })).toHaveCount(0);
  await expect(imageEditor).toContainText("إضافة أو استبدال الغلاف");
  await imageEditor.getByRole("button", { name: "إغلاق تعديل الصورة" }).click();
  await inspector.getByRole("button", { name: "تغيير شعار المتجر" }).click();
  const logoDialog = page.getByRole("dialog", { name: "تغيير شعار المتجر" });
  await expect(logoDialog).toBeVisible();
  await logoDialog.locator('input[type="file"]').setInputFiles({ name: "store-test.png", mimeType: "image/png", buffer: uploadBytes });
  await expect(logoDialog.locator(".store-list-logo canvas")).toHaveAttribute("width", "1");
  await expect(logoDialog.locator('img[src^="blob:"]')).toHaveCount(0);
  await logoDialog.getByRole("textbox", { name: "منشئ الصورة" }).fill("مصور تجريبي");
  await logoDialog.getByRole("textbox", { name: "مصدر الصورة" }).fill("بيانات اختبار");
  await logoDialog.getByRole("textbox", { name: "حق استخدام الصورة" }).fill("حقوق تصوير تجريبية");
  await logoDialog.getByRole("checkbox", { name: /أؤكد صحة بيانات المصدر/ }).check();
  await logoDialog.getByRole("button", { name: "حفظ الشعار" }).click();
  await expect(logoDialog).toBeVisible();
  await expect(logoDialog.getByRole("alert")).toContainText(/تعذر|لم يتم|فشل|تأكد/);
  allowImageSave = true;
  await logoDialog.getByRole("button", { name: "حفظ الشعار" }).click();
  await expect(logoDialog).toHaveCount(0);
  await expect(inspector.locator(".store-profile-image-notice")).toContainText("تم تحديث شعار المتجر والتحقق من حفظه.");

  const modes = inspector.locator(".store-mode-controls");
  await modes.getByRole("button", { name: "تعديل" }).click();
  await modes.getByRole("checkbox", { name: "استلم بنفسك من المتجر" }).check();
  await modes.getByRole("button", { name: "حفظ" }).click();
  await expect(modes.locator('[data-enabled="true"]')).toContainText(["توصيل بثواني", "استلم بنفسك من المتجر"]);

  await inspector.getByRole("tab", { name: "أوقات العمل" }).click();
  const hours = inspector.getByRole("region", { name: "إدارة تشغيل المتجر وأوقاته" });
  await expect(hours).toContainText("على مدار الساعة");
  await hours.getByRole("button", { name: "تعديل الأوقات والتشغيل" }).click();
  await hours.getByRole("radio", { name: "حسب أيام وساعات محددة" }).check();
  await hours.getByRole("button", { name: "+ إضافة فترة" }).first().click();
  await hours.getByRole("button", { name: "حفظ وتطبيق" }).click();
  await expect(hours).toContainText("جدول أسبوعي");
  await expect(hours).toContainText("09:00");
  await inspector.getByRole("tab", { name: "نظرة عامة" }).click();
  await inspector.getByRole("tab", { name: "الكتالوج والمنتجات" }).click();
  await expect(inspector.getByRole("tabpanel", { name: "الكتالوج والمنتجات" })).toBeVisible();
  await expect(inspector.getByRole("tabpanel", { name: "نظرة عامة" })).toBeHidden();
  await inspector.getByRole("tab", { name: "نظرة عامة" }).click();
  await expect(inspector.getByRole("tabpanel", { name: "نظرة عامة" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("inspect")).toBe("reference-store");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(inspector.getByRole("tab", { name: "نظرة عامة" })).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "الطلبات" })).toBeAttached();
  const mobile = await inspector.locator(".store-profile").boundingBox();
  expect(mobile).not.toBeNull();
  expect(mobile!.width).toBeLessThanOrEqual(392);
  await page.screenshot({ path: testInfo.outputPath("store-reference-mobile.png"), fullPage: false });
});
