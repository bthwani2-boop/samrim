import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { readOwner } from "./transport.ts";
import type { CustomerFundingHistory, CustomerFundingTransaction } from "./types.ts";
import { actorValid, amountValid, exactRecord, fundingIdValid } from "./validation.ts";

type FundingKey = { timestamp: string; fundingId: string };
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const utcStamp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;

function fundingKey(postedAt: unknown, fundingId: unknown): FundingKey {
  if (typeof postedAt !== "string" || !fundingIdValid(fundingId)) throw new WltReadError(502);
  const stamp = utcStamp.exec(postedAt);
  if (!stamp) throw new WltReadError(502);
  const time = Date.parse(postedAt);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== stamp[1]) {
    throw new WltReadError(502);
  }
  return { timestamp: `${stamp[1]}.${(stamp[2] ?? "").padEnd(9, "0")}`, fundingId };
}

function strictlyOlder(key: FundingKey, previous: FundingKey): boolean {
  return key.timestamp < previous.timestamp ||
    (key.timestamp === previous.timestamp && key.fundingId < previous.fundingId);
}

// Fixed-width UTC comparison keeps nanoseconds; the cursor uses Go's
// RFC3339Nano form, omitting trailing fractional zeros and an empty fraction.
function encodeCursor(key: FundingKey): string {
  let end = key.timestamp.length;
  while (key.timestamp[end - 1] === "0" && end > 20) end--;
  if (end === 20) end = 19;
  const text = `${key.timestamp.slice(0, end)}Z|${key.fundingId}`;
  let result = "";
  let bits = 0;
  let buffer = 0;
  // ASCII only by the owner timestamp and funding ID contracts.
  for (const char of text) {
    buffer = (buffer << 8) | (char.codePointAt(0) ?? 0);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += alphabet.charAt((buffer >>> bits) & 63);
    }
  }
  if (bits > 0) result += alphabet.charAt((buffer << (6 - bits)) & 63);
  return result;
}

function decodeCursor(cursor: string): FundingKey {
  if (!/^[A-Za-z0-9_-]{20,240}$/.test(cursor)) throw new WltReadError(502);
  let text = "";
  let buffer = 0;
  let bits = 0;
  for (const char of cursor) {
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      text += String.fromCodePoint((buffer >>> bits) & 255);
    }
  }
  const [stamp, id, extra] = text.split("|");
  if (extra !== undefined) throw new WltReadError(502);
  const key = fundingKey(stamp, id);
  if (encodeCursor(key) !== cursor) throw new WltReadError(502);
  return key;
}

function admitTransaction(value: unknown): CustomerFundingTransaction {
  const entry = exactRecord(value, ["fundingId", "amountYer", "postedAt"], ["reversesFundingId"]);
  const { fundingId, amountYer, postedAt } = entry;
  if (!fundingIdValid(fundingId) || !amountValid(amountYer, true) || typeof postedAt !== "string") {
    throw new WltReadError(502);
  }
  const transaction = { fundingId, amountYer, postedAt };
  if (!Object.hasOwn(entry, "reversesFundingId")) return transaction;
  const original = entry.reversesFundingId;
  if (!fundingIdValid(original) || original === fundingId) throw new WltReadError(502);
  return { ...transaction, reversesFundingId: original };
}

function admitPage(value: unknown): { actorId: string; currency: "YER"; entries: unknown[]; hasMore: boolean; nextCursor: string | null } {
  const { actorId, currency, items, hasMore, nextCursor } =
    exactRecord(value, ["actorId", "currency", "items", "hasMore", "nextCursor"]);
  if (!actorValid(actorId) || currency !== "YER" || typeof hasMore !== "boolean" ||
      !Array.isArray(items) || items.length > 10) throw new WltReadError(502);
  if (hasMore) {
    if (typeof nextCursor !== "string" || items.length !== 10) throw new WltReadError(502);
  } else if (nextCursor !== null) {
    throw new WltReadError(502);
  }
  return { actorId, currency, entries: items as unknown[], hasMore, nextCursor: nextCursor as string | null };
}

export function parseCustomerFundingHistory(value: unknown, requestedCursor?: string): CustomerFundingHistory {
  const { actorId, currency, entries, hasMore, nextCursor } = admitPage(value);
  const items: CustomerFundingTransaction[] = [];
  let previous = requestedCursor === undefined ? null : decodeCursor(requestedCursor);
  const seen = new Set(previous ? [previous.fundingId] : []);
  for (const raw of entries) {
    const transaction = admitTransaction(raw);
    const key = fundingKey(transaction.postedAt, transaction.fundingId);
    if (seen.has(key.fundingId) || (previous && !strictlyOlder(key, previous))) throw new WltReadError(502);
    seen.add(key.fundingId);
    items.push(transaction);
    previous = key;
  }
  if (hasMore && (!previous || nextCursor !== encodeCursor(previous))) throw new WltReadError(502);
  return { actorId, currency, items, hasMore, nextCursor };
}

export async function readCurrentCustomerWalletTransactions(
  origin: string, bearer: string, signal: AbortSignal, cursor?: string,
): Promise<CustomerFundingHistory> {
  const operation = wltOperations.listCurrentCustomerWalletTransactions;
  const value = await readOwner(origin, bearer, operation.method, operation.path, signal, cursor);
  return parseCustomerFundingHistory(value, cursor);
}
