import { resolveDirection, type Direction } from "@bthwani/design-system";

export type IdentityLocale = "ar" | "en";

export function resolveIdentityLocale(languageCode?: string | null): IdentityLocale {
  return languageCode?.trim().toLowerCase().startsWith("en") ? "en" : "ar";
}

export function resolveIdentityDirection(languageCode?: string | null): Direction {
  return resolveDirection(resolveIdentityLocale(languageCode));
}
