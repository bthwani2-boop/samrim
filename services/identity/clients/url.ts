declare const process: { env: Record<string, string | undefined> };

export function validateServiceUrl(value: string, name = "SERVICE_URL"): string {
  const trimmed = value.trim();
  const parsed = new URL(trimmed);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const localDevelopment = process.env.BTHWANI_ENV === "development" && loopbackHosts.has(parsed.hostname);
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:" && !localDevelopment) {
    throw new Error(`${name}_HTTPS_REQUIRED`);
  }
  return trimmed.replace(/\/+$/, "");
}
