/**
 * Resolve a host-owned internal return path without allowing protocol or
 * protocol-relative navigation. Route admission stays with the host app.
 */
export function resolveInternalReturnPath(value: string | string[] | undefined, fallback: string, admitted: RegExp): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) return fallback;
  return admitted.test(candidate) ? candidate : fallback;
}
