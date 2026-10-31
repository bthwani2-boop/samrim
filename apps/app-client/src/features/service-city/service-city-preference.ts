export type CityPreferenceStorage = Readonly<{
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}>;

// The persisted city is a convenience, never an authority or an API precondition.
export async function readCitySelection(
  storage: CityPreferenceStorage,
  key: string,
  activeIDs: ReadonlySet<string>,
  current: string | null,
): Promise<string | null> {
  let saved: string | null = null;
  try {
    saved = (await storage.getItemAsync(key))?.trim() || null;
  } catch {
    // A locked or unavailable device keychain cannot block public store discovery.
  }
  if (saved && !activeIDs.has(saved)) {
    await storage.deleteItemAsync(key).catch(() => {});
    return null;
  }
  const preferred = saved ?? current;
  return preferred && activeIDs.has(preferred) ? preferred : null;
}

// A Store link may suggest an active city for a fresh visitor, never override a saved choice.
export function resolveLinkedServiceCityID(
  selectedCityID: string | null,
  linkedCityID: string,
  activeIDs: ReadonlySet<string>,
): string | null {
  if (selectedCityID && activeIDs.has(selectedCityID)) return selectedCityID;
  return linkedCityID && activeIDs.has(linkedCityID) ? linkedCityID : null;
}

export async function persistCitySelection(
  storage: CityPreferenceStorage,
  key: string,
  cityID: string | null,
): Promise<void> {
  if (cityID) await storage.setItemAsync(key, cityID).catch(() => {});
  else await storage.deleteItemAsync(key).catch(() => {});
}
