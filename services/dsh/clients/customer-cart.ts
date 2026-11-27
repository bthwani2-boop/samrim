/** DSH owns Customer Cart drafts; neither the SDK nor UI can author price or Order truth. */
import { consumeOwnerResponse, fetchOwnerHeaders, readBoundedOwnerJSON } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";

export interface CustomerCartLine {
  offerId: string;
  variantId: string;
  name: string;
  quantity: number;
  previewUnitYer: string;
  previewAvailable: boolean;
}
export interface CustomerCart {
  actorId: string;
  storeId: string;
  version: number;
  lines: CustomerCartLine[];
}
export interface CustomerCartChange {
  operationId: string;
  expectedVersion: number;
  lines: { offerId: string; quantity: number }[];
}
export interface CustomerCartResult {
  cart: CustomerCart;
  replay: boolean;
}
/** DSH-priced read-only merchandise subtotal. No delivery fees, order or WLT authorization. */
export interface CustomerCartMerchandiseEstimateLine {
  offerId: string;
  variantId: string;
  quantity: number;
  unitYer: string;
  lineTotalYer: string;
}
export interface CustomerCartMerchandiseEstimate {
  actorId: string;
  storeId: string;
  cartVersion: number;
  lines: CustomerCartMerchandiseEstimateLine[];
  merchandiseSubtotalYer: string;
  checkoutReady: false;
}
export class DshCartError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.name = "DshCartError";
  }
}

const storeRule = /^[a-z0-9-]{1,64}$/;
const operationRule = /^[A-Za-z0-9._-]{8,128}$/;
const bearerRule = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const yerRule = /^(0|[1-9][0-9]{0,18})$/;
const maxOwnerYER = 9223372036854775807n;
const ownerError = () => new DshCartError(502, "OWNER_RESPONSE_INVALID");

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key));
}
function cartFrom(value: unknown, expectedStore: string, expectedActor: string): CustomerCart {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw ownerError();
  const cart = value as Record<string, unknown>;
  if (!exactKeys(cart, ["actorId", "storeId", "version", "lines"]) ||
    cart.actorId !== expectedActor || cart.storeId !== expectedStore ||
    !Number.isSafeInteger(cart.version) || (cart.version as number) < 0 ||
    !Array.isArray(cart.lines) || cart.lines.length > 20) throw ownerError();
  const ids = new Set<string>();
  const lines: CustomerCartLine[] = [];
  for (const raw of cart.lines) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw ownerError();
    const line = raw as Record<string, unknown>;
    if (!exactKeys(line, ["offerId", "variantId", "name", "quantity", "previewUnitYer", "previewAvailable"]) ||
      typeof line.offerId !== "string" || !storeRule.test(line.offerId) ||
      typeof line.variantId !== "string" || !storeRule.test(line.variantId) ||
      typeof line.name !== "string" || line.name.trim().length === 0 ||
      Array.from(line.name).length > 160 ||
      !Number.isSafeInteger(line.quantity) || (line.quantity as number) < 1 ||
      (line.quantity as number) > 2147483647 ||
      typeof line.previewUnitYer !== "string" || !yerRule.test(line.previewUnitYer) ||
      BigInt(line.previewUnitYer) > maxOwnerYER ||
      typeof line.previewAvailable !== "boolean" || ids.has(line.offerId)) throw ownerError();
    ids.add(line.offerId);
    lines.push(line as unknown as CustomerCartLine);
  }
  return { actorId: expectedActor, storeId: expectedStore, version: cart.version as number, lines };
}
function estimateFrom(value: unknown, expectedStore: string, expectedActor: string,
  expectedVersion: number): CustomerCartMerchandiseEstimate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw ownerError();
  const estimate = value as Record<string, unknown>;
  if (!exactKeys(estimate, ["actorId", "storeId", "cartVersion", "lines", "merchandiseSubtotalYer", "checkoutReady"]) ||
    estimate.actorId !== expectedActor || estimate.storeId !== expectedStore ||
    !Number.isSafeInteger(estimate.cartVersion) || estimate.cartVersion !== expectedVersion ||
    estimate.checkoutReady !== false || !Array.isArray(estimate.lines) ||
    estimate.lines.length < 1 || estimate.lines.length > 20 ||
    typeof estimate.merchandiseSubtotalYer !== "string" || !/^[1-9][0-9]{0,18}$/.test(estimate.merchandiseSubtotalYer)) {
    throw ownerError();
  }
  const seen = new Set<string>();
  let sum = 0n;
  const max = maxOwnerYER;
  const lines: CustomerCartMerchandiseEstimateLine[] = [];
  for (const raw of estimate.lines) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw ownerError();
    const line = raw as Record<string, unknown>;
    if (!exactKeys(line, ["offerId", "variantId", "quantity", "unitYer", "lineTotalYer"]) ||
      typeof line.offerId !== "string" || !storeRule.test(line.offerId) || seen.has(line.offerId) ||
      typeof line.variantId !== "string" || !storeRule.test(line.variantId) ||
      !Number.isSafeInteger(line.quantity) || (line.quantity as number) < 1 ||
      (line.quantity as number) > 2147483647 ||
      typeof line.unitYer !== "string" || !/^[1-9][0-9]{0,18}$/.test(line.unitYer) ||
      typeof line.lineTotalYer !== "string" || !/^[1-9][0-9]{0,18}$/.test(line.lineTotalYer)) {
      throw ownerError();
    }
    const unit = BigInt(line.unitYer);
    const subtotal = BigInt(line.lineTotalYer);
    if (unit > max || subtotal > max || unit * BigInt(line.quantity as number) !== subtotal) throw ownerError();
    sum += subtotal;
    if (sum > max) throw ownerError();
    seen.add(line.offerId);
    lines.push(line as unknown as CustomerCartMerchandiseEstimateLine);
  }
  if (sum !== BigInt(estimate.merchandiseSubtotalYer)) throw ownerError();
  return { actorId: expectedActor, storeId: expectedStore, cartVersion: expectedVersion,
    lines, merchandiseSubtotalYer: estimate.merchandiseSubtotalYer, checkoutReady: false };
}

/** Capture one exact, detached command before any asynchronous work. */
export function prepareCustomerCartChange(value: unknown): CustomerCartChange {
  const reject = (): never => { throw new DshCartError(400, "INVALID_REQUEST"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject();
  const command = value as Record<string, unknown>;
  if (!exactKeys(command, ["operationId", "expectedVersion", "lines"])) return reject();
  const { operationId, expectedVersion, lines: input } = command;
  if (typeof operationId !== "string" || !operationRule.test(operationId) ||
    typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER ||
    !Array.isArray(input) || input.length > 20) return reject();
  const seen = new Set<string>();
  const lines: CustomerCartChange["lines"] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
      !exactKeys(item, ["offerId", "quantity"])) return reject();
    const { offerId, quantity } = item;
    if (typeof offerId !== "string" || !storeRule.test(offerId) || seen.has(offerId) ||
      typeof quantity !== "number" || !Number.isSafeInteger(quantity) ||
      quantity < 1 || quantity > 2147483647) return reject();
    seen.add(offerId);
    lines.push(Object.freeze({ offerId, quantity }));
  }
  Object.freeze(lines);
  return Object.freeze({ operationId, expectedVersion, lines });
}

function receiptFrom(value: unknown, storeId: string, actorId: string,
  command: CustomerCartChange): CustomerCartResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw ownerError();
  const envelope = value as Record<string, unknown>;
  if (!exactKeys(envelope, ["cart", "replay"]) || typeof envelope.replay !== "boolean") throw ownerError();
  const cart = cartFrom(envelope.cart, storeId, actorId);
  const quantities = new Map(command.lines.map(line => [line.offerId, line.quantity]));
  if (cart.version !== command.expectedVersion + 1 || cart.lines.length !== quantities.size ||
    cart.lines.some(line => quantities.get(line.offerId) !== line.quantity)) throw ownerError();
  return { cart, replay: envelope.replay };
}

function urlForCart(origin: string, storeId: string, method: "GET" | "PUT" | "ESTIMATE",
  expectedVersion?: number): URL {
  const safe = /^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):([1-9][0-9]{0,4})$/.exec(origin);
  if (!safe || Number(safe[1]) > 65535 || !storeRule.test(storeId)) {
    throw new DshCartError(503, "OWNER_UNAVAILABLE");
  }
  const path = method === "GET" ? dshOperations.getCurrentCustomerCart.path
    : method === "PUT" ? dshOperations.replaceCurrentCustomerCart.path
      : dshOperations.estimateCurrentCustomerCartMerchandise.path;
  const url = new URL(path.replace("{storeID}", storeId), origin);
  if (method === "ESTIMATE") {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion === undefined || expectedVersion < 0) {
      throw new DshCartError(400, "INVALID_REQUEST");
    }
    url.searchParams.set("expectedVersion", String(expectedVersion));
  }
  return url;
}

async function cartRequest(origin: string, bearer: string, storeId: string, expectedActor: string,
  method: "GET" | "PUT" | "ESTIMATE", signal: AbortSignal, change?: CustomerCartChange,
  expectedVersion?: number): Promise<CustomerCart | CustomerCartResult | CustomerCartMerchandiseEstimate> {
  const url = urlForCart(origin, storeId, method, expectedVersion);
  if (!bearerRule.test(bearer) || typeof expectedActor !== "string" ||
    expectedActor.length < 1 || expectedActor.length > 128 || expectedActor.trim() !== expectedActor) {
    throw new DshCartError(401, "UNAUTHORIZED");
  }
  const command = method === "PUT" ? prepareCustomerCartChange(change) : undefined;
  const dispatched = method === "PUT";
  let response: Response;
  try {
    response = await fetchOwnerHeaders(url, {
      method: method === "ESTIMATE" ? "GET" : method, cache: "no-store", credentials: "omit", redirect: "error", signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${bearer}`,
        ...(dispatched ? { "Content-Type": "application/json" } : {}),
      },
      ...(command ? { body: JSON.stringify(command) } : {}),
    });
  } catch {
    throw new DshCartError(0, dispatched ? "OPERATION_RESULT_UNKNOWN" : signal.aborted ? "OWNER_RESPONSE_STALE" : "OWNER_NETWORK_UNAVAILABLE");
  }
  return consumeOwnerResponse(response, async () => {
    if (signal.aborted) throw new DshCartError(0,
      dispatched ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
    if (response.status !== 200) {
      if (response.status === 401 || response.status === 403 || response.status === 404 ||
        response.status === 409 || response.status === 400) {
        throw new DshCartError(response.status, response.status === 409 ?
          (method === "ESTIMATE" ? "ESTIMATE_NOT_AVAILABLE" : "CART_VERSION_OR_OPERATION_CONFLICT") : response.status === 404 ?
            "STORE_OR_OFFER_NOT_AVAILABLE" : response.status === 400 ? "INVALID_REQUEST" : "UNAUTHORIZED");
      }
      throw new DshCartError(503, dispatched ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE");
    }
    let body: unknown;
    try {
      body = await readBoundedOwnerJSON(response, 65536, 65536, signal, "private-json");
    } catch {
      throw new DshCartError(signal.aborted ? 0 : 502, dispatched ? "OPERATION_RESULT_UNKNOWN" : signal.aborted ? "OWNER_RESPONSE_STALE" : "OWNER_RESPONSE_INVALID");
    }
    if (signal.aborted) throw new DshCartError(0,
      dispatched ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
    if (method === "ESTIMATE") return estimateFrom(body, storeId, expectedActor, expectedVersion as number);
    if (!dispatched) return cartFrom(body, storeId, expectedActor);
    try {
      if (!command) throw ownerError();
      return receiptFrom(body, storeId, expectedActor, command);
    } catch {
      throw new DshCartError(502, "OPERATION_RESULT_UNKNOWN");
    }
  });
}

export function parseCustomerCart(value: unknown, storeId: string, actorId: string): CustomerCart {
  return cartFrom(value, storeId, actorId);
}

export function parseCustomerCartResult(value: unknown, storeId: string, actorId: string,
  change: CustomerCartChange): CustomerCartResult {
  return receiptFrom(value, storeId, actorId, prepareCustomerCartChange(change));
}

export function readCurrentCustomerCart(
  origin: string, bearer: string, storeId: string, actorId: string, signal: AbortSignal,
): Promise<CustomerCart> {
  return cartRequest(origin, bearer, storeId, actorId, "GET", signal) as Promise<CustomerCart>;
}
export function replaceCurrentCustomerCart(
  origin: string, bearer: string, storeId: string, actorId: string,
  change: CustomerCartChange, signal: AbortSignal,
): Promise<CustomerCartResult> {
  return cartRequest(origin, bearer, storeId, actorId, "PUT", signal, change) as Promise<CustomerCartResult>;
}

/** Read DSH's current per-line merchandise amounts; NOT a final payable quote. */
export function parseCustomerCartMerchandiseEstimate(value: unknown, storeId: string, actorId: string,
  expectedVersion: number): CustomerCartMerchandiseEstimate {
  return estimateFrom(value, storeId, actorId, expectedVersion);
}
export function readCurrentCustomerCartMerchandiseEstimate(
  origin: string, bearer: string, storeId: string, actorId: string, expectedVersion: number, signal: AbortSignal,
): Promise<CustomerCartMerchandiseEstimate> {
  return cartRequest(origin, bearer, storeId, actorId, "ESTIMATE", signal, undefined, expectedVersion) as Promise<CustomerCartMerchandiseEstimate>;
}
