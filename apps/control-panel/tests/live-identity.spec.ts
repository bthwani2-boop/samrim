import { randomInt, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required for live Identity browser proof");
  return value;
}

async function waitForMailpitCode(mailpitBaseUrl: string, phone: string, purpose: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(mailpitBaseUrl + "/view/latest.txt", {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const message = await response.text();
        if (message.includes("Phone: " + phone) && message.includes("Purpose: " + purpose)) {
          const match = message.match(/Code:\s*(\d{6})/);
          if (match?.[1]) return match[1];
        }
      }
    } catch {
      // Delivery is asynchronous; retry until the bounded proof window closes.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(purpose + " challenge was not delivered to Mailpit for the expected phone");
}

test("@live platform owner MFA persists through reload and logout revokes the live session", async ({ page }) => {
  test.setTimeout(45_000);

  const identityBaseUrl = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const mailpitBaseUrl = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const bootstrapToken = requiredEnv("PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN");
  const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
  const password = "Owner-" + randomUUID() + "-Aa1!";

  const bootstrap = await fetch(identityBaseUrl + "/internal/bootstrap/platform-owner", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + bootstrapToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phoneE164: phone, password }),
    signal: AbortSignal.timeout(5_000),
  });
  expect(bootstrap.status, "platform-owner bootstrap must succeed on a fresh integration database").toBe(201);

  await page.goto("/");
  await page.getByLabel("الدور").selectOption("platform_owner");
  await page.getByLabel("رقم الهاتف").fill(phone);
  await page.getByRole("button", { name: "متابعة" }).click();

  await expect(page.getByRole("heading", { name: "تسجيل دخول لوحة التحكم" })).toBeVisible();
  await page.getByLabel(/^كلمة المرور/).fill(password);
  await page.getByRole("button", { name: "متابعة إلى التحقق الثاني" }).click();

  await expect(page.getByRole("heading", { name: "تحقق من الجهاز الثاني" })).toBeVisible();
  const code = await waitForMailpitCode(mailpitBaseUrl, phone, "operator_mfa");
  await page.getByLabel("رمز تحقق الهاتف").fill(code);
  await page.getByRole("button", { name: "إكمال تسجيل الدخول" }).click();

  await expect(page.getByRole("heading", { name: "أهلاً بك في مساحة العمل" })).toBeVisible();
  await expect(page.getByText("مالك المنصة", { exact: true }).first()).toBeVisible();

  const authenticatedReadback = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
  expect(authenticatedReadback.status).toBe(200);
  expect(authenticatedReadback.body.identity.role).toBe("platform_owner");
  expect(authenticatedReadback.body.identity.surface).toBe("control-panel");

  await page.getByRole("link", { name: "الحسابات والأدوار" }).click();
  await expect(page).toHaveURL(/\/access$/);
  await expect(page.getByRole("heading", { name: "الحسابات والأدوار" })).toBeVisible();

  const managedPhone = "+9678" + String(randomInt(10_000_000, 99_999_999));
  const accountStatus = page.locator("section.access-card > div.managed-status").first();
  await page.getByLabel("رقم الهاتف", { exact: false }).last().fill(managedPhone);
  await expect(accountStatus).toContainText("لا يوجد حساب مهيأ لهذا الدور.");
  await page.getByRole("button", { name: "تهيئة الدور" }).click();
  await expect(accountStatus).toContainText("الدور مهيأ ولم يكتمل تفعيله بعد.");
  await expect(accountStatus).toContainText("الدور مفعّل · الهوية مسموحة");

  const managedReadback = await page.evaluate(async (phoneValue) => {
    const params = new URLSearchParams({ phone: phoneValue, role: "partner" });
    const response = await fetch("/api/access/managed-user/status?" + params.toString(), { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, managedPhone);
  expect(managedReadback.status).toBe(200);
  expect(managedReadback.body.role).toBe("partner");
  expect(managedReadback.body.exists).toBe(true);
  expect(managedReadback.body.enabled).toBe(true);
  expect(managedReadback.body.securityEnabled).toBe(true);
  expect(managedReadback.body.activated).toBe(false);
  expect(managedReadback.body.actorId).toEqual(expect.any(String));

  const partnerPassword = "Partner-" + randomUUID() + "-Aa1!";
  const activationRequest = await fetch(identityBaseUrl + "/auth/managed/activation/request", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ phone: managedPhone, role: "partner" }),
    signal: AbortSignal.timeout(5_000),
  });
  expect(activationRequest.status, "managed Partner activation challenge must be issued").toBe(201);
  const activationCode = await waitForMailpitCode(mailpitBaseUrl, managedPhone, "managed_activate");
  const activation = await fetch(identityBaseUrl + "/auth/managed/activate", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: managedPhone,
      role: "partner",
      verificationCode: activationCode,
      password: partnerPassword,
      deviceFingerprint: "control-panel-live-partner-" + randomUUID(),
    }),
    signal: AbortSignal.timeout(5_000),
  });
  expect(activation.status, "managed Partner activation must succeed").toBe(200);
  const activationBody = await activation.json() as { accessToken?: unknown; identity?: { role?: unknown; surface?: unknown } };
  expect(activationBody.accessToken).toEqual(expect.any(String));
  expect(activationBody.identity?.role).toBe("partner");
  expect(activationBody.identity?.surface).toBe("app-partner");

  await page.getByRole("link", { name: "تهيئة الشركاء" }).click();
  await expect(page).toHaveURL(/\/partners$/);
  await expect(page.getByRole("heading", { name: "تهيئة الشركاء" })).toBeVisible();

  const storeName = "متجر إثبات " + randomUUID().slice(0, 8);
  const bootstrapResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/partners/bootstrap") && response.request().method() === "POST");
  await page.getByLabel("رقم هاتف الشريك").fill(managedPhone);
  await page.getByLabel("اسم المتجر الأول").fill(storeName);
  await page.getByRole("button", { name: "إنشاء المنظمة والمتجر" }).click();
  const bootstrapResponse = await bootstrapResponsePromise;
  const bootstrapBody = await bootstrapResponse.json() as {
    partnerOrganization?: { id?: unknown; ownerActorId?: unknown };
    firstStore?: { id?: unknown; partnerOrganizationId?: unknown; name?: unknown };
    idempotentReplay?: unknown;
  };
  expect(bootstrapResponse.status(), `Control Panel Partner Bootstrap must create the canonical DSH records: ${JSON.stringify(bootstrapBody)}`).toBe(201);
  expect(bootstrapBody.idempotentReplay).toBe(false);
  expect(bootstrapBody.partnerOrganization?.id).toEqual(expect.any(String));
  expect(bootstrapBody.partnerOrganization?.ownerActorId).toBe(managedReadback.body.actorId);
  expect(bootstrapBody.firstStore?.id).toEqual(expect.any(String));
  expect(bootstrapBody.firstStore?.partnerOrganizationId).toBe(bootstrapBody.partnerOrganization?.id);
  expect(bootstrapBody.firstStore?.name).toBe(storeName);

  const bootstrapStatus = page.locator('section[aria-labelledby="partner-bootstrap-title"] div[role="status"]');
  await expect(bootstrapStatus).toContainText("تم إنشاء التهيئة الكانونية");
  await expect(bootstrapStatus).toContainText(storeName);
  await expect(bootstrapStatus).toContainText(managedReadback.body.actorId);
  await expect(page.locator("p.identity-error")).toHaveCount(0);

  await page.goto("/access");
  await expect(page).toHaveURL(/\/access$/);
  await expect(page.getByRole("heading", { name: "الحسابات والأدوار" })).toBeVisible();
  const cleanupAccountStatus = page.locator("section.access-card > div.managed-status").first();
  await page.getByLabel("رقم الهاتف", { exact: false }).last().fill(managedPhone);
  await expect(cleanupAccountStatus).toContainText("يوجد تسجيل سابق لهذا الدور.");
  await expect(cleanupAccountStatus).toContainText("الدور مفعّل · الهوية مسموحة");
  await page.locator("#access-reason").fill("إثبات تهيئة الوصول المحلي");
  await page.getByRole("button", { name: "إيقاف الدور" }).click();
  await expect(cleanupAccountStatus).toContainText("الدور موقوف · الهوية مسموحة");

  const accountReadback = await page.evaluate(async (phone) => {
    const params = new URLSearchParams({ phone, role: "partner" });
    const response = await fetch("/api/access/managed-user/status?" + params.toString(), { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, managedPhone);
  expect(accountReadback.status).toBe(200);
  expect(accountReadback.body.role).toBe("partner");
  expect(accountReadback.body.exists).toBe(true);
  expect(accountReadback.body.enabled).toBe(false);
  expect(accountReadback.body.securityEnabled).toBe(true);
  expect(accountReadback.body.activated).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "الحسابات والأدوار" })).toBeVisible();

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "ابدأ برقم الهاتف" })).toBeVisible();

  const signedOutReadback = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    return response.status;
  });
  expect(signedOutReadback).toBe(401);
});
