import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { readOwner } from "./transport.ts";
import type { CustomerWalletBalance } from "./types.ts";
import { actorValid, amountValid } from "./validation.ts";

export function parseCustomerWalletBalance(value: unknown): CustomerWalletBalance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WltReadError(502);
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 3 || !actorValid(fields.actorId) ||
    fields.currency !== "YER" || !amountValid(fields.balanceYer, false)) throw new WltReadError(502);
  return { actorId: fields.actorId, currency: "YER", balanceYer: fields.balanceYer };
}

export async function readCurrentCustomerWallet(
  origin: string, bearer: string, signal: AbortSignal,
): Promise<CustomerWalletBalance> {
  const operation = wltOperations.getCurrentCustomerWalletBalance;
  return parseCustomerWalletBalance(await readOwner(origin, bearer, operation.method, operation.path, signal));
}
