export function isCurrentCaptainActor(loadedActorID: string, activeActorID: string): boolean {
  return loadedActorID.trim().length > 0 && loadedActorID === activeActorID;
}
