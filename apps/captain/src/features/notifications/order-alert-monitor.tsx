/** Visibility only; never accept offers or reveal customer address via an alert. */
export type CaptainOfferAlert = Readonly<{captainId:string;expiresAt:string;status:"OFFERED"|"EXPIRED"|"SUPERSEDED"}>;
export function mayShowOfferAlert(event:CaptainOfferAlert|null, ownerCaptainId:string|null,
  hasActiveMission:boolean, now=Date.now()):boolean {
  return Boolean(event && ownerCaptainId && event.captainId===ownerCaptainId &&
    event.status==="OFFERED" && !hasActiveMission && Number.isFinite(Date.parse(event.expiresAt)) &&
    Date.parse(event.expiresAt)>now);
}
