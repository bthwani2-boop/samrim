import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, restoreIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";

// Older installed development builds do not contain the new native module.
// A guarded require preserves their foreground GPS fallback until rebuilt.
const TaskManager: typeof import("expo-task-manager") | null = (() => {
  try { return require("expo-task-manager") as typeof import("expo-task-manager"); }
  catch { return null; }
})();

export const MISSION_LOCATION_TASK = "bthwani-captain-mission-background-v1";
const SCOPE_KEY = "bthwani.captain.mission.background.scope.v1";
const ENABLED_KEY = "bthwani.captain.mission.background.enabled.v1";
type Scope = Readonly<{ actor: string; assignment: string }>;

async function getScope(): Promise<Scope | null> {
  const raw = await SecureStore.getItemAsync(SCOPE_KEY);
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const scope = data as Partial<Scope>;
    if (!scope.actor || !scope.assignment || scope.actor.length > 128 || scope.assignment.length > 128) return null;
    return { actor: scope.actor, assignment: scope.assignment };
  } catch { return null; }
}

export async function hasBackgroundMissionConsent(actor: string, assignment: string): Promise<boolean> {
  if (Platform.OS !== "android" || !actor || !assignment) return false;
  const raw = await SecureStore.getItemAsync(ENABLED_KEY);
  if (!raw) return false;
  try {
    const choice = JSON.parse(raw) as Partial<Scope>;
    return choice.actor === actor && choice.assignment === assignment;
  } catch { return false; }
}

export async function backgroundMissionRunning(): Promise<boolean> {
  return Boolean(TaskManager) && Platform.OS === "android" && await Location.hasStartedLocationUpdatesAsync(MISSION_LOCATION_TASK);
}

export async function stopBackgroundMissionLocation(clearConsent = false): Promise<void> {
  // The native task must stop even when secure storage is temporarily unavailable.
  try {
    if (await backgroundMissionRunning()) await Location.stopLocationUpdatesAsync(MISSION_LOCATION_TASK);
  } finally {
    await SecureStore.deleteItemAsync(SCOPE_KEY);
    if (clearConsent) await SecureStore.deleteItemAsync(ENABLED_KEY);
  }
}

export async function setBackgroundMissionConsent(enabled: boolean, actor: string, assignment: string): Promise<void> {
  if (!enabled) { await stopBackgroundMissionLocation(true); return; }
  if (!actor || !assignment || actor.length > 128 || assignment.length > 128) return;
  if (Platform.OS !== "android" || AppState.currentState !== "active" || !TaskManager) {
    throw new Error("NATIVE_BACKGROUND_LOCATION_BUILD_REQUIRED");
  }
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted || !await Location.hasServicesEnabledAsync()) throw new Error("FOREGROUND_GPS_REQUIRED");
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) throw new Error("BACKGROUND_LOCATION_PERMISSION_DENIED");
  await SecureStore.setItemAsync(ENABLED_KEY, JSON.stringify({ actor, assignment } satisfies Scope));
}

export async function reconcileBackgroundMissionLocation(actor: string, assignment: string): Promise<boolean> {
  if (!TaskManager || Platform.OS !== "android" || AppState.currentState !== "active"
      || !await hasBackgroundMissionConsent(actor, assignment)) return false;
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  if (!foreground.granted || !background.granted || !await Location.hasServicesEnabledAsync()) {
    await stopBackgroundMissionLocation(false);
    return false;
  }
  const session = currentIdentityState();
  if (session.kind !== "authenticated" || session.identity.subject !== actor) return false;
  const previous = await getScope();
  if (await backgroundMissionRunning() && previous?.actor === actor && previous.assignment === assignment) return true;
  if (await backgroundMissionRunning()) await stopBackgroundMissionLocation(false);
  await SecureStore.setItemAsync(SCOPE_KEY, JSON.stringify({ actor, assignment } satisfies Scope));
  try {
    await Location.startLocationUpdatesAsync(MISSION_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 20_000,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: "بثواني — مهمة توصيل نشطة",
        notificationBody: "موقع المهمة متاح للعمليات حتى انتهاء التوصيل.",
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch {
    await SecureStore.deleteItemAsync(SCOPE_KEY);
    return false;
  }
}

// Register at the top-level entrypoint: Expo TaskManager headless execution
// cannot register a task from a mounted React component.
TaskManager?.defineTask<{ locations?: Location.LocationObject[] }>(MISSION_LOCATION_TASK, async ({ data, error }) => {
  if (error || Platform.OS !== "android" || !data?.locations?.length) return;
  try {
    const scope = await getScope();
    if (!scope || !await hasBackgroundMissionConsent(scope.actor, scope.assignment)) {
      await stopBackgroundMissionLocation(); return;
    }
    let session = currentIdentityState();
    if (session.kind !== "authenticated") session = await restoreIdentitySession();
    if (session.kind !== "authenticated" || session.identity.subject !== scope.actor) {
      await stopBackgroundMissionLocation();
      return;
    }
    const token = await getUsableIdentityAccessToken();
    const api = captainClient();
    const own = await api.listOwnCaptainAssignments(token);
    if (!own.assignments.some(a => a.id === scope.assignment && (a.state === "assigned" || a.state === "in_custody"))) {
      await stopBackgroundMissionLocation();
      return;
    }
    const task = await api.readOwnCaptainDeliveryTask(token, scope.assignment);
    if (task.task.fulfillmentMode !== "BTHWANI_CAPTAIN") { await stopBackgroundMissionLocation(); return; }
    // Only the latest fix is sent. No movement history is retained or forwarded to clients.
    const fix = data.locations[data.locations.length - 1];
    if (!fix || !Number.isFinite(fix.coords.latitude) || !Number.isFinite(fix.coords.longitude)) return;
    const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!url) return;
    const latest = currentIdentityState();
    if (latest.kind !== "authenticated" || latest.identity.subject !== scope.actor
        || !await hasBackgroundMissionConsent(scope.actor, scope.assignment)) return;
    const response = await fetch(
      url.replace(/\/$/, "") + "/dsh/captains/me/assignments/" + encodeURIComponent(scope.assignment) + "/mission-location",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: fix.coords.latitude, longitude: fix.coords.longitude,
          accuracyMeters: Math.max(0, fix.coords.accuracy ?? 5000),
          recordedAt: new Date(fix.timestamp).toISOString(),
          sequence: Math.max(Date.now(), Math.floor(fix.timestamp)),
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (response.status === 403) await stopBackgroundMissionLocation();
    // 401, 409, network and GPS outages remain missing signals, not synthetic positions.
  } catch {
    // Native OS throttling and transient offline/auth errors cannot fabricate location.
    // Operations accurately displays STALE/LOST until the next validated fix.
  }
});
