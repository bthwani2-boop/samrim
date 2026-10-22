/**
 * Browser compatibility storage used by the local Expo Web experiment.
 * Never persist identity tokens or the client instance ID to web storage.
 * Order/financial retry payloads may be held per-tab ONLY while __DEV__.
 * Production browser payment must use a server-owned durable session/intent.
 */
declare const __DEV__: boolean;
const privateSession = new Map<string, string>();

function isIdentityKey(key: string): boolean {
  return key.includes(".identity.session.") || key.includes(".identity.device.");
}
function isPreferenceKey(key: string): boolean {
  return key.endsWith(".appearance") || key.endsWith(".service-city");
}
function storageForKey(key: string): Storage | null {
  if (isIdentityKey(key)) return null;
  if (isPreferenceKey(key)) return window.localStorage;
  if (!__DEV__) throw new Error("WEB_TRANSACTION_STORAGE_REQUIRES_SERVER_SESSION");
  return window.sessionStorage;
}
export async function getItemAsync(key: string): Promise<string | null> {
  const storage = storageForKey(key);
  return storage ? storage.getItem(key) : privateSession.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  const storage = storageForKey(key);
  if (storage) storage.setItem(key, value);
  else privateSession.set(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  const storage = storageForKey(key);
  if (storage) storage.removeItem(key);
  else privateSession.delete(key);
}
