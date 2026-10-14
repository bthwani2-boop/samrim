import { expect, type Page, test } from "@playwright/test";

type SessionReadback = Readonly<{
  status: number;
  body: Readonly<{
    identity?: Record<string, unknown>;
    error?: Readonly<{ code?: string }>;
  }>;
}>;

async function readSession(page: Page): Promise<SessionReadback> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
}

test("@live development password failure preserves the operator and the correct password opens its real session", async ({ page }) => {
  const password = process.env.PLAYWRIGHT_DEVELOPMENT_PASSWORD?.trim();
  const actorId = process.env.PLAYWRIGHT_DEVELOPMENT_OPERATOR_ACTOR_ID?.trim();
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (!password || !actorId || !baseUrl) {
    test.skip(true, "requires the isolated development-password proof runtime");
    return;
  }

  await page.goto(new URL("/", baseUrl).toString());
  await expect(page.getByRole("heading", { name: "الدخول بكلمة المرور" })).toBeVisible();
  await page.getByLabel("كلمة المرور").fill(`${password}.incorrect`);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("alert")).toContainText("كلمة مرور التطوير غير صحيحة.");
  const afterWrongPassword = await readSession(page);
  expect(afterWrongPassword.status).toBe(401);
  expect(afterWrongPassword.body.error?.code).toBe("UNAUTHENTICATED");
  expect((await page.context().cookies()).some((cookie) => cookie.name.endsWith("bt_identity_access") || cookie.name.endsWith("bt_identity_refresh"))).toBe(false);

  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("حساب المشغل", { exact: true })).toBeVisible();
  const authenticated = await readSession(page);
  expect(authenticated.status).toBe(200);
  const authenticatedIdentity = authenticated.body.identity;
  expect(authenticatedIdentity).toBeDefined();
  if (!authenticatedIdentity) throw new Error("development login did not return an operator identity");
  expect(authenticatedIdentity).toMatchObject({ subject: actorId, role: "operator", canManageOperatorPermissions: true });
  const permissions = authenticatedIdentity.permissions;
  expect(Array.isArray(permissions)).toBe(true);
  expect([...(permissions as string[])].sort()).toEqual(["catalog", "finance", "marketing", "operations", "partners", "platform_policies"]);

  await page.getByText("حساب المشغل", { exact: true }).click();
  const logoutResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/logout") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  expect((await logoutResponse).status()).toBe(204);
  await page.reload();
  await expect(page.getByRole("heading", { name: "الدخول بكلمة المرور" })).toBeVisible();
  const afterLogout = await readSession(page);
  expect(afterLogout.status).toBe(401);
});
