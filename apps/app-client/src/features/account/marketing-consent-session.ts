export function marketingConsentActorID(session: { kind: string; identity?: { subject?: string } }): string {
  return session.kind === "authenticated" ? (session.identity?.subject ?? "").trim() : "";
}

export function isCurrentMarketingConsentActor(
  active: boolean,
  expectedActorID: string,
  session: { kind: string; identity?: { subject?: string } },
): boolean {
  return active && expectedActorID.length > 0 && marketingConsentActorID(session) === expectedActorID;
}