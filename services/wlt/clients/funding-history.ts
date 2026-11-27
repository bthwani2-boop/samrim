import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { readOwner } from "./transport.ts";
import type { CustomerFundingHistory, CustomerFundingTransaction } from "./types.ts";
import { actorValid, amountValid, fundingIdValid } from "./validation.ts";

type FundingKey = { timestamp: string; fundingId: string };
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function fundingKey(postedAt: unknown, fundingId: unknown): FundingKey {
  if (typeof postedAt !== "string" || !fundingIdValid(fundingId)) throw new WltReadError(502);
  const stamp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(postedAt);
  const time = Date.parse(postedAt);
  if (!stamp || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== stamp[1]) {
    throw new WltReadError(502);
  }
  return { timestamp: stamp[1] + "." + (stamp[2] ?? "").padEnd(9, "0"), fundingId };
}

// Use the owner's exact UTC nanosecond / PostgreSQL C-collation tuple.
// JavaScript's millisecond Date precision is only used for calendar validation.
function strictlyOlder(key: FundingKey, previous: FundingKey): boolean {
  return key.timestamp < previous.timestamp ||
    (key.timestamp === previous.timestamp && key.fundingId < previous.fundingId);
}

// Cursor payloads are ASCII by contract; keep the codec portable across Web
// and Hermes without browser-only btoa or Node-only Buffer.
function encodeCursor(key: FundingKey): string {
  const text = key.timestamp.replace(/\.?0+$/, "") + "Z|" + key.fundingId;
  let result = "";
  let bits = 0;
  let buffer = 0;
  for (const char of text) {
    buffer = (buffer << 8) | char.charCodeAt(0);
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
      text += String.fromCharCode((buffer >>> bits) & 255);
    }
  }
  const [stamp, id, extra] = text.split("|");
  if (extra !== undefined) throw new WltReadError(502);
  const key = fundingKey(stamp, id);
  if (encodeCursor(key) !== cursor) throw new WltReadError(502);
  return key;
}

export function parseCustomerFundingHistory(value: unknown, requestedCursor?: string): CustomerFundingHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WltReadError(502);
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 5 || !actorValid(fields.actorId) ||
    fields.currency !== "YER" || typeof fields.hasMore !== "boolean" ||
    !Array.isArray(fields.items) || fields.items.length > 10 ||
    (fields.nextCursor !== null && typeof fields.nextCursor !== "string") ||
    fields.hasMore !== (fields.nextCursor !== null) ||
    (fields.hasMore && fields.items.length !== 10)) throw new WltReadError(502);

  const items: CustomerFundingTransaction[] = [];
  const seen = new Set<string>();
  // The first item of a continuation must be strictly older than the exact
  // requested owner key, not merely older than the next item on its own page.
  let previous = requestedCursor === undefined ? null : decodeCursor(requestedCursor);
  for (const raw of fields.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WltReadError(502);
    const entry = raw as Record<string, unknown>;
    const reversal = Object.hasOwn(entry, "reversesFundingId");
    const originalId = entry.reversesFundingId;
    if (Object.keys(entry).length !== (reversal ? 4 : 3) ||
      !amountValid(entry.amountYer, true) || typeof entry.postedAt !== "string" ||
      !fundingIdValid(entry.fundingId) ||
      (reversal && (!fundingIdValid(originalId) || originalId === entry.fundingId)) ||
      seen.has(entry.fundingId)) throw new WltReadError(502);
    const key = fundingKey(entry.postedAt, entry.fundingId);
    if (previous && !strictlyOlder(key, previous)) throw new WltReadError(502);
    previous = key;
    seen.add(key.fundingId);
    const transaction = { fundingId: key.fundingId, amountYer: entry.amountYer, postedAt: entry.postedAt };
    items.push(reversal && typeof originalId === "string"
      ? { ...transaction, reversesFundingId: originalId } : transaction);
  }
  if (fields.hasMore && (!previous || fields.nextCursor !== encodeCursor(previous))) {
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
  const value = await readOwner(origin, bearer, operation.method, operation.path, signal, cursor);
  return parseCustomerFundingHistory(value, cursor);
}
