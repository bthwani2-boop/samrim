import { randomInt } from "node:crypto";
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
  jsonRequest,
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

async function findOrBootstrapPrimaryOperator(
  identityBase: string,
  controlToken: string,
  bootstrapToken: string,
): Promise<PreparedOperator> {
  const response = await fetch(identityBase + "/internal/actor-roles/search?role=operator&limit=2", {
    headers: { Accept: "application/json", Authorization: "Bearer " + controlToken },
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.status, "primary operator search must succeed for the DSH fixture").toBe(200);
  const body = await response.json() as { items?: Array<{ actorId: string; phoneE164: string }> };
  const operators = body.items ?? [];
  if (operators.length > 1) {
    throw new Error(`DSH checker fixture requires deterministic primary Operator selection; found ${operators.length}`);
  }
  if (operators.length === 1) return findExistingOperator(identityBase, controlToken);

  if (process.env.BTHWANI_IDENTITY_PROOF_SCOPE !== "disposable-ci" || process.env.CI !== "true") {
    throw new Error("DSH checker fixture requires an existing primary operator outside disposable CI");
  }

  const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
  const bootstrap = await jsonRequest(
    identityBase,
    "/internal/bootstrap/operator",
    bootstrapToken,
    { phoneE164: phone, role: "operator" },
  );
  expect(bootstrap.response.status, "fresh disposable CI must bootstrap its primary operator").toBe(201);
  expect(bootstrap.body?.role?.role).toBe("operator");
  const actorId = String(bootstrap.body?.role?.actorId || "");
  const enrollmentToken = String(bootstrap.body?.enrollmentToken?.code || "");
  expect(actorId).toMatch(/^act_/);
  expect(enrollmentToken).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  return {
    actorId,
    phone,
    token: enrollmentToken,
    profileId: "",
    actorCreatedByTest: false,
    createdByTest: false,
  };
}

test("@live provision and activate an independent operator for downstream DSH separation proof", async ({ page }) => {
  test.setTimeout(60_000);
  if (process.env.CI === "true") {
    test.skip(!dshRuntimeFixturePath, "DSH checker fixture is owned by the DSH runtime lane in CI");
    test.skip(existsSync(dshRuntimeFixturePath), "DSH checker fixture was already prepared by its dedicated runtime target");
  }

  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const bootstrapToken = requiredEnv("PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN");
  const baseUrl = requiredEnv("PLAYWRIGHT_BASE_URL").replace(/\/+$/, "");
  const mailpitBase = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const primaryOperator = await findOrBootstrapPrimaryOperator(identityBase, controlToken, bootstrapToken);
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
