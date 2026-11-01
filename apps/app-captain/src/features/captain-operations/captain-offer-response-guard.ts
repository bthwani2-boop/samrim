import type { CaptainOffer } from "@bthwani/dsh";

export function isCaptainOfferActionable(
  offer: Pick<CaptainOffer, "state" | "expiresAt">,
  now = Date.now(),
): boolean {
  return offer.state === "offered" && Number.isFinite(now) && Date.parse(offer.expiresAt) > now;
}

export function claimCaptainOfferResponse(inFlight: Set<string>, offerID: string): boolean {
  if (inFlight.size > 0) return false;
  inFlight.add(offerID);
  return true;
}