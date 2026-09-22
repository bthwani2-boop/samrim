import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { recordPublicDiscoveryContentEvent } from "./store-discovery-client";

const SESSION_KEY = "bthwani.discovery.analytics.session.v1";
const LAST_CLICK_KEY = "bthwani.discovery.analytics.last-click.v1";
let volatileSessionID = "";

function analyticsID(): string {
  if (typeof Crypto.randomUUID === "function") return Crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function clientSessionID(): Promise<string> {
  try {
    const saved = (await SecureStore.getItemAsync(SESSION_KEY))?.trim();
    if (saved) return saved;
  } catch {
    // Analytics must not depend on device keychain availability.
  }
  if (volatileSessionID) return volatileSessionID;
  const created = analyticsID();
  volatileSessionID = created;
  try {
    await SecureStore.setItemAsync(SESSION_KEY, created);
  } catch {
    // Keep the in-memory session for the current app run.
  }
  return created;
}

export async function recordDiscoveryImpression(contentID: string): Promise<void> {
  if (!contentID.trim()) return;
  try {
    await recordPublicDiscoveryContentEvent({ clientEventId: analyticsID(), contentId: contentID, eventType: "IMPRESSION", clientSessionId: await clientSessionID() });
  } catch (error) {
    console.warn("Discovery impression was not recorded", error);
  }
}

export async function recordDiscoveryClick(contentID: string): Promise<void> {
  if (!contentID.trim()) return;
  try {
    try {
      await SecureStore.setItemAsync(LAST_CLICK_KEY, JSON.stringify({ contentId: contentID, clickedAt: Date.now() }));
    } catch {
      // A click remains measurable even when durable attribution storage is unavailable.
    }
    await recordPublicDiscoveryContentEvent({ clientEventId: analyticsID(), contentId: contentID, eventType: "CLICK", clientSessionId: await clientSessionID() });
  } catch (error) {
    console.warn("Discovery click was not recorded", error);
  }
}

export async function recordPendingDiscoveryConversion(orderID: string): Promise<void> {
  if (!orderID.trim()) return;
  try {
    const raw = await SecureStore.getItemAsync(LAST_CLICK_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw) as { contentId?: unknown; clickedAt?: unknown };
    if (typeof pending.contentId !== "string" || typeof pending.clickedAt !== "number" || Date.now() - pending.clickedAt > 24 * 60 * 60 * 1000) return;
    await recordPublicDiscoveryContentEvent({ clientEventId: analyticsID(), contentId: pending.contentId, eventType: "CONVERSION", clientSessionId: await clientSessionID(), orderId: orderID });
    await SecureStore.deleteItemAsync(LAST_CLICK_KEY);
  } catch (error) {
    console.warn("Discovery conversion was not recorded", error);
  }
}
