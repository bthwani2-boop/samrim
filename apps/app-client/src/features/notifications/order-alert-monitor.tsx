import { createDshMobileClient, OrderAlertCursor } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { type Href, useRouter } from "expo-router";
import { AppState, Platform } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { currentAlertTone } from "./order-alert-preferences";
import { registerOwnPushDevice } from "./push-device";

const role = "client" as const;
const alerts = new OrderAlertCursor();
let initialized = false;

const channels = [
  ["classic", "order-classic-v1", "order-classic.wav"],
  ["soft", "order-soft-v1", "order-soft.wav"],
  ["urgent", "order-urgent-v1", "order-urgent.wav"],
] as const;

async function ensureChannel() {
  if (Platform.OS !== "android" || initialized) return;
  for (const [tone, channelId, sound] of channels) {
    await Notifications.setNotificationChannelAsync(channelId, {
      name: `تنبيهات الطلبات - ${tone}`,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 120, 300],
      enableVibrate: true,
      sound,
    });
  }
  initialized = true;
}

// A foreground fallback over the canonical DSH inbox. Server push delivery
// must be enabled separately for background/locked-device alerts.
export function OrderAlertMonitor() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    let busy = false;
    let permissionRequested = false;
    const tick = async () => {
      if (busy || cancelled || AppState.currentState !== "active") return;
      const session = currentIdentityState();
      const actor = session.kind === "authenticated" ? session.identity.subject.trim() : "";
      if (!actor) { alerts.reset(""); return; }
      const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if (!url) return;
      busy = true;
      try {
        await ensureChannel();
        const permission = await Notifications.getPermissionsAsync();
        if (!permission.granted && !permissionRequested) {
          permissionRequested = true;
          await Notifications.requestPermissionsAsync();
        }
        const token = await getUsableIdentityAccessToken();
        // Registration is best effort. Foreground polling remains functional
        // without Firebase credentials before the first EAS development build.
        const chosenTone = await currentAlertTone();
        const remotePushActive = await registerOwnPushDevice(token, actor, chosenTone);
        const data = await createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() }).listNotifications(token, 35);
        if (cancelled || AppState.currentState !== "active") return;
        const current = currentIdentityState();
        if (current.kind !== "authenticated" || current.identity.subject.trim() !== actor) return;
        const newlyUrgent = alerts.receive(role, actor, data.notifications);
        // When remote Push owns delivery, suppress the foreground polling bell.
        // Otherwise the same server event can audibly ring twice.
        if (!newlyUrgent.length || remotePushActive) return;
        const alertPermission = await Notifications.getPermissionsAsync();
        if (!alertPermission.granted) return;
        // At most one audible notification per poll; no overlapping alarms.
        const item = newlyUrgent.at(-1)!;
        const selected = await currentAlertTone();
        const channel = channels.find(([tone]) => tone === selected) ?? channels[0];
        const latestSession = currentIdentityState();
        if (cancelled || latestSession.kind !== "authenticated" || latestSession.identity.subject.trim() !== actor) return;
        await Notifications.scheduleNotificationAsync({
          content: { title: item.title, body: item.body, sound: channel[2], data: { orderId: item.orderId, notificationId: item.id, actorId: actor } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: channel[1] },
        });
      } catch (error) {
        console.warn("Order alert monitor unavailable", error);
      } finally {
        busy = false;
      }
    };
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    void tick();
    const interval = setInterval(() => void tick(), 8_000);
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") void tick(); });
    const response = Notifications.addNotificationResponseReceivedListener(result => {
      const data = result.notification.request.content.data;
      const orderId = data?.orderId;
      const session = currentIdentityState();
      if (typeof orderId !== "string" || !/^[A-Za-z0-9._~-]{1,160}$/.test(orderId)) return;
      if (session.kind !== "authenticated" || session.identity.subject.trim() !== data?.actorId) return;
      router.push(`/orders/${encodeURIComponent(orderId)}` as Href);
    });
    return () => { cancelled = true; clearInterval(interval); listener.remove(); response.remove(); };
  }, [router]);
  return null;
}
