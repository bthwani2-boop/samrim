import * as Crypto from "expo-crypto";
import * as SecureStore from "../../bootstrap/compatible-storage";
import { recordPublicDiscoveryContentEvent } from "./store-discovery-client";

const SESSION_KEY = "bthwani.discovery.analytics.session.v1";
const LAST_CLICK_KEY = "bthwani.discovery.analytics.last-click.v1";
let volatileSessionID = "";

function analyticsID(): string {
  return Crypto.randomUUID();
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
    const sessionID = await clientSessionID();
    const clickEventID = analyticsID();
    await recordPublicDiscoveryContentEvent({ clientEventId: clickEventID, contentId: contentID, eventType: "CLICK", clientSessionId: sessionID });
    // Conversion attribution requires a click already acknowledged by DSH.
    // Never save an unrecorded click as the last-click source of truth.
    try {
      await SecureStore.setItemAsync(LAST_CLICK_KEY, JSON.stringify({ contentId: contentID, clickEventId: clickEventID, clickedAt: Date.now() }));
    } catch {
      // The click was recorded, but this device cannot persist attribution.
    }
  } catch (error) {
    console.warn("Discovery click was not recorded", error);
  }
}

// Only the previously acknowledged DSH click ID may accompany checkout.
export async function acknowledgedDiscoveryClickForCheckout(): Promise<string | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(LAST_CLICK_KEY);
    if (!raw) return undefined;
    const pending = JSON.parse(raw) as { clickEventId?: unknown; clickedAt?: unknown };
    if (typeof pending.clickEventId !== "string" || pending.clickEventId.length > 128 ||
      typeof pending.clickedAt !== "number" || pending.clickedAt > Date.now() ||
      Date.now() - pending.clickedAt > 24 * 60 * 60 * 1000) return undefined;
    return pending.clickEventId;
  } catch {
    return undefined;
  }
}
