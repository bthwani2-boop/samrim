import { createDshMobileClient, OrderAlertCursor } from "@bthwani/dsh";
import { hasNativeNotificationModules, registerOwnPushDevice } from "@bthwani/push-device";
import { currentOrderAlertToneForIdentity as currentAlertTone } from "@bthwani/push-device/alert-tone";
import * as Crypto from "expo-crypto";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { captainSessionKey } from "../../bootstrap/captain-session-scope";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

const role = "captain" as const;
const alerts = new OrderAlertCursor();
let initialized = false;

function isCurrentAlertSession(sessionKey: string): boolean {
  return Boolean(sessionKey) && captainSessionKey(currentIdentityState()) === sessionKey;
}

const channels = [
  ["classic", "order-classic-v1", "order_classic.wav"],
  ["soft", "order-soft-v1", "order_soft.wav"],
  ["urgent", "order-urgent-v1", "order_urgent.wav"],
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
    // A local OS notification belongs only to the session that scheduled it.
    // Keep private Identity session identifiers out of the OS notification payload.
    const scheduledSessions = new Map<string, string>();
    const handleResponse = (result: import("expo-notifications").NotificationResponse) => {
      const data = result.notification.request.content.data;
      const orderId = data?.orderId;
      const session = currentIdentityState();
      if (session.kind !== "authenticated") return;
      if (session.identity.subject.trim() !== data?.actorId) {
        void Notifications?.clearLastNotificationResponseAsync().catch(() => undefined);
        return;
      }
      if (data?.source === "captain-foreground"
        && scheduledSessions.get(result.notification.request.identifier) !== captainSessionKey(session)) {
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
      const sessionKey = captainSessionKey(session);
      if (!sessionKey) { alerts.reset(""); return; }
      const stillCurrent = () => !cancelled && AppState.currentState === "active" && isCurrentAlertSession(sessionKey);
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
        if (!stillCurrent()) return;
        const token = await getUsableIdentityAccessToken();
        if (!stillCurrent()) return;
        // Registration is best effort. Foreground polling remains functional
        // without Firebase credentials before the first EAS development build.
        const chosenTone = await currentAlertTone(currentIdentityState);
        if (!stillCurrent()) return;
        const remotePushActive = await registerOwnPushDevice(token, actor, chosenTone, stillCurrent, url);
        if (!stillCurrent()) return;
        const data = await createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() }).listNotifications(token, 35);
        if (!stillCurrent()) return;
        // The alert cursor must re-prime for a renewed session of the same Captain.
        const newlyUrgent = alerts.receive(role, sessionKey, data.notifications);
        // When remote Push owns delivery, suppress the foreground polling bell.
        // Otherwise the same server event can audibly ring twice.
        if (!newlyUrgent.length || remotePushActive || !Notifications) return;
        const alertPermission = await Notifications.getPermissionsAsync();
        if (!stillCurrent() || !alertPermission.granted) return;
        // At most one audible notification per poll; no overlapping alarms.
        const item = newlyUrgent.at(-1);
        if (!item) return;
        const selected = await currentAlertTone(currentIdentityState);
        if (!stillCurrent()) return;
        const channel = channels.find(([tone]) => tone === selected) ?? channels[0];
        const notificationId = await Notifications.scheduleNotificationAsync({
          content: { title: item.title, body: item.body, sound: channel[2], data: { orderId: item.orderId, notificationId: item.id, actorId: actor, source: "captain-foreground" } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: channel[1] },
        });
        if (!stillCurrent()) {
          // Scheduling may complete after logout; cancel the pending local alert.
          await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
          return;
        }
        if (scheduledSessions.size >= 100) {
          const oldestId = scheduledSessions.keys().next().value;
          if (oldestId !== undefined) scheduledSessions.delete(oldestId);
        }
        scheduledSessions.set(notificationId, sessionKey);
      } catch (error) {
        console.warn("Order alert monitor unavailable", error);
      } finally {
        busy = false;
      }
    };
    // Older development builds may not include the native push module.
    // Keep the DSH inbox polling alive even when this import fails.
    if (hasNativeNotificationModules()) void import("expo-notifications").then(module => {
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
