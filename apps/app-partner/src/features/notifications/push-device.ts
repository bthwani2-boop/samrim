import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const installationStorageKey = "bthwani.order-alert.installation-v1";
let lastRegistered = { actor: "", expires: 0, tone: "", pushActive: false };
let registrationInFlight: Promise<boolean> | null = null;

function endpoint(): string {
  const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!url || !/^https?:\/\//.test(url)) throw new Error("DSH_PUSH_BASE_URL_REQUIRED");
  return url.replace(/\/$/, "") + "/dsh/notifications/devices";
}

async function installationId(): Promise<string> {
  let id = await SecureStore.getItemAsync(installationStorageKey);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(installationStorageKey, id);
  }
  return id;
}

export async function unregisterOwnPushDevice(accessToken: string): Promise<void> {
  if (Platform.OS !== "android" || !accessToken) return;
  try {
    const id = await SecureStore.getItemAsync(installationStorageKey);
    if (!id) return;
    await fetch(endpoint() + "/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    // Logout must not be blocked by transport issues. The next actor's
    // registration replaces the old binding for this installation.
  } finally {
    lastRegistered = { actor: "", expires: 0, tone: "", pushActive: false };
  }
}

export function registerOwnPushDevice(accessToken: string, actor: string, tone: "classic" | "soft" | "urgent"): Promise<boolean> {
  if (Platform.OS !== "android" || !accessToken || !actor) return Promise.resolve(false);
  if (registrationInFlight) return registrationInFlight;
  registrationInFlight = (async () => {
    try {
      if (lastRegistered.actor === actor && lastRegistered.tone === tone && lastRegistered.expires > Date.now()) return lastRegistered.pushActive;
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) return false;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      if (!projectId) throw new Error("EAS_PROJECT_ID_MISSING");
      const push = await Notifications.getExpoPushTokenAsync({ projectId });
      const installation = await installationId();
      const result = await fetch(endpoint(), {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: installation, expoPushToken: push.data, tone }),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) return false;
      const body = await result.json() as { registered?: boolean; pushEnabled?: boolean };
      if (body.registered !== true) return false;
      const pushActive = body.pushEnabled === true;
      lastRegistered = { actor, tone, expires: Date.now() + 15 * 60_000, pushActive };
      return pushActive;
    } catch {
      return false;
    }
  })().finally(() => { registrationInFlight = null; });
  return registrationInFlight;
}
