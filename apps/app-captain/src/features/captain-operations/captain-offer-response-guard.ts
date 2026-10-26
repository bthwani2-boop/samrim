export function claimCaptainOfferResponse(inFlight: Set<string>, offerID: string): boolean {
  if (inFlight.has(offerID)) return false;
  inFlight.add(offerID);
  return true;
}
