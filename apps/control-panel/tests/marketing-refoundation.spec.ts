import { expect, type Page, test } from "./coverage-fixtures";

const identity = {
  subject: "marketing-review-operator",
  sessionId: "marketing-review-session",
  role: "operator",
  permissions: ["marketing", "finance"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function provideMarketingReads(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 405, json: { error: { message: "اختبار قراءة فقط" } } });
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/auth/session": { identity },
      "/api/notifications": { notifications: [], unreadCount: 0, nextCursor: "" },
      "/api/service-cities": { cities: [] },
      "/api/marketing/summary": { activePromotions: 125, scheduledPromotions: 2, endedPromotions: 3, draftPromotions: 4, pausedPromotions: 5, activeContent: 6, asOf: "2026-10-18T19:00:00Z" },
      "/api/marketing/promotions": {
        promotions: [{
          id: "promotion-smoke",
          nameAr: "عرض تجريبي",
          code: "SMOKE",
          kind: "PERCENTAGE",
          valueMinor: 10,
          fundingSource: "BTHWANI",
          targets: [],
          state: "PUBLISHED",
          startsAt: "2026-10-10T10:00:00Z",
        }],
        nextCursor: "",
      },
      "/api/marketing/content": {
        items: [{
          id: "content-smoke",
          titleAr: "بنر تجريبي",
          mediaUri: null,
          kind: "BANNER",
          targetType: "INFO",
          state: "PUBLISHED",
          ordinal: 1,
          startsAt: "2026-10-10T10:00:00Z",
        }],
        nextCursor: "",
      },
      "/api/marketing/analytics": {
        items: [
          { eventType: "IMPRESSION", count: 150 },
          { eventType: "CLICK", count: 25 },
          { eventType: "CONVERSION", count: 3 },
        ],
      },
    };
    await route.fulfill(url.pathname in responses
      ? { status: 200, json: responses[url.pathname] }
      : { status: 404, json: { error: { message: "مورد اختبار غير مُعدّ" } } });
  });
}

test("marketing promotions retain their canonical screen and records after splitting components", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing/promotions");
  await expect(page.getByRole("heading", { name: "العروض", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: "سجل العروض" });
  await expect(table).toContainText("عرض تجريبي");
  await expect(table).toContainText("SMOKE");
  await expect(table).toContainText("بثواني");
  await expect(table.locator(".record-indicator")).toContainText(["منشور"]);
  await expect(page.getByText("إنشاء محتوى اكتشاف", { exact: true })).toHaveCount(0);
});

test("marketing content retains its screen and honest event-count visualization", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing/content");
  await expect(page.getByRole("heading", { name: "محتوى الاكتشاف", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: "سجل محتوى الاكتشاف" });
  await expect(table).toContainText("بنر تجريبي");
  await expect(table.locator(".record-indicator")).toContainText(["منشور"]);
  await table.getByRole("button", { name: "قراءة التحليلات" }).click();
  const panel = page.getByRole("complementary").filter({ hasText: "تحليلات المحتوى" });
  await expect(panel).toContainText("طلبات منشأة منسوبة");
  await expect(panel.locator("progress")).toHaveCount(3);
  await expect(panel.locator("progress").first()).toHaveAttribute("max", "150");
  await expect(panel.locator("progress").last()).toHaveAttribute("value", "3");
  await expect(panel).toContainText("لا تعبر عن معدل تحويل أو أرباح");
});

test("marketing content previews the selected banner locally without publishing", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing/content");
  await page.getByText("إنشاء محتوى اكتشاف", { exact: true }).click();
  await page.getByRole("textbox", { name: "عنوان المحتوى" }).fill("عرض الخضروات");
  await page.getByLabel("ملف صورة المحتوى").setInputFiles({
    name: "banner.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGO846bBwMDAxMDAwMDAAAAQVgFOyh0XIgAAAABJRU5ErkJggg==", "base64"),
  });
  const preview = page.getByTestId("marketing-content-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByText("عرض الخضروات")).toBeVisible();
  await expect(preview.getByRole("img", { name: "معاينة الصورة المختارة" })).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(0);
  await expect.poll(async () => preview.locator("canvas").evaluate((canvas) => {
    const bitmap = canvas as HTMLCanvasElement;
    return (bitmap.getContext("2d")?.getImageData(0, 0, 1, 1).data[3] ?? 0) > 0;
  })).toBe(true);
  await expect(preview).toContainText("معاينة تقريبية");
});

test("marketing analytics failure remains an explicit error and never becomes a false zero", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/marketing/analytics?**", (route) => route.fulfill({ status: 503, json: { error: { message: "مصدر التحليلات غير متاح" } } }));
  await page.goto("/marketing/content");
  await page.getByRole("table", { name: "سجل محتوى الاكتشاف" }).getByRole("button", { name: "قراءة التحليلات" }).click();
  const panel = page.getByRole("complementary").filter({ hasText: "تحليلات المحتوى" });
  await expect(panel.getByRole("alert")).toHaveText("مصدر التحليلات غير متاح");
  await expect(panel.locator("progress")).toHaveCount(0);
});

test("marketing content publication waits for canonical readback, not just an HTTP success", async ({ page }) => {
  await provideMarketingReads(page);
  let didPost = false;
  await page.route("**/api/marketing/content**", async (route) => {
    if (route.request().method() === "POST") {
      didPost = true;
      await route.fulfill({ status: 200, json: { state: "PAUSED", version: 3 } });
      return;
    }
    await route.fulfill({ status: 200, json: {
      items: [{
        id: "content-smoke", titleAr: "بنر تجريبي", mediaUri: null,
        kind: "BANNER", targetType: "INFO", state: "PUBLISHED",
        version: 2, ordinal: 1, startsAt: "2026-10-10T10:00:00Z",
      }],
      nextCursor: "",
    } });
  });
  await page.goto("/marketing/content");
  await page.getByRole("table", { name: "سجل محتوى الاكتشاف" })
    .getByRole("button", { name: "إيقاف المحتوى" }).click();
  await expect(page.getByRole("status").filter({ hasText: "لم تؤكد القراءة المعتمدة" })).toBeVisible();
  expect(didPost).toBe(true);
  await expect(page.getByText("أُوقف المحتوى وأُكدت حالته من السجل.")).toHaveCount(0);
});

test("marketing content publication confirms the versioned canonical state", async ({ page }) => {
  await provideMarketingReads(page);
  let paused = false;
  await page.route("**/api/marketing/content**", async (route) => {
    if (route.request().method() === "POST") {
      paused = true;
      await route.fulfill({ status: 200, json: { state: "PAUSED", version: 3 } });
      return;
    }
    await route.fulfill({ status: 200, json: {
      items: [{
        id: "content-smoke", titleAr: "بنر تجريبي", mediaUri: null,
        kind: "BANNER", targetType: "INFO",
        state: paused ? "PAUSED" : "PUBLISHED",
        version: paused ? 3 : 2, ordinal: 1,
        startsAt: "2026-10-10T10:00:00Z",
      }],
      nextCursor: "",
    } });
  });
  await page.goto("/marketing/content");
  await page.getByRole("table", { name: "سجل محتوى الاكتشاف" })
    .getByRole("button", { name: "إيقاف المحتوى" }).click();
  await expect(page.getByText("أُوقف المحتوى وأُكدت حالته من السجل.")).toBeVisible();
  await expect(page.getByRole("table", { name: "سجل محتوى الاكتشاف" })).toContainText("موقوف");
});

test("marketing promotion state cannot be claimed without a newer canonical version", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/marketing/promotions**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, json: { state: "PAUSED", version: 3 } });
      return;
    }
    await route.fulfill({ status: 200, json: {
      promotions: [{
        id: "promotion-smoke", nameAr: "عرض تجريبي", code: "SMOKE",
        kind: "PERCENTAGE", valueMinor: 10, fundingSource: "BTHWANI",
        targets: [], state: "PAUSED", version: 2, startsAt: "2026-10-10T10:00:00Z",
      }],
      nextCursor: "",
    } });
  });
  await page.goto("/marketing/promotions");
  await page.getByRole("table", { name: "سجل العروض" })
    .getByRole("button", { name: "نشر العرض" }).click();
  await expect(page.getByRole("status").filter({ hasText: "الحالة والإصدار الجديدين" })).toBeVisible();
  await expect(page.getByText("نُشر العرض وأُكدت حالته من السجل.")).toHaveCount(0);
});



test("guided marketing creation keeps discount values while moving through stages and never posts before confirmation", async ({ page }) => {
  await provideMarketingReads(page);
  let mutations = 0;
  await page.route("**/api/marketing/promotions**", async (route) => {
    if (route.request().method() !== "GET") mutations++;
    await route.fulfill({ status: 200, json: { promotions: [], nextCursor: "" } });
  });
  await page.goto("/marketing/promotions");
  await expect(page.getByRole("link", { name: /إعلان دون خصم/ })).toHaveAttribute("href", "/marketing/content");
  await page.getByRole("button", { name: /خصم أو قسيمة/ }).click();
  await expect(page.getByRole("navigation", { name: "مراحل إعداد الخصم" })).toBeVisible();
  const code = page.getByRole("textbox", { name: "رمز العرض" });
  await expect(code).toHaveValue(/^BT-[A-F0-9]{10}$/);
  await page.getByRole("textbox", { name: "اسم العرض" }).fill("حملة الجمعة");
  await page.getByRole("spinbutton", { name: "نسبة الخصم" }).fill("20");
  await page.getByRole("button", { name: "التالي: النطاق والموعد" }).click();
  await expect(page.locator("#promotion-city")).toBeVisible();
  await page.getByRole("button", { name: "التالي: التمويل والضوابط" }).click();
  await page.locator("#promotion-funding-source").selectOption("SHARED");
  await page.getByRole("spinbutton", { name: "حصة الشريك من التمويل" }).fill("40");
  await page.getByRole("button", { name: "التالي: المراجعة" }).click();
  const review = page.getByRole("region", { name: "مراجعة العرض قبل الحفظ" });
  await expect(review).toContainText("حملة الجمعة");
  await expect(review).toContainText("الشريك 40%، بثواني 60%");
  await expect(review).toContainText("مطلوبة قبل المشاركة");
  await expect(review).toContainText("لم تحدد سقفًا إجماليًا");
  expect(mutations).toBe(0);
  await page.locator(".marketing-flow-actions").getByRole("button", { name: "السابق" }).click();
  await page.locator(".marketing-flow-actions").getByRole("button", { name: "السابق" }).click();
  await page.locator(".marketing-flow-actions").getByRole("button", { name: "السابق" }).click();
  await expect(page.getByRole("spinbutton", { name: "نسبة الخصم" })).toHaveValue("20");
  expect(mutations).toBe(0);
});

test("guided marketing flow blocks invalid discounts and stays on the current stage", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing/promotions");
  await page.getByRole("button", { name: /خصم أو قسيمة/ }).click();
  await page.getByRole("button", { name: "التالي: النطاق والموعد" }).click();
  await expect(page.getByRole("alert").getByText("أدخل اسم العرض وقيمة خصم صحيحة قبل المتابعة.")).toBeVisible();
  await expect(page.locator("#promotion-city")).toHaveCount(0);
});

test("operator Store-specific campaign never offers unauthorized Partner funding", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/service-cities", (route) =>
    route.fulfill({ status: 200, json: { cities: [{ id: "marketing-city", displayNameAr: "صنعاء", active: true }] } }));
  await page.route("**/api/marketing/content/targets?**", (route) =>
    route.fulfill({ status: 200, json: { options: [{ id: "marketing-store", label: "متجر تجريبي" }] } }));
  await page.goto("/marketing/promotions");
  await page.getByText("إعداد خصم أو قسيمة", { exact: true }).click();
  await page.getByRole("textbox", { name: "اسم العرض" }).fill("خصم متجر تجريبي");
  await page.getByRole("button", { name: "التالي: النطاق والموعد" }).click();
  await page.locator("#promotion-city").selectOption("marketing-city");
  await page.getByRole("textbox", { name: "بحث متجر الحملة" }).fill("متجر");
  await expect(page.locator("#promotion-store option[value='marketing-store']")).toHaveCount(1);
  await page.locator("#promotion-store").selectOption("marketing-store");
  await page.getByRole("button", { name: "التالي: التمويل والضوابط" }).click();
  const funding = page.locator("#promotion-funding-source");
  await expect(funding).toHaveValue("BTHWANI");
  await expect(funding.locator("option[value='SHARED']")).toHaveAttribute("disabled", "");
  await expect(funding.locator("option[value='PARTNER']")).toHaveAttribute("disabled", "");
  await expect(page.getByText("المتجر المحدد يموله بثواني فقط.", { exact: false })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "حصة الشريك من التمويل" })).toHaveCount(0);
});


test("published promotion opens a validated banner draft with its canonical destination", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/marketing/content/targets?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    await route.fulfill({ status: 200, json: {
      options: query.get("targetType") === "PROMOTION" && query.get("query") === "SMOKE"
        ? [{ id: "promotion-smoke", label: "عرض تجريبي" }] : [],
      nextCursor: "",
    } });
  });
  await page.goto("/marketing/promotions");
  const linked = page.getByRole("link", { name: "إنشاء بنر للعرض" });
  await expect(linked).toHaveAttribute("href", "/marketing/content?promotionId=promotion-smoke");
  await linked.click();
  await expect(page.locator("#marketing-content-target")).toHaveValue("PROMOTION");
  await expect(page.getByRole("textbox", { name: "بحث في الوجهات" })).toHaveValue("SMOKE");
  await expect(page.locator("#marketing-content-target-option")).toHaveValue("promotion-smoke");
  await expect(page.getByText("تم ربط البنر بالعرض المنشور.", { exact: false })).toBeVisible();
});

test("unverified promotion links do not silently create marketing targets", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing/content?promotionId=untrusted-promotion");
  await expect(page.getByText("العرض المحدد غير منشور أو غير متاح.", { exact: false })).toBeVisible();
  await expect(page.locator("#marketing-content-target")).toHaveValue("INFO");
});


test("marketing center provides five genuine sections with honest summary scope", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing");
  await expect(page.getByRole("heading", { name: "التسويق والمحتوى" })).toBeVisible();
  await expect(page.getByRole("link", { name: /إعلان دون خصم/ })).toHaveAttribute("href", "/marketing/content");
  await expect(page.getByRole("link", { name: /خصم أو قسيمة/ })).toHaveAttribute("href", "/marketing/promotions");
  const navigation = page.getByRole("navigation", { name: "أقسام التسويق" });
  for (const name of ["نظرة عامة", "الحملات والعروض", "المحتوى والظهور", "مشاركة الشركاء", "الأداء والتحليلات"]) {
    await expect(navigation.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByText("العروض الفعالة", { exact: true })).toBeVisible();
  await expect(page.getByText("موافقات المتاجر المنتظرة لم تُربط بعد بتقرير المشغّل", { exact: false })).toBeVisible();
  await navigation.getByRole("button", { name: "مشاركة الشركاء" }).click();
  await expect(page.getByRole("heading", { name: "حملات تتطلب موافقة الشركاء" })).toBeVisible();
  await expect(page.getByText("حالة كل قبول أو رفض وعدد المتاجر المنتظرة: غير متاحين", { exact: false })).toBeVisible();
  await navigation.getByRole("button", { name: "الأداء والتحليلات" }).click();
  await page.getByLabel("اختر المحتوى لقراءة نتائجه").selectOption("content-smoke");
  await expect(page.getByText("طلبات منشأة منسوبة", { exact: true })).toBeVisible();
  await expect(page.getByText("الطلبات المكتملة، وقيمة الخصم المسوّاة، ومصاريف WLT الفعلية: غير متاحة", { exact: false })).toBeVisible();
  await expect(page.locator(".marketing-analytics-breakdown")).toContainText("٣");
});

test("marketing overview uses server totals despite a paginated promotions registry", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/marketing/promotions?**", async (route) => route.fulfill({
    status: 200, json: { promotions: [{ id: "partial-promo", nameAr: "عرض مجدول", state: "PUBLISHED", startsAt: "2099-01-01T00:00:00.000Z" }], nextCursor: "next-page" },
  }));
  await page.goto("/marketing");
  await expect(page.getByText("إجماليات كاملة من سجلات DSH", { exact: false })).toBeVisible();
});

test("marketing summary reports backend unavailability instead of fabricated zeros", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/marketing/summary?**", async (route) => route.fulfill({ status: 503, json: { error: { message: "Unavailable" } } }));
  await page.goto("/marketing");
  await expect(page.getByRole("alert").getByText("تعذرت قراءة إجماليات التسويق", { exact: false })).toBeVisible();
  await expect(page.getByText("العروض الفعالة", { exact: true })).toHaveCount(0);
});


test("marketing settlement report reads posted WLT expense without inventing refunds", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/marketing/promotions/promotion-smoke/settlement-summary", async (route) =>
    route.fulfill({ status: 200, json: {
      promotionId: "promotion-smoke", settledOrderCount: 2, settledDiscountMinor: 1000,
      partnerFundedMinor: 400, platformFrozenMinor: 600, platformPostedExpenseMinor: 600,
      currency: "YER", basis: "POSTED_SETTLEMENT_NOT_NET_REFUNDS",
    } }));
  await page.goto("/marketing/promotions");
  await page.getByRole("button", { name: "نتائج التسوية" }).click();
  const region = page.getByRole("region", { name: "نتائج تسوية العرض" });
  await expect(region).toContainText("طلبات وصلت للتسوية");
  await expect(region).toContainText("مصروف بثواني المرحّل في القيود");
  await expect(region).toContainText("600");
  await expect(region).toContainText("ليست صافي المصروف بعد الاستردادات");
});

test("marketing-only operators never see financial settlement controls", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/auth/session**", (route) => route.fulfill({
    status: 200, json: { identity: { ...identity, permissions: ["marketing"] } },
  }));
  await page.goto("/marketing/promotions");
  await expect(page.getByRole("table", { name: "سجل العروض" })).toBeVisible();
  await expect(page.getByRole("button", { name: "نتائج التسوية" })).toHaveCount(0);
});

test("marketing settlement does not turn WLT failure into zero expense", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/marketing/promotions/promotion-smoke/settlement-summary", async (route) =>
    route.fulfill({ status: 503, json: { error: { code: "WLT_UNAVAILABLE" } } }));
  await page.goto("/marketing/promotions");
  await page.getByRole("button", { name: "نتائج التسوية" }).click();
  await expect(page.getByRole("alert").getByText("القراءة المالية غير متاحة الآن", { exact: false })).toBeVisible();
  await expect(page.getByText("مصروف بثواني المرحّل في القيود")).toHaveCount(0);
});

test("overview uses DSH full-registry aggregates instead of first-page counts", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing");
  const overview = page.getByRole("region", { name: "نظرة عامة" });
  await expect(overview).toContainText("إجماليات كاملة من سجلات DSH");
  await expect(overview).toContainText("١٢٥");
  await expect(overview).toContainText("٦");
});