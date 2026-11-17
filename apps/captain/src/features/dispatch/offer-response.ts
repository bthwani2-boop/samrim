/** DSH, not this presentation predicate, owns transactional offer acceptance. */
export type OfferSummary=Readonly<{captainId:string;offerId:string;expiresAt:string;status:"OFFERED"|"SUPERSEDED"|"EXPIRED"}>;
export type OfferViewContext=Readonly<{captainId:string;hasActiveAssignment:boolean;sessionVerified:boolean}>;
export function mayPresentOfferResponse(offer:OfferSummary|null,ctx:OfferViewContext,now=Date.now()):boolean {
  if(!offer || !ctx.sessionVerified || ctx.hasActiveAssignment || !Number.isFinite(now)) return false;
  return offer.status==="OFFERED" && offer.offerId.trim().length>0 && ctx.captainId.trim().length>0 &&
    offer.captainId===ctx.captainId && Number.isFinite(Date.parse(offer.expiresAt)) &&
    Date.parse(offer.expiresAt)>now;
}
