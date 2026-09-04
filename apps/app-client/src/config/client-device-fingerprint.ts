type ClientFingerprintStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const CLIENT_DEVICE_FINGERPRINT_KEY = "bthwani.client.device-fingerprint.v1";

export async function getOrCreateClientDeviceFingerprint(
  storage: ClientFingerprintStorage,
  randomUUID: () => string,
): Promise<string> {
  const existing = await storage.getItem(CLIENT_DEVICE_FINGERPRINT_KEY);
  if (existing?.trim()) return existing;
  const created = `client-device:${randomUUID()}`;
  await storage.setItem(CLIENT_DEVICE_FINGERPRINT_KEY, created);
  return created;
}
