import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, request, test } from "@playwright/test";
import { assertIdentityProofScope, enableVirtualAuthenticator, findInitialOperator, findOperatorProfileByPhone, jsonRequest, type PreparedOperator, provisionIndependentOperator, readCanonicalRuntime, registerOperator, requiredEnv, waitForMailpitCode } from "./live-identity-proof-helpers";

test.beforeAll(() => {
  assertIdentityProofScope();
});

function mutateOperatorSessions(actorId: string, mutation: string): void {
  const runtime = readCanonicalRuntime();
  const actorLiteral = actorId.replaceAll("'", "''");
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      runtime.composeProject,
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
  execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      runtime.composeProject,
      "--env-file",
      runtime.envFile,
      "-f",
      path.join(runtime.repoRoot, "infra/local/compose/compose.yaml"),
      "up",
      "-d",
      "--no-deps",
      "--force-recreate",
      "--wait",
      "--wait-timeout",
      "300",
      "identity",
    ],
    { cwd: runtime.repoRoot, encoding: "utf8", stdio: "ignore" },
  );
}

function configureDisposableDevelopmentOperator(actorId: string): void {
  assertIdentityProofScope();
  const runtime = readCanonicalRuntime();
  const disposableCi = process.env.CI === "true" && process.env.BTHWANI_IDENTITY_PROOF_SCOPE === "disposable-ci";
  const defaultEnvFile = path.resolve(runtime.repoRoot, "infra/local/.env");
  if (runtime.composeProject === "samrim-local" && !disposableCi) throw new Error("live Identity proof refuses to configure the persistent local Compose project");
  if (!disposableCi && runtime.envFile === defaultEnvFile) throw new Error("live Identity proof requires a task-owned Compose environment file before configuring its development operator");
  const lines = readFileSync(runtime.envFile, "utf8").split(/\r?\n/);
  let found = false;
  let changed = false;
  const updated = lines.map((line) => {
    if (!line.startsWith("IDENTITY_DEVELOPMENT_OPERATOR_ACTOR_ID=")) return line;
    found = true;
    const value = `IDENTITY_DEVELOPMENT_OPERATOR_ACTOR_ID=${actorId}`;
    changed ||= line !== value;
    return value;
  });
  if (!found) throw new Error("task-owned runtime environment must declare IDENTITY_DEVELOPMENT_OPERATOR_ACTOR_ID");
  if (!changed) return;
  const contents = updated.join("\n");
  writeFileSync(runtime.envFile, contents.endsWith("\n") ? contents : `${contents}\n`);
  execFileSync("docker", [
    "compose", "--project-name", runtime.composeProject, "--env-file", runtime.envFile,
    "-f", path.join(runtime.repoRoot, "infra/local/compose/compose.yaml"),
    "up", "-d", "--force-recreate", "--no-deps", "--wait", "--wait-timeout", "300", "identity",
  ], { cwd: runtime.repoRoot, encoding: "utf8", stdio: "ignore" });
}

async function readBrowserSession(page: Page): Promise<{ status: number; body: Record<string, any> }> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
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

async function createOperatorThroughControlPanel(
  page: Page,
  baseUrl: string,
  input: { fullNameAr: string; phone: string; jobTitle: string; department: string },
): Promise<PreparedOperator> {
  await page.goto(baseUrl + "/access?view=requests");
  async function post(pathName: string, body: unknown, key: string) {
    return page.evaluate(async ({ pathName, body, key }) => {
      const response = await fetch(pathName, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() as Record<string, any> };
    }, { pathName, body, key });
  }
  const employee = await post("/api/hr/employees", {
    fullNameAr: input.fullNameAr, phoneE164: input.phone,
    department: input.department, jobTitle: input.jobTitle,
    managerEmployeeId: "", workLocation: "صنعاء",
    startDate: new Date().toISOString().slice(0, 10),
  }, randomUUID());
  expect(employee.status).toBe(201);
  const employeeId = String(employee.data?.employee?.id || "");
  expect(employeeId).toMatch(/^emp_/);
  const access = await post("/api/hr/access-requests", {
    employeeId, reason: "يتطلب العمل الوظيفي الوصول إلى العمليات",
    requestedPermissions: ["operations"],
  }, randomUUID());
  expect(access.status).toBe(201);
  const accessId = String(access.data?.request?.id || "");
  expect(accessId).toMatch(/^hreq_/);
  const linked = await post("/api/access/hr-requests/" + encodeURIComponent(accessId) + "/profile", {}, randomUUID());
  expect(linked.status).toBe(200);
  const expectedProfileId = String(linked.data?.profile?.id || "");
  expect(expectedProfileId).toMatch(/^oprof_/);
  await page.goto(baseUrl + "/access?view=operators");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const profile = await findOperatorProfileByPhone(identityBase, controlToken, (await findInitialOperator(identityBase, controlToken))!.actorId, input.phone);
  expect(profile).toMatchObject({ fullNameAr: input.fullNameAr, phoneE164: input.phone, jobTitle: input.jobTitle, department: input.department, state: "pending_review", version: 1 });
  const profileId = String(profile?.id || "");
  expect(profileId).toBe(expectedProfileId);

  const profileRow = page.getByRole("row").filter({ hasText: input.fullNameAr });
  await expect(profileRow).toContainText(input.phone);
  const approveResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/api/access/operator-profiles/${encodeURIComponent(profileId)}`) && response.request().method() === "POST",
  );
  await profileRow.getByRole("button", { name: "اعتماد الملف", exact: true }).click();
  const admissionDrawer = page.getByRole("dialog");
  await admissionDrawer.getByRole("button", { name: "اعتماد الملف", exact: true }).click();
  const approveResponse = await approveResponsePromise;
  expect(approveResponse.status()).toBe(200);
  const approvedProfile = await findOperatorProfileByPhone(identityBase, controlToken, (await findInitialOperator(identityBase, controlToken))!.actorId, input.phone);
  expect(approvedProfile).toMatchObject({ id: profileId, state: "approved", version: 2 });
  await expect(admissionDrawer.getByRole("button", { name: "منح الدور", exact: true })).toBeVisible();

  const grantResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/api/access/operator-profiles/${encodeURIComponent(profileId)}`) && response.request().method() === "POST",
  );
  await admissionDrawer.getByRole("button", { name: "منح الدور", exact: true }).click();
  const grantResponse = await grantResponsePromise;
  expect(grantResponse.status()).toBe(201);
  const grantedProfile = await findOperatorProfileByPhone(identityBase, controlToken, (await findInitialOperator(identityBase, controlToken))!.actorId, input.phone);
  expect(grantedProfile).toMatchObject({ id: profileId, state: "admitted", version: 3, roleEnabled: true, securityEnabled: true });
  const actorId = String(grantedProfile?.actorId || "");
  expect(actorId).toMatch(/^act_/);

  const invitationResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/api/access/operator-profiles/${encodeURIComponent(profileId)}`) && response.request().method() === "POST",
  );
  await admissionDrawer.getByRole("button", { name: "إصدار دعوة", exact: true }).click();
  const invitationResponse = await invitationResponsePromise;
  expect(invitationResponse.status()).toBe(201);
  const finalProfile = await findOperatorProfileByPhone(identityBase, controlToken, (await findInitialOperator(identityBase, controlToken))!.actorId, input.phone);
  expect(finalProfile).toMatchObject({ id: profileId, actorId, state: "admitted", roleEnabled: true, securityEnabled: true });
  const token = String(await admissionDrawer.locator(".access-center-invitation code").textContent() || "");
  expect(token).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  return { actorId, phone: input.phone, token, profileId, actorCreatedByTest: true };
}

async function signOutOperator(page: Page): Promise<void> {
  await page.locator('summary[aria-label="الحساب"]').click();
  const logoutResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/logout") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  expect((await logoutResponsePromise).status()).toBe(204);
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
}

test("@live HR-led Control Panel admission creates two operators and proves founder recovery plus logins", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const mailpitBase = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const bootstrapToken = requiredEnv("PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN");
  const baseUrl = requiredEnv("PLAYWRIGHT_BASE_URL").replace(/\/+$/, "");
  const root = await findInitialOperator(identityBase, controlToken);
  expect(root, "the isolated Identity database must contain its canonical founder").not.toBeNull();
  await enableVirtualAuthenticator(page);
  const checkerPath = process.env.DSH_RUNTIME_CHECKER_FIXTURE_PATH?.trim() || "";
  let founderRecoveryCredential: string;
  if (checkerPath) {
    assertIdentityProofScope();
    const runnerTemp = path.resolve(requiredEnv("RUNNER_TEMP"));
    const checkerDir = path.resolve(path.dirname(checkerPath));
    const checkerStats = lstatSync(checkerDir);
    if (!checkerDir.startsWith(runnerTemp + path.sep) ||
        path.basename(checkerPath) !== "dsh-checker-fixture.json" ||
        !checkerStats.isDirectory() || checkerStats.isSymbolicLink() ||
        (checkerStats.mode & 0o777) !== 0o700) {
      throw new Error("founder proof handoff must remain inside the private CI fixture directory");
    }
    const proofPath = path.join(checkerDir, "identity-founder-recovery-proof.json");
    // Open once without following symlinks, then verify and read the same
    // descriptor. Checking the filename before reading it is a TOCTOU hazard.
    const proofFD = openSync(proofPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let handoff: { actorId?: string; phone?: string; recoveryCredential?: string };
    try {
      const proofStats = fstatSync(proofFD);
      if (!proofStats.isFile() || (proofStats.mode & 0o777) !== 0o600 ||
          proofStats.size < 60 || proofStats.size > 1024) {
        throw new Error("the DSH checker did not provide a private one-use founder recovery proof");
      }
      handoff = JSON.parse(readFileSync(proofFD, "utf8")) as typeof handoff;
    } finally {
      closeSync(proofFD);
      unlinkSync(proofPath);
    }
    expect(handoff.actorId).toBe(root!.actorId);
    expect(handoff.phone).toBe(root!.phone);
    expect(handoff.recoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
    // The Root was activated by the DSH checker; a second bootstrap must be denied.
    const denied = await jsonRequest(identityBase, "/internal/bootstrap/operator", bootstrapToken, { phoneE164: root!.phone, role: "operator" });
    expect(denied.response.status).toBe(409);
    await page.goto(baseUrl + "/");
    await page.getByRole("button", { name: "استرداد الوصول" }).click();
    await page.getByLabel("رقم الهاتف").fill(root!.phone);
    await page.getByLabel("اعتماد الاسترداد").fill(handoff.recoveryCredential!);
    const sentAt = Date.now();
    await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
    const code = await waitForMailpitCode(mailpitBase, root!.phone, "operator_recover", sentAt);
    await page.getByLabel("رمز إثبات الهاتف").fill(code);
    await page.getByRole("button", { name: "إثبات الهاتف وتسجيل مفتاح مرور بديل" }).click();
    await expect(page.getByRole("heading", { name: "احفظ هذا الاعتماد الآن" })).toBeVisible();
    founderRecoveryCredential = String(await page.locator(".code-output").textContent() || "");
    expect(founderRecoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
    expect(founderRecoveryCredential).not.toBe(handoff.recoveryCredential);
    await page.getByRole("button", { name: "حفظت الاعتماد وفتح لوحة التحكم" }).click();
  } else {
    // Standalone isolated proof: Root has not yet been activated.
    configureDisposableDevelopmentOperator(root!.actorId);
    const enrollment = await jsonRequest(identityBase, "/internal/bootstrap/operator", bootstrapToken, { phoneE164: root!.phone, role: "operator" });
    expect(enrollment.response.status, "fresh Root enrollment must use Identity bootstrap").toBe(200);
    const founder: PreparedOperator = { ...root!, token: String(enrollment.body?.enrollmentToken?.code || "") };
    expect(founder.token).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
    founderRecoveryCredential = await registerOperator(page, founder, baseUrl, mailpitBase);
  }
  const founderSession = await readBrowserSession(page);
  expect(founderSession.status).toBe(200);
  expect(founderSession.body.identity.subject).toBe(root!.actorId);

  const operatorInputs = [
    { fullNameAr: "مشغل اختبار مباشر أول", phone: "+9677" + String(randomInt(10_000_000, 99_999_999)), jobTitle: "مشرف العمليات", department: "العمليات" },
    { fullNameAr: "مشغل اختبار مباشر ثان", phone: "+9677" + String(randomInt(10_000_000, 99_999_999)), jobTitle: "منسق الدعم", department: "الدعم" },
  ];
  const operators: PreparedOperator[] = [];
  for (const input of operatorInputs) operators.push(await createOperatorThroughControlPanel(page, baseUrl, input));

  // Revoke only the isolated founder session to prove lost-session recovery without touching persistent local Identity state.
  mutateOperatorSessions(root!.actorId, "revoked_at=clock_timestamp()");
  const lostFounderSession = await readBrowserSession(page);
  expect(lostFounderSession.status).toBe(401);
  await page.reload();
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await page.getByRole("button", { name: "استرداد الوصول" }).click();
  await page.getByLabel("رقم الهاتف").fill(root!.phone);
  await page.getByLabel("اعتماد الاسترداد").fill(founderRecoveryCredential);
  const recoveryChallengeSentAt = Date.now();
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  const recoveryCode = await waitForMailpitCode(mailpitBase, root!.phone, "operator_recover", recoveryChallengeSentAt);
  await page.getByLabel("رمز إثبات الهاتف").fill(recoveryCode);
  await page.getByRole("button", { name: "إثبات الهاتف وتسجيل مفتاح مرور بديل" }).click();
  await expect(page.getByRole("heading", { name: "احفظ هذا الاعتماد الآن" })).toBeVisible();
  const replacementRecoveryCredential = await page.locator(".code-output").textContent();
  expect(replacementRecoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  expect(replacementRecoveryCredential).not.toBe(founderRecoveryCredential);
  await page.getByRole("button", { name: "حفظت الاعتماد وفتح لوحة التحكم" }).click();
  const recoveredFounderSession = await readBrowserSession(page);
  expect(recoveredFounderSession.status).toBe(200);
  expect(recoveredFounderSession.body.identity.subject).toBe(root!.actorId);

  for (const operator of operators) {
    const operatorContext = await browser.newContext({ baseURL: baseUrl });
    try {
      const operatorPage = await operatorContext.newPage();
      await enableVirtualAuthenticator(operatorPage);
      const recoveryCredential = await registerOperator(operatorPage, operator, baseUrl, mailpitBase);
      expect(recoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
      const enrolledSession = await readBrowserSession(operatorPage);
      expect(enrolledSession.status).toBe(200);
      expect(enrolledSession.body.identity.subject).toBe(operator.actorId);
      await operatorPage.reload();
      expect((await readBrowserSession(operatorPage)).body.identity.subject).toBe(operator.actorId);
      await signOutOperator(operatorPage);
      const authenticationResponsePromise = operatorPage.waitForResponse((response) =>
        response.url().endsWith("/api/auth/passkey/finish") && response.request().method() === "POST",
      );
      await operatorPage.getByRole("button", { name: "الدخول بمفتاح المرور" }).click();
      const authenticationResponse = await authenticationResponsePromise;
      expect(authenticationResponse.status()).toBe(200);
      await expect.poll(async () => (await readBrowserSession(operatorPage)).status, { timeout: 10_000 }).toBe(200);
      const authenticatedSession = await readBrowserSession(operatorPage);
      expect(authenticatedSession.body.identity.subject).toBe(operator.actorId);
    } finally {
      await operatorContext.close();
    }
  }
});

test("@live operator passkey registration, authentication and governed recovery survive browser readback", async ({ page }) => {
  test.setTimeout(90_000);
  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const mailpitBase = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const bootstrapToken = requiredEnv("PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN");
  const operator = await prepareOperator(identityBase, controlToken, bootstrapToken);
  const baseUrl = requiredEnv("PLAYWRIGHT_BASE_URL").replace(/\/+$/, "");
  await enableVirtualAuthenticator(page);
  const firstRecoveryCredential = await registerOperator(page, operator, baseUrl, mailpitBase);
  const firstSession = await readBrowserSession(page);
  expect(firstSession.status).toBe(200);
  expect(firstSession.body.identity.subject).toBe(operator.actorId);
  expect(firstSession.body.identity.role).toBe("operator");
  expect(firstSession.body.identity.surface).toBe("control-panel");

  // Expired access + dropped response: the next independent browser request
  // sends the old cookies and receives the same canonical refresh generation.
  mutateOperatorSessions(operator.actorId, "access_expires_at=clock_timestamp()-interval '1 second'");
  const cookiesBeforeDroppedResponse = await page.context().cookies();
  const accessBeforeDroppedResponse = cookiesBeforeDroppedResponse.find((cookie) => cookie.name.endsWith("bt_identity_access"))?.value;
  const refreshBeforeDroppedResponse = cookiesBeforeDroppedResponse.find((cookie) => cookie.name.endsWith("bt_identity_refresh"))?.value;
  const deviceBeforeDroppedResponse = cookiesBeforeDroppedResponse.find((cookie) => cookie.name.endsWith("bt_identity_device"))?.value;
  const droppedResponseContext = await request.newContext();
  try {
    const droppedResponse = await droppedResponseContext.get(new URL("/api/auth/session", page.url()).toString(), {
      headers: {
        Accept: "application/json",
        Cookie: cookiesBeforeDroppedResponse.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
      },
    });
    expect(droppedResponse.status(), await droppedResponse.text()).toBe(200);
  } finally {
    await droppedResponseContext.dispose();
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
  execFileSync("docker", ["compose", "--project-name", runtime.composeProject, "--env-file", runtime.envFile, "-f", path.join(runtime.repoRoot, "infra/local/compose/compose.yaml"), "stop", "identity"], { cwd: runtime.repoRoot, encoding: "utf8", stdio: "ignore" });
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

  await page.locator('summary[aria-label="الحساب"]').click();
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
  await expect(page.locator('summary[aria-label="الحساب"]')).toBeVisible();

  await page.locator('summary[aria-label="الحساب"]').click();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
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

  // Confirmed terminal invalidation clears the browser session cookies.
  mutateOperatorSessions(operator.actorId, "revoked_at=clock_timestamp()");
  const terminalSession = await readBrowserSession(page);
  expect(terminalSession.status).toBe(401);
  expect(terminalSession.body.error.code).toBe("UNAUTHENTICATED");
  expect((await page.context().cookies()).filter((cookie) => cookie.name.endsWith("bt_identity_access") || cookie.name.endsWith("bt_identity_refresh") || cookie.name.endsWith("bt_identity_device"))).toHaveLength(0);
});
