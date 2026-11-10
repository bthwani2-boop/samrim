import * as Location from "expo-location";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { captainSessionKey } from "../../bootstrap/captain-session-scope";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { captainPresenceIntervalMs, shouldPublishCaptainPresence } from "./captain-presence-policy";

let lastSubmittedAt = 0;
let lastSubmittedSession = "";
async function sendCurrentPresence() {
  const sessionKey = captainSessionKey(currentIdentityState());
  const isCurrent = () => Boolean(sessionKey) && AppState.currentState === "active"
    && captainSessionKey(currentIdentityState()) === sessionKey;
  if (!isCurrent()) return;
  const [permission, locationServicesEnabled] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.hasServicesEnabledAsync(),
  ]);
  if (!isCurrent() || !permission.granted || !locationServicesEnabled) return;
  const token = await getUsableIdentityAccessToken();
  if (!isCurrent()) return;
  const api = captainClient();
  const admission = await api.readOwnCaptainAdmission(token);
  const available = admission.admission.state === "eligible" && admission.admission.availabilityState === "available";
  if (!shouldPublishCaptainPresence(
    AppState.currentState === "active", permission.granted,
    isCurrent(), available, locationServicesEnabled,
  )) return;
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  if (!isCurrent()) return;
  const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!base) return;
  const response = await fetch(`${base.replace(/\/$/, "")}/dsh/captains/me/presence`, {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
  });
  if (!response.ok) throw new Error("CAPTAIN_PRESENCE_NOT_ACCEPTED");
  if (!isCurrent()) return;
  lastSubmittedAt = Date.now();
  lastSubmittedSession = sessionKey;
}
export async function publishCaptainPresence(force = false) {
  const sessionKey = captainSessionKey(currentIdentityState());
  if (!sessionKey) return;
  if (!force && lastSubmittedSession === sessionKey && Date.now() - lastSubmittedAt < 60_000) return;
  await sendCurrentPresence();
}
export function CaptainPresencePublisher() {
  const inFlight = useRef(false);
  useEffect(() => {
    let disposed = false;
    let refreshPending = false;
    let observedSession = captainSessionKey(currentIdentityState());
    const tick = async () => {
      if (disposed || AppState.currentState !== "active") return;
      if (inFlight.current) { refreshPending = true; return; }
      inFlight.current = true;
      try { await publishCaptainPresence(); }
      catch { /* A failed update is not queued: retry with current GPS on the next tick. */ }
      finally {
        inFlight.current = false;
        if (refreshPending && !disposed) {
          refreshPending = false;
          void tick();
        }
      }
    };
    void tick();
    const unsubscribeIdentity = subscribeIdentitySession((identity) => {
      const nextSession = captainSessionKey(identity);
      if (nextSession === observedSession) return;
      observedSession = nextSession;
      void tick();
    });
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void tick(); });
    const interval = setInterval(() => { void tick(); }, captainPresenceIntervalMs);
    return () => { disposed = true; unsubscribeIdentity(); subscription.remove(); clearInterval(interval); };
  }, []);
  return null;
}
