declare const process: { env: Record<string, string | undefined> };

export function validateServiceUrl(value: string, name = "SERVICE_URL"): string {
  const trimmed = value.trim();
  const parsed = new URL(trimmed);
  // A production Next shell may still be part of the local integration
  // topology. In that topology service-to-service HTTP uses Docker DNS names
  // (for example, http://identity:8082), so NODE_ENV alone is not the
  // transport authority. BTHWANI_ENV is the runtime boundary that decides
  // whether local HTTP is allowed; non-local environments remain HTTPS-only.
  const localDevelopment = process.env.BTHWANI_ENV === "development";
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:" && !localDevelopment) {
    throw new Error(`${name}_HTTPS_REQUIRED`);
  }
  return trimmed.replace(/\/+$/, "");
}
