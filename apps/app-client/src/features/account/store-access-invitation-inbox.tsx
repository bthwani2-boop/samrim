import { BthwaniButton, BthwaniSectionHeader, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreAccessGrant } from "@bthwani/dsh";
import { createDshMobileClient } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { clientOrderSessionKey } from "../orders/order-session-scope";

export type StoreAccessInvitationInboxProps = Readonly<{
  baseURL: string;
  cryptoRandomUUID: () => string;
  getAccessToken: () => Promise<string>;
  showTitle?: boolean;
  hideWhenEmpty?: boolean;
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

function currentInvitationSessionKey(): string {
  return clientOrderSessionKey(currentIdentityState());
}

const permissionLabels: Readonly<Record<string, string>> = {
  orders: "الطلبات",
  catalog: "الكتالوج",
  store_operations: "إتاحة المتجر وساعاته",
  promotions: "العروض والتخفيضات",
  finance_read: "قراءة المالية",
  payout_request: "طلب صرف المستحقات",
  fulfillment: "التوصيل والاستلام",
};

export function StoreAccessInvitationInbox({ baseURL, cryptoRandomUUID, getAccessToken, showTitle = true, hideWhenEmpty = false }: StoreAccessInvitationInboxProps) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [sessionKey, setSessionKey] = useState(currentInvitationSessionKey);
  const sessionKeyRef = useRef(sessionKey);
  const requestID = useRef(0);
  const [loadedSessionKey, setLoadedSessionKey] = useState("");
  const [items, setItems] = useState<ReadonlyArray<StoreAccessGrant>>([]);
  const [loading, setLoading] = useState(true);
  const [busyGrantID, setBusyGrantID] = useState("");
  const busyGrantRef = useRef("");
  const [error, setError] = useState("");
  const attempts = useRef(new Map<string, Readonly<{ idempotencyKey: string; correlationID: string }>>());
  const isCurrentSession = () => Boolean(sessionKey) && currentInvitationSessionKey() === sessionKey;
  const currentItems = isCurrentSession() && loadedSessionKey === sessionKey ? items : [];

  useEffect(() => subscribeIdentitySession(() => {
    const next = currentInvitationSessionKey();
    if (next === sessionKeyRef.current) return;
    sessionKeyRef.current = next;
    requestID.current += 1;
    setSessionKey(next);
    setLoadedSessionKey("");
    setItems([]);
    setError("");
    busyGrantRef.current = "";
    setBusyGrantID("");
  }), []);

  const createClient = useCallback(() => {
    const normalizedBaseURL = baseURL.trim();
    if (!normalizedBaseURL) throw new Error("DSH_BASE_URL_REQUIRED");
    return createDshMobileClient(normalizedBaseURL, { cryptoRandomUUID });
  }, [baseURL, cryptoRandomUUID]);

  const reload = useCallback(async () => {
    const sequence = ++requestID.current;
    const isCurrent = () => sequence === requestID.current && Boolean(sessionKey) && currentInvitationSessionKey() === sessionKey;
    setLoading(true);
    setError("");
    if (!isCurrent()) { setLoading(false); return; }
    try {
      const token = await getAccessToken();
      if (!isCurrent()) return;
      const response = await createClient().listActorStoreAccessInvitations(token);
      if (!isCurrent()) return;
      setItems(response.items);
      setLoadedSessionKey(sessionKey);
    } catch {
      if (isCurrent()) {
        setItems([]);
        setLoadedSessionKey(sessionKey);
        setError("تعذر قراءة دعوات الوصول من المنصة.");
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [createClient, getAccessToken, sessionKey]);

  useEffect(() => {
    void reload();
    return () => { requestID.current += 1; };
  }, [reload]);

  async function decide(grant: StoreAccessGrant, decision: "accept" | "decline") {
    const isCurrent = () => isCurrentSession() && loadedSessionKey === sessionKey;
    if (busyGrantID || busyGrantRef.current || !isCurrent()) return;
    const identity = currentIdentityState();
    if (identity.kind !== "authenticated") return;
    busyGrantRef.current = grant.id;
    setBusyGrantID(grant.id);
    setError("");
    // Retain uncertain retries for the same actor across sessions, never across accounts.
    const attemptKey = `${identity.identity.subject.trim()}:${grant.id}:${grant.version}:${decision}`;
    const headers = attempts.current.get(attemptKey) ?? (() => {
      const id = cryptoRandomUUID();
      return { idempotencyKey: `store_access_decision_${id}`, correlationID: `store_access_decision_corr_${id}` };
    })();
    attempts.current.set(attemptKey, headers);
    try {
      const token = await getAccessToken();
      if (!isCurrent()) return;
      await createClient().decideActorStoreAccessInvitation(token, grant.id, { decision, expectedVersion: grant.version }, headers.idempotencyKey, headers.correlationID);
      if (!isCurrent()) return;
      attempts.current.delete(attemptKey);
      await reload();
    } catch {
      if (!isCurrent()) return;
      await reload();
      if (isCurrent()) setError("تعذر تأكيد القرار أو تغيرت الدعوة. أُعيدت قراءة الحالة المعتمدة.");
    } finally {
      if (isCurrent()) {
        busyGrantRef.current = "";
        setBusyGrantID("");
      }
    }
  }

  if (!isCurrentSession()) return null;
  if (hideWhenEmpty && (loading || loadedSessionKey !== sessionKey || (!error && currentItems.length === 0))) return null;

  return <View style={styles.container}>
    {showTitle ? <BthwaniSectionHeader title="دعوات الوصول للمتاجر" subtitle="اقبل الدعوة أولًا؛ تفعيل صلاحيات المتجر يحتاج جلسة شريك مستقلة." /> : <Text style={styles.muted}>اقبل الدعوة أولًا؛ تفعيل صلاحيات المتجر يحتاج جلسة شريك مستقلة.</Text>}
    <BthwaniSurface tone="raised" style={styles.panel}>
      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة دعوات الوصول" color={theme.interactiveText} /><Text style={styles.muted}>جارٍ قراءة الحالة المعتمدة…</Text></View> : null}
      {!loading && loadedSessionKey === sessionKey && currentItems.length === 0 && !error ? <Text style={styles.muted}>لا توجد دعوات وصول موجهة إلى حسابك.</Text> : null}
      {currentItems.map((grant) => <View key={grant.id} style={styles.invitation}>
        <Text style={styles.title}>{grant.storeName}</Text>
        <Text style={styles.muted}>الصلاحيات المطلوبة: {grant.permissions.map((permission) => permissionLabels[permission] ?? "صلاحية إضافية").join("، ")}</Text>
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
