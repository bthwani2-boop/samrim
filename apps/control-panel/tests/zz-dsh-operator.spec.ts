import { existsSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  assertIdentityProofScope,
  cleanupPreparedOperator,
  enableOperatorPermission,
  enableVirtualAuthenticator,
  findExistingOperator,
  type PreparedOperator,
  provisionIndependentOperator,
  registerOperator,
  requiredEnv,
} from "./live-identity-proof-helpers";

let preparedOperatorForCleanup: PreparedOperator | undefined;
let dshRuntimeFixturePath = "";

function validateRuntimeFixturePath(value: string): string {
  const runnerTemp = realpathSync(process.env.RUNNER_TEMP || os.tmpdir());
  const fixtureDirectory = realpathSync(path.dirname(value));
  const relativeDirectory = path.relative(runnerTemp, fixtureDirectory);
  const directoryMode = statSync(fixtureDirectory).mode & 0o777;
  if (
    path.basename(value) !== "dsh-checker-fixture.json" ||
    !path.basename(fixtureDirectory).startsWith("samrim-runtime-proof-") ||
    relativeDirectory.startsWith("..") ||
    path.isAbsolute(relativeDirectory) ||
    directoryMode !== 0o700
  ) {
    throw new Error("DSH checker fixture path must be inside the private runner-owned directory");
  }
  return value;
}

test.beforeAll(() => {
  assertIdentityProofScope();
  const fixturePath = process.env.DSH_RUNTIME_CHECKER_FIXTURE_PATH;
  if (fixturePath) dshRuntimeFixturePath = validateRuntimeFixturePath(fixturePath);
});

test.afterEach(() => {
  const operator = preparedOperatorForCleanup;
  preparedOperatorForCleanup = undefined;
  if (operator?.createdByTest && !(dshRuntimeFixturePath && existsSync(dshRuntimeFixturePath))) cleanupPreparedOperator(operator);
});

function validatedRuntimeFixtureValue(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== "string" || value.length > 128 || !pattern.test(value)) {
    throw new Error(`DSH checker fixture ${field} was not a canonical value`);
  }
  return value;
}

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
  const fixturePath = dshRuntimeFixturePath;
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
      const actorId = validatedRuntimeFixtureValue(independentOperator.actorId, "actor id", /^[A-Za-z][A-Za-z0-9_-]{0,127}$/);
      const profileId = validatedRuntimeFixtureValue(independentOperator.profileId, "profile id", /^[A-Za-z][A-Za-z0-9_-]{0,127}$/);
      const phone = validatedRuntimeFixtureValue(independentOperator.phone, "phone", /^\+[1-9][0-9]{7,14}$/);
      writeFileSync(fixturePath, JSON.stringify({
        actorId,
        profileId,
        phone,
        createdByTest: true,
      }), { encoding: "utf8", flag: "wx", mode: 0o600 });
      console.log("DSH_RUNTIME_CHECKER_FIXTURE=READY");
    }
  } finally {
    await independentContext.close();
  }
});
