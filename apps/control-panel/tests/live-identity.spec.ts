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
      const response = await fetch(mailpitBaseUrl + "/view/latest.txt", { signal: AbortSignal.timeout(2_000) });
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

test("@live first operator MFA persists through reload and logout revokes the live session", async ({ page }) => {
  test.setTimeout(45_000);

  const identityBaseUrl = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const dshBaseUrl = requiredEnv("PLAYWRIGHT_DSH_API_BASE_URL").replace(/\/+$/, "");
  const mailpitBaseUrl = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const bootstrapToken = requiredEnv("PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN");
  const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
  const password = "Operator-" + randomUUID() + "-Aa1!";

  const bootstrap = await fetch(identityBaseUrl + "/internal/bootstrap/operator", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + bootstrapToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phoneE164: phone, role: "operator", password }),
    signal: AbortSignal.timeout(5_000),
  });
  expect(bootstrap.status, "first-operator bootstrap must succeed on a fresh integration database").toBe(201);
  const bootstrapBody = await bootstrap.json() as { role?: unknown };
  expect(bootstrapBody.role).toBe("operator");

  await page.goto("/");
  await expect(page.getByLabel("الدور")).toHaveCount(0);
  await page.getByLabel("رقم الهاتف").fill(phone);
  await page.getByRole("button", { name: "متابعة" }).click();

  await expect(page.getByRole("heading", { name: "تسجيل دخول لوحة التحكم" })).toBeVisible();
  await page.getByLabel(/^كلمة المرور/).fill(password);
  await page.getByRole("button", { name: "متابعة إلى التحقق الثاني" }).click();

  await expect(page.getByRole("heading", { name: "تحقق من الجهاز الثاني" })).toBeVisible({ timeout: 15_000 });
  const code = await waitForMailpitCode(mailpitBaseUrl, phone, "operator_mfa");
  await page.getByLabel("رمز تحقق الهاتف").fill(code);
  await page.getByRole("button", { name: "إكمال تسجيل الدخول" }).click();

  await expect(page.getByRole("heading", { name: "أهلاً بك في مساحة العمل" })).toBeVisible();
  await expect(page.getByText("المشغل", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("مالك المنصة", { exact: true })).toHaveCount(0);

  const authenticatedReadback = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
  expect(authenticatedReadback.status).toBe(200);
  expect(authenticatedReadback.body.identity.role).toBe("operator");
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
  const partnerAccessToken = String(activationBody.accessToken);

  await page.getByRole("link", { name: "تهيئة الشركاء" }).click();
  await expect(page).toHaveURL(/\/partners$/);
  await expect(page.getByRole("heading", { name: "تهيئة الشركاء" })).toBeVisible();

  const storeName = "متجر إثبات " + randomUUID().slice(0, 8);
  const bootstrapResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/partners/bootstrap") && response.request().method() === "POST");
  await page.getByLabel("رقم هاتف الشريك").fill(managedPhone);
  await page.getByLabel("اسم المتجر الأول").fill(storeName);
  await page.getByRole("button", { name: "إنشاء المتجر الأول" }).click();
  const bootstrapResponse = await bootstrapResponsePromise;
  const partnerBootstrapBody = await bootstrapResponse.json() as {
    partnerActorId?: unknown;
    firstStore?: { id?: unknown; partnerActorId?: unknown; name?: unknown; publicationState?: unknown; version?: unknown };
    idempotentReplay?: unknown;
  };
  expect(bootstrapResponse.status(), `Control Panel Partner Bootstrap must create the canonical DSH Store relationship: ${JSON.stringify(partnerBootstrapBody)}`).toBe(201);
  expect(partnerBootstrapBody.idempotentReplay).toBe(false);
  expect(partnerBootstrapBody.partnerActorId).toBe(managedReadback.body.actorId);
  expect(partnerBootstrapBody.firstStore?.id).toEqual(expect.any(String));
  expect(partnerBootstrapBody.firstStore?.partnerActorId).toBe(managedReadback.body.actorId);
  expect(partnerBootstrapBody.firstStore?.name).toBe(storeName);
  expect(partnerBootstrapBody.firstStore?.publicationState).toBe("unpublished");
  expect(partnerBootstrapBody.firstStore?.version).toBe(1);

  const storeID = String(partnerBootstrapBody.firstStore?.id);
  const partnerReadbackBefore = await fetch(dshBaseUrl + "/dsh/partner-bootstrap/self", {
    headers: { Accept: "application/json", Authorization: "Bearer " + partnerAccessToken },
    signal: AbortSignal.timeout(5_000),
  });
  const partnerBeforeBody = await partnerReadbackBefore.json() as { firstStore?: { publicationState?: unknown; version?: unknown } };
  expect(partnerReadbackBefore.status).toBe(200);
  expect(partnerBeforeBody.firstStore?.publicationState).toBe("unpublished");
  expect(partnerBeforeBody.firstStore?.version).toBe(1);

  const partnerPublishAttempt = await fetch(dshBaseUrl + `/dsh/stores/${storeID}/publication`, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: "Bearer " + partnerAccessToken, "X-Acting-Actor-ID": String(managedReadback.body.actorId), "X-Correlation-ID": "partner-self-publish", "X-Expected-Version": "1", "Idempotency-Key": "partner-self-publish-1", "Content-Type": "application/json" },
    body: JSON.stringify({ state: "published" }),
    signal: AbortSignal.timeout(5_000),
  });
  expect(partnerPublishAttempt.status, "Partner user access must not reach operator publication boundary").toBe(401);

  const bootstrapStatus = page.locator('section[aria-labelledby="partner-bootstrap-title"] div[role="status"]');
  await expect(bootstrapStatus).toContainText("تم إنشاء التهيئة الكانونية");
  await expect(bootstrapStatus).toContainText(storeName);
  await expect(bootstrapStatus).toContainText(managedReadback.body.actorId);
  await expect(page.locator("p.identity-error")).toHaveCount(0);

  const publishResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/stores/${storeID}/publication`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "نشر المتجر" }).click();
  const publishResponse = await publishResponsePromise;
  const publishBody = await publishResponse.json() as { store?: { publicationState?: unknown; version?: unknown }; idempotentReplay?: unknown };
  expect(publishResponse.status(), `Control Panel Store publication must commit canonical state: ${JSON.stringify(publishBody)}`).toBe(200);
  expect(publishBody.store?.publicationState).toBe("published");
  expect(publishBody.store?.version).toBe(2);
  expect(publishBody.idempotentReplay).toBe(false);
  await expect(bootstrapStatus).toContainText("حالة النشر الكانونية: published");

  const publicListAfterPublish = await fetch(dshBaseUrl + "/dsh/public/stores", { signal: AbortSignal.timeout(5_000) });
  const publicListBody = await publicListAfterPublish.json() as { stores?: Array<{ id?: unknown; partnerActorId?: unknown }> };
  expect(publicListAfterPublish.status).toBe(200);
  const publicStore = publicListBody.stores?.find((store) => store.id === storeID);
  expect(publicStore).toBeDefined();
  expect(publicStore?.partnerActorId).toBeUndefined();
  const partnerReadbackAfter = await fetch(dshBaseUrl + "/dsh/partner-bootstrap/self", {
    headers: { Accept: "application/json", Authorization: "Bearer " + partnerAccessToken },
    signal: AbortSignal.timeout(5_000),
  });
  const partnerAfterBody = await partnerReadbackAfter.json() as { firstStore?: { publicationState?: unknown; version?: unknown } };
  expect(partnerReadbackAfter.status).toBe(200);
  expect(partnerAfterBody.firstStore?.publicationState).toBe("published");
  expect(partnerAfterBody.firstStore?.version).toBe(2);

  const hideResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/stores/${storeID}/publication`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "إخفاء المتجر" }).click();
  const hideResponse = await hideResponsePromise;
  const hideBody = await hideResponse.json() as { store?: { publicationState?: unknown; version?: unknown } };
  expect(hideResponse.status()).toBe(200);
  expect(hideBody.store?.publicationState).toBe("hidden");
  expect(hideBody.store?.version).toBe(3);
  const publicDetailAfterHide = await fetch(dshBaseUrl + `/dsh/public/stores/${storeID}`, { signal: AbortSignal.timeout(5_000) });
  expect(publicDetailAfterHide.status).toBe(404);

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

  const accountReadback = await page.evaluate(async (phoneValue) => {
    const params = new URLSearchParams({ phone: phoneValue, role: "partner" });
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
