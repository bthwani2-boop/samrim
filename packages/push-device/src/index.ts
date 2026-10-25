import { requireOptionalNativeModule } from "expo";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { Platform } from "react-native";

const installationStorageKey = "bthwani.order-alert.installation-v1";
let lastRegistered = { actor: "", expires: 0, tone: "", pushActive: false };
let registrationInFlight: { actor: string; task: Promise<boolean> } | null = null;

export function hasNativeNotificationModules(): boolean {
  if (Platform.OS === "web") return false;
  try { return requireOptionalNativeModule("ExpoPushTokenManager") !== null; }
  catch { return false; }
}

function endpoint(apiBaseUrl: string | undefined): string {
  const url = apiBaseUrl?.trim();
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

export async function unregisterOwnPushDevice(accessToken: string, apiBaseUrl: string | undefined): Promise<void> {
  if (Platform.OS === "web" || !accessToken) return;
  try {
    // Do not allow an in-flight registration to re-bind the token after logout.
    await registrationInFlight?.task.catch(() => false);
    const id = await SecureStore.getItemAsync(installationStorageKey);
    if (!id) return;
    await fetch(endpoint(apiBaseUrl) + "/" + encodeURIComponent(id), {
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

export function registerOwnPushDevice(accessToken: string, actor: string, tone: "classic" | "soft" | "urgent", stillCurrent: () => boolean, apiBaseUrl: string | undefined): Promise<boolean> {
  if (Platform.OS === "web" || !accessToken || !actor || !stillCurrent()) return Promise.resolve(false);
  if (registrationInFlight?.actor === actor) return registrationInFlight.task;
  const previousTask = registrationInFlight?.task;
  const task = (async () => {
    if (previousTask) await previousTask.catch(() => false);
    try {
      if (!stillCurrent()) return false;
      if (lastRegistered.actor === actor && lastRegistered.tone === tone && lastRegistered.expires > Date.now()) return lastRegistered.pushActive;
      if (!hasNativeNotificationModules()) return false;
      const Notifications = await import("expo-notifications");
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) return false;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      if (!projectId) throw new Error("EAS_PROJECT_ID_MISSING");
      const push = await Notifications.getExpoPushTokenAsync({ projectId });
      const installation = await installationId();
      if (!stillCurrent()) return false;
      const result = await fetch(endpoint(apiBaseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: installation, expoPushToken: push.data, tone }),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) return false;
      const body = await result.json() as { registered?: boolean; pushEnabled?: boolean };
      if (body.registered !== true || !stillCurrent()) return false;
      const pushActive = body.pushEnabled === true;
      lastRegistered = { actor, tone, expires: Date.now() + 15 * 60_000, pushActive };
      return pushActive;
    } catch {
      return false;
    }
  })();
  registrationInFlight = { actor, task };
  void task.finally(() => {
    if (registrationInFlight?.task === task) registrationInFlight = null;
  });
  return task;
}
