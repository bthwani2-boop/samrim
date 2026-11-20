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

export function isDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

// One bounded JSON transport parser for DSH public and private owner replies.
// A successful decode does not grant authority: domain clients still validate
// every schema field and actor/Store binding after parsing.
export async function readBoundedOwnerJSON(response: Response, maxTextLength: number): Promise<unknown> {
  const maxBytes = 3 * maxTextLength; // UTF-8 bytes per UTF-16 code unit are at most 3.
  if (Number(response.headers.get("Content-Length")) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Oversized DSH owner reply");
  }
  // React Native may expose only text() instead of a ReadableStream.
  if (!response.body?.getReader || typeof TextDecoder !== "function") {
    const text = await response.text();
    if (text.length > maxTextLength) throw new Error("Oversized DSH owner reply");
    return JSON.parse(text) as unknown;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Oversized DSH owner reply");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.length > maxTextLength) throw new Error("Oversized DSH owner reply");
  return JSON.parse(text) as unknown;
}
