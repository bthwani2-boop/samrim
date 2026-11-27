import { identityOperations } from "@bthwani/identity";
import { type OperatorPermission, operatorPermissions } from "../features/session/operator-permissions.ts";
import type { OperatorPasskeyConfig } from "./operator-passkey-config.ts";

const limits = {
  owner: 5000,
  assertion: 2000,
  empty: 1000,
  json: 65536,
} as const;

type OwnerOperation = Readonly<{ method: string; path: string }>;
type BodyPolicy = Readonly<{ maxBytes: number; timeoutMs: number; empty: boolean }>;

export function operatorPermissionOperation(permission: OperatorPermission): OwnerOperation {
  const operation = identityOperations.getEffectiveOperatorPermission;
  return { method: operation.method, path: operation.path.replace("{permission}", permission) };
}

const ownerOperations = new Set([
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
  operation: OwnerOperation,
  init: Omit<RequestInit, "method">,
): Promise<Response> {
  if (!ownerOperations.has(operation.method + " " + operation.path)) {
    throw new Error("Unexpected Identity owner operation");
  }
  return fetch(config.identityOrigin + operation.path, {
    ...init,
    method: operation.method,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(limits.owner),
  });
}

function admitsDeclaration(headers: Headers, policy: BodyPolicy): boolean {
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 0 || policy.maxBytes > limits.json) return false;
  const length = headers.get("content-length");
  if (policy.empty) {
    return (length === null || length === "0") && !headers.has("transfer-encoding");
  }
  return length === null || (/^\d+$/.test(length) && Number(length) <= policy.maxBytes);
}

async function cancelRejected(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best effort: never wait for an uncooperative source.
  }
}

// All three body policies use one admission, bounded read and cleanup path.
// Acquire the reader before rejecting headers so the rejected source is
// cancelled as well. No bytes are read for inadmissible declarations.
async function admittedBytes(message: Request | Response, policy: BodyPolicy): Promise<Uint8Array> {
  const reader = message.body?.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  try {
    if (!admitsDeclaration(message.headers, policy)) throw new Error("Unexpected body declaration");
    if (!reader) {
      if (!policy.empty) throw new Error("Missing body");
      return new Uint8Array(0);
    }
    const expires = performance.now() + policy.timeoutMs;
    const consume = async () => {
      const buffer = new Uint8Array(policy.maxBytes);
      let size = 0;
      for (;;) {
        if (performance.now() >= expires) throw new Error("Body read deadline exceeded");
        const { done, value } = await reader.read();
        if (done) return buffer.subarray(0, size);
        if (policy.empty || value.byteLength > policy.maxBytes - size) {
          throw new Error("Unexpected body size");
        }
        buffer.set(value, size);
        size += value.byteLength;
      }
    };
    const bytes = await Promise.race([
      consume(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Body read deadline exceeded")), policy.timeoutMs);
      }),
    ]);
    complete = true;
    return bytes;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (reader) {
      if (!complete) void cancelRejected(reader);
      reader.releaseLock();
    }
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function boundedResponseJSON(response: Response): Promise<unknown> {
  const bytes = await admittedBytes(response, {
    maxBytes: limits.json, timeoutMs: limits.owner, empty: false,
  });
  return JSON.parse(decode(bytes));
}

export async function boundedRequestBody(request: Request, maxBytes: number = limits.json): Promise<string | null> {
  try {
    const bytes = await admittedBytes(request, {
      maxBytes, timeoutMs: limits.assertion, empty: false,
    });
    return bytes.byteLength === 0 ? null : decode(bytes);
  } catch {
    return null;
  }
}

export async function isEmptyRequestBody(request: Request): Promise<boolean> {
  try {
    await admittedBytes(request, { maxBytes: 0, timeoutMs: limits.empty, empty: true });
    return true;
  } catch {
    return false;
  }
}
