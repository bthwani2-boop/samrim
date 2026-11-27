import { DshPublicError } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type CustomerCartDirectoryEntry = Readonly<{
  storeId: string;
  storeName: string;
  version: number;
  lineCount: number;
}>;
export type CustomerCartDirectory = Readonly<{
  actorId: string;
  carts: CustomerCartDirectoryEntry[];
  nextCursor?: string;
}>;

const pageLimit = 20;
const bearerRule = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
function storeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
}
function actorId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "") === value &&
    !/[\p{Cc}\p{Cs}]/u.test(value) && new TextEncoder().encode(value).length <= 128;
}
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function positiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max;
}
function invalid(): never {
  throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
}

function admitEntry(value: unknown, previous: string): CustomerCartDirectoryEntry {
  if (!record(value, ["storeId", "storeName", "version", "lineCount"])) return invalid();
  const { storeId: id, storeName, version, lineCount } = value;
  if (!storeId(id) || id <= previous || typeof storeName !== "string" ||
      [...storeName].length > 120 || /\p{Cs}/u.test(storeName) ||
      !positiveInteger(version) || !positiveInteger(lineCount, pageLimit)) return invalid();
  return { storeId: id, storeName, version, lineCount };
}

export function parseCustomerCartDirectory(value: unknown, actor: string, after = ""): CustomerCartDirectory {
  if (!actorId(actor) || (after !== "" && !storeId(after)) || value === null ||
      typeof value !== "object" || Array.isArray(value)) return invalid();
  const hasCursor = Object.hasOwn(value, "nextCursor");
  if (!record(value, hasCursor ? ["actorId", "carts", "nextCursor"] : ["actorId", "carts"]) ||
      value.actorId !== actor || !Array.isArray(value.carts) || value.carts.length > pageLimit) return invalid();
  const carts: CustomerCartDirectoryEntry[] = [];
  let previous = after;
  for (const raw of value.carts) {
    const entry = admitEntry(raw, previous);
    carts.push(entry);
    previous = entry.storeId;
  }
  if (!hasCursor) return { actorId: actor, carts };
  if (carts.length !== pageLimit || value.nextCursor !== previous) return invalid();
  return { actorId: actor, carts, nextCursor: previous };
}

export async function listCurrentCustomerCarts(
  origin: string, bearer: string, actor: string, after?: string, signal?: AbortSignal,
): Promise<CustomerCartDirectory> {
  if (typeof bearer !== "string" || !bearerRule.test(bearer) || !actorId(actor)) {
    throw new DshPublicError(401, "UNAUTHENTICATED");
  }
  if (after !== undefined && !storeId(after)) throw new DshPublicError(400, "INVALID_REQUEST");
  const match = typeof origin === "string" && /^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):([1-9][0-9]{0,4})$/.exec(origin);
  if (!match || Number(match[1]) > 65535) throw new DshPublicError(503, "OWNER_UNAVAILABLE");
  const operation = dshOperations.listCurrentCustomerCarts;
  const path = after === undefined ? operation.path : `${operation.path}?after=${after}`;
  const value = await privateOwnerRequest(origin, path, bearer, operation.method, undefined, signal);
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return parseCustomerCartDirectory(value, actor, after);
}
