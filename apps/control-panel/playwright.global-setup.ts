import type { FullConfig } from "@playwright/test";

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
    parsed.hostname !== "127.0.0.1" ||
    parsed.port === "" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Control Panel Playwright base URL must be an explicit HTTP IPv4-loopback origin, received: ${raw}`);
  }

  return parsed.origin;
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
  }
}
