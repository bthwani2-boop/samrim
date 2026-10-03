import { BthwaniButton, BthwaniSectionHeader, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient } from "./mobile";
import type { StoreAccessGrant } from "./generated/dsh-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

export type StoreAccessInvitationInboxProps = Readonly<{
  baseURL: string;
  cryptoRandomUUID: () => string;
  getAccessToken: () => Promise<string>;
}>;

function grantStateLabel(state: StoreAccessGrant["state"]): string {
  switch (state) {
    case "pending_acceptance": return "بانتظار قرارك";
    case "pending_role_admission": return "قُبلت الدعوة؛ بانتظار اعتماد دور الشريك";
    case "pending_partner_activation": return "قُبلت الدعوة؛ يلزم تفعيل الوصول بدور الشريك";
    case "active": return "وصول نشط";
    case "suspended": return "وصول موقوف مؤقتًا";
    case "revoked": return "وصول ملغى";
    case "declined": return "دعوة مرفوضة";
    case "expired": return "انتهت الدعوة";
  }
}

const permissionLabels: Readonly<Record<string, string>> = {
  orders: "الطلبات",
  catalog: "الكتالوج والعروض",
  store_operations: "إتاحة المتجر وساعاته",
};

export function StoreAccessInvitationInbox({ baseURL, cryptoRandomUUID, getAccessToken }: StoreAccessInvitationInboxProps) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [items, setItems] = useState<ReadonlyArray<StoreAccessGrant>>([]);
  const [loading, setLoading] = useState(true);
  const [busyGrantID, setBusyGrantID] = useState("");
  const [error, setError] = useState("");
  const attempts = useRef(new Map<string, Readonly<{ idempotencyKey: string; correlationID: string }>>());

  const createClient = useCallback(() => {
    const normalizedBaseURL = baseURL.trim();
    if (!normalizedBaseURL) throw new Error("DSH_BASE_URL_REQUIRED");
    return createDshMobileClient(normalizedBaseURL, { cryptoRandomUUID });
  }, [baseURL, cryptoRandomUUID]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getAccessToken();
      const response = await createClient().listActorStoreAccessInvitations(token);
      setItems(response.items);
    } catch {
      setItems([]);
      setError("تعذر قراءة دعوات الوصول من المنصة.");
    } finally {
      setLoading(false);
    }
  }, [createClient, getAccessToken]);

  useEffect(() => { void reload(); }, [reload]);

  async function decide(grant: StoreAccessGrant, decision: "accept" | "decline") {
    if (busyGrantID) return;
    setBusyGrantID(grant.id);
    setError("");
    const attemptKey = `${grant.id}:${grant.version}:${decision}`;
    const headers = attempts.current.get(attemptKey) ?? (() => {
      const id = cryptoRandomUUID();
      return { idempotencyKey: `store_access_decision_${id}`, correlationID: `store_access_decision_corr_${id}` };
    })();
    attempts.current.set(attemptKey, headers);
    try {
      const token = await getAccessToken();
      await createClient().decideActorStoreAccessInvitation(token, grant.id, { decision, expectedVersion: grant.version }, headers.idempotencyKey, headers.correlationID);
      attempts.current.delete(attemptKey);
      await reload();
    } catch {
      await reload();
      setError("تعذر تأكيد القرار أو تغيرت الدعوة. أُعيدت قراءة الحالة المعتمدة.");
    } finally {
      setBusyGrantID("");
    }
  }

  return <View style={styles.container}>
    <BthwaniSectionHeader title="دعوات الوصول للمتاجر" subtitle="اقبل الدعوة أولًا؛ تفعيل صلاحيات المتجر يحتاج جلسة شريك مستقلة." />
    <BthwaniSurface tone="raised" style={styles.panel}>
      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة دعوات الوصول" color={theme.interactiveText} /><Text style={styles.muted}>جارٍ قراءة الحالة المعتمدة…</Text></View> : null}
      {!loading && items.length === 0 && !error ? <Text style={styles.muted}>لا توجد دعوات وصول موجهة إلى حسابك.</Text> : null}
      {items.map((grant) => <View key={grant.id} style={styles.invitation}>
        <Text style={styles.title}>{grant.storeName}</Text>
        <Text style={styles.muted}>الصلاحيات المطلوبة: {grant.permissions.map((permission) => permissionLabels[permission] ?? permission).join("، ")}</Text>
        <Text style={styles.status}>{grantStateLabel(grant.state)}</Text>
        {grant.state === "pending_acceptance" ? <View style={styles.actions}>
          <View style={styles.action}><BthwaniButton busy={busyGrantID === grant.id} disabled={Boolean(busyGrantID)} label="قبول الدعوة" onPress={() => void decide(grant, "accept")} /></View>
          <View style={styles.action}><BthwaniButton disabled={Boolean(busyGrantID)} label="رفض الدعوة" onPress={() => void decide(grant, "decline")} variant="secondary" /></View>
        </View> : null}
        {grant.state === "pending_role_admission" ? <Text style={styles.muted}>تم تسجيل قبولك. ينتظر دور الشريك اعتماد مشغّل المنصة قبل أن تتمكن من تفعيل الوصول.</Text> : null}
        {grant.state === "pending_partner_activation" ? <Text style={styles.muted}>تم اعتماد دور الشريك. افتح تطبيق الشريك وسجّل الدخول به لإكمال تفعيل وصول هذا المتجر.</Text> : null}
      </View>)}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton disabled={loading || Boolean(busyGrantID)} label="إعادة القراءة" onPress={() => void reload()} variant="secondary" />
    </BthwaniSurface>
  </View>;
}

function createStyles(theme: ReturnType<typeof useAppearanceTheme>) {
  return StyleSheet.create({
    container: { gap: 12 },
    panel: { borderRadius: 16, gap: 12, padding: 16 },
    state: { alignItems: "center", flexDirection: "row", gap: 8 },
    invitation: { borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 },
    title: { color: theme.color, fontSize: 16, fontWeight: "700", textAlign: "right" },
    muted: { color: theme.colorMuted, textAlign: "right" },
    status: { color: theme.interactiveText, fontWeight: "600", textAlign: "right" },
    actions: { flexDirection: "row", gap: 8 },
    action: { flex: 1 },
    error: { color: theme.warning, textAlign: "right" },
  });
}
