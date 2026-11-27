import { identityOperations } from "@bthwani/identity";
import { type OperatorPermission, operatorPermissions } from "../features/session/operator-permissions.ts";
import type { OperatorPasskeyConfig } from "./operator-passkey-config.ts";

const ownerDeadlineMs = 5000;
const assertionDeadlineMs = 2000;
const emptyDeadlineMs = 1000;
const jsonLimit = 65536;

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
].map(({ method, path }) => method + " " + path));

export async function operatorIdentityRequest(
  config: OperatorPasskeyConfig,
  operation: Readonly<{ path: string; method: string }>,
  init: Omit<RequestInit, "method">,
): Promise<Response> {
  const { method, path } = operation;
  if (!allowedOwnerRequests.has(method + " " + path)) throw new Error("Unexpected Identity owner operation");
  return fetch(config.identityOrigin + path, {
    ...init,
    method,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(ownerDeadlineMs),
  });
}

function declaredLengthAllowed(headers: Headers, limit: number): boolean {
  const length = headers.get("content-length");
  return length === null || (/^\d+$/.test(length) && Number(length) <= limit);
}

// One bounded stream owner for browser requests and Identity replies. A
// deadline covers the entire body, including a source that ignores fetch
// cancellation. A rejected body is cancelled without waiting for its source.
async function readBody(
  body: ReadableStream<Uint8Array>,
  limit: number,
  timeoutMs: number,
  emptyOnly = false,
): Promise<Uint8Array> {
  const reader = body.getReader();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  const consume = async (): Promise<Uint8Array> => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (emptyOnly || size + value.byteLength > limit) throw new Error("Unexpected body size");
      chunks.push(value);
      size += value.byteLength;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };
  try {
    const bytes = await Promise.race([
      consume(),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error("Body read deadline exceeded")), timeoutMs);
      }),
    ]);
    complete = true;
    return bytes;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

export async function boundedResponseJSON(response: Response): Promise<unknown> {
  if (!response.body || !declaredLengthAllowed(response.headers, jsonLimit)) {
    throw new Error("Invalid Identity owner body");
  }
  return JSON.parse(decode(await readBody(response.body, jsonLimit, ownerDeadlineMs)));
}

export async function boundedRequestBody(request: Request, maxBytes = jsonLimit): Promise<string | null> {
  if (!request.body || !declaredLengthAllowed(request.headers, maxBytes)) return null;
  try {
    const bytes = await readBody(request.body, maxBytes, assertionDeadlineMs);
    return bytes.byteLength === 0 ? null : decode(bytes);
  } catch {
    return null;
  }
}

// Next.js may expose a zero-byte POST as a readable stream. No chunks
// (including zero-length chunks), transfer encoding or nonzero declaration
// may reach a body-free endpoint. Malformed or stalled streams fail closed.
export async function isEmptyRequestBody(request: Request): Promise<boolean> {
  const length = request.headers.get("content-length");
  if ((length !== null && length !== "0") || request.headers.has("transfer-encoding")) return false;
  if (!request.body) return true;
  try {
    await readBody(request.body, 0, emptyDeadlineMs, true);
    return true;
  } catch {
    return false;
  }
}
