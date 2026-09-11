import { randomInt, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required for live Identity browser proof");
  return value;
}

async function waitForMailpitCode(mailpitBaseUrl: string, phone: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(mailpitBaseUrl + "/view/latest.txt", {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const message = await response.text();
        if (message.includes("Phone: " + phone) && message.includes("Purpose: operator_mfa")) {
          const match = message.match(/Code:\s*(\d{6})/);
          if (match?.[1]) return match[1];
        }
      }
    } catch {
      // Delivery is asynchronous; retry until the bounded proof window closes.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("operator MFA challenge was not delivered to Mailpit for the expected phone");
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
  const code = await waitForMailpitCode(mailpitBaseUrl, phone);
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

  await page.locator("#access-reason").fill("إثبات تهيئة الوصول المحلي");
  await page.getByRole("button", { name: "إيقاف الدور" }).click();
  await expect(accountStatus).toContainText("الدور موقوف · الهوية مسموحة");

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
