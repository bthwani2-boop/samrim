import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { readOwner } from "./transport.ts";
import { actorValid, amountValid, fundingIdValid } from "./validation.ts";

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

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WltReadError(502);
  return value as Record<string, unknown>;
}

export function parseCustomerOrderPaymentReadback(value: unknown, actorId: string, checkoutId: string): CustomerOrderPaymentReadback {
  const fields = record(value);
  if (!actorValid(actorId) || !fundingIdValid(checkoutId) ||
    fields.actorId !== actorId || fields.checkoutId !== checkoutId || Object.keys(fields).length !== 3) {
    throw new WltReadError(502);
  }
  if (fields.allocation === null) return {actorId,checkoutId,allocation:null};
  const a = record(fields.allocation);
  if (Object.keys(a).length !== 7 || typeof a.storeId !== "string" || !/^[a-z0-9-]{1,64}$/.test(a.storeId) ||
    a.currency !== "YER" || (a.state !== "ALLOCATED" && a.state !== "RELEASED") ||
    !amountValid(a.totalYer,true) || !amountValid(a.walletYer,false) || !amountValid(a.cashYer,false)) throw new WltReadError(502);
  const total = BigInt(a.totalYer), wallet = BigInt(a.walletYer), cash = BigInt(a.cashYer);
  if (total > 9223372036854775807n || wallet + cash !== total) throw new WltReadError(502);
  if (!((a.method === "COD" && wallet === 0n) || (a.method === "WALLET" && cash === 0n) ||
    (a.method === "MIXED" && wallet > 0n && cash > 0n))) throw new WltReadError(502);
  return {actorId,checkoutId,allocation:{
    storeId:a.storeId, method:a.method, totalYer:a.totalYer, walletYer:a.walletYer,
    cashYer:a.cashYer,currency:a.currency,state:a.state,
  }};
}

export async function readCurrentCustomerOrderPaymentAllocation(origin: string, bearer: string,
  actorId: string, checkoutId: string, signal: AbortSignal): Promise<CustomerOrderPaymentReadback> {
  if (!actorValid(actorId) || !fundingIdValid(checkoutId)) throw new WltReadError(400);
  const operation = wltOperations.getCurrentCustomerOrderPaymentAllocation;
  return parseCustomerOrderPaymentReadback(await readOwner(origin,bearer,operation.method,
    operation.path.replace("{checkoutID}",checkoutId),signal),actorId,checkoutId);
}
