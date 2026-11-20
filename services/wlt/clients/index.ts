// Empty contract-bound entrypoint. Add exports only with an approved client implementation.
import { wltOperations } from "./generated/wlt-operations.ts";

export interface CustomerWalletBalance {
  actorId: string;
  currency: "YER";
  balanceYer: string;
}

export class WltReadError extends Error {
  constructor(readonly status: number) {
    super("WLT wallet read unavailable");
    this.name = "WltReadError";
  }
}

export function parseCustomerWalletBalance(value: unknown): CustomerWalletBalance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WltReadError(502);
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 3 || typeof fields.actorId !== "string" ||
    fields.actorId.length === 0 || Array.from(fields.actorId).length > 128 ||
    fields.actorId.trim() !== fields.actorId || /\p{Cc}/u.test(fields.actorId) ||
    fields.currency !== "YER" || typeof fields.balanceYer !== "string" ||
    !/^(0|[1-9][0-9]{0,37})$/.test(fields.balanceYer)) throw new WltReadError(502);
  return { actorId: fields.actorId, currency: "YER", balanceYer: fields.balanceYer };
}

export async function readCurrentCustomerWallet(
  origin: string, bearer: string, signal: AbortSignal,
): Promise<CustomerWalletBalance> {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin)) throw new WltReadError(503);
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) throw new WltReadError(401);
  const operation = wltOperations.getCurrentCustomerWalletBalance;
  const response = await fetch(new URL(operation.path, origin), {
    method: operation.method, signal, redirect: "error", credentials: "omit", cache: "no-store",
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
    return parseCustomerWalletBalance(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
  } finally {
    stream.releaseLock();
  }
}
