// Preserve one operator's queue position in this tab without copying private filters
// and opaque server cursors into the case-detail URL.
const sessionKey = "bthwani-joining-return";
const validQueryKeys = new Set(["state", "sort", "q", "cursor"]);
const ttlMillis = 60 * 60 * 1000;

export function rememberJoiningQueueReturn(caseId: string) {
  if (typeof window === "undefined") return;
  try {
    const href = window.location.pathname + window.location.search;
    window.sessionStorage.setItem(sessionKey, JSON.stringify({ caseId, href, at: Date.now() }));
  } catch {
    // Storage may be disabled. A plain queue link remains available.
  }
}

export function readJoiningQueueReturn(caseId: string): string {
  const fallback = "/partners/joining";
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(sessionKey);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as { caseId?: unknown; href?: unknown; at?: unknown };
    if (saved.caseId !== caseId || typeof saved.href !== "string" || typeof saved.at !== "number" || Date.now() - saved.at > ttlMillis || saved.at > Date.now()) return fallback;
    const destination = new URL(saved.href, window.location.origin);
    if (destination.origin !== window.location.origin || destination.pathname !== fallback ||
      Array.from(destination.searchParams.keys()).some((key) => !validQueryKeys.has(key)) ||
      (destination.searchParams.get("q")?.length ?? 0) > 128 ||
      (destination.searchParams.get("cursor")?.length ?? 0) > 2400) return fallback;
    return destination.pathname + destination.search;
  } catch {
    return fallback;
  }
}
