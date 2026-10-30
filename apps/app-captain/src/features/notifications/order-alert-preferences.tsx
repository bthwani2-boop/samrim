import { BthwaniOrderAlertPreferences } from "@bthwani/push-device/order-alert-preferences";
import { currentOrderAlertTone, readAlertToneForActor, saveAlertToneForActor, type AlertTone } from "@bthwani/push-device/alert-tone";
import { useSyncExternalStore } from "react";
import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";

export type { AlertTone };
function currentActorID(): string {
  const state = currentIdentityState();
  return state.kind === "authenticated" ? state.identity.subject.trim() : "";
}
function isCurrentActor(actorID: string): boolean {
  return Boolean(actorID) && currentActorID() === actorID;
}
export function currentAlertTone(): Promise<AlertTone> {
  return currentOrderAlertTone(currentActorID);
}
export function OrderAlertPreferences() {
  const actorID = useSyncExternalStore(subscribeIdentitySession, currentActorID, () => "");
  return <BthwaniOrderAlertPreferences actorID={actorID} readTone={readAlertToneForActor}
    saveTone={saveAlertToneForActor} isCurrentActor={isCurrentActor} />;
}
