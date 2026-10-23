import * as Location from "expo-location";
import { useEffect } from "react";
import { AppState } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";

// Foreground-only mission fixes until a native Android background build has
// passed permission/crash testing. This is distinct from dispatch presence.
export function CaptainMissionLocationPublisher() {
  useEffect(() => {
    let disposed = false;
    let activeAssignment = "";
    let watcher: Location.LocationSubscription | null = null;
    let sequence = Date.now();
    let posting = false;
    let discovering = false;
    let owner = "";
    let pendingRequest: AbortController | null = null;
    async function stop() {
      activeAssignment = "";
      owner = "";
      watcher?.remove();
      watcher = null;
      pendingRequest?.abort();
      pendingRequest = null;
      posting = false;
    }
    async function update() {
      if (disposed || discovering) return;
      const identity = currentIdentityState();
      if (AppState.currentState !== "active" || identity.kind !== "authenticated") {
        await stop(); return;
      }
      discovering = true;
      try {
        const actor = identity.identity.subject;
        const token = await getUsableIdentityAccessToken();
        const result = await captainClient().listOwnCaptainAssignments(token);
        if (disposed || AppState.currentState !== "active" || currentIdentityState().kind !== "authenticated") {
          await stop(); return;
        }
        const candidate = result.assignments.find((a) => a.state === "assigned" || a.state === "in_custody");
        if (!candidate) { await stop();return; }
        const task = await captainClient().readOwnCaptainDeliveryTask(token, candidate.id);
        const currentSession = currentIdentityState();
        if (task.task.fulfillmentMode !== "BTHWANI_CAPTAIN" ||
            disposed || AppState.currentState !== "active" ||
            currentSession.kind !== "authenticated" || currentSession.identity.subject !== actor) {
          await stop(); return;
        }
        if (candidate.id === activeAssignment && owner === actor && watcher) return;
        await stop();
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted || disposed || AppState.currentState !== "active") return;
        owner = actor;
        activeAssignment = candidate.id;
        const targetAssignment = candidate.id;
        const sourceActor = actor;
        const subscription = await Location.watchPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 20_000,
          // A stationary Captain still needs periodic location updates.
          distanceInterval: 0,
        }, (position) => {
          const session = currentIdentityState();
          if (disposed || posting || AppState.currentState !== "active" ||
              targetAssignment !== activeAssignment || session.kind !== "authenticated" ||
              session.identity.subject !== sourceActor) return;
          const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
          if (!url) return;
          const fixSequence = sequence = Math.max(sequence + 1, Date.now());
          posting = true;
          const requestController = new AbortController();
          pendingRequest = requestController;
          void (async () => {
            const accessToken = await getUsableIdentityAccessToken();
            const currentSession = currentIdentityState();
            if (disposed || requestController.signal.aborted ||
                AppState.currentState !== "active" ||
                activeAssignment !== targetAssignment ||
                currentSession.kind !== "authenticated" ||
                currentSession.identity.subject !== sourceActor) return;
            const timeout = setTimeout(() => requestController.abort(), 12_000);
            try {
              const response = await fetch(url.replace(/\/$/, "") +
                `/dsh/captains/me/assignments/${encodeURIComponent(targetAssignment)}/mission-location`, {
                method: "POST",
                signal: requestController.signal,
                headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  accuracyMeters: Math.max(0, position.coords.accuracy ?? 5000),
                  recordedAt: new Date(position.timestamp).toISOString(),
                  sequence: fixSequence,
                }),
              });
              if (!response.ok && response.status !== 409) throw new Error("MISSION_LOCATION_REJECTED");
            } finally {
              clearTimeout(timeout);
            }
          })().catch(() => {
            // Operator displays LOST when fixes cannot be submitted. No synthetic position.
          }).finally(() => {
            if (pendingRequest === requestController) {
              pendingRequest = null;
              posting = false;
            }
          });
        }, () => {
          // Android can invalidate a watcher when GPS or permission changes.
          // Let the existing foreground discovery loop safely re-register it.
          if (targetAssignment === activeAssignment) {
            watcher?.remove();
            watcher = null;
          }
        });
        if (disposed || AppState.currentState !== "active" || activeAssignment !== targetAssignment) {
          subscription.remove();
          return;
        }
        watcher = subscription;
      } catch {
        await stop();
      } finally {
        discovering = false;
      }
    }
    void update();
    const appListener = AppState.addEventListener("change", (state) => {
      if (state !== "active") { void stop(); return; }
      void update();
    });
    const unsubscribeIdentity = subscribeIdentitySession((identity) => {
      if (identity.kind !== "authenticated" || (owner && owner !== identity.identity.subject)) {
        void stop();
        return;
      }
      void update();
    });
    const interval = setInterval(() => { void update(); }, 40_000);
    return () => {
      disposed = true;
      unsubscribeIdentity();
      appListener.remove();
      clearInterval(interval);
      void stop();
    };
  }, []);
  return null;
}
