declare const process: { env: Record<string, string | undefined> };

export function validateServiceUrl(value: string, name = "SERVICE_URL"): string {
  const trimmed = value.trim();
  const parsed = new URL(trimmed);
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error(`${name}_HTTPS_REQUIRED`);
  }
  return trimmed.replace(/\/+$/, "");
}
