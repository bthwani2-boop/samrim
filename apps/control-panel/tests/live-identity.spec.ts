import { randomInt, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required for live Identity browser proof");
  return value;
}

async function jsonRequest(base: string, pathname: string, token: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5_000),
  });
  return { response, body: await response.json().catch(() => null) as Record<string, any> | null };
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
      // Delivery is asynchronous; continue through the bounded proof window.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(purpose + " challenge was not delivered to Mailpit");
}

async function prepareOperator(identityBase: string, controlToken: string, bootstrapToken: string): Promise<{ phone: string; token: string }> {
  const search = await fetch(identityBase + "/internal/actor-roles/search?role=operator&limit=10", { headers: { Accept: "application/json", Authorization: "Bearer " + controlToken }, signal: AbortSignal.timeout(5_000) });
  const searchBody = await search.json() as { items?: Array<{ actorId: string; phoneE164: string }> };
  const existing = searchBody.items?.[0];
  if (!existing) {
    const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
    const bootstrap = await jsonRequest(identityBase, "/internal/bootstrap/operator", bootstrapToken, { phoneE164: phone, role: "operator" });
    expect(bootstrap.response.status, "fresh operator bootstrap must succeed").toBe(201);
    expect(bootstrap.body?.role?.role).toBe("operator");
    return { phone, token: String(bootstrap.body?.enrollmentToken?.code) };
  }

  const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
  const provision = await jsonRequest(identityBase, "/internal/actor-roles/provision", controlToken, { phoneE164: phone, role: "operator" }, { "X-Acting-Actor-ID": existing.actorId });
  expect(provision.response.status, "governed operator provisioning must succeed").toBe(201);
  const enrollment = await fetch(identityBase + "/internal/operator-enrollment-tokens", {
    method: "POST",
    headers: { Accept: "application/json", Authorization: "Bearer " + controlToken, "X-Acting-Actor-ID": existing.actorId, "Content-Type": "application/json" },
    body: JSON.stringify({ phoneE164: phone, role: "operator" }),
    signal: AbortSignal.timeout(5_000),
  });
  expect(enrollment.status, "governed operator enrollment token must be issued").toBe(201);
  const enrollmentBody = await enrollment.json() as { code?: string };
  return { phone, token: String(enrollmentBody.code) };
}

test("@live operator passkey registration, authentication and governed recovery survive browser readback", async ({ page }) => {
  test.setTimeout(60_000);
  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const mailpitBase = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const bootstrapToken = requiredEnv("PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN");
  const operator = await prepareOperator(identityBase, controlToken, bootstrapToken);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await page.getByRole("button", { name: "تفعيل حساب موظف" }).click();
  await page.getByLabel("رقم الهاتف").fill(operator.phone);
  await page.getByLabel("دعوة التفعيل عالية الأمان").fill(operator.token);
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  const enrollmentCode = await waitForMailpitCode(mailpitBase, operator.phone, "operator_enroll");
  await page.getByLabel("رمز إثبات الهاتف").fill(enrollmentCode);
  await page.getByRole("button", { name: "إثبات الهاتف وتسجيل مفتاح المرور" }).click();
  await expect(page.getByRole("heading", { name: "احفظ هذا الاعتماد الآن" })).toBeVisible();
  const firstRecoveryCredential = await page.locator(".code-output").textContent();
  expect(firstRecoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  await page.getByRole("button", { name: "حفظت الاعتماد وفتح لوحة التحكم" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "أهلاً بك في مساحة العمل" })).toBeVisible();
  const firstSession = await page.evaluate(async () => { const response = await fetch("/api/auth/session", { cache: "no-store" }); return { status: response.status, body: await response.json() }; });
  expect(firstSession.status).toBe(200);
  expect(firstSession.body.identity.role).toBe("operator");
  expect(firstSession.body.identity.surface).toBe("control-panel");

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await page.getByRole("button", { name: "الدخول بمفتاح المرور" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("المشغل", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByRole("button", { name: "استرداد الوصول" }).click();
  await page.getByLabel("رقم الهاتف").fill(operator.phone);
  await page.getByLabel("اعتماد الاسترداد").fill(String(firstRecoveryCredential));
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  const recoveryCode = await waitForMailpitCode(mailpitBase, operator.phone, "operator_recover");
  await page.getByLabel("رمز إثبات الهاتف").fill(recoveryCode);
  await page.getByRole("button", { name: "إثبات الهاتف وتسجيل مفتاح مرور بديل" }).click();
  await expect(page.getByRole("heading", { name: "احفظ هذا الاعتماد الآن" })).toBeVisible();
  const replacementRecoveryCredential = await page.locator(".code-output").textContent();
  expect(replacementRecoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  expect(replacementRecoveryCredential).not.toBe(firstRecoveryCredential);
  await page.getByRole("button", { name: "حفظت الاعتماد وفتح لوحة التحكم" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  const recoveredSession = await page.evaluate(async () => { const response = await fetch("/api/auth/session", { cache: "no-store" }); return { status: response.status, body: await response.json() }; });
  expect(recoveredSession.status).toBe(200);
  expect(recoveredSession.body.identity.role).toBe("operator");
  expect(recoveredSession.body.identity.surface).toBe("control-panel");
});
