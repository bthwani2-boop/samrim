import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, request, test } from "@playwright/test";

type PreparedOperator = {
  actorId: string;
  phone: string;
  token: string;
  createdByTest: boolean;
};

let preparedOperatorForCleanup: PreparedOperator | undefined;

test.beforeAll(() => {
  if (process.env.CI !== "true" || process.env.BTHWANI_IDENTITY_PROOF_SCOPE !== "disposable-ci") {
    throw new Error("live Identity proof requires explicitly disposable CI state");
  }
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required for live Identity browser proof");
  return value;
}

async function jsonRequest(base: string, pathname: string, token: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5_000),
  });
  return { response, body: await response.json().catch(() => null) as Record<string, any> | null };
}

async function waitForMailpitCode(mailpitBaseUrl: string, phone: string, purpose: string): Promise<string> {
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

function readCanonicalRuntime(): { envFile: string; repoRoot: string; postgresUser: string; postgresDatabase: string } {
  const repoRoots = [
    path.resolve(process.cwd()),
    path.resolve(process.cwd(), "../.."),
  ];
  const repoRoot = repoRoots.find((candidate) =>
    existsSync(path.join(candidate, "infra/local/.env")) &&
    existsSync(path.join(candidate, "infra/local/compose/compose.yaml")),
  );
  if (!repoRoot) throw new Error("canonical local runtime environment is required for live Identity fixture cleanup");
  const envFile = path.join(repoRoot, "infra/local/.env");
  const values = Object.fromEntries(
    readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) throw new Error("malformed canonical local runtime environment");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
  const postgresUser = String(values.SAMRIM_POSTGRES_USER || "");
  const postgresDatabase = String(values.SAMRIM_POSTGRES_DB || "");
  if (!postgresUser || !postgresDatabase) throw new Error("canonical Postgres credentials are required for live Identity fixture cleanup");
  return { envFile, repoRoot, postgresUser, postgresDatabase };
}

function cleanupPreparedOperator(operator: PreparedOperator): void {
  const runtime = readCanonicalRuntime();
  const actorLiteral = operator.actorId.replaceAll("'", "''");
  const query = operator.createdByTest
    ? `DELETE FROM identity_actors WHERE id='${actorLiteral}'; SELECT count(*) FROM identity_actors WHERE id='${actorLiteral}';`
    : `DELETE FROM identity_sessions WHERE actor_id='${actorLiteral}'; SELECT count(*) FROM identity_sessions WHERE actor_id='${actorLiteral}';`;
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      "samrim-local",
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
      query,
    ],
    { cwd: runtime.repoRoot, encoding: "utf8" },
  ).trim();
  if (output.split(/\r?\n/).at(-1) !== "0") throw new Error("live Identity fixture cleanup left actor data");
}

function mutateOperatorSessions(actorId: string, mutation: string): void {
  const runtime = readCanonicalRuntime();
  const actorLiteral = actorId.replaceAll("'", "''");
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      "samrim-local",
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
      "samrim-local",
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

test.afterEach(() => {
  const operator = preparedOperatorForCleanup;
  preparedOperatorForCleanup = undefined;
  if (process.env.BTHWANI_IDENTITY_PROOF_SCOPE === "disposable-ci") return;
  if (operator) cleanupPreparedOperator(operator);
});

async function prepareOperator(identityBase: string, controlToken: string, bootstrapToken: string): Promise<PreparedOperator> {
  const search = await fetch(identityBase + "/internal/actor-roles/search?role=operator&limit=10", { headers: { Accept: "application/json", Authorization: "Bearer " + controlToken }, signal: AbortSignal.timeout(5_000) });
  const searchBody = await search.json() as { items?: Array<{ actorId: string; phoneE164: string }> };
  const existing = searchBody.items?.[0];
  if (!existing) {
    const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
    const bootstrap = await jsonRequest(identityBase, "/internal/bootstrap/operator", bootstrapToken, { phoneE164: phone, role: "operator" });
    expect(bootstrap.response.status, "fresh operator bootstrap must succeed").toBe(201);
    expect(bootstrap.body?.role?.role).toBe("operator");
    const operator = { actorId: String(bootstrap.body?.role?.actorId), phone, token: String(bootstrap.body?.enrollmentToken?.code), createdByTest: false };
    preparedOperatorForCleanup = operator;
    expect(operator.actorId).toMatch(/^act_/);
    return operator;
  }

  const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
  const provision = await jsonRequest(identityBase, "/internal/actor-roles/provision", controlToken, { phoneE164: phone, role: "operator" }, { "X-Acting-Actor-ID": existing.actorId });
  const operator = { actorId: String(provision.body?.actorId), phone, token: "", createdByTest: provision.response.status === 201 };
  if (operator.createdByTest && operator.actorId.startsWith("act_")) preparedOperatorForCleanup = operator;
  expect(provision.response.status, "governed operator provisioning must succeed").toBe(201);
  expect(operator.actorId).toMatch(/^act_/);
  const enrollment = await fetch(identityBase + "/internal/operator-enrollment-tokens", {
    method: "POST",
    headers: { Accept: "application/json", Authorization: "Bearer " + controlToken, "X-Acting-Actor-ID": existing.actorId, "Content-Type": "application/json" },
    body: JSON.stringify({ phoneE164: phone, role: "operator" }),
    signal: AbortSignal.timeout(5_000),
  });
  expect(enrollment.status, "governed operator enrollment token must be issued").toBe(201);
  const enrollmentBody = await enrollment.json() as { code?: string };
  operator.token = String(enrollmentBody.code);
  return operator;
}

test("@live operator passkey registration, authentication and governed recovery survive browser readback", async ({ page }) => {
  test.setTimeout(90_000);
  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const mailpitBase = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const bootstrapToken = requiredEnv("PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN");
  const operator = await prepareOperator(identityBase, controlToken, bootstrapToken);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await page.getByRole("button", { name: "تفعيل حساب موظف" }).click();
  await page.getByLabel("رقم الهاتف").fill(operator.phone);
  await page.getByLabel("دعوة التفعيل عالية الأمان").fill(operator.token);
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  const enrollmentCode = await waitForMailpitCode(mailpitBase, operator.phone, "operator_enroll");
  await page.getByLabel("رمز إثبات الهاتف").fill(enrollmentCode);
  await page.getByRole("button", { name: "إثبات الهاتف وتسجيل مفتاح المرور" }).click();
  await expect(page.getByRole("heading", { name: "احفظ هذا الاعتماد الآن" })).toBeVisible();
  const firstRecoveryCredential = await page.locator(".code-output").textContent();
  expect(firstRecoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  await page.getByRole("button", { name: "حفظت الاعتماد وفتح لوحة التحكم" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
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
  execFileSync("docker", ["compose", "--project-name", "samrim-local", "--env-file", runtime.envFile, "-f", path.join(runtime.repoRoot, "infra/local/compose/compose.yaml"), "stop", "identity"], { cwd: runtime.repoRoot, encoding: "utf8", stdio: "ignore" });
  try {
    const transientSession = await readBrowserSession(page);
    expect(transientSession.status).toBe(503);
    expect(transientSession.body.error.code).toBe("IDENTITY_UNAVAILABLE");
    expect((await page.context().cookies()).find((cookie) => cookie.name.endsWith("bt_identity_access"))?.value).toBe(accessBeforeOutage);
  } finally {
    restartIdentity();
  }

  await page.getByText("حساب المشغل", { exact: true }).click();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  const cookiesAfterExplicitLogout = await page.context().cookies();
  expect(cookiesAfterExplicitLogout.some((cookie) => cookie.name.endsWith("bt_identity_access") || cookie.name.endsWith("bt_identity_refresh"))).toBe(false);
  expect(cookiesAfterExplicitLogout.find((cookie) => cookie.name.endsWith("bt_identity_device"))?.value).toBeTruthy();
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
  await page.getByLabel("اعتماد الاسترداد").fill(String(firstRecoveryCredential));
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  const recoveryCode = await waitForMailpitCode(mailpitBase, operator.phone, "operator_recover");
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
