/** Presentation check for an Identity-verified session; never an authentication authority. */
export type CaptainSessionView = Readonly<{actorId:string;role:string;sessionExpiresAt:string}>;
export function hasActiveCaptainSession(v:unknown,now=Date.now()):v is CaptainSessionView {
  if (!v || typeof v!=="object" || Array.isArray(v) || !Number.isFinite(now)) return false;
  const s=v as Record<string,unknown>;
  return typeof s.actorId==="string" && s.actorId.trim().length>0 && s.actorId===s.actorId.trim() &&
    s.role==="captain" && typeof s.sessionExpiresAt==="string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s.sessionExpiresAt) &&
    Number.isFinite(Date.parse(s.sessionExpiresAt)) && Date.parse(s.sessionExpiresAt)>now;
}
