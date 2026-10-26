import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type AlertTone = "classic" | "soft" | "urgent";
const tones: readonly AlertTone[] = ["classic", "soft", "urgent"];

async function keyForActor(actorID: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, actorID);
  return "order-alert-tone-" + digest;
}
export async function readAlertToneForActor(actorID: string): Promise<AlertTone> {
  if (!actorID.trim() || Platform.OS === "web") return "classic";
  try {
    const value = await SecureStore.getItemAsync(await keyForActor(actorID));
    return tones.includes(value as AlertTone) ? value as AlertTone : "classic";
  } catch { return "classic"; }
}
export async function currentOrderAlertTone(actorIDNow: () => string): Promise<AlertTone> {
  const selectedActor = actorIDNow();
  if (!selectedActor) return "classic";
  const chosen = await readAlertToneForActor(selectedActor);
  return actorIDNow() === selectedActor ? chosen : "classic";
}
export async function saveAlertToneForActor(
  selectedActor: string, tone: AlertTone, isCurrentActor: (actorID: string) => boolean,
): Promise<boolean> {
  if (!selectedActor || Platform.OS === "web" || !tones.includes(tone) || !isCurrentActor(selectedActor)) return false;
  try {
    const key = await keyForActor(selectedActor);
    if (!isCurrentActor(selectedActor)) return false;
    await SecureStore.setItemAsync(key, tone);
    return isCurrentActor(selectedActor);
  } catch { return false; }
}
