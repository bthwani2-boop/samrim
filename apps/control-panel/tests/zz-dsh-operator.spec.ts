import { expect, test } from "@playwright/test";
import {
  enableVirtualAuthenticator,
  findExistingOperator,
  provisionIndependentOperator,
  registerOperator,
  requiredEnv,
} from "./live-identity-proof-helpers";

test.beforeAll(() => {
  if (process.env.CI !== "true" || process.env.BTHWANI_IDENTITY_PROOF_SCOPE !== "disposable-ci") {
    throw new Error("DSH operator proof requires explicitly disposable CI state");
  }
});

test("@live provision and activate an independent operator for downstream DSH separation proof", async ({ page }) => {
  test.setTimeout(60_000);
  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const baseUrl = requiredEnv("PLAYWRIGHT_BASE_URL").replace(/\/+$/, "");
  const mailpitBase = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const primaryOperator = await findExistingOperator(identityBase, controlToken);
  const independentOperator = await provisionIndependentOperator(identityBase, controlToken, primaryOperator.actorId);
  const browser = page.context().browser();
  if (!browser) throw new Error("live Identity proof requires a browser instance for the independent operator fixture");
  const independentContext = await browser.newContext({ baseURL: baseUrl, locale: "ar-YE" });
  const independentPage = await independentContext.newPage();
  try {
    await enableVirtualAuthenticator(independentPage);
    // Development fallback may select the sole ready primary Operator before the
    // disposable role is activated. End that real session in this context so its
    // device is explicitly suppressed before the enrollment journey starts.
    await independentPage.goto(baseUrl + "/");
    await expect(independentPage).toHaveURL(/\/workspace$/);
    await independentPage.getByText("حساب المشغل", { exact: true }).click();
    await independentPage.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(independentPage.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
    await registerOperator(independentPage, independentOperator, baseUrl, mailpitBase);
    await expect(independentPage.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  } finally {
    await independentContext.close();
  }
});
