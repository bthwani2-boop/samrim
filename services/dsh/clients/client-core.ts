/** Shared DSH SDK error, endpoint safety and strict object-key checks. No domain writers. */
export class DshPublicError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "DshPublicError";
    this.status = status;
    this.code = code;
  }
}
export function endpoint(baseUrl: string, path: string): URL {
  if (!baseUrl) throw new DshPublicError(0, "DSH_ENDPOINT_NOT_CONFIGURED");
  let root: URL;
  try {
    root = new URL(baseUrl);
  } catch {
    throw new DshPublicError(0, "DSH_ENDPOINT_INVALID");
  }
  if (root.username || root.password || root.pathname !== "/" || root.search || root.hash ||
    !(root.protocol === "https:" ||
      (root.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(root.hostname)))) {
    throw new DshPublicError(0, "DSH_ENDPOINT_UNSAFE");
  }
  const pathname = path.split("?")[0] ?? "";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") ||
    path.includes("#") || Array.from(path).some(character =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    /(^|\/)(?:\.|%2e){1,2}(\/|$)/i.test(pathname)) {
    throw new DshPublicError(0, "DSH_ENDPOINT_UNSAFE");
  }
  // URL accepts absolute and network-path inputs, so resolve only after
  // checking that the owner-authored path cannot select a different host.
  const target = new URL(path, root);
  if (target.origin !== root.origin) throw new DshPublicError(0, "DSH_ENDPOINT_UNSAFE");
  return target;
}

export function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
