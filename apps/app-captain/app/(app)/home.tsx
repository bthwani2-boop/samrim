import type { CaptainAssignment, CaptainDeliveryTask } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AppState, View } from "react-native";

import { captainSessionKey } from "../../src/bootstrap/captain-session-scope";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../src/bootstrap/identity";
import { captainClient } from "../../src/features/captain-operations/captain-client";
import { CaptainOffers } from "../../src/features/captain-operations/captain-offers";
import { CaptainOpportunities } from "../../src/features/captain-operations/captain-opportunities";
import { CaptainReadiness } from "../../src/features/captain-operations/captain-readiness";
export type ActiveCaptainMission = Readonly<{
  assignment: CaptainAssignment;
  task: CaptainDeliveryTask;
}>;

// The home is the only visual map. The owner-backed assignment determines
// whether it shows opportunity circles or the current delivery destination.
// Never infer pickup/delivery transitions from local taps or unverified offers.
export default function CaptainHomeRoute() {
  const [missionSource, setMission] = useState<ActiveCaptainMission | null>(null);
  const [missionStatus, setMissionReadiness] = useState<"loading" | "ready" | "unavailable">("loading");
  const [confirmedMissionSession, setConfirmedMissionSession] = useState("");
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const onAvailabilityConfirmed = useCallback(() => setAvailabilityRevision((current) => current + 1), []);

  useFocusEffect(useCallback(() => {
    let disposed = false;
    let inFlight = false;
    let generation = 0;
    const readMission = async () => {
      if (disposed || inFlight || AppState.currentState !== "active") return;
      inFlight = true;
      const requestID = ++generation;
      const requestSession = captainSessionKey(currentIdentityState());
      const isCurrent = () => !disposed && requestID === generation
        && AppState.currentState === "active"
        && Boolean(requestSession)
        && captainSessionKey(currentIdentityState()) === requestSession;
      if (!requestSession) {
        if (!disposed && requestID === generation) {
          setMission(null);
          setConfirmedMissionSession("");
          setMissionReadiness("unavailable");
        }
        inFlight = false;
        return;
      }
      try {
        const token = await getUsableIdentityAccessToken();
        if (!isCurrent()) return;
        const api = captainClient();
        const result = await api.listOwnCaptainAssignments(token);
        if (!isCurrent()) return;
        const active = result.assignments.find((a) => a.state === "in_custody"
          || a.state === "assigned" || a.state === "delivery_failed");
        const taskResult = active ? await api.readOwnCaptainDeliveryTask(token, active.id) : null;
        if (!isCurrent()) return;
        if (active && !taskResult) throw new Error("ACTIVE_TASK_NOT_READABLE");
        const next = active && taskResult ? { assignment: active, task: taskResult.task } : null;
        // Preserve map camera between unchanged reads, but never across Identity sessions.
        setMission((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        setConfirmedMissionSession(requestSession);
        setMissionReadiness("ready");
      } catch {
        // Never open the idle opportunity map while assignment visibility is uncertain.
        if (isCurrent()) {
          setConfirmedMissionSession(requestSession);
          setMissionReadiness("unavailable");
        }
      } finally {
        if (requestID === generation) inFlight = false;
      }
    };
    void readMission();
    const interval = setInterval(() => { void readMission(); }, 6000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void readMission();
    });
    const unsubscribe = subscribeIdentitySession(() => {
      generation++;
      inFlight = false; // Old request may still settle; only the new session may render.
      setMission(null);
      setConfirmedMissionSession("");
      setMissionReadiness("loading");
      void readMission();
    });
    return () => {
      disposed = true; generation++; clearInterval(interval);
      subscription.remove(); unsubscribe();
      setMission(null);
      setConfirmedMissionSession("");
      setMissionReadiness("loading");
    };
  }, []));

  const currentSession = captainSessionKey(currentIdentityState());
  const missionReadiness = !currentSession ? "unavailable"
    : confirmedMissionSession === currentSession ? missionStatus : "loading";
  const mission = missionReadiness === "ready" ? missionSource : null;

  return <View style={{ flex: 1 }}>
    <CaptainOpportunities mission={missionReadiness === "ready" ? mission : null}
      missionReadiness={missionReadiness} availabilityRevision={availabilityRevision} />
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 8 }}>
      <CaptainReadiness overlay missionActive={missionReadiness === "ready" && Boolean(mission)}
        missionAssignmentId={missionReadiness === "ready" ? (mission?.assignment.id ?? "") : ""}
        onAvailabilityConfirmed={onAvailabilityConfirmed} />
    </View>
    <CaptainOffers popup suppressed={Boolean(mission) || missionReadiness !== "ready"} />
  </View>;
}
