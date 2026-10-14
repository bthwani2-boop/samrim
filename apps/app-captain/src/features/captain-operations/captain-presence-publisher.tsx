import * as Location from "expo-location";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { captainPresenceIntervalMs, shouldPublishCaptainPresence } from "./captain-presence-policy";

let lastSubmittedAt = 0;
let lastSubmittedActor = "";
async function sendCurrentPresence() {
  const before = currentIdentityState();
  if (before.kind !== "authenticated" || AppState.currentState !== "active") return;
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return;
  const token = await getUsableIdentityAccessToken();
  const api = captainClient();
  const admission = await api.readOwnCaptainAdmission(token);
  const available = admission.admission.state === "eligible" && admission.admission.availabilityState === "available";
  let inCustody = false;
  if (!available) {
    const assignments = await api.listOwnCaptainAssignments(token);
    inCustody = assignments.assignments.some((assignment) => assignment.state === "in_custody");
  }
  const current = currentIdentityState();
  if (!shouldPublishCaptainPresence(
    AppState.currentState === "active", permission.granted,
    current.kind === "authenticated" && current.identity.subject === before.identity.subject,
    available, inCustody,
  )) return;
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const after = currentIdentityState();
  if (AppState.currentState !== "active" || after.kind !== "authenticated" || after.identity.subject !== before.identity.subject) return;
  const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!base) return;
  const response = await fetch(base.replace(/\/$/, "") + "/dsh/captains/me/presence", {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
  });
  if (!response.ok) throw new Error("CAPTAIN_PRESENCE_NOT_ACCEPTED");
  lastSubmittedAt = Date.now();
  lastSubmittedActor = after.identity.subject;
}
export async function publishCaptainPresence() {
  const session = currentIdentityState();
  if (session.kind !== "authenticated") return;
  if (lastSubmittedActor === session.identity.subject && Date.now() - lastSubmittedAt < 60_000) return;
  await sendCurrentPresence();
}
export function CaptainPresencePublisher() {
  const inFlight = useRef(false);
  useEffect(() => {
    let disposed = false;
    const tick = async () => {
      if (disposed || inFlight.current || AppState.currentState !== "active") return;
      inFlight.current = true;
      try { await publishCaptainPresence(); }
      catch { /* A failed update is not queued: retry with current GPS on the next tick. */ }
      finally { inFlight.current = false; }
    };
    void tick();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void tick(); });
    const interval = setInterval(() => { void tick(); }, captainPresenceIntervalMs);
    return () => { disposed = true; subscription.remove(); clearInterval(interval); };
  }, []);
  return null;
}
