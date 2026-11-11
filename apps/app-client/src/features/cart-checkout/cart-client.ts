import type { CartResponse, CatalogStoreOffer, CheckoutQuoteResponse, CheckoutRequest, ClientOpenCartListResponse, MultiStoreCheckoutRequest, MultiStoreCheckoutResponse, ServiceabilityResponse } from "@bthwani/dsh";
import { createClientDsh } from "../../bootstrap/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { assertClientActor, tokenForClientActor, tokenForClientSession } from "../access/client-request-token";

/** Read a DSH-owned cart for multi-Store checkout preview without another UI transport. */
export async function readCartForPreview(accessToken: string, storeID: string) {
  return (await createClientDsh().readOpenCart(accessToken, storeID)).cart;
}

export async function evaluateStoreServiceability(storeID: string, addressID: string): Promise<ServiceabilityResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return createClientDsh().evaluateServiceability(accessToken, storeID, addressID);
}

export async function listOwnOpenCarts(): Promise<ClientOpenCartListResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return createClientDsh().listClientOpenCarts(accessToken);
}

export async function quoteMultiStoreChildCheckout(input: CheckoutRequest, expectedCartVersion: number, sessionKey: string): Promise<CheckoutQuoteResponse> {
  const accessToken = await tokenForClientSession(sessionKey);
  return createClientDsh().quoteCheckout(accessToken, input, expectedCartVersion);
}

export async function createMultiStoreCheckout(input: MultiStoreCheckoutRequest, idempotencyKey: string, correlationID: string, sessionKey: string): Promise<MultiStoreCheckoutResponse> {
  const accessToken = await tokenForClientSession(sessionKey);
  return createClientDsh().createMultiStoreCheckout(accessToken, input, idempotencyKey, correlationID);
}

export async function readOwnMultiStoreCheckout(checkoutID: string, sessionKey: string): Promise<MultiStoreCheckoutResponse> {
  const accessToken = await tokenForClientSession(sessionKey);
  return createClientDsh().readMultiStoreCheckout(accessToken, checkoutID);
}

export async function readOwnStoreCart(storeID: string): Promise<CartResponse | null> {
  const accessToken = await getUsableIdentityAccessToken();
  try {
    return await createClientDsh().readOpenCart(accessToken, storeID);
  } catch (error) {
    const notFound = error && typeof error === "object" && (error as { kind?: unknown; status?: unknown }).kind === "http" && (error as { status?: unknown }).status === 404;
    if (notFound) return null;
    throw error;
  }
}

export async function addCatalogOfferToCart(
  storeID: string,
  offer: CatalogStoreOffer,
  quantityBaseUnits: number,
  selectedModifierOptionIds: ReadonlyArray<string>,
  actorID: string,
): Promise<CartResponse> {
  const accessToken = await tokenForClientActor(actorID);
  let expectedVersion = 0;
  try {
    expectedVersion = (await createClientDsh().readOpenCart(accessToken, storeID)).cart.version;
  } catch (error) {
    const notFound = error && typeof error === "object" && (error as { kind?: unknown; status?: unknown }).kind === "http" && (error as { status?: unknown }).status === 404;
    if (!notFound) throw error;
  }
  assertClientActor(actorID);
  return createClientDsh().upsertCartLine(accessToken, { storeId: storeID, storeOfferId: offer.offerId, quantityBaseUnits, selectedModifierOptionIds }, expectedVersion);
}

/** Update one simple, discrete home offer using DSH's authoritative cart version. */
export async function adjustSimpleOfferQuantity(storeID: string, offer: CatalogStoreOffer, direction: 1 | -1, actorID: string): Promise<CartResponse> {
  if (offer.quantityPolicy !== "DISCRETE" || offer.modifierGroups.length > 0 || !offer.availability) {
    throw new Error("HOME_OFFER_REQUIRES_DETAIL");
  }
  const accessToken = await tokenForClientActor(actorID);
  let current: CartResponse | null = null;
  try {
    current = await createClientDsh().readOpenCart(accessToken, storeID);
  } catch (error) {
    const missing = error && typeof error === "object" && (error as { status?: unknown }).status === 404;
    if (!missing) throw error;
  }
  assertClientActor(actorID);
  const line = current?.cart.lines.find((item) => item.storeOfferId === offer.offerId);
  if (direction === -1 && !line) throw new Error("HOME_OFFER_NOT_IN_CART");
  if (direction === -1 && current && line && line.quantityBaseUnits <= offer.quantityMinBaseUnits) {
    return createClientDsh().removeCartLine(accessToken, line.id, current.cart.version);
  }
  const quantityBaseUnits = line
    ? line.quantityBaseUnits + direction * offer.quantityStepBaseUnits
    : offer.quantityMinBaseUnits;
  if (!Number.isSafeInteger(quantityBaseUnits) || quantityBaseUnits < offer.quantityMinBaseUnits || quantityBaseUnits > offer.quantityMaxBaseUnits) {
    throw new Error("HOME_OFFER_QUANTITY_LIMIT");
  }
  return createClientDsh().upsertCartLine(
    accessToken,
    { storeId: storeID, storeOfferId: offer.offerId, quantityBaseUnits, selectedModifierOptionIds: [] },
    current?.cart.version ?? 0,
  );
}
