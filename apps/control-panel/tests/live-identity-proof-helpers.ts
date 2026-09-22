import { randomInt } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export type PreparedOperator = {
  actorId: string;
  phone: string;
  token: string;
  createdByTest: boolean;
};

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required for live Identity browser proof");
  return value;
}

export async function jsonRequest(base: string, pathname: string, token: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5_000),
  });
  return { response, body: await response.json().catch(() => null) as Record<string, any> | null };
}

export async function findExistingOperator(identityBase: string, controlToken: string): Promise<PreparedOperator> {
  const response = await fetch(identityBase + "/internal/actor-roles/search?role=operator&limit=10", {
    headers: { Accept: "application/json", Authorization: "Bearer " + controlToken },
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.status, "an established primary operator must exist for the DSH fixture").toBe(200);
  const body = await response.json() as { items?: Array<{ actorId: string; phoneE164: string }> };
  const existing = body.items?.[0];
  expect(existing?.actorId).toMatch(/^act_/);
  expect(existing?.phoneE164).toMatch(/^\+9677/);
  return { actorId: String(existing?.actorId), phone: String(existing?.phoneE164), token: "", createdByTest: false };
}

export async function provisionIndependentOperator(identityBase: string, controlToken: string, actingOperatorID: string): Promise<PreparedOperator> {
  const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
  const provision = await jsonRequest(identityBase, "/internal/actor-roles/provision", controlToken, { phoneE164: phone, role: "operator" }, { "X-Acting-Actor-ID": actingOperatorID });
  expect(provision.response.status, "independent operator provisioning must succeed").toBe(201);
  const actorId = String(provision.body?.actorId || "");
  expect(actorId).toMatch(/^act_/);
  const enrollment = await jsonRequest(identityBase, "/internal/operator-enrollment-tokens", controlToken, { phoneE164: phone, role: "operator" }, { "X-Acting-Actor-ID": actingOperatorID });
  expect(enrollment.response.status, "independent operator enrollment token must be issued").toBe(201);
  const token = String(enrollment.body?.code || "");
  expect(token).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  return { actorId, phone, token, createdByTest: true };
}

export async function waitForMailpitCode(mailpitBaseUrl: string, phone: string, purpose: string): Promise<string> {
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

export async function enableVirtualAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
}

export async function registerOperator(page: Page, operator: PreparedOperator, baseUrl: string, mailpitBase: string): Promise<string> {
  await page.goto(baseUrl + "/");
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await page.getByRole("button", { name: "تفعيل حساب موظف" }).click();
  await page.getByLabel("رقم الهاتف").fill(operator.phone);
  await page.getByLabel("دعوة التفعيل عالية الأمان").fill(operator.token);
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  const enrollmentCode = await waitForMailpitCode(mailpitBase, operator.phone, "operator_enroll");
  await page.getByLabel("رمز إثبات الهاتف").fill(enrollmentCode);
  await page.getByRole("button", { name: "إثبات الهاتف وتسجيل مفتاح المرور" }).click();
  await expect(page.getByRole("heading", { name: "احفظ هذا الاعتماد الآن" })).toBeVisible();
  const recoveryCredential = await page.locator(".code-output").textContent();
  expect(recoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  await page.getByRole("button", { name: "حفظت الاعتماد وفتح لوحة التحكم" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  return String(recoveryCredential);
}
