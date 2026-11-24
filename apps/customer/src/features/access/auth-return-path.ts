/** Only local paths without traversal may survive an authentication round trip. */
export function safeAuthReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 300 || !/^\/[a-zA-Z0-9/_-]*$/.test(value) || value.startsWith("//") || value.split("/").includes("..")) return "/";
  return value;
}

/** Authentication continuation is limited to explicit screen destinations, never API or mutation routes. */
export function customerAuthDestination(value: unknown): "/" | "/account" | "/wallet" | "/addresses" | "/orders" {
  const path = safeAuthReturnPath(value);
  switch (path) {
    case "/account":
    case "/wallet":
    case "/addresses":
    case "/orders":
      return path;
    default:
      return "/";
  }
}
