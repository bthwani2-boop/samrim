// Public WLT read-only SDK. The owner alone selects and writes financial facts.
import { wltOperations } from "./generated/wlt-operations.ts";

export interface CustomerWalletBalance {
  actorId: string;
  currency: "YER";
  balanceYer: string;
}
export interface CustomerFundingTransaction {
  fundingId: string;
  amountYer: string;
  postedAt: string;
  reversesFundingId?: string;
}
export interface CustomerFundingHistory {
  actorId: string;
  currency: "YER";
  items: CustomerFundingTransaction[];
  hasMore: boolean;
  nextCursor: string | null;
}

export class WltReadError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("WLT wallet read unavailable");
    this.name = "WltReadError";
    this.status = status;
  }
}

const actorValid = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && Array.from(id).length <= 128 &&
  id.trim() === id && !/\p{Cc}/u.test(id);
const amountValid = (value: unknown, positive: boolean): value is string =>
  typeof value === "string" &&
  (positive ? /^[1-9][0-9]{0,37}$/ : /^(0|[1-9][0-9]{0,37})$/).test(value);
const fundingIdValid = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(value);

// Match WLT's RFC3339Nano|fundingId keyset cursor without Node-only Buffer
// or browser-only btoa (the Customer SDK also runs in React Native).
function encodeFundingCursor(last: CustomerFundingTransaction): string {
  const value = `${last.postedAt}|${last.fundingId}`;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";
  for (let i = 0; i < value.length; i += 3) {
    const first = value.charCodeAt(i);
    const second = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
    const third = i + 2 < value.length ? value.charCodeAt(i + 2) : 0;
    encoded += alphabet.charAt(first >>> 2) + alphabet.charAt(((first & 3) << 4) | (second >>> 4));
    if (i + 1 < value.length) encoded += alphabet.charAt(((second & 15) << 2) | (third >>> 6));
    if (i + 2 < value.length) encoded += alphabet.charAt(third & 63);
  }
  return encoded;
}

export function parseCustomerWalletBalance(value: unknown): CustomerWalletBalance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WltReadError(502);
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 3 || !actorValid(fields.actorId) ||
    fields.currency !== "YER" || !amountValid(fields.balanceYer, false)) throw new WltReadError(502);
  return { actorId: fields.actorId, currency: "YER", balanceYer: fields.balanceYer };
}

export function parseCustomerFundingHistory(value: unknown): CustomerFundingHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WltReadError(502);
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 5 || !actorValid(fields.actorId) ||
    fields.currency !== "YER" || typeof fields.hasMore !== "boolean" ||
    !Array.isArray(fields.items) || fields.items.length > 10 ||
    (fields.nextCursor !== null && (typeof fields.nextCursor !== "string" ||
      !/^[A-Za-z0-9_-]{20,240}$/.test(fields.nextCursor))) ||
    fields.hasMore !== (fields.nextCursor !== null) ||
    (fields.hasMore && fields.items.length !== 10)) throw new WltReadError(502);
  const items: CustomerFundingTransaction[] = [];
  const seenFundingIds = new Set<string>();
  let previousKey: { timestamp: string; fundingId: string } | null = null;
  for (const raw of fields.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WltReadError(502);
    const entry = raw as Record<string, unknown>;
    const stamp = typeof entry.postedAt === "string"
      ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(entry.postedAt)
      : null;
    const parsedTime = stamp ? Date.parse(entry.postedAt as string) : NaN;
    const originalId = entry.reversesFundingId;
    const reversal = Object.hasOwn(entry, "reversesFundingId");
    if (Object.keys(entry).length !== (reversal ? 4 : 3) ||
      (reversal && (!fundingIdValid(originalId) || originalId === entry.fundingId)) ||
      !fundingIdValid(entry.fundingId) || !amountValid(entry.amountYer, true) ||
      typeof entry.postedAt !== "string" || !stamp || !Number.isFinite(parsedTime) ||
      new Date(parsedTime).toISOString().slice(0, 19) !== stamp[1] ||
      seenFundingIds.has(entry.fundingId)) throw new WltReadError(502);
    // Compare exact UTC nanoseconds, not JavaScript's millisecond precision.
    // Funding IDs are unique; equal timestamps are legal under PostgreSQL.
    const timestamp = stamp[1] + "." + (stamp[2] ?? "").padEnd(9, "0");
    // Mirror the owner's (posted_at DESC, funding_id DESC) keyset ordering.
    // Checking the timestamp alone can accept skipped entries when postings share one instant.
    if (previousKey && (timestamp > previousKey.timestamp ||
      (timestamp === previousKey.timestamp && entry.fundingId >= previousKey.fundingId))) {
      throw new WltReadError(502);
    }
    previousKey = { timestamp, fundingId: entry.fundingId as string };
    seenFundingIds.add(entry.fundingId);
    const transaction = { fundingId: entry.fundingId, amountYer: entry.amountYer, postedAt: entry.postedAt };
    items.push(reversal && typeof originalId === "string"
      ? { ...transaction, reversesFundingId: originalId }
      : transaction);
  }
  // An unrelated yet syntactically valid cursor would silently skip or repeat
  // posted financial history. WLT must resume strictly after the last item.
  const lastItem = items.at(-1);
  if (fields.hasMore && (!lastItem || fields.nextCursor !== encodeFundingCursor(lastItem))) {
    throw new WltReadError(502);
  }
  return {
    actorId: fields.actorId, currency: "YER", items, hasMore: fields.hasMore,
    nextCursor: fields.nextCursor as string | null,
  };
}

async function readOwner(origin: string, bearer: string, method: "GET", path: string,
  signal: AbortSignal, cursor?: string): Promise<unknown> {
  // Only isolated local WLT and the Android emulator's host-loopback alias.
  // Production/public network origins are intentionally not admitted.
  const isolated = /^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):([1-9][0-9]{0,4})$/.exec(origin);
  if (!isolated || Number(isolated[1]) > 65535) throw new WltReadError(503);
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) throw new WltReadError(401);
  // Ten contract-valid funding entries, reversals and a keyset cursor can
  // exceed 4 KiB. Keep the balance bound at 4 KiB and history at 8 KiB.
  const maxBytes = path === wltOperations.listCurrentCustomerWalletTransactions.path ? 8192 : 4096;
  const requestURL = new URL(path, origin);
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{20,240}$/.test(cursor)) {
      throw new WltReadError(400);
    }
    requestURL.searchParams.set("cursor", cursor);
  }
  const response = await fetch(requestURL, {
    method, signal, redirect: "error", credentials: "omit", cache: "no-store",
    headers: { Accept: "application/json", Authorization: "Bearer " + bearer },
  });
  if (response.status !== 200 ||
    response.headers.get("Cache-Control")?.toLowerCase() !== "no-store" ||
    response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    void response.body?.cancel().catch(() => {});
    throw new WltReadError(response.status === 401 || response.status === 403 ? response.status : 503);
  }
  const declaredSize = response.headers.get("Content-Length");
  if (declaredSize !== null && (!/^[0-9]+$/.test(declaredSize) || Number(declaredSize) > maxBytes)) {
    void response.body?.cancel().catch(() => {});
    throw new WltReadError(502);
  }
  // Hermes/React Native may expose Response.text() but not ReadableStream or
  // TextDecoder. In that case validate the decoded UTF-8 byte count before
  // parsing. The WLT owner is limited to isolated host-loopback origins.
  if (!response.body?.getReader || typeof TextDecoder !== "function") {
    const text = await response.text();
    let bytes = 0;
    for (const rune of text) {
      const value = rune.codePointAt(0) ?? 0xfffd;
      bytes += value < 0x80 ? 1 : value < 0x800 ? 2 : value < 0x10000 ? 3 : 4;
      if (bytes > maxBytes) throw new WltReadError(502);
    }
    signal.throwIfAborted();
    try { return JSON.parse(text) as unknown; }
    catch { throw new WltReadError(502); }
  }
  const stream = response.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      if (size + value.length > bytes.length) {
        void stream.cancel().catch(() => {});
        throw new WltReadError(502);
      }
      bytes.set(value, size);
      size += value.length;
    }
    signal.throwIfAborted();
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
    } catch {
      throw new WltReadError(502);
    }
  } finally {
    stream.releaseLock();
  }
}

export async function readCurrentCustomerWallet(
  origin: string, bearer: string, signal: AbortSignal,
): Promise<CustomerWalletBalance> {
  const operation = wltOperations.getCurrentCustomerWalletBalance;
  return parseCustomerWalletBalance(await readOwner(origin, bearer, operation.method, operation.path, signal));
}

export async function readCurrentCustomerWalletTransactions(
  origin: string, bearer: string, signal: AbortSignal, cursor?: string,
): Promise<CustomerFundingHistory> {
  const operation = wltOperations.listCurrentCustomerWalletTransactions;
  return parseCustomerFundingHistory(await readOwner(origin, bearer, operation.method, operation.path, signal, cursor));
}
