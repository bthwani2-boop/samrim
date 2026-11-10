import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";

import { captainSessionKey } from "../../bootstrap/captain-session-scope";
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
type Scope = Readonly<{ actor: string; assignment: string; sessionKey: string }>;

// The native headless task may outlive React. Its active scope therefore
// carries the canonical Identity session, while explicit consent remains
// bound only to the Captain and their assignment.
function activeScope(actor: string, assignment: string): Scope | null {
  const session = currentIdentityState();
  const sessionKey = captainSessionKey(session);
  if (!sessionKey || session.kind !== "authenticated" || session.identity.subject !== actor) return null;
  return { actor, assignment, sessionKey };
}

function sameScope(left: Scope | null, right: Scope): boolean {
  return left?.actor === right.actor && left.assignment === right.assignment && left.sessionKey === right.sessionKey;
}

async function scopeIsCurrent(scope: Scope): Promise<boolean> {
  if (captainSessionKey(currentIdentityState()) !== scope.sessionKey) return false;
  if (!sameScope(await getScope(), scope)) return false;
  return hasBackgroundMissionConsent(scope.actor, scope.assignment);
}

async function getScope(): Promise<Scope | null> {
  const raw = await SecureStore.getItemAsync(SCOPE_KEY);
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const scope = data as Partial<Scope>;
    if (!scope.actor || !scope.assignment || typeof scope.sessionKey !== "string"
      || !scope.sessionKey || scope.actor.length > 128 || scope.assignment.length > 128
      || scope.sessionKey.length > 512) return null;
    return { actor: scope.actor, assignment: scope.assignment, sessionKey: scope.sessionKey };
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
  const requested = activeScope(actor, assignment);
  if (!requested) throw new Error("CAPTAIN_MISSION_SESSION_REQUIRED");
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted || !await Location.hasServicesEnabledAsync()) throw new Error("FOREGROUND_GPS_REQUIRED");
  if (!sameScope(activeScope(actor, assignment), requested)) throw new Error("CAPTAIN_MISSION_SESSION_CHANGED");
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) throw new Error("BACKGROUND_LOCATION_PERMISSION_DENIED");
  if (!sameScope(activeScope(actor, assignment), requested)) throw new Error("CAPTAIN_MISSION_SESSION_CHANGED");
  await SecureStore.setItemAsync(ENABLED_KEY, JSON.stringify({ actor, assignment }));
}

export async function reconcileBackgroundMissionLocation(actor: string, assignment: string): Promise<boolean> {
  const requested = activeScope(actor, assignment);
  if (!requested || !TaskManager || Platform.OS !== "android" || AppState.currentState !== "active"
      || !await hasBackgroundMissionConsent(actor, assignment)) return false;
  const valid = () => AppState.currentState === "active" && sameScope(activeScope(actor, assignment), requested);
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  if (!valid()) return false;
  if (!foreground.granted || !background.granted || !await Location.hasServicesEnabledAsync()) {
    if (valid()) await stopBackgroundMissionLocation(false);
    return false;
  }
  if (!valid()) return false;
  const previous = await getScope();
  if (!valid()) return false;
  if (await backgroundMissionRunning()) {
    if (!valid()) return false;
    if (sameScope(previous, requested)) return true;
    await stopBackgroundMissionLocation(false);
  }
  if (!valid()) return false;
  await SecureStore.setItemAsync(SCOPE_KEY, JSON.stringify(requested));
  if (!valid()) {
    if (sameScope(await getScope(), requested)) await stopBackgroundMissionLocation(false);
    return false;
  }
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
    if (!valid()) {
      if (sameScope(await getScope(), requested)) await stopBackgroundMissionLocation(false);
      return false;
    }
    return true;
  } catch {
    if (sameScope(await getScope(), requested)) await SecureStore.deleteItemAsync(SCOPE_KEY);
    return false;
  }
}

// Register at the top-level entrypoint: Expo TaskManager headless execution
// cannot register a task from a mounted React component.
TaskManager?.defineTask<{ locations?: Location.LocationObject[] }>(MISSION_LOCATION_TASK, async ({ data, error }) => {
  if (error || Platform.OS !== "android" || !data?.locations?.length) return;
  try {
    const scope = await getScope();
    // A legacy scope has no session; it cannot authorize the new native task.
    if (!scope || !await hasBackgroundMissionConsent(scope.actor, scope.assignment)) {
      await stopBackgroundMissionLocation(); return;
    }
    let session = currentIdentityState();
    if (session.kind !== "authenticated") session = await restoreIdentitySession();
    if (session.kind !== "authenticated" || session.identity.subject !== scope.actor
      || captainSessionKey(session) !== scope.sessionKey) {
      if (sameScope(await getScope(), scope)) await stopBackgroundMissionLocation();
      return;
    }
    const token = await getUsableIdentityAccessToken();
    if (!await scopeIsCurrent(scope)) return;
    const api = captainClient();
    const own = await api.listOwnCaptainAssignments(token);
    if (!await scopeIsCurrent(scope)) return;
    if (!own.assignments.some(a => a.id === scope.assignment && (a.state === "assigned" || a.state === "in_custody"))) {
      if (sameScope(await getScope(), scope)) await stopBackgroundMissionLocation();
      return;
    }
    const task = await api.readOwnCaptainDeliveryTask(token, scope.assignment);
    if (!await scopeIsCurrent(scope)) return;
    if (task.task.fulfillmentMode !== "BTHWANI_CAPTAIN") {
      if (sameScope(await getScope(), scope)) await stopBackgroundMissionLocation();
      return;
    }
    // Latest-only, never a movement history or a Client tracking feed.
    const fix = data.locations[data.locations.length - 1];
    if (!fix || !Number.isFinite(fix.coords.latitude) || !Number.isFinite(fix.coords.longitude)) return;
    const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!url || !await scopeIsCurrent(scope)) return;
    const response = await fetch(
      `${url.replace(/\/$/, "")}/dsh/captains/me/assignments/${encodeURIComponent(scope.assignment)}/mission-location`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: fix.coords.latitude, longitude: fix.coords.longitude,
          accuracyMeters: Math.max(0, fix.coords.accuracy ?? 5000),
          recordedAt: new Date(fix.timestamp).toISOString(),
          sequence: Math.max(Date.now(), Math.floor(fix.timestamp)),
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (response.status === 403 && sameScope(await getScope(), scope)) await stopBackgroundMissionLocation();
    // 401, 409 and network outages remain missing signals, not synthetic positions.
  } catch {
    // A transient native, offline or auth failure must not manufacture GPS.
    // Operations displays STALE/LOST until the next validated fix.
  }
});
