import { createDshMobileClient, OrderAlertCursor } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";

import { useEffect } from "react";
import { type Href, useRouter } from "expo-router";
import { AppState, Platform } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { currentAlertTone } from "./order-alert-preferences";
import { registerOwnPushDevice } from "./push-device";

const role = "captain" as const;
const alerts = new OrderAlertCursor();
let initialized = false;

const channels = [
  ["classic", "order-classic-v1", "order-classic.wav"],
  ["soft", "order-soft-v1", "order-soft.wav"],
  ["urgent", "order-urgent-v1", "order-urgent.wav"],
] as const;

async function ensureChannel(Notifications: typeof import("expo-notifications") | null) {
  if (Platform.OS !== "android" || initialized || !Notifications) return;
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
    let Notifications: typeof import("expo-notifications") | null = null;
    let responseListener: { remove: () => void } | null = null;
    const openedResponses = new Set<string>();
    const handleResponse = (result: import("expo-notifications").NotificationResponse) => {
      const data = result.notification.request.content.data;
      const orderId = data?.orderId;
      const session = currentIdentityState();
      if (session.kind !== "authenticated") return;
      if (session.identity.subject.trim() !== data?.actorId) {
        void Notifications?.clearLastNotificationResponseAsync().catch(() => undefined);
        return;
      }
      if (typeof orderId !== "string" || !/^[A-Za-z0-9._~-]{1,160}$/.test(orderId)) return;
      const responseId = result.notification.request.identifier;
      if (openedResponses.has(responseId)) return;
      openedResponses.add(responseId);
      void Notifications?.clearLastNotificationResponseAsync().catch(() => undefined);
      router.push({ pathname: "/offers", params: { q: orderId } } as Href);
    };
    const tick = async () => {
      if (busy || cancelled || AppState.currentState !== "active") return;
      const session = currentIdentityState();
      const actor = session.kind === "authenticated" ? session.identity.subject.trim() : "";
      if (!actor) { alerts.reset(""); return; }
      if (Notifications) void Notifications.getLastNotificationResponseAsync()
        .then(last => { if (last && !cancelled) handleResponse(last); })
        .catch(() => undefined);
      const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if (!url) return;
      busy = true;
      try {
        if (Notifications) {
          await ensureChannel(Notifications);
          const permission = await Notifications.getPermissionsAsync();
          if (!permission.granted && !permissionRequested) {
            permissionRequested = true;
            await Notifications.requestPermissionsAsync();
          }
        }
        const token = await getUsableIdentityAccessToken();
        // Registration is best effort. Foreground polling remains functional
        // without Firebase credentials before the first EAS development build.
        const chosenTone = await currentAlertTone();
        const remotePushActive = await registerOwnPushDevice(token, actor, chosenTone, () => {
          const current = currentIdentityState();
          return !cancelled && current.kind === "authenticated" && current.identity.subject.trim() === actor;
        });
        const data = await createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() }).listNotifications(token, 35);
        if (cancelled || AppState.currentState !== "active") return;
        const current = currentIdentityState();
        if (current.kind !== "authenticated" || current.identity.subject.trim() !== actor) return;
        const newlyUrgent = alerts.receive(role, actor, data.notifications);
        // When remote Push owns delivery, suppress the foreground polling bell.
        // Otherwise the same server event can audibly ring twice.
        if (!newlyUrgent.length || remotePushActive || !Notifications) return;
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
    // Older development builds may not include the native push module.
    // Keep the DSH inbox polling alive even when this import fails.
    void import("expo-notifications").then(module => {
      if (cancelled) return;
      Notifications = module;
      module.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      responseListener = module.addNotificationResponseReceivedListener(handleResponse);
      void tick();
    }).catch(() => {
      // Push and OS alerts remain unavailable until a compatible native build.
    });
    void tick();
    const interval = setInterval(() => void tick(), 8_000);
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") void tick(); });
    return () => { cancelled = true; clearInterval(interval); listener.remove(); responseListener?.remove(); };
  }, [router]);
  return null;
}
