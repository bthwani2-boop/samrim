import * as Location from "expo-location";
import { useEffect } from "react";
import { AppState } from "react-native";

import { captainSessionKey } from "../../bootstrap/captain-session-scope";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { reconcileBackgroundMissionLocation, stopBackgroundMissionLocation } from "./captain-mission-location-background";

// Foreground mission fixes are a fallback when native background consent is absent.
// Neither publisher supplies a Customer location feed or movement history.
export function CaptainMissionLocationPublisher() {
  useEffect(() => {
    let disposed = false;
    let activeAssignment = "";
    let ownerSession = "";
    let watcher: Location.LocationSubscription | null = null;
    let sequence = Date.now();
    let posting = false;
    let discovering = false;
    let discoveryPending = false;
    let stopping: Promise<void> | null = null;
    let pendingRequest: AbortController | null = null;
    let observedSession = captainSessionKey(currentIdentityState());

    async function stop(endMission = true) {
      activeAssignment = "";
      ownerSession = "";
      watcher?.remove();
      watcher = null;
      pendingRequest?.abort();
      pendingRequest = null;
      posting = false;
      if (!endMission) return;
      const operation = stopBackgroundMissionLocation(false);
      stopping = operation;
      let stopped = false;
      try { await operation; stopped = true; }
      finally {
        if (stopping === operation) stopping = null;
        if (!stopped) discoveryPending = false;
        else if (discoveryPending && !discovering && !disposed) {
          discoveryPending = false;
          void update();
        }
      }
    }

    async function update() {
      if (disposed) return;
      if (discovering || stopping) { discoveryPending = true; return; }
      const identity = currentIdentityState();
      if (AppState.currentState !== "active") { await stop(false); return; }
      const sessionKey = captainSessionKey(identity);
      if (!sessionKey || identity.kind !== "authenticated") { await stop(); return; }
      const actor = identity.identity.subject;
      const isCurrent = () => !disposed && AppState.currentState === "active"
        && captainSessionKey(currentIdentityState()) === sessionKey;
      discovering = true;
      try {
        const token = await getUsableIdentityAccessToken();
        if (!isCurrent()) { await stop(); return; }
        const result = await captainClient().listOwnCaptainAssignments(token);
        if (!isCurrent()) { await stop(); return; }
        const candidate = result.assignments.find((item) => item.state === "assigned" || item.state === "in_custody");
        if (!candidate) { await stop(); return; }
        const task = await captainClient().readOwnCaptainDeliveryTask(token, candidate.id);
        if (!isCurrent() || task.task.fulfillmentMode !== "BTHWANI_CAPTAIN") {
          await stop(); return;
        }
        if (candidate.id === activeAssignment && ownerSession === sessionKey && watcher) {
          const backgroundActive = await reconcileBackgroundMissionLocation(actor, candidate.id);
          if (!isCurrent()) { await stop(); return; }
          if (backgroundActive) { watcher.remove(); watcher = null; }
          return;
        }
        await stop(false);
        if (!isCurrent()) { await stop(); return; }
        const backgroundActive = await reconcileBackgroundMissionLocation(actor, candidate.id);
        if (!isCurrent()) { await stop(); return; }
        if (backgroundActive) {
          activeAssignment = candidate.id;
          ownerSession = sessionKey;
          return;
        }
        const permission = await Location.getForegroundPermissionsAsync();
        if (!isCurrent() || !permission.granted) return;
        activeAssignment = candidate.id;
        ownerSession = sessionKey;
        const targetAssignment = candidate.id;
        const targetSession = sessionKey;
        const isWatcherCurrent = () => !disposed && AppState.currentState === "active"
          && targetAssignment === activeAssignment && ownerSession === targetSession
          && captainSessionKey(currentIdentityState()) === targetSession;

        const subscription = await Location.watchPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 20_000,
          // A stationary Captain still needs periodic location updates.
          distanceInterval: 0,
        }, (position) => {
          if (posting || !isWatcherCurrent()) return;
          const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
          if (!url) return;
          sequence = Math.max(sequence + 1, Date.now());
          const fixSequence = sequence;
          posting = true;
          const requestController = new AbortController();
          pendingRequest = requestController;
          void (async () => {
            const accessToken = await getUsableIdentityAccessToken();
            if (requestController.signal.aborted || !isWatcherCurrent()) return;
            const timeout = setTimeout(() => requestController.abort(), 12_000);
            try {
              const response = await fetch(
                `${url.replace(/\/$/, "")}/dsh/captains/me/assignments/${encodeURIComponent(targetAssignment)}/mission-location`, {
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
                },
              );
              if (!response.ok && response.status !== 409) throw new Error("MISSION_LOCATION_REJECTED");
            } finally { clearTimeout(timeout); }
          })().catch(() => {
            // No synthetic position: Operations reports STALE/LOST during failure.
          }).finally(() => {
            if (pendingRequest === requestController) {
              pendingRequest = null;
              posting = false;
            }
          });
        }, () => {
          // Android may invalidate a watcher when GPS or permission changes.
          if (isWatcherCurrent()) { watcher?.remove(); watcher = null; }
        });
        if (!isWatcherCurrent()) { subscription.remove(); return; }
        watcher = subscription;
      } catch {
        await stop(false);
      } finally {
        discovering = false;
        if (discoveryPending && !disposed) {
          discoveryPending = false;
          void update();
        }
      }
    }

    void update();
    const appListener = AppState.addEventListener("change", (state) => {
      if (state !== "active") { void stop(false); return; }
      void update();
    });
    const unsubscribeIdentity = subscribeIdentitySession((identity) => {
      const nextSession = captainSessionKey(identity);
      if (nextSession !== observedSession) {
        observedSession = nextSession;
        discoveryPending = Boolean(nextSession);
        void stop().then(() => {
          if (nextSession && !disposed) void update();
        }).catch(() => {
          // An unconfirmed native stop must not start another GPS watcher.
          // The headless task independently rejects the superseded session.
        });
        return;
      }
      if (nextSession) void update();
    });
    const interval = setInterval(() => { void update(); }, 40_000);
    return () => {
      disposed = true;
      unsubscribeIdentity();
      appListener.remove();
      clearInterval(interval);
      // Unmounting the tab layout is not a completed mission.
      void stop(false);
    };
  }, []);
  return null;
}
