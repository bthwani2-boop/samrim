import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  assertIdentityProofScope,
  enableOperatorPermission,
  enableVirtualAuthenticator,
  findInitialOperator,
  jsonRequest,
  type PreparedOperator,
  provisionIndependentOperator,
  registerOperator,
  requiredEnv,
} from "./live-identity-proof-helpers";

let dshRuntimeFixturePath = "";

function isPrivateWindowsFixtureDirectory(directory: string): boolean {
  const currentUser = `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`.toLowerCase();
  if (!currentUser || !process.env.SystemRoot) return false;

  let output: string;
  try {
    const icacls = path.join(process.env.SystemRoot, "System32", "icacls.exe");
    output = execFileSync(icacls, [directory], { encoding: "utf8", windowsHide: true });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "unknown")
      : "unknown";
    throw new Error(`Windows fixture ACL inspection failed (${code})`);
  }

  const entries = output.split(/\r?\n/).flatMap((rawLine) => {
    const directoryOffset = rawLine.toLowerCase().indexOf(directory.toLowerCase());
    const line = directoryOffset < 0
      ? rawLine
      : rawLine.slice(directoryOffset + directory.length).trim();
    const separator = line.indexOf(":");
    if (separator < 1) return [];
    const permissions = line.slice(separator + 1).trim();
    return permissions.startsWith("(")
      ? [{ principal: line.slice(0, separator).trim().toLowerCase(), permissions }]
      : [];
  });
  const allowedPrincipals = new Set([currentUser, "nt authority\\system", "builtin\\administrators"]);
  const hasUser = entries.some((entry) => entry.principal === currentUser);
  const hasSystem = entries.some((entry) => entry.principal === "nt authority\\system");
  const hasAdministrators = entries.some((entry) => entry.principal === "builtin\\administrators");
  const allAllowed = entries.every((entry) => allowedPrincipals.has(entry.principal));
  const fullControl = entries.every((entry) => entry.permissions.includes("(F)"));
  const explicit = entries.every((entry) => !entry.permissions.includes("(I)"));
  if (entries.length < 2 || entries.length > allowedPrincipals.size || !hasUser || !hasAdministrators || !allAllowed || !fullControl || !explicit) {
    throw new Error(`Windows fixture ACL is not private (entries=${entries.length}, user=${hasUser}, system=${hasSystem}, administrators=${hasAdministrators}, allowed=${allAllowed}, fullControl=${fullControl}, explicit=${explicit})`);
  }
  return true;
}

function validateRuntimeFixturePath(value: string): string {
  const runnerTemp = realpathSync(process.env.RUNNER_TEMP || os.tmpdir());
  const fixtureDirectory = realpathSync(path.dirname(value));
  const relativeDirectory = path.relative(runnerTemp, fixtureDirectory);
  const directoryMode = statSync(fixtureDirectory).mode & 0o777;
  const privateDirectory = process.platform === "win32"
    ? isPrivateWindowsFixtureDirectory(fixtureDirectory)
    : directoryMode === 0o700;
  const expectedFileName = path.basename(value) === "dsh-checker-fixture.json";
  const expectedDirectoryName = path.basename(fixtureDirectory).startsWith("samrim-runtime-proof-");
  const isRunnerTemporaryDirectory = !relativeDirectory.startsWith("..") && !path.isAbsolute(relativeDirectory);
  if (!expectedFileName || !expectedDirectoryName || !isRunnerTemporaryDirectory || !privateDirectory) {
    throw new Error(`DSH checker fixture path must be private and runner-owned (file=${expectedFileName}, directory=${expectedDirectoryName}, runnerTemp=${isRunnerTemporaryDirectory}, private=${privateDirectory}, platform=${process.platform}, mode=${directoryMode.toString(8)})`);
  }
  return value;
}

test.beforeAll(() => {
  assertIdentityProofScope();
  const fixturePath = process.env.DSH_RUNTIME_CHECKER_FIXTURE_PATH;
  if (fixturePath) dshRuntimeFixturePath = validateRuntimeFixturePath(fixturePath);
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
  const existing = await findInitialOperator(identityBase, controlToken);
  if (existing) {
    expect(existing.actorId).toMatch(/^act_/);
    expect(existing.phone).toMatch(/^\+9677/);
    if (process.env.BTHWANI_IDENTITY_PROOF_SCOPE === "disposable-ci" && process.env.CI === "true") {
      const enrollment = await jsonRequest(
        identityBase,
        "/internal/bootstrap/operator",
        bootstrapToken,
        { phoneE164: existing.phone, role: "operator" },
      );
      expect(enrollment.response.status, "disposable CI founder must enroll through canonical bootstrap").toBe(200);
      const token = String(enrollment.body?.enrollmentToken?.code || "");
      expect(token).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
      return { ...existing, token };
    }
    return existing;
  }

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
  const independentOperator = await provisionIndependentOperator(identityBase, controlToken, primaryOperator.actorId);
  const fixturePath = dshRuntimeFixturePath;
  if (fixturePath) {
    await enableOperatorPermission(identityBase, controlToken, primaryOperator.actorId, independentOperator.actorId, "operations");
    await enableOperatorPermission(identityBase, controlToken, primaryOperator.actorId, independentOperator.actorId, "finance");
  }
  const browser = page.context().browser();
  if (!browser) throw new Error("live Identity proof requires a browser instance for the independent operator fixture");
  if (primaryOperator.token) {
    const primaryContext = await browser.newContext({ baseURL: baseUrl, locale: "ar-YE" });
    const primaryPage = await primaryContext.newPage();
    try {
      await enableVirtualAuthenticator(primaryPage);
      await registerOperator(primaryPage, primaryOperator, baseUrl, mailpitBase);
      console.log("DSH_PRIMARY_OPERATOR_ACTIVATION=PASS");
    } finally {
      await primaryContext.close();
    }
  }
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
