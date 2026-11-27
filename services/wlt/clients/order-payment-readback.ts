import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { readOwner } from "./transport.ts";
import { actorValid, amountValid, exactRecord, fundingIdValid } from "./validation.ts";

export type OrderPaymentAllocation = {
  storeId: string;
  method: "COD" | "WALLET" | "MIXED";
  totalYer: string;
  walletYer: string;
  cashYer: string;
  currency: "YER";
  state: "ALLOCATED" | "RELEASED";
};
export type CustomerOrderPaymentReadback = {
  actorId: string;
  checkoutId: string;
  allocation: OrderPaymentAllocation | null;
};

function allocationFrom(value: unknown): OrderPaymentAllocation {
  const { storeId, method, totalYer, walletYer, cashYer, currency, state } =
    exactRecord(value, ["storeId", "method", "totalYer", "walletYer", "cashYer", "currency", "state"]);
  if (typeof storeId !== "string" || !/^[a-z0-9-]{1,64}$/.test(storeId) ||
      currency !== "YER" || (state !== "ALLOCATED" && state !== "RELEASED") ||
      !amountValid(totalYer, true) || !amountValid(walletYer, false) || !amountValid(cashYer, false)) {
    throw new WltReadError(502);
  }
  const total = BigInt(totalYer), wallet = BigInt(walletYer), cash = BigInt(cashYer);
  if (total > 9223372036854775807n || wallet + cash !== total ||
      !((method === "COD" && wallet === 0n) || (method === "WALLET" && cash === 0n) ||
        (method === "MIXED" && wallet > 0n && cash > 0n))) throw new WltReadError(502);
  return { storeId, method, totalYer, walletYer, cashYer, currency, state };
}

export function parseCustomerOrderPaymentReadback(value: unknown, actorId: string, checkoutId: string): CustomerOrderPaymentReadback {
  const fields = exactRecord(value, ["actorId", "checkoutId", "allocation"]);
  if (!actorValid(actorId) || !fundingIdValid(checkoutId) ||
      fields.actorId !== actorId || fields.checkoutId !== checkoutId) throw new WltReadError(502);
  return { actorId, checkoutId, allocation: fields.allocation === null ? null : allocationFrom(fields.allocation) };
}

export async function readCurrentCustomerOrderPaymentAllocation(origin: string, bearer: string,
  actorId: string, checkoutId: string, signal: AbortSignal): Promise<CustomerOrderPaymentReadback> {
  if (!actorValid(actorId) || !fundingIdValid(checkoutId)) throw new WltReadError(400);
  const operation = wltOperations.getCurrentCustomerOrderPaymentAllocation;
  return parseCustomerOrderPaymentReadback(await readOwner(origin, bearer, operation.method,
    operation.path.replace("{checkoutID}", checkoutId), signal), actorId, checkoutId);
}
