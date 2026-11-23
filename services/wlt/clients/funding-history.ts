import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { readOwner } from "./transport.ts";
import type { CustomerFundingHistory, CustomerFundingTransaction } from "./types.ts";
import { actorValid, amountValid, fundingIdValid } from "./validation.ts";

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

export async function readCurrentCustomerWalletTransactions(
  origin: string, bearer: string, signal: AbortSignal, cursor?: string,
): Promise<CustomerFundingHistory> {
  const operation = wltOperations.listCurrentCustomerWalletTransactions;
  return parseCustomerFundingHistory(await readOwner(origin, bearer, operation.method, operation.path, signal, cursor));
}
