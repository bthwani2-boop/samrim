import { expect, test } from "@playwright/test";
import {
  assertIdentityProofScope,
  cleanupPreparedOperator,
  enableVirtualAuthenticator,
  findExistingOperator,
  provisionIndependentOperator,
  registerOperator,
  requiredEnv,
  type PreparedOperator,
} from "./live-identity-proof-helpers";

let preparedOperatorForCleanup: PreparedOperator | undefined;

test.beforeAll(() => {
  assertIdentityProofScope();
});

test.afterEach(() => {
  const operator = preparedOperatorForCleanup;
  preparedOperatorForCleanup = undefined;
  if (operator?.createdByTest) cleanupPreparedOperator(operator);
});

test("@live provision and activate an independent operator for downstream DSH separation proof", async ({ page }) => {
  test.setTimeout(60_000);
  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const baseUrl = requiredEnv("PLAYWRIGHT_BASE_URL").replace(/\/+$/, "");
  const mailpitBase = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const primaryOperator = await findExistingOperator(identityBase, controlToken);
  const independentOperator = await provisionIndependentOperator(identityBase, controlToken, primaryOperator.actorId, (operator) => {
    preparedOperatorForCleanup = operator;
  });
  const browser = page.context().browser();
  if (!browser) throw new Error("live Identity proof requires a browser instance for the independent operator fixture");
  const independentContext = await browser.newContext({ baseURL: baseUrl, locale: "ar-YE" });
  const independentPage = await independentContext.newPage();
  try {
    await enableVirtualAuthenticator(independentPage);
    await registerOperator(independentPage, independentOperator, baseUrl, mailpitBase);
    await expect(independentPage.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  } finally {
    await independentContext.close();
  }
});
