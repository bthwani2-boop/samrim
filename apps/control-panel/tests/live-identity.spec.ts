import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

type PreparedOperator = {
  actorId: string;
  phone: string;
  token: string;
  createdByTest: boolean;
};

let preparedOperatorForCleanup: PreparedOperator | undefined;

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
  const candidates = [
    path.resolve(process.cwd(), "infra/local/compose/.env"),
    path.resolve(process.cwd(), "../../infra/local/compose/.env"),
  ];
  const envFile = candidates.find((candidate) => existsSync(candidate));
  if (!envFile) throw new Error("canonical local runtime environment is required for live Identity fixture cleanup");
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
  return { envFile, repoRoot: path.resolve(path.dirname(envFile), "../../.."), postgresUser, postgresDatabase };
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

test.afterEach(() => {
  const operator = preparedOperatorForCleanup;
  preparedOperatorForCleanup = undefined;
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
    const operator = { actorId: String(bootstrap.body?.actorId), phone, token: String(bootstrap.body?.enrollmentToken?.code), createdByTest: false };
    preparedOperatorForCleanup = operator;
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
  test.setTimeout(60_000);
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
  await expect(page.getByRole("heading", { name: "أهلاً بك في مساحة العمل" })).toBeVisible();
  const firstSession = await page.evaluate(async () => { const response = await fetch("/api/auth/session", { cache: "no-store" }); return { status: response.status, body: await response.json() }; });
  expect(firstSession.status).toBe(200);
  expect(firstSession.body.identity.role).toBe("operator");
  expect(firstSession.body.identity.surface).toBe("control-panel");

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await page.getByRole("button", { name: "الدخول بمفتاح المرور" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("المشغل", { exact: true }).first()).toBeVisible();

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
  const recoveredSession = await page.evaluate(async () => { const response = await fetch("/api/auth/session", { cache: "no-store" }); return { status: response.status, body: await response.json() }; });
  expect(recoveredSession.status).toBe(200);
  expect(recoveredSession.body.identity.role).toBe("operator");
  expect(recoveredSession.body.identity.surface).toBe("control-panel");
});
