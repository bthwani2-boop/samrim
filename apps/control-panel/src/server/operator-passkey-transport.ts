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
type Cancellable = Pick<ReadableStream<Uint8Array>, "cancel">;

export function operatorPermissionOperation(permission: OperatorPermission): OwnerOperation {
  const operation = identityOperations.getEffectiveOperatorPermission;
  return { method: operation.method, path: operation.path.replace("{permission}", permission) };
}

function operationKey(operation: OwnerOperation): string {
  return operation.method + " " + operation.path;
}

// Each contract admits exactly one success status. Only its JSON response
// may transfer body ownership to the domain parser; all other responses
// retain the transport's cleanup responsibility.
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

async function cancelRejected(source: Cancellable): Promise<void> {
  try {
    await source.cancel();
  } catch {
    // Cleanup is best effort and never changes the admitted outcome.
  }
}

async function discardResponse(response: Response): Promise<void> {
  try {
    const body = response.body;
    if (body && !body.locked) await body.cancel();
  } catch {
    // Native getter/cancellation failures cannot replace the owner status.
  }
}

export async function operatorIdentityRequest(
  config: OperatorPasskeyConfig,
  operation: OwnerOperation,
  init: Omit<RequestInit, "method">,
): Promise<Response> {
  const admittedStatus = ownerOperations.get(operationKey(operation));
  if (admittedStatus === undefined) throw new Error("Unexpected Identity owner operation");
  const response = await fetch(config.identityOrigin + operation.path, {
    ...init,
    method: operation.method,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(limits.owner),
  });
  if (response.status !== admittedStatus || admittedStatus === 204) {
    void discardResponse(response);
  }
  return response;
}

function admitsDeclaration(headers: Headers, policy: BodyPolicy): boolean {
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 0 || policy.maxBytes > limits.json) return false;
  const length = headers.get("content-length");
  if (policy.empty) {
    return (length === null || length === "0") && !headers.has("transfer-encoding");
  }
  return length === null || (/^\d+$/.test(length) && Number(length) <= policy.maxBytes);
}

// One admission, bounded read and cleanup path for all three body policies.
// Acquire the reader before rejecting headers; no inadmissible bytes are read.
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
    const consume = async (): Promise<Uint8Array> => {
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
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Body read deadline exceeded")), policy.timeoutMs);
    });
    const bytes = await Promise.race([consume(), deadline]);
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
