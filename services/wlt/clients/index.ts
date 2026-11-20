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
}
export interface CustomerFundingHistory {
  actorId: string;
  currency: "YER";
  items: CustomerFundingTransaction[];
  hasMore: boolean;
}

export class WltReadError extends Error {
  constructor(readonly status: number) {
    super("WLT wallet read unavailable");
    this.name = "WltReadError";
  }
}

const actorValid = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && Array.from(id).length <= 128 &&
  id.trim() === id && !/\p{Cc}/u.test(id);
const amountValid = (value: unknown, positive: boolean): value is string =>
  typeof value === "string" &&
  (positive ? /^[1-9][0-9]{0,37}$/ : /^(0|[1-9][0-9]{0,37})$/).test(value);

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
  if (Object.keys(fields).length !== 4 || !actorValid(fields.actorId) ||
    fields.currency !== "YER" || typeof fields.hasMore !== "boolean" ||
    !Array.isArray(fields.items) || fields.items.length > 10) throw new WltReadError(502);
  const items: CustomerFundingTransaction[] = [];
  for (const raw of fields.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WltReadError(502);
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).length !== 3 || typeof entry.fundingId !== "string" ||
      !/^[A-Za-z0-9._-]{8,128}$/.test(entry.fundingId) || !amountValid(entry.amountYer, true) ||
      typeof entry.postedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(entry.postedAt) ||
      !Number.isFinite(Date.parse(entry.postedAt))) throw new WltReadError(502);
    items.push({ fundingId: entry.fundingId, amountYer: entry.amountYer, postedAt: entry.postedAt });
  }
  return { actorId: fields.actorId, currency: "YER", items, hasMore: fields.hasMore };
}

async function readOwner(origin: string, bearer: string, method: "GET", path: string,
  signal: AbortSignal): Promise<unknown> {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin)) throw new WltReadError(503);
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) throw new WltReadError(401);
  const response = await fetch(new URL(path, origin), {
    method, signal, redirect: "error", credentials: "omit", cache: "no-store",
    headers: { Accept: "application/json", Authorization: "Bearer " + bearer },
  });
  if (response.status !== 200 ||
    response.headers.get("Cache-Control")?.toLowerCase() !== "no-store" ||
    response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    void response.body?.cancel().catch(() => {});
    throw new WltReadError(response.status === 401 || response.status === 403 ? response.status : 503);
  }
  const stream = response.body?.getReader();
  if (!stream) throw new WltReadError(502);
  const bytes = new Uint8Array(4096);
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
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
  origin: string, bearer: string, signal: AbortSignal,
): Promise<CustomerFundingHistory> {
  const operation = wltOperations.listCurrentCustomerWalletTransactions;
  return parseCustomerFundingHistory(await readOwner(origin, bearer, operation.method, operation.path, signal));
}
