import type { Href } from "expo-router";

import { resolveInternalReturnPath } from "@bthwani/identity/presentation/return-path";

export type ClientIdentitySearchContext = Readonly<{
  focus?: string | string[] | undefined;
  q?: string | string[] | undefined;
  scope?: string | string[] | undefined;
}>;

const admittedClientReturnPath = /^\/(?:home|account|wallet|addresses|multi-store-checkout|orders(?:\/[A-Za-z0-9._~%-]+)?|store\/[A-Za-z0-9._~%-]+|cart\/[A-Za-z0-9._~%-]+)$/u;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveClientIdentityReturnHref(
  value: string | string[] | undefined,
  search: ClientIdentitySearchContext = {},
): Href {
  const path = resolveInternalReturnPath(value, "/home", admittedClientReturnPath);
  if (path !== "/home") return path as Href;

  const focus = first(search.focus);
  const query = first(search.q) ?? "";
  const scope = first(search.scope);
  if (focus !== "search" && !query.trim()) return path as Href;

  return {
    pathname: "/home",
    params: {
      focus: "search",
      ...(query ? { q: query } : {}),
      ...(scope === "products" ? { scope } : {}),
    },
  } as Href;
}
