import type { CaptainAssignment, CaptainDeliveryTask } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AppState, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../src/bootstrap/identity";
import { CaptainReadiness } from "../../src/features/captain-operations/captain-readiness";
import { captainClient } from "../../src/features/captain-operations/captain-client";
import { CaptainOffers } from "../../src/features/captain-operations/captain-offers";
import { CaptainOpportunities } from "../../src/features/captain-operations/captain-opportunities";
import { isCurrentCaptainActor } from "../../src/features/captain-operations/captain-session-scope";

export type ActiveCaptainMission = Readonly<{
  assignment: CaptainAssignment;
  task: CaptainDeliveryTask;
}>;

// The home is the only visual map. The owner-backed assignment determines
// whether it shows opportunity circles or the current delivery destination.
// Never infer pickup/delivery transitions from local taps or unverified offers.
export default function CaptainHomeRoute() {
  const [mission, setMission] = useState<ActiveCaptainMission | null>(null);
  const [missionReadiness, setMissionReadiness] = useState<"loading" | "ready" | "unavailable">("loading");
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
      const before = currentIdentityState();
      const actor = before.kind === "authenticated" ? before.identity.subject.trim() : "";
      if (!actor) {
        if (!disposed) { setMission(null); setMissionReadiness("unavailable"); }
        inFlight = false;
        return;
      }
      try {
        const token = await getUsableIdentityAccessToken();
        const api = captainClient();
        const result = await api.listOwnCaptainAssignments(token);
        const active = result.assignments.find((a) => a.state === "in_custody"
          || a.state === "assigned" || a.state === "delivery_failed");
        const taskResult = active ? await api.readOwnCaptainDeliveryTask(token, active.id) : null;
        const after = currentIdentityState();
        if (disposed || requestID !== generation || after.kind !== "authenticated"
          || !isCurrentCaptainActor(actor, after.identity.subject.trim())) return;
        if (active && !taskResult) throw new Error("ACTIVE_TASK_NOT_READABLE");
        const next = active && taskResult ? { assignment: active, task: taskResult.task } : null;
        // Preserve the map instance and camera between unchanged six-second
        // reads; only an actual assignment/route transition should re-center.
        setMission((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        setMissionReadiness("ready");
      } catch {
        // Do not ever fall back to the opportunity map if a previously
        // confirmed mission might still be active. Keep the last safe state.
        if (!disposed) setMissionReadiness("unavailable");
      } finally { inFlight = false; }
    };
    void readMission();
    const interval = setInterval(() => { void readMission(); }, 6000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void readMission();
    });
    const unsubscribe = subscribeIdentitySession(() => {
      generation++;
      setMission(null);
      setMissionReadiness("loading");
      void readMission();
    });
    return () => {
      disposed = true; generation++; clearInterval(interval);
      subscription.remove(); unsubscribe();
      setMission(null);
      setMissionReadiness("loading");
    };
  }, []));

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
