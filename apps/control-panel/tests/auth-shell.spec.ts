import { expect, type Page, test } from "@playwright/test";

async function stubSession(page: Page, status: number) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 401 ? { error: { code: "UNAUTHENTICATED" } } : { error: { code: "IDENTITY_UNAVAILABLE" } }),
    });
  });
}

const authenticatedOperator = {
  subject: "actor-operator",
  sessionId: "session-operator",
  role: "operator",
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function stubAuthenticatedSession(page: Page) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: authenticatedOperator }) });
  });
}

test("signed-out access to a protected workspace route returns to the identity surface", async ({ page }) => {
  await stubSession(page, 401);
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "ابدأ برقم الهاتف" })).toBeVisible();
});

test("authenticated operator discovers access and partner responsibilities through workspace navigation", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "أهلاً بك في مساحة العمل" })).toBeVisible();
  await expect(page.getByText("مشغل لوحة التحكم", { exact: true }).first()).toBeVisible();
  const accessLink = page.getByRole("link", { name: "الحسابات والأدوار" });
  await expect(accessLink).toBeVisible();
  await accessLink.click();
  await expect(page).toHaveURL(/\/access$/);
  await expect(accessLink).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "الحسابات والأدوار" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "تهيئة أو إيقاف الحساب" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#workspace-main")).toBeFocused();

  await page.reload();
  await expect(page.getByRole("heading", { name: "الحسابات والأدوار" })).toBeVisible();
});

test("operator direct navigation to access exposes the canonical access capability", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.goto("/access");
  await expect(page.getByRole("heading", { name: "الحسابات والأدوار" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "تهيئة أو إيقاف الحساب" })).toBeVisible();
});

test("partner bootstrap resolves the actor id from the partner phone", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let requestBody: unknown;
  await page.route("**/api/partners/bootstrap", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        partnerOrganization: { id: "org_test", ownerActorId: "act_generated" },
        firstStore: { id: "store_test", partnerOrganizationId: "org_test", name: "متجر الاختبار" },
        idempotentReplay: false,
      }),
    });
  });

  await page.goto("/partners");
  await expect(page.getByRole("heading", { name: "تهيئة الشركاء" })).toBeVisible();
  await expect(page.getByLabel("معرّف Actor الشريك")).toHaveCount(0);
  await expect(page.getByLabel("رقم هاتف الشريك")).toBeVisible();

  await page.getByLabel("رقم هاتف الشريك").fill("96777000100");
  await page.getByLabel("اسم المتجر الأول").fill("متجر الاختبار");
  await page.getByRole("button", { name: "إنشاء المنظمة والمتجر" }).click();

  await expect(page.getByRole("status")).toContainText("مولّد تلقائيًا من Identity");
  expect(requestBody).toEqual({ partnerPhone: "96777000100", storeName: "متجر الاختبار" });
});

test("authenticated workspace keeps navigation meaning across light and dark themes", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/workspace");

  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.getByRole("link", { name: "الحسابات والأدوار" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("id", "workspace-main");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await expect(page.getByRole("link", { name: "الحسابات والأدوار" })).toBeVisible();
});

test("phone-first operator sign-in exposes no human-role selector and reaches the second step", async ({ page }) => {
  await stubSession(page, 401);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ابدأ برقم الهاتف" })).toBeVisible();
  await expect(page.getByLabel("الدور")).toHaveCount(0);
  await expect(page.getByText("مالك المنصة", { exact: true })).toHaveCount(0);
  await page.getByLabel("رقم الهاتف").fill("96777000100");
  await page.getByRole("button", { name: "متابعة" }).click();

  await expect(page.getByRole("heading", { name: "تسجيل دخول لوحة التحكم" })).toBeVisible();
  await expect(page.getByText("الدور: مشغل لوحة التحكم", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^كلمة المرور/ })).toBeVisible();
  const password = page.locator("#operator-password");
  await expect(page.getByRole("button", { name: "إظهار كلمة المرور" })).toBeVisible();
  await page.getByRole("button", { name: "إظهار كلمة المرور" }).click();
  await expect(password).toHaveAttribute("type", "text");
});

test("identity service failure is exposed as an alert with a recovery action", async ({ page }) => {
  await stubSession(page, 503);
  await page.goto("/");
  await expect(page.locator("section[role=alert]")).toContainText("تعذر الوصول إلى الهوية");
  await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();
});

test("recovery success is a status and returns to the canonical login journey", async ({ page }) => {
  await stubSession(page, 401);
  await page.route("**/api/auth/recovery/start", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ challenge: { id: "challenge" } }) });
  });
  await page.route("**/api/auth/recovery/complete", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "recovery_complete" }) });
  });
  await page.goto("/");

  await page.getByLabel("رقم الهاتف").fill("96777000100");
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.getByRole("button", { name: "نسيت كلمة المرور؟" })).toBeVisible();
  await page.getByRole("button", { name: "نسيت كلمة المرور؟" }).click();
  await page.getByRole("button", { name: "إرسال رمز الاسترداد" }).click();
  await page.getByLabel("رمز تحقق الهاتف").fill("123456");
  await page.getByLabel("كلمة المرور الجديدة").fill("A-valid-password-123");
  await page.getByLabel("تأكيد كلمة المرور").fill("A-valid-password-123");
  await page.getByRole("button", { name: "تغيير كلمة المرور" }).click();

  await expect(page.getByRole("status")).toContainText("تم تغيير كلمة المرور");
  await expect(page.locator("p.identity-error")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "ابدأ برقم الهاتف" })).toBeVisible();
});

test("remote logout failure keeps local sign-out and remains observable", async ({ page }) => {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: authenticatedOperator }) });
  });
  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "IDENTITY_UNAVAILABLE" } }) });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "أهلاً بك في مساحة العمل" })).toBeVisible();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "ابدأ برقم الهاتف" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("تعذر تأكيد إبطال الجلسة");
  await expect(page.locator("p.identity-error")).toHaveCount(0);
});

test("production security headers and cross-origin mutation guard are active", async ({ page }) => {
  const cspMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|csp/i.test(message.text())) cspMessages.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/content security policy|csp/i.test(error.message)) cspMessages.push(error.message);
  });

  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"] ?? "";

  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(headers["strict-transport-security"]).toContain("max-age=63072000");
  expect(headers["x-frame-options"]).toBe("DENY");

  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const renderedNonces = await page.locator("script[nonce]").evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(renderedNonces.length).toBeGreaterThan(0);
  expect(new Set(renderedNonces)).toEqual(new Set([nonce]));

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: /ابدأ برقم الهاتف|تعذر الوصول إلى الهوية/ })).toBeVisible();
  expect(cspMessages).toEqual([]);

  const crossOriginResponse = await page.request.post("/api/auth/logout", {
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
  });
  expect(crossOriginResponse.status()).toBe(403);

  const sameOriginBrowserResponse = await page.request.post("/api/auth/logout", { headers: { Referer: page.url() } });
  expect(sameOriginBrowserResponse.status()).not.toBe(403);
});

test("rendered light and dark themes preserve RTL and keyboard focus", async ({ page }) => {
  await stubSession(page, 401);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByLabel("رقم الهاتف").fill("96777000100");
  const continueButton = page.getByRole("button", { name: "متابعة" });
  await continueButton.focus();
  await expect(continueButton).toBeFocused();

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
