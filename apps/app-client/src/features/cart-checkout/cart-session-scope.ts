export function isClientCartScopeCurrent(
  loadedActorID: string,
  activeActorID: string,
  loadedStoreID: string,
  currentStoreID: string,
  loadedCityID: string,
  currentCityID: string,
): boolean {
  return loadedActorID.trim().length > 0
    && loadedActorID === activeActorID
    && loadedStoreID === currentStoreID
    && loadedCityID === currentCityID;
}

export function subscribeClientCartActorChanges(initialActorID: string, readCurrentActorID: () => string, subscribe: (listener: (actorID: string) => void) => () => void, onActorChange: (actorID: string) => void): { unsubscribe: () => void; changedDuringSync: boolean } {
  let activeActorID = initialActorID.trim();
  const reconcile = (nextActorID: string) => {
    const normalizedActorID = nextActorID.trim();
    if (normalizedActorID === activeActorID) return;
    activeActorID = normalizedActorID;
    onActorChange(normalizedActorID);
  };

  // Subscribe first, then reread so a session transition during setup cannot be missed.
  const unsubscribe = subscribe(reconcile);
  reconcile(readCurrentActorID());
  return { unsubscribe, changedDuringSync: activeActorID !== initialActorID.trim() };
}
