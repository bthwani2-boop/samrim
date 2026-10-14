import { expect, type Page, test } from "@playwright/test";

async function session(page: Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: { subject: "return-reader", sessionId: "return-reader", role: "operator", permissions: ["operations", "marketing", "hr", "finance"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z" } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [] } }));
}

for (const [path, endpoint, empty] of [
  ["/marketing/promotions", "**/api/marketing/promotions?**", "لا توجد عروض مطابقة."],
  ["/marketing/content", "**/api/marketing/content?**", "لا يوجد محتوى مطابق."],
] as const) {
  test(`marketing registry failure is never empty and return reads preserve the draft: ${path}`, async ({ page }) => {
    await session(page);
    await page.clock.install();
    let valid = false;
    let reads = 0;
    await page.route(endpoint, (route) => {
      reads++;
      return route.fulfill({ json: valid ? path.endsWith("promotions") ? { promotions: [] } : { items: [] } : {} });
    });
    await page.goto(path);
    await expect(page.locator("#workspace-main").getByRole("alert")).toContainText("غير صالحة");
    await expect(page.getByText(empty, { exact: true })).toHaveCount(0);
    valid = true;
    await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
    await expect(page.getByText(empty, { exact: true })).toBeVisible();
    await page.getByText(path.endsWith("promotions") ? "إنشاء عرض أو حملة" : "إنشاء محتوى اكتشاف", { exact: true }).click();
    const draft = page.getByLabel(path.endsWith("promotions") ? "اسم العرض" : "عنوان المحتوى", { exact: true });
    await draft.fill("مسودة محفوظة أثناء الرجوع");
    const before = reads;
    await page.clock.fastForward(31_000);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => reads).toBe(before + 1);
    await expect(draft).toHaveValue("مسودة محفوظة أثناء الرجوع");
  });
}

test("operations rereads the current server filter on return without touching the search draft", async ({ page }) => {
  await session(page);
  await page.clock.install();
  const queries: string[] = [];
  await page.route("**/api/operations?**", (route) => {
    queries.push(new URL(route.request().url()).searchParams.get("q") ?? "");
    return route.fulfill({ json: { operations: [] } });
  });
  await page.goto("/operations?q=المعتمد");
  await expect(page.getByText("لا توجد نتائج تطابق البحث", { exact: true })).toBeVisible();
  await page.getByLabel("رقم الطلب أو اسم المتجر").fill("بحث لم يُرسل");
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => queries.length).toBe(2);
  expect(queries).toEqual(["المعتمد", "المعتمد"]);
  await expect(page.getByLabel("رقم الطلب أو اسم المتجر")).toHaveValue("بحث لم يُرسل");
});

test("HR errors are distinct from an empty directory and automatic reads pause during employee creation", async ({ page }) => {
  await session(page);
  await page.clock.install();
  let valid = false;
  let reads = 0;
  await page.route("**/api/hr/employees?**", (route) => {
    reads++;
    return route.fulfill(valid ? { json: { items: [] } } : { status: 503, json: {} });
  });
  await page.goto("/hr/employees");
  await expect(page.locator(".hr-directory").getByRole("alert")).toBeVisible();
  await expect(page.getByText("لا يوجد موظفون مطابقون للبحث.", { exact: true }).filter({ visible: true })).toHaveCount(0);
  valid = true;
  await page.getByRole("button", { name: "إعادة تحميل السجل", exact: true }).click();
  await expect(page.getByText("لا يوجد موظفون مطابقون للبحث.", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "إضافة موظف", exact: true }).click();
  await page.getByLabel("الاسم الكامل", { exact: true }).fill("مسودة موظف");
  const before = reads;
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(reads).toBe(before);
  await expect(page.getByLabel("الاسم الكامل", { exact: true })).toHaveValue("مسودة موظف");
});

test("employee file keeps the directory context and retains a closed draft with focus restoration", async ({ page }) => {
  await session(page);
  const person = { id: "employee-context", fullNameAr: "موظف الملف", department: "العمليات", jobTitle: "مشرف", startDate: "2026-10-01", workLocation: "صنعاء", phoneE164: "", status: "active", version: 1, createdAt: "2026-10-01T00:00:00Z" };
  await page.route("**/api/hr/employees?**", (route) => route.fulfill({ json: { items: [person, { ...person, id: "employee-other", fullNameAr: "موظف آخر" }] } }));
  await page.route("**/api/hr/access-requests?**", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/hr/employees");
  const trigger = page.getByRole("button", { name: "فتح ملف موظف الملف", exact: true });
  await trigger.click();
  const file = page.getByRole("dialog", { name: "تفاصيل الموظف", exact: true });
  await expect(file).toBeVisible();
  await file.getByRole("button", { name: "تعديل البيانات", exact: true }).click();
  await file.getByLabel("موقع العمل", { exact: true }).fill("مسودة موقع محفوظة");
  await file.press("Escape");
  await expect(file).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(file.getByLabel("موقع العمل", { exact: true })).toHaveValue("مسودة موقع محفوظة");
  await file.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.getByRole("button", { name: "فتح ملف موظف آخر", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "فتح ملف موظف آخر", exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "الاحتفاظ بالملف الحالي", exact: true }).click();
  await trigger.click();
  await expect(file.getByLabel("موقع العمل", { exact: true })).toHaveValue("مسودة موقع محفوظة");
});
