import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export type PreparedOperator = {
  actorId: string;
  phone: string;
  token: string;
  createdByTest: boolean;
};

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required for live Identity browser proof");
  return value;
}

export function assertIdentityProofScope(): void {
  const disposableCi = process.env.CI === "true" && process.env.BTHWANI_IDENTITY_PROOF_SCOPE === "disposable-ci";
  const isolatedLocalActors = process.env.BTHWANI_IDENTITY_PROOF_SCOPE === "isolated-local-actors";
  if (!disposableCi && !isolatedLocalActors) {
    throw new Error("live Identity proof requires disposable CI state or the isolated-local-actors scope");
  }
}

function readCanonicalRuntime(): { envFile: string; repoRoot: string; postgresUser: string; postgresDatabase: string } {
  const repoRoots = [path.resolve(process.cwd()), path.resolve(process.cwd(), "../..")];
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

export function cleanupPreparedOperator(operator: PreparedOperator): void {
  if (!operator.createdByTest) return;
  const runtime = readCanonicalRuntime();
  const actorLiteral = operator.actorId.replaceAll("'", "''");
  const query = `DELETE FROM identity_actors WHERE id='${actorLiteral}'; SELECT count(*) FROM identity_actors WHERE id='${actorLiteral}';`;
  const output = execFileSync(
    "docker",
    [
      "compose", "--project-name", "samrim-local", "--env-file", runtime.envFile,
      "-f", path.join(runtime.repoRoot, "infra/local/compose/compose.yaml"), "exec", "-T", "postgres",
      "psql", "-v", "ON_ERROR_STOP=1", "-U", runtime.postgresUser, "-d", runtime.postgresDatabase,
      "-Atc", query,
    ],
    { cwd: runtime.repoRoot, encoding: "utf8" },
  ).trim();
  if (output.split(/\r?\n/).at(-1) !== "0") throw new Error("live Identity fixture cleanup left actor data");
}

export async function jsonRequest(base: string, pathname: string, token: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5_000),
  });
  return { response, body: await response.json().catch(() => null) as Record<string, any> | null };
}

export async function findExistingOperator(identityBase: string, controlToken: string): Promise<PreparedOperator> {
  const response = await fetch(identityBase + "/internal/actor-roles/search?role=operator&limit=10", {
    headers: { Accept: "application/json", Authorization: "Bearer " + controlToken },
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.status, "an established primary operator must exist for the DSH fixture").toBe(200);
  const body = await response.json() as { items?: Array<{ actorId: string; phoneE164: string }> };
  const existing = body.items?.[0];
  expect(existing?.actorId).toMatch(/^act_/);
  expect(existing?.phoneE164).toMatch(/^\+9677/);
  return { actorId: String(existing?.actorId), phone: String(existing?.phoneE164), token: "", createdByTest: false };
}

export async function enrollAndAuthenticateIsolatedOperator(
  page: Page,
  permissions: string[] = [],
  onCreated?: (operator: PreparedOperator) => void,
): Promise<PreparedOperator> {
  assertIdentityProofScope();
  const identityBase = requiredEnv("PLAYWRIGHT_IDENTITY_API_BASE_URL").replace(/\/+$/, "");
  const controlToken = requiredEnv("PLAYWRIGHT_CONTROL_PANEL_SERVICE_TOKEN");
  const mailpitBase = requiredEnv("PLAYWRIGHT_MAILPIT_BASE_URL").replace(/\/+$/, "");
  const baseUrl = requiredEnv("PLAYWRIGHT_BASE_URL").replace(/\/+$/, "");
  const primaryOperator = await findExistingOperator(identityBase, controlToken);
  const operator = await provisionIndependentOperator(identityBase, controlToken, primaryOperator.actorId, onCreated);
  for (const permission of permissions) await enableOperatorPermission(identityBase, controlToken, primaryOperator.actorId, operator.actorId, permission);
  await enableVirtualAuthenticator(page);
  await registerOperator(page, operator, baseUrl, mailpitBase);
  return operator;
}

async function enableOperatorPermission(identityBase: string, controlToken: string, actingOperatorID: string, actorID: string, permission: string): Promise<void> {
  const pathName = `/internal/operators/${encodeURIComponent(actorID)}/permissions/${encodeURIComponent(permission)}`;
  const headers = { Accept: "application/json", Authorization: "Bearer " + controlToken, "X-Acting-Actor-ID": actingOperatorID };
  const read = await fetch(identityBase + pathName, { headers, signal: AbortSignal.timeout(5_000) });
  const current = await read.json().catch(() => null) as Record<string, any> | null;
  expect(read.status, `${permission} permission readback must succeed`).toBe(200);
  expect(current?.actorId).toBe(actorID);
  expect(current?.permission).toBe(permission);
  expect(Number.isSafeInteger(current?.version)).toBe(true);
  if (current?.enabled === true) return;

  const changed = await fetch(identityBase + pathName, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-Correlation-ID": randomUUID(),
      "X-Expected-Version": String(current?.version),
      "X-Reason": `isolated browser proof actor ${permission} permission`,
    },
    body: JSON.stringify({ enabled: true }),
    signal: AbortSignal.timeout(5_000),
  });
  const result = await changed.json().catch(() => null) as Record<string, any> | null;
  expect(changed.status, `${permission} permission should be granted only to the isolated proof actor`).toBe(200);
  expect(result).toMatchObject({ actorId: actorID, permission, enabled: true, version: Number(current?.version) + 1 });
}

export async function provisionIndependentOperator(
  identityBase: string,
  controlToken: string,
  actingOperatorID: string,
  onCreated?: (operator: PreparedOperator) => void,
): Promise<PreparedOperator> {
  const phone = "+9677" + String(randomInt(10_000_000, 99_999_999));
  const provision = await jsonRequest(identityBase, "/internal/actor-roles/provision", controlToken, { phoneE164: phone, role: "operator" }, { "X-Acting-Actor-ID": actingOperatorID });
  expect(provision.response.status, "independent operator provisioning must succeed").toBe(201);
  const actorId = String(provision.body?.actorId || "");
  expect(actorId).toMatch(/^act_/);
  const operator: PreparedOperator = { actorId, phone, token: "", createdByTest: true };
  onCreated?.(operator);
  const enrollment = await jsonRequest(identityBase, "/internal/operator-enrollment-tokens", controlToken, { phoneE164: phone, role: "operator" }, { "X-Acting-Actor-ID": actingOperatorID });
  expect(enrollment.response.status, "independent operator enrollment token must be issued").toBe(201);
  operator.token = String(enrollment.body?.code || "");
  expect(operator.token).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  return operator;
}

export async function waitForMailpitCode(mailpitBaseUrl: string, phone: string, purpose: string, sentAfter: number): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(mailpitBaseUrl + "/api/v1/messages?limit=50", { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        const body = await response.json() as { messages?: Array<{ Created?: string; Snippet?: string }> };
        const message = body.messages?.find((candidate) => {
          const createdAt = Date.parse(String(candidate.Created || ""));
          const snippet = String(candidate.Snippet || "");
          return createdAt >= sentAfter && snippet.includes("Phone: " + phone) && snippet.includes("Purpose: " + purpose);
        })?.Snippet || "";
        if (message) {
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

export async function enableVirtualAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
}

export async function registerOperator(page: Page, operator: PreparedOperator, baseUrl: string, mailpitBase: string): Promise<string> {
  await page.goto(baseUrl + "/");
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await page.getByRole("button", { name: "تفعيل حساب موظف" }).click();
  await page.getByLabel("رقم الهاتف").fill(operator.phone);
  await page.getByLabel("دعوة التفعيل عالية الأمان").fill(operator.token);
  const challengeSentAt = Date.now();
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  const enrollmentCode = await waitForMailpitCode(mailpitBase, operator.phone, "operator_enroll", challengeSentAt);
  await page.getByLabel("رمز إثبات الهاتف").fill(enrollmentCode);
  await page.getByRole("button", { name: "إثبات الهاتف وتسجيل مفتاح المرور" }).click();
  await expect(page.getByRole("heading", { name: "احفظ هذا الاعتماد الآن" })).toBeVisible();
  const recoveryCredential = await page.locator(".code-output").textContent();
  expect(recoveryCredential).toMatch(/^[A-Za-z0-9_-]{24,256}$/);
  await page.getByRole("button", { name: "حفظت الاعتماد وفتح لوحة التحكم" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  return String(recoveryCredential);
}
