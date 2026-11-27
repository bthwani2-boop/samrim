import { identityOperations } from "@bthwani/identity";
import { type OperatorPermission, operatorPermissions } from "../features/session/operator-permissions.ts";
import type { OperatorPasskeyConfig } from "./operator-passkey-config.ts";

const limits = { owner: 5000, assertion: 2000, empty: 1000, json: 65536 } as const;

type OwnerOperation = Readonly<{ method: string; path: string }>;
type BodyMode = "owner-json" | "request" | "empty";
type BodyPolicy = Readonly<{ maxBytes: number; timeoutMs: number; mode: BodyMode }>;

export function operatorPermissionOperation(permission: OperatorPermission): OwnerOperation {
  const operation = identityOperations.getEffectiveOperatorPermission;
  return { method: operation.method, path: operation.path.replace("{permission}", permission) };
}

function operationKey(operation: OwnerOperation): string {
  return operation.method + " " + operation.path;
}

const ownerOperations = new Map<string, number>([
  [operationKey(identityOperations.beginOperatorPasskeyAuthentication), 200],
  [operationKey(identityOperations.finishOperatorPasskeyAuthentication), 200],
  [operationKey(identityOperations.beginInitialOperatorPasskeyRegistration), 200],
  [operationKey(identityOperations.finishInitialOperatorPasskeyRegistration), 201],
  [operationKey(identityOperations.beginExistingOperatorPasskeyRecovery), 200],
  [operationKey(identityOperations.finishExistingOperatorPasskeyRecovery), 200],
  [operationKey(identityOperations.getVerifiedIdentitySession), 200],
  [operationKey(identityOperations.revokeCurrentIdentitySession), 204],
  ...operatorPermissions.map(permission => [operationKey(operatorPermissionOperation(permission)), 200] as const),
]);

// A single cleanup boundary covers both native getters and cancellation
// promises; a failed cleanup cannot replace the authoritative outcome.
async function discard(acquire: () => { cancel(): Promise<void> } | null): Promise<void> {
  try {
    await acquire()?.cancel();
  } catch {
    // Cleanup is best effort and never delays the caller.
  }
}

function discardResponse(response: Response): void {
  void discard(() => {
    const body = response.body;
    return body && !body.locked ? body : null;
  });
}

function privateReply(headers: Headers): boolean {
  return headers.get("cache-control")?.split(",")
    .some(directive => directive.trim().toLowerCase() === "no-store") ?? false;
}

function emptyDeclaration(headers: Headers): boolean {
  const length = headers.get("content-length");
  return (length === null || length === "0") && !headers.has("transfer-encoding");
}

// Exact status is the first admission boundary. Non-admitted status bodies
// stay owned by the transport. A successful empty receipt must independently
// establish privacy and absence of a representation before it is returned.
export async function operatorIdentityRequest(
  config: OperatorPasskeyConfig,
  operation: OwnerOperation,
  init: Omit<RequestInit, "method">,
): Promise<Response> {
  const expected = ownerOperations.get(operationKey(operation));
  if (expected === undefined) throw new Error("Unexpected Identity owner operation");
  const response = await fetch(config.identityOrigin + operation.path, {
    ...init,
    method: operation.method,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(limits.owner),
  });
  if (response.status !== expected) {
    discardResponse(response);
  } else if (expected === 204) {
    try {
      if (!privateReply(response.headers) || !emptyDeclaration(response.headers) || response.body !== null) {
        throw new Error("Unexpected Identity empty receipt");
      }
    } finally {
      discardResponse(response);
    }
  }
  return response;
}

function admitsDeclaration(headers: Headers, policy: BodyPolicy): boolean {
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 0 || policy.maxBytes > limits.json) return false;
  if (policy.mode === "empty") return emptyDeclaration(headers);
  if (policy.mode === "owner-json" && (!privateReply(headers) ||
      headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")) return false;
  const length = headers.get("content-length");
  return length === null || (/^\d+$/.test(length) && Number(length) <= policy.maxBytes);
}

// One bounded reader for requests and owner responses. Metadata is verified
// before reading any bytes; acquire first so rejected declarations are disposed.
async function admittedBytes(message: Request | Response, policy: BodyPolicy): Promise<Uint8Array> {
  const reader = message.body?.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  try {
    if (!admitsDeclaration(message.headers, policy)) throw new Error("Unexpected body declaration");
    if (!reader) {
      if (policy.mode !== "empty") throw new Error("Missing body");
      return new Uint8Array(0);
    }
    const expires = performance.now() + policy.timeoutMs;
    const consume = async (): Promise<Uint8Array> => {
      const buffer = new Uint8Array(policy.maxBytes);
      let size = 0;
      for (;;) {
        if (performance.now() >= expires) throw new Error("Body read deadline exceeded");
        const { done, value } = await reader.read();
        if (done) return buffer.subarray(0, size);
        if (policy.mode === "empty" || value.byteLength > policy.maxBytes - size) {
          throw new Error("Unexpected body size");
        }
        buffer.set(value, size);
        size += value.byteLength;
      }
    };
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Body read deadline exceeded")), policy.timeoutMs);
    });
    const bytes = await Promise.race([consume(), deadline]);
    complete = true;
    return bytes;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (reader) {
      if (!complete) void discard(() => reader);
      reader.releaseLock();
    }
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function boundedResponseJSON(response: Response): Promise<unknown> {
  return JSON.parse(decode(await admittedBytes(response, {
    maxBytes: limits.json, timeoutMs: limits.owner, mode: "owner-json",
  })));
}

export async function boundedRequestBody(request: Request, maxBytes: number = limits.json): Promise<string | null> {
  try {
    const bytes = await admittedBytes(request, { maxBytes, timeoutMs: limits.assertion, mode: "request" });
    return bytes.byteLength === 0 ? null : decode(bytes);
  } catch {
    return null;
  }
}

export async function isEmptyRequestBody(request: Request): Promise<boolean> {
  try {
    await admittedBytes(request, { maxBytes: 0, timeoutMs: limits.empty, mode: "empty" });
    return true;
  } catch {
    return false;
  }
}
