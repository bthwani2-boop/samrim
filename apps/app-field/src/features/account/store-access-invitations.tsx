import { BthwaniNavigationRow } from "@bthwani/design-system/native";
import { createDshMobileClient, type StoreAccessGrant } from "@bthwani/dsh";
import { StoreAccessInvitationInbox as DshStoreAccessInvitationInbox } from "@bthwani/dsh/mobile/store-access-invitations";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

export function StoreAccessInvitationSummary({ compact = false, onPress }: Readonly<{ compact?: boolean; onPress: () => void }>) {
  const [items, setItems] = useState<ReadonlyArray<StoreAccessGrant> | null>(null);
  const [failed, setFailed] = useState(false);
  const requestID = useRef(0);
  useFocusEffect(useCallback(() => {
    const currentRequest = ++requestID.current;
    setFailed(false);
    let current = true;
    async function load() {
      try {
        const baseURL = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
        if (!baseURL) throw new Error("DSH_BASE_URL_REQUIRED");
        const token = await getUsableIdentityAccessToken();
        const response = await createDshMobileClient(baseURL, { cryptoRandomUUID: Crypto.randomUUID }).listActorStoreAccessInvitations(token);
        if (current && currentRequest === requestID.current) setItems(response.items);
      } catch {
        if (current && currentRequest === requestID.current) setFailed(true);
      }
    }
    void load();
    return () => { current = false; requestID.current += 1; };
  }, []));
  const pending = items?.filter((item) => item.state === "pending_acceptance").length ?? 0;
  const description = failed ? "تعذر قراءة الحالة؛ افتح الدعوات لإعادة المحاولة." : items === null ? "جارٍ قراءة الدعوات…" : pending ? `${pending.toLocaleString("ar-YE")} بانتظار قرارك من ${items.length.toLocaleString("ar-YE")}` : `${items.length.toLocaleString("ar-YE")} دعوة وصول · لا توجد قرارات معلّقة`;
  return <BthwaniNavigationRow compact={compact} description={description} icon="store" title="دعوات الوصول للمتاجر" onPress={onPress} />;
}

export function StoreAccessInvitationInbox({ showTitle = true }: Readonly<{ showTitle?: boolean }> = {}) {
  return <DshStoreAccessInvitationInbox baseURL={process.env.EXPO_PUBLIC_DSH_API_URL?.trim() ?? ""} cryptoRandomUUID={Crypto.randomUUID} getAccessToken={getUsableIdentityAccessToken} showTitle={showTitle} />;
}
