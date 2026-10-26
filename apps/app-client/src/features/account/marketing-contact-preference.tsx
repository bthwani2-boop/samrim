import { Host, Switch } from "@expo/ui";
import { useMobileAppearance } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

// Promotional PUSH requires explicit opt-in. Delivery and order alerts are
// transactional and deliberately independent of this preference.
type Consent = Readonly<{ channel: string; decision: "OPTED_IN" | "OPTED_OUT"; version: number }>;
const base = (process.env.EXPO_PUBLIC_DSH_API_URL ?? "").trim().replace(/\/+$/, "");
const endpoint = base + "/dsh/client/marketing-consent/PUSH";

export function MarketingContactPreference({ active }: Readonly<{ active: boolean }>) {
  const { themeName, theme } = useMobileAppearance();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let mounted = true;
    setConsent(null);
    setNotice("");
    if (!active || !base) return () => { mounted = false; };
    void (async () => {
      try {
        const token = await getUsableIdentityAccessToken();
        const response = await fetch(endpoint, { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
        if (!response.ok) throw Error("CONSENT_FETCH_FAILED");
        const data = await response.json() as Consent;
        if (data.channel !== "PUSH" || !Number.isInteger(data.version)) throw Error("CONSENT_INVALID_RESPONSE");
        if (mounted) setConsent(data);
      } catch {
        if (mounted) setNotice("تعذّر قراءة تفضيلات العروض. حاول فتح الحساب مجددًا.");
      }
    })();
    return () => { mounted = false; };
  }, [active]);

  const update = async (next: boolean) => {
    if (pending || !consent || !active) return;
    setPending(true);
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "Idempotency-Key": Crypto.randomUUID(),
          "X-Expected-Version": String(consent.version),
        },
        body: JSON.stringify({ decision: next ? "OPTED_IN" : "OPTED_OUT" }),
      });
      if (!response.ok) throw Error("CONSENT_UPDATE_FAILED");
      const data = await response.json() as { decision: "OPTED_IN" | "OPTED_OUT"; version: number };
      if (!Number.isInteger(data.version) || data.version <= consent.version) throw Error("CONSENT_VERSION_INVALID");
      setConsent({ channel: "PUSH", decision: data.decision, version: data.version });
    } catch {
      setNotice("لم يُحفظ التغيير. ستظل آخر موافقة مؤكدة سارية.");
    } finally {
      setPending(false);
    }
  };

  if (!active) return null;
  return <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 12 }}>
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={{ color: theme.colorMuted, fontSize: 12 }}>اختياري؛ لا يؤثر على إشعارات طلباتك</Text>
      {notice ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{notice}</Text> : null}
    </View>
    {pending || (!consent && !notice) ? <ActivityIndicator color={theme.brandAction} /> : null}
    <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
      <Switch
        label="السماح بتنبيهات العروض"
        value={consent?.decision === "OPTED_IN"}
        disabled={!consent || pending}
        onValueChange={(next) => void update(next)}
        testID="client-marketing-push-consent-switch"
      />
    </Host>
  </View>;
}
