export const captainReturnPathPattern = /^(?:\/home|\/notifications|\/offers(?:\?q=[^&#]*)?|\/deliveries|\/wallet|\/account)$/u;

export function captainProtectedReturnTo(pathname: string, query: string | string[] | undefined): string {
  if (pathname !== "/offers") return pathname;
  const orderID = Array.isArray(query) ? query[0] : query;
  return orderID ? `${pathname}?q=${encodeURIComponent(orderID)}` : pathname;
}
