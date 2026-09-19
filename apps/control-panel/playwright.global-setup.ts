import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, type FullConfig } from "@playwright/test";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Control Panel Playwright runtime proof`);
  return value;
}

function canonicalControlOrigin(): string {
  const raw = process.env.PLAYWRIGHT_BASE_URL?.trim() || process.env.CONTROL_PANEL_PUBLIC_ORIGIN?.trim();
  if (!raw) throw new Error("PLAYWRIGHT_BASE_URL or CONTROL_PANEL_PUBLIC_ORIGIN is required for the Control Panel Playwright runtime proof");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Control Panel Playwright base URL is invalid: ${raw}`);
  }

  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.port === "" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Control Panel Playwright base URL must be an explicit HTTP loopback origin, received: ${raw}`);
  }

  return parsed.origin;
}

function canonicalControlSessionStatePath(): string {
  return path.join(
    process.env.BTHWANI_SECRETS_ROOT?.trim() || "C:\\BTHWANI-Secrets\\samrim",
    "control-playwright",
    "storage-state.json",
  );
}

function persistControlSessionState(statePath: string, state: unknown): void {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(state)}\n`;
  writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tempPath, statePath);
  } catch (error) {
    try { rmSync(tempPath, { force: true }); } catch { /* preserve the original failure */ }
    throw new Error(`Control reusable session state could not be persisted: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (readFileSync(statePath, "utf8") !== serialized) throw new Error("Control reusable session state readback mismatch");
}

async function refreshReusableControlSession(controlOrigin: string): Promise<void> {
  const statePath = canonicalControlSessionStatePath();
  if (!existsSync(statePath)) return;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: statePath, locale: "ar-YE" });
  try {
    const page = await context.newPage();
    const response = await page.goto(controlOrigin + "/api/auth/session", { waitUntil: "domcontentloaded" });
    const body = response ? await response.json().catch(() => null) as { identity?: { role?: string; surface?: string } } | null : null;
    if (response?.status() !== 200 || body?.identity?.role !== "operator" || body.identity.surface !== "control-panel") {
      throw new Error("canonical reusable Control session is not authenticated; refusing login, recovery, or reenrollment from Playwright");
    }
    persistControlSessionState(statePath, await context.storageState());
  } finally {
    await context.close();
    await browser.close();
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const controlOrigin = canonicalControlOrigin();
  try {
    const response = await fetch(controlOrigin + "/", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`Control Panel runtime preflight failed for ${controlOrigin}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (process.env.PLAYWRIGHT_LIVE_IDENTITY === "1") {
    requiredEnvironment("PLAYWRIGHT_IDENTITY_API_BASE_URL");
    requiredEnvironment("PLAYWRIGHT_MAILPIT_BASE_URL");
    requiredEnvironment("PLAYWRIGHT_IDENTITY_BOOTSTRAP_TOKEN");
    return;
  }

  await refreshReusableControlSession(controlOrigin);
}
