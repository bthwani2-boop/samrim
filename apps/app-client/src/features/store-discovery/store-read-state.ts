// The marketplace public Store projection is the authority for visibility.
// Treat access-denied, absent and withdrawn Stores identically; never disclose
// whether an unpublished/private Store ID exists.
export function storeReadFailureKind(error: unknown): "unavailable" | "error" {
  if (!error || typeof error !== "object") return "error";
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403 || status === 404 || status === 410 ? "unavailable" : "error";
}
