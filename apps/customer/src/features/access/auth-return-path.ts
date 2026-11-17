/** Only local paths without traversal may survive an authentication round trip. */
export function safeAuthReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 300 || !/^\/[a-zA-Z0-9/_-]*$/.test(value) || value.startsWith("//") || value.split("/").includes("..")) return "/";
  return value;
}
