export function claimCaptainOfferResponse(inFlight: Set<string>, offerID: string): boolean {
  if (inFlight.size > 0) return false;
  inFlight.add(offerID);
  return true;
}