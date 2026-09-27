import { existsSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  assertIdentityProofScope,
  cleanupPreparedOperator,
  enableOperatorPermission,
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
  const fixturePath = process.env.DSH_RUNTIME_CHECKER_FIXTURE_PATH;
  if (operator?.createdByTest && !(fixturePath && existsSync(fixturePath))) cleanupPreparedOperator(operator);
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
  const fixturePath = process.env.DSH_RUNTIME_CHECKER_FIXTURE_PATH;
  if (fixturePath) {
    await enableOperatorPermission(identityBase, controlToken, primaryOperator.actorId, independentOperator.actorId, "operations");
    await enableOperatorPermission(identityBase, controlToken, primaryOperator.actorId, independentOperator.actorId, "finance");
  }
  const browser = page.context().browser();
  if (!browser) throw new Error("live Identity proof requires a browser instance for the independent operator fixture");
  const independentContext = await browser.newContext({ baseURL: baseUrl, locale: "ar-YE" });
  const independentPage = await independentContext.newPage();
  try {
    await enableVirtualAuthenticator(independentPage);
    await registerOperator(independentPage, independentOperator, baseUrl, mailpitBase);
    await expect(independentPage.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
    if (fixturePath) {
      if (process.env.CI !== "true" || process.env.BTHWANI_IDENTITY_PROOF_SCOPE !== "disposable-ci") {
        throw new Error("DSH checker fixture handoff requires the disposable CI proof scope");
      }
      if (!independentOperator.actorCreatedByTest || !independentOperator.actorId || !independentOperator.profileId) {
        throw new Error("DSH checker fixture must be an Operator created by this proof through profile review");
      }
      writeFileSync(fixturePath, JSON.stringify({
        actorId: independentOperator.actorId,
        profileId: independentOperator.profileId,
        phone: independentOperator.phone,
        createdByTest: true,
      }), { encoding: "utf8", flag: "wx", mode: 0o600 });
      console.log("DSH_RUNTIME_CHECKER_FIXTURE=READY");
    }
  } finally {
    await independentContext.close();
  }
});
