import { identityOperations } from "@bthwani/identity";
import { type OperatorPermission, operatorPermissions } from "../features/session/operator-permissions.ts";
import type { OperatorPasskeyConfig } from "./operator-passkey-config.ts";

export function operatorPermissionOperation(permission: OperatorPermission) {
  const operation = identityOperations.getEffectiveOperatorPermission;
  return { method: operation.method, path: operation.path.replace("{permission}", permission) };
}

const allowedOwnerRequests = new Set([
  identityOperations.beginOperatorPasskeyAuthentication,
  identityOperations.finishOperatorPasskeyAuthentication,
  identityOperations.beginInitialOperatorPasskeyRegistration,
  identityOperations.finishInitialOperatorPasskeyRegistration,
  identityOperations.beginExistingOperatorPasskeyRecovery,
  identityOperations.finishExistingOperatorPasskeyRecovery,
  identityOperations.getVerifiedIdentitySession,
  identityOperations.revokeCurrentIdentitySession,
  ...operatorPermissions.map(operatorPermissionOperation),
].map(operation => `${operation.method} ${operation.path}`));

export async function operatorIdentityRequest(
  config: OperatorPasskeyConfig,
  operation: Readonly<{ path: string; method: string }>,
  init: Omit<RequestInit, "method">,
): Promise<Response> {
  const { method, path } = operation;
  if (!allowedOwnerRequests.has(`${method} ${path}`)) throw new Error("Unexpected Identity owner operation");
  return fetch(config.identityOrigin + path, {
    ...init,
    method,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
}

export async function boundedResponseJSON(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty Identity owner reply");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error("Oversized Identity owner reply");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
}

export async function boundedRequestBody(request: Request, maxBytes = 65536): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  let deadline: ReturnType<typeof setTimeout> | undefined;
  // The whole JSON assertion body, not each individual chunk, has a bounded
  // read deadline. A slow sender cannot keep the Passkey endpoint occupied.
  const consume = async (): Promise<boolean> => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return true;
      size += value.byteLength;
      if (size > maxBytes) return false;
      chunks.push(value);
    }
  };
  try {
    const complete = await Promise.race([
      consume(),
      new Promise<boolean>((resolve) => {
        deadline = setTimeout(() => resolve(false), 2000);
      }),
    ]);
    if (!complete) return null;
  } catch {
    return null;
  } finally {
    if (deadline) clearTimeout(deadline);
    // A stalled stream's cancellation may itself wait on a broken source.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (size === 0) return null;
  const combined = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    combined.set(chunk, pos);
    pos += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    return null;
  }
}

// Next.js can expose a zero-byte POST as a readable stream. Reject actual
// payload bytes instead of equating a non-null stream with a request body.
export async function isEmptyRequestBody(request: Request): Promise<boolean> {
  const length = request.headers.get("content-length");
  if ((length !== null && length !== "0") || request.headers.has("transfer-encoding")) return false;
  if (!request.body) return true;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = request.body.getReader(); } catch { return false; }
  let ended = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // Header spoofing must never allow a client to hold this endpoint open
    // indefinitely with a readable stream that neither sends nor closes.
    const first = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => {
        deadline = setTimeout(() => resolve(null), 1000);
      }),
    ]);
    ended = first?.done === true;
    return ended;
  } catch {
    return false;
  } finally {
    if (deadline) clearTimeout(deadline);
    // Cancel without waiting for a potentially uncooperative stream source.
    if (!ended) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
