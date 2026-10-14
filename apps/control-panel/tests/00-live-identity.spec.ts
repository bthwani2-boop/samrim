import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import path from "node:path";
import { expect, type Page, request, test } from "@playwright/test";
import { resolveTrustedExecutable } from "../../../tests/runtime/runtime-proof/trusted-executables.mjs";
import { assertIdentityProofScope, enableVirtualAuthenticator, findInitialOperator, jsonRequest, type PreparedOperator, provisionIndependentOperator, readCanonicalRuntime, registerOperator, requiredEnv, runtimeComposeProject, waitForMailpitCode } from "./live-identity-proof-helpers";

test.beforeAll(() => {
  assertIdentityProofScope();
});

function mutateOperatorSessions(actorId: string, mutation: string): void {
  const runtime = readCanonicalRuntime();
  const composeProject = runtimeComposeProject();
  const actorLiteral = actorId.replaceAll("'", "''");
  const output = execFileSync(
    resolveTrustedExecutable("docker"),
    [
      "compose",
      "--project-name",
      composeProject,
      "--env-file",
      runtime.envFile,
      "-f",
      path.join(runtime.repoRoot, "infra/local/compose/compose.yaml"),
      "exec",
      "-T",
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      runtime.postgresUser,
      "-d",
      runtime.postgresDatabase,
      "-Atc",
      `UPDATE identity_sessions SET ${mutation} WHERE actor_id='${actorLiteral}' AND revoked_at IS NULL RETURNING id;`,
    ],
    { cwd: runtime.repoRoot, encoding: "utf8" },
  ).trim();
  if (!output) throw new Error(`live Identity fixture mutation matched no active sessions for actor ${actorId}`);
}

function restartIdentity(): void {
  const runtime = readCanonicalRuntime();
  const composeProject = runtimeComposeProject();
  execFileSync(
    resolveTrustedExecutable("docker"),
    [
      "compose",
      "--project-name",
      composeProject,
      "--env-file",
      runtime.envFile,
      "-f",
      path.join(runtime.repoRoot, "infra/local/compose/compose.yaml"),
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "300",
      "identity",
    ],
    { cwd: runtime.repoRoot, encoding: "utf8", stdio: "ignore" },
  );
}

async function readBrowserSession(page: Page): Promise<{ status: number; body: Record<string, any> }> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
}

function readOperatorPermissionAudit(actorId: string): Array<Record<string, unknown>> {
  if (!/^act_[A-Za-z0-9_-]+$/.test(actorId)) throw new Error("audit readback actor ID is invalid");
  const runtime = readCanonicalRuntime();
  const output = execFileSync(
    resolveTrustedExecutable("docker"),
    [
      "compose", "--project-name", runtimeComposeProject(), "--env-file", runtime.envFile,
      "-f", path.join(runtime.repoRoot, "infra/local/compose/compose.yaml"), "exec", "-T", "postgres",
      "psql", "-v", "ON_ERROR_STOP=1", "-U", runtime.postgresUser, "-d", runtime.postgresDatabase,
      "-Atc",
      `SELECT COALESCE(json_agg(json_build_object('principal',principal,'outcome',outcome,'correlationId',correlation_id,'permission',metadata->>'permission','enabled',(metadata->>'enabled')::boolean,'reason',metadata->>'reason','expectedVersion',(metadata->>'expectedVersion')::integer,'operatorActorId',metadata->>'operatorActorId') ORDER BY created_at),'[]'::json)::text FROM identity_security_audit WHERE event_type='operator.permission_changed' AND subject_actor_id='${actorId}' AND metadata->>'permission'='catalog';`,
    ],
    { cwd: runtime.repoRoot, encoding: "utf8" },
  ).trim();
  return JSON.parse(output) as Array<Record<string, unknown>>;
}

async function prepareOperator(identityBase: string, controlToken: string, bootstrapToken: string): Promise<PreparedOperator> {
  const existing = await findInitialOperator(identityBase, controlToken);
  if (existing) {
    expect(existing.actorId).toMatch(/^act_/);
    expect(existing.phone).toMatch(/^\+9677/);
    return provisionIndependentOperator(identityBase, controlToken, existing.actorId);
  }

  const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
  const bootstrap = await jsonRequest(identityBase, "/internal/bootstrap/operator", bootstrapToken, { phoneE164: phone, role: "operator" });
  expect(bootstrap.response.status, "fresh operator bootstrap must succeed").toBe(201);
  expect(bootstrap.body?.role?.role).toBe("operator");
  const operator = { actorId: String(bootstrap.body?.role?.actorId), phone, token: String(bootstrap.body?.enrollmentToken?.code), profileId: "", actorCreatedByTest: false };
  expect(operator.actorId).toMatch(/^act_/);
  expect(operator.token).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  return operator;
}

test("@live operator identity, recovery, sessions and permissions survive canonical readback", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const mailpitBase = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const bootstrapToken = requiredEnv("PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN");
  const operator = await prepareOperator(identityBase, controlToken, bootstrapToken);
  const duplicateBootstrapPhone = `+9677${String(randomInt(10_000_000, 99_999_999))}`;
  const duplicateBootstrap = await jsonRequest(identityBase, "/internal/bootstrap/operator", bootstrapToken, { phoneE164: duplicateBootstrapPhone, role: "operator" });
  expect(duplicateBootstrap.response.status).toBe(409);
  expect((await findInitialOperator(identityBase, controlToken))?.actorId).toBe(operator.actorId);
  const duplicateSearchParams = new URLSearchParams({ role: "operator", q: duplicateBootstrapPhone, limit: "5" });
  const duplicateSearch = await fetch(`${identityBase}/internal/actor-roles/search?${duplicateSearchParams}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${controlToken}` },
  });
  expect(duplicateSearch.status).toBe(200);
  expect((await duplicateSearch.json() as { items?: unknown[] }).items ?? []).toHaveLength(0);
  const baseUrl = requiredEnv("PLAYWRIGHT_BASE_URL").replace(/\/+$/, "");
  await enableVirtualAuthenticator(page);
  await page.goto(baseUrl + "/");
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByLabel("كلمة المرور")).toHaveCount(0);
  const disabledDevelopmentLogin = await page.evaluate(async () => {
    const response = await fetch("/api/auth/development/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "isolated-disabled-path-proof" }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(disabledDevelopmentLogin.status).toBe(404);
  expect(disabledDevelopmentLogin.body.error.code).toBe("DEVELOPMENT_LOGIN_DISABLED");
  const firstRecoveryCredential = await registerOperator(page, operator, baseUrl, mailpitBase);
  const firstSession = await readBrowserSession(page);
  expect(firstSession.status).toBe(200);
  expect(firstSession.body.identity.subject).toBe(operator.actorId);
  expect(firstSession.body.identity.role).toBe("operator");
  expect(firstSession.body.identity.surface).toBe("control-panel");
  expect(firstSession.body.identity.canManageOperatorPermissions).toBe(true);
  expect([...firstSession.body.identity.permissions].sort()).toEqual(["catalog", "finance", "marketing", "operations", "partners", "platform_policies"]);
  await page.reload();
  const reloadedSession = await readBrowserSession(page);
  expect(reloadedSession.status).toBe(200);
  expect(reloadedSession.body.identity.subject).toBe(operator.actorId);

  // Expired access + dropped response: the next independent browser request
  // sends the old cookies and receives the same canonical refresh generation.
  mutateOperatorSessions(operator.actorId, "access_expires_at=clock_timestamp()-interval '1 second'");
  const cookiesBeforeDroppedResponse = await page.context().cookies();
  const accessBeforeDroppedResponse = cookiesBeforeDroppedResponse.find((cookie) => cookie.name.endsWith("bt_identity_access"))?.value;
  const refreshBeforeDroppedResponse = cookiesBeforeDroppedResponse.find((cookie) => cookie.name.endsWith("bt_identity_refresh"))?.value;
  const deviceBeforeDroppedResponse = cookiesBeforeDroppedResponse.find((cookie) => cookie.name.endsWith("bt_identity_device"))?.value;
  const droppedResponseContext = await request.newContext();
  const concurrentRefreshContext = await request.newContext();
  try {
    const sessionUrl = new URL("/api/auth/session", page.url()).toString();
    const headers = {
      Accept: "application/json",
      Cookie: cookiesBeforeDroppedResponse.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    };
    const [droppedResponse, concurrentResponse] = await Promise.all([
      droppedResponseContext.get(sessionUrl, { headers }),
      concurrentRefreshContext.get(sessionUrl, { headers }),
    ]);
    expect(droppedResponse.status(), await droppedResponse.text()).toBe(200);
    expect(concurrentResponse.status(), await concurrentResponse.text()).toBe(200);
  } finally {
    await droppedResponseContext.dispose();
    await concurrentRefreshContext.dispose();
  }
  const cookiesAfterDroppedResponse = await page.context().cookies();
  expect(cookiesAfterDroppedResponse.find((cookie) => cookie.name.endsWith("bt_identity_access"))?.value).toBe(accessBeforeDroppedResponse);
  expect(cookiesAfterDroppedResponse.find((cookie) => cookie.name.endsWith("bt_identity_refresh"))?.value).toBe(refreshBeforeDroppedResponse);
  expect(cookiesAfterDroppedResponse.find((cookie) => cookie.name.endsWith("bt_identity_device"))?.value).toBe(deviceBeforeDroppedResponse);
  const reconciledSession = await readBrowserSession(page);
  expect(reconciledSession.status, JSON.stringify(reconciledSession.body)).toBe(200);
  expect(reconciledSession.body.identity.role).toBe("operator");

  // Identity outage is transient: the BFF returns 503 and leaves cookies intact.
  mutateOperatorSessions(operator.actorId, "access_expires_at=clock_timestamp()-interval '1 second'");
  const cookiesBeforeOutage = await page.context().cookies();
  const accessBeforeOutage = cookiesBeforeOutage.find((cookie) => cookie.name.endsWith("bt_identity_access"))?.value;
  const runtime = readCanonicalRuntime();
  const composeProject = runtimeComposeProject();
  execFileSync(resolveTrustedExecutable("docker"), ["compose", "--project-name", composeProject, "--env-file", runtime.envFile, "-f", path.join(runtime.repoRoot, "infra/local/compose/compose.yaml"), "stop", "identity"], { cwd: runtime.repoRoot, encoding: "utf8", stdio: "ignore" });
  try {
    const transientSession = await readBrowserSession(page);
    expect(transientSession.status).toBe(503);
    expect(transientSession.body.error.code).toBe("IDENTITY_UNAVAILABLE");
    expect((await page.context().cookies()).find((cookie) => cookie.name.endsWith("bt_identity_access"))?.value).toBe(accessBeforeOutage);
  } finally {
    restartIdentity();
  }
  const sessionAfterIdentityRecovery = await readBrowserSession(page);
  expect(sessionAfterIdentityRecovery.status, JSON.stringify(sessionAfterIdentityRecovery.body)).toBe(200);
  expect(sessionAfterIdentityRecovery.body.identity.subject).toBe(operator.actorId);

  await page.getByText("حساب المشغل", { exact: true }).click();
  const explicitLogoutResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/logout") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  const logoutResponse = await explicitLogoutResponse;
  const logoutFailureBody = logoutResponse.status() === 204
    ? ""
    : await Promise.race([
      logoutResponse.text(),
      new Promise<string>((resolve) => setTimeout(() => resolve("logout response body did not finish within 2s"), 2_000)),
    ]);
  expect(logoutResponse.status(), logoutFailureBody).toBe(204);
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  const cookiesAfterExplicitLogout = await page.context().cookies();
  expect(cookiesAfterExplicitLogout.some((cookie) => cookie.name.endsWith("bt_identity_access") || cookie.name.endsWith("bt_identity_refresh"))).toBe(false);
  expect(cookiesAfterExplicitLogout.some((cookie) => cookie.name.endsWith("bt_identity_device"))).toBe(false);
  const signedOutSession = await readBrowserSession(page);
  expect(signedOutSession.status, JSON.stringify(signedOutSession.body)).toBe(401);
  expect(signedOutSession.body.error.code).toBe("UNAUTHENTICATED");
  await page.reload();
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await page.getByRole("button", { name: "الدخول بمفتاح المرور" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("حساب المشغل", { exact: true })).toBeVisible();

  await page.getByText("حساب المشغل", { exact: true }).click();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByRole("button", { name: "استرداد الوصول" }).click();
  await page.getByLabel("رقم الهاتف").fill(operator.phone);
  const invalidRecoveryCredential = "A".repeat(32);
  await page.getByLabel("اعتماد الاسترداد").fill(invalidRecoveryCredential);
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  await expect(page.getByRole("status")).toContainText("إذا كان اعتماد الاسترداد صالحًا");
  const invalidRecoveryOptions = await page.evaluate(async ({ phone, recoveryCredential }) => {
    const response = await fetch("/api/auth/operator/recovery/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, recoveryCredential, verificationCode: "000000" }),
    });
    return { status: response.status, body: await response.json() };
  }, { phone: operator.phone, recoveryCredential: invalidRecoveryCredential });
  expect(invalidRecoveryOptions.status).toBe(401);
  await page.getByRole("button", { name: "العودة للدخول" }).click();
  await page.getByRole("button", { name: "استرداد الوصول" }).click();
  await page.getByLabel("رقم الهاتف").fill(operator.phone);
  await page.getByLabel("اعتماد الاسترداد").fill(String(firstRecoveryCredential));
  const recoveryChallengeSentAt = Date.now();
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  const recoveryCode = await waitForMailpitCode(mailpitBase, operator.phone, "operator_recover", recoveryChallengeSentAt);
  await page.getByLabel("رمز إثبات الهاتف").fill(recoveryCode);
  await page.getByRole("button", { name: "إثبات الهاتف وتسجيل مفتاح مرور بديل" }).click();
  await expect(page.getByRole("heading", { name: "احفظ هذا الاعتماد الآن" })).toBeVisible();
  const replacementRecoveryCredential = await page.locator(".code-output").textContent();
  expect(replacementRecoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  expect(replacementRecoveryCredential).not.toBe(firstRecoveryCredential);
  await page.getByRole("button", { name: "حفظت الاعتماد وفتح لوحة التحكم" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  const recoveredSession = await readBrowserSession(page);
  expect(recoveredSession.status).toBe(200);
  expect(recoveredSession.body.identity.subject).toBe(operator.actorId);
  expect(recoveredSession.body.identity.role).toBe("operator");
  expect(recoveredSession.body.identity.surface).toBe("control-panel");
  const replayedRecoveryCode = await page.evaluate(async ({ phone, recoveryCredential, verificationCode }) => {
    const response = await fetch("/api/auth/operator/recovery/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, recoveryCredential, verificationCode }),
    });
    return { status: response.status, body: await response.json() };
  }, { phone: operator.phone, recoveryCredential: String(replacementRecoveryCredential), verificationCode: recoveryCode });
  expect(replayedRecoveryCode.status).toBe(401);

  const secondary = await provisionIndependentOperator(identityBase, controlToken, operator.actorId);
  const secondaryContext = await browser.newContext();
  try {
    const secondaryPage = await secondaryContext.newPage();
    await enableVirtualAuthenticator(secondaryPage);
    await registerOperator(secondaryPage, secondary, baseUrl, mailpitBase);
    const secondarySession = await readBrowserSession(secondaryPage);
    expect(secondarySession.status).toBe(200);
    expect(secondarySession.body.identity.subject).toBe(secondary.actorId);
    expect(secondarySession.body.identity.role).toBe("operator");
    expect(secondarySession.body.identity.canManageOperatorPermissions).not.toBe(true);
    expect(secondarySession.body.identity.permissions ?? []).toEqual([]);

    const secondaryDirectory = await secondaryPage.evaluate(async () => {
      const response = await fetch("/api/access/operators?q=", { cache: "no-store" });
      return { status: response.status, body: await response.json() };
    });
    expect(secondaryDirectory.status).toBe(403);
    const secondaryWrite = await secondaryPage.evaluate(async (actorId) => {
      const response = await fetch("/api/access/operator-permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId, permission: "catalog", enabled: true, expectedVersion: 1, reason: "unauthorized proof attempt" }),
      });
      return { status: response.status, body: await response.json() };
    }, secondary.actorId);
    expect(secondaryWrite.status).toBe(403);

    const secondaryCookies = await secondaryContext.cookies(baseUrl);
    const secondaryCookieHeader = secondaryCookies
      .filter((cookie) => cookie.name.endsWith("bt_identity_access") || cookie.name.endsWith("bt_identity_refresh") || cookie.name.endsWith("bt_identity_device"))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    expect(secondaryCookieHeader).toContain("bt_identity_access=");

    await page.goto(`${baseUrl}/access`);
    await page.locator("#operator-permissions-tab").click();
    await page.locator("#operator-search").fill(secondary.phone);
    const secondaryRow = page.locator(".operations-table tbody tr").filter({ hasText: secondary.phone });
    await expect(secondaryRow).toHaveCount(1);
    await secondaryRow.getByRole("button", { name: "إدارة الحساب" }).click();
    const catalogPermission = page.locator('[aria-label="صلاحية الكتالوج"]');
    await expect(catalogPermission.locator("strong").first()).toHaveText("catalog · غير ممنوحة");
    await page.locator("#operator-permission-reason-catalog").fill("إثبات حي لمنح الكتالوج");
    const grantButton = catalogPermission.getByRole("button", { name: "منح صلاحية الكتالوج" });
    await expect(grantButton).toBeEnabled();
    const grantResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/access/operator-permission") && response.request().method() === "POST",
    );
    await grantButton.click();
    const grantResponse = await grantResponsePromise;
    const grantResponseBody = await grantResponse.json();
    expect(grantResponse.status(), JSON.stringify(grantResponseBody)).toBe(200);
    expect(grantResponseBody).toMatchObject({ actorId: secondary.actorId, permission: "catalog", enabled: true, version: 2 });
    await expect(catalogPermission.locator("strong").first()).toHaveText("catalog · ممنوحة");

    const revokedSecondarySession = await request.newContext();
    let revokedReadback: { status: number; body: Record<string, any> };
    try {
      const response = await revokedSecondarySession.get(new URL("/api/auth/session", baseUrl).toString(), { headers: { Cookie: secondaryCookieHeader } });
      revokedReadback = { status: response.status(), body: await response.json() };
    } finally {
      await revokedSecondarySession.dispose();
    }
    expect(revokedReadback.status).toBe(401);

    const stalePermissionWrite = await page.evaluate(async (actorId) => {
      const response = await fetch("/api/access/operator-permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId, permission: "catalog", enabled: false, expectedVersion: 1, reason: "stale version proof" }),
      });
      return { status: response.status, body: await response.json() };
    }, secondary.actorId);
    expect(stalePermissionWrite.status).toBe(409);
    const afterStaleWrite = await page.evaluate(async (phone) => {
      const params = new URLSearchParams({ role: "operator", phone });
      const response = await fetch(`/api/access/managed-user/status?${params}`, { cache: "no-store" });
      return { status: response.status, body: await response.json() };
    }, secondary.phone);
    expect(afterStaleWrite.status).toBe(200);
    expect(afterStaleWrite.body.operatorPermissions.catalog).toMatchObject({ enabled: true, version: 2, reason: "إثبات حي لمنح الكتالوج" });

    await page.locator("#operator-permission-reason-catalog").fill("إثبات حي لإلغاء الكتالوج");
    const revokeButton = catalogPermission.getByRole("button", { name: "سحب صلاحية الكتالوج" });
    await expect(revokeButton).toBeEnabled();
    const revokeResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/access/operator-permission") && response.request().method() === "POST",
    );
    await revokeButton.click();
    const revokeResponse = await revokeResponsePromise;
    const revokeResponseBody = await revokeResponse.json();
    expect(revokeResponse.status(), JSON.stringify(revokeResponseBody)).toBe(200);
    expect(revokeResponseBody).toMatchObject({ actorId: secondary.actorId, permission: "catalog", enabled: false, version: 3 });
    await expect(catalogPermission.locator("strong").first()).toHaveText("catalog · غير ممنوحة");
    const finalPermissionReadback = await page.evaluate(async (phone) => {
      const params = new URLSearchParams({ role: "operator", phone });
      const response = await fetch(`/api/access/managed-user/status?${params}`, { cache: "no-store" });
      return { status: response.status, body: await response.json() };
    }, secondary.phone);
    expect(finalPermissionReadback.status).toBe(200);
    expect(finalPermissionReadback.body.operatorPermissions.catalog).toMatchObject({ enabled: false, version: 3, reason: "إثبات حي لإلغاء الكتالوج" });
    expect(readOperatorPermissionAudit(secondary.actorId)).toEqual([
      expect.objectContaining({ outcome: "success", correlationId: expect.any(String), permission: "catalog", enabled: true, expectedVersion: 1, reason: "إثبات حي لمنح الكتالوج", operatorActorId: operator.actorId }),
      expect.objectContaining({ outcome: "success", correlationId: expect.any(String), permission: "catalog", enabled: false, expectedVersion: 2, reason: "إثبات حي لإلغاء الكتالوج", operatorActorId: operator.actorId }),
    ]);
  } finally {
    await secondaryContext.close();
  }

  // Confirmed terminal invalidation clears the browser session cookies.
  mutateOperatorSessions(operator.actorId, "revoked_at=clock_timestamp()");
  const terminalSession = await readBrowserSession(page);
  expect(terminalSession.status).toBe(401);
  expect(terminalSession.body.error.code).toBe("UNAUTHENTICATED");
  expect((await page.context().cookies()).filter((cookie) => cookie.name.endsWith("bt_identity_access") || cookie.name.endsWith("bt_identity_refresh") || cookie.name.endsWith("bt_identity_device"))).toHaveLength(0);
});
