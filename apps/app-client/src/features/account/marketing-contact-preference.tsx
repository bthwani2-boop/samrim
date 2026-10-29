import { Host, Switch } from "@expo/ui";
import { BthwaniButton, useMobileAppearance } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { isCurrentMarketingConsentActor, marketingConsentActorID } from "./marketing-consent-session";

// Promotional PUSH requires explicit opt-in. Delivery and order alerts are
// transactional and deliberately independent of this preference.
type Consent = Readonly<{ channel: string; decision: "OPTED_IN" | "OPTED_OUT"; version: number }>;
const base = (process.env.EXPO_PUBLIC_DSH_API_URL ?? "").trim().replace(/\/+$/, "");
const endpoint = `${base}/dsh/client/marketing-consent/PUSH`;

export function MarketingContactPreference({ active }: Readonly<{ active: boolean }>) {
  const { themeName, theme } = useMobileAppearance();
  const [actorID, setActorID] = useState(() => marketingConsentActorID(currentIdentityState()));
  const [consent, setConsent] = useState<Consent | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const loadRequestID = useRef(0);
  const currentConsent = isCurrentMarketingConsentActor(active, actorID, currentIdentityState()) ? consent : null;

  useEffect(() => {
    const unsubscribe = subscribeIdentitySession((session) => setActorID(marketingConsentActorID(session)));
    setActorID(marketingConsentActorID(currentIdentityState()));
    return unsubscribe;
  }, []);

  const load = useCallback(async () => {
    const requestID = ++loadRequestID.current;
    const isCurrent = () => requestID === loadRequestID.current
      && isCurrentMarketingConsentActor(active, actorID, currentIdentityState());
    setConsent(null);
    setNotice("");
    setPending(false);
    if (!active || !actorID) return;
    if (!base) {
      if (isCurrent()) setNotice("تعذر الاتصال بخدمة تفضيلات العروض.");
      return;
    }
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) return;
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw Error("CONSENT_FETCH_FAILED");
      const data = await response.json() as Consent;
      if (data.channel !== "PUSH" || !Number.isInteger(data.version)) throw Error("CONSENT_INVALID_RESPONSE");
      if (isCurrent()) setConsent(data);
    } catch {
      if (isCurrent()) setNotice("تعذر قراءة تفضيل إشعارات العروض.");
    }
  }, [active, actorID]);

  useEffect(() => {
    void load();
    return () => { loadRequestID.current += 1; };
  }, [load]);

  const update = async (next: boolean) => {
    const isCurrent = () => isCurrentMarketingConsentActor(active, actorID, currentIdentityState());
    if (pending || !consent || !isCurrent()) return;
    setPending(true);
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) return;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": Crypto.randomUUID(),
          "X-Expected-Version": String(consent.version),
        },
        body: JSON.stringify({ decision: next ? "OPTED_IN" : "OPTED_OUT" }),
      });
      if (!response.ok) throw Error("CONSENT_UPDATE_FAILED");
      const data = await response.json() as { decision: "OPTED_IN" | "OPTED_OUT"; version: number };
      if (data.decision !== (next ? "OPTED_IN" : "OPTED_OUT") || !Number.isInteger(data.version) || data.version <= consent.version) throw Error("CONSENT_READBACK_INVALID");
      if (isCurrent()) setConsent({ channel: "PUSH", decision: data.decision, version: data.version });
    } catch {
      if (isCurrent()) {
        setConsent(null);
        setNotice("تعذر حفظ التغيير؛ جارٍ تحديث الحالة.");
        await load();
      }
    } finally {
      if (isCurrent()) setPending(false);
    }
  };

  if (!active) return null;
  return <View style={{ gap: 8, paddingVertical: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: theme.colorMuted, fontSize: 12 }}>اختياري؛ لا يؤثر على إشعارات طلباتك</Text>
        {notice ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{notice}</Text> : null}
      </View>
      {pending || (!currentConsent && !notice) ? <ActivityIndicator color={theme.brandAction} /> : null}
      <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
        <Switch
          label="السماح بتنبيهات العروض"
          value={currentConsent?.decision === "OPTED_IN"}
          disabled={!currentConsent || pending}
          onValueChange={(next) => void update(next)}
          testID="client-marketing-push-consent-switch"
        />
      </Host>
    </View>
    {notice && !currentConsent ? <BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="quiet" /> : null}
  </View>;
}