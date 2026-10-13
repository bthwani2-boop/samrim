export function isCurrentCaptainActor(loadedActorID: string, activeActorID: string): boolean {
  return loadedActorID.trim().length > 0 && loadedActorID === activeActorID;
}

export function canPublishCaptainLocation(loadedActorID: string, activeActorID: string, assignmentID: string): boolean {
  return isCurrentCaptainActor(loadedActorID, activeActorID) && assignmentID.trim().length > 0;
}
