import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { readOwner } from "./transport.ts";
import type { CustomerWalletBalance } from "./types.ts";
import { actorValid, amountValid, exactRecord } from "./validation.ts";

export function parseCustomerWalletBalance(value: unknown): CustomerWalletBalance {
  const { actorId, currency, balanceYer, availableYer } =
    exactRecord(value, ["actorId", "currency", "balanceYer", "availableYer"]);
  if (!actorValid(actorId) || currency !== "YER" ||
      !amountValid(balanceYer, false) || !amountValid(availableYer, false) ||
      BigInt(availableYer) > BigInt(balanceYer)) throw new WltReadError(502);
  return { actorId, currency, balanceYer, availableYer };
}

export async function readCurrentCustomerWallet(
  origin: string, bearer: string, signal: AbortSignal,
): Promise<CustomerWalletBalance> {
  const operation = wltOperations.getCurrentCustomerWalletBalance;
  return parseCustomerWalletBalance(await readOwner(origin, bearer, operation.method, operation.path, signal));
}
