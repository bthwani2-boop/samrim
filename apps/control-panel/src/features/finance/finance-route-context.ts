/** Keep operators inside the financial workspace while legacy action components paginate/filter. */
export function preserveFinanceRouteContext(params: URLSearchParams, pathname?: string): void {
  if (typeof window === "undefined" || (pathname ?? window.location.pathname) !== "/finance") return;
  const current = new URLSearchParams(window.location.search);
  for (const key of ["tab", "workflow"] as const) {
    const value = current.get(key);
    if (value) params.set(key, value);
  }
}
