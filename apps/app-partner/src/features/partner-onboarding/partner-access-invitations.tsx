import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreAccessGrant } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { grantStateLabel, permissionNames } from "./partner-store-access";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { type InvitationAction, invitationActionConfirmed, invitationActionIdentity } from "./store-access-invitation-recovery";
import { activateOwnStoreAccessInvitation, decideOwnStoreAccessInvitation, listOwnStoreAccessInvitations } from "./store-readback-client";

async function attemptHeaders(grant: StoreAccessGrant, action: InvitationAction) {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, invitationActionIdentity(grant.id, grant.version, action));
  return { idempotencyKey: `store_access_${digest}`, correlationID: `store_access_corr_${digest}` };
}

/**
 * Identity-directed access invitations: grants aimed at this actor's own
 * identity, not at any store authority. It stays reachable from the Account
 * surface for every actor — including delegated staff whose workspace
 * surfaces are permission-derived — so accepting, declining, or activating a
 * delegation never depends on a surface the actor may not be authorized to
 * see. Activation also reloads the accessible-store scope so adaptive
 * navigation reflects the newly granted stores immediately.
 */
export function PartnerAccessInvitationsCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { reload: reloadScope } = usePartnerStoreScope();
  const [invitations, setInvitations] = useState<ReadonlyArray<StoreAccessGrant>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async (): Promise<ReadonlyArray<StoreAccessGrant> | null> => {
    setLoading(true);
    setError("");
    try {
      const page = await listOwnStoreAccessInvitations();
      setInvitations(page.items);
      return page.items;
    } catch {
      setError("تعذرت قراءة دعوات الوصول الموجهة إلى حسابك.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function submitInvitationAction(grant: StoreAccessGrant, action: InvitationAction) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const headers = await attemptHeaders(grant, action);
      try {
        if (action === "activate") {
          await activateOwnStoreAccessInvitation(grant.id, grant.version, headers.idempotencyKey, headers.correlationID);
        } else {
          await decideOwnStoreAccessInvitation(grant.id, { decision: action, expectedVersion: grant.version }, headers.idempotencyKey, headers.correlationID);
        }
      } catch (cause) {
        // The transport may fail after DSH committed the transition.
        // An owner readback, not another fresh mutation, decides the outcome.
        console.warn("DSH delegate invitation response uncertain", cause);
      }
      const latest = await reload();
      const canonical = latest?.find((item) => item.id === grant.id);
      if (!invitationActionConfirmed(grant, canonical, action)) {
        setError(latest === null
          ? "تعذر التحقق من نتيجة الدعوة. أعد قراءة حالتها قبل المحاولة مجددًا."
          : "لم يتأكد الإجراء من الحالة المعتمدة. راجع حالة الدعوة قبل المحاولة مجددًا.");
        return;
      }
      setNotice(action === "decline" ? "تأكد رفض الدعوة من المنصة."
        : action === "activate" || canonical?.state === "active" ? "تأكد تفعيل وصولك للمتجر."
        : "تأكد قبول دعوتك؛ يتبقى اعتماد الدور أو تفعيل الوصول وفق الحالة المعروضة.");
      if (action === "activate" || (action === "accept" && canonical?.state === "active")) {
        try {
          await reloadScope();
        } catch (cause) {
          console.warn("DSH delegated store scopes refresh failed after confirmed invitation", cause);
          setError("تأكد وصولك، لكن تعذر تحديث قائمة المتاجر. افتح المتاجر لإعادة قراءة صلاحياتك.");
        }
      }
    } catch (cause) {
      console.warn("DSH delegate invitation verification failed", cause);
      setError("تعذر تأكيد نتيجة الدعوة. أعد قراءة حالتها قبل اتخاذ إجراء جديد.");
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.card}>
    <Text style={styles.value}>دعوات الوصول الموجهة إليك</Text>
    {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة دعوات الوصول" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الحالة المعتمدة…</Text></View> : null}
    {!loading && invitations.length === 0 ? <Text style={styles.muted}>لا توجد دعوات وصول موجهة إلى حسابك.</Text> : null}
    {invitations.map((grant) => <View key={grant.id} style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 }}>
      <Text style={styles.value}>{grant.storeName}</Text>
      <Text style={styles.muted}>الصلاحيات: {permissionNames(grant.permissions)} · {grantStateLabel(grant.state)}</Text>
      {grant.state === "pending_role_admission" ? <Text style={styles.muted}>ينتظر اعتماد مشغّل المنصة لدور الشريك.</Text> : null}
      {grant.state === "pending_acceptance" ? <View style={{ flexDirection: "row", gap: 8 }}><View style={{ flex: 1 }}><BthwaniButton busy={busy} disabled={busy || loading || Boolean(error)} label="قبول الدعوة" onPress={() => void submitInvitationAction(grant, "accept")} /></View><View style={{ flex: 1 }}><BthwaniButton disabled={busy || loading || Boolean(error)} label="رفض الدعوة" onPress={() => void submitInvitationAction(grant, "decline")} variant="secondary" /></View></View> : null}
      {grant.state === "pending_partner_activation" ? <View style={{ gap: 8 }}><Text style={styles.muted}>قُبلت الدعوة واعتمد دور الشريك. سجّل الدخول بدور الشريك لإكمال تفعيل صلاحيات هذا المتجر.</Text><BthwaniButton busy={busy} disabled={busy || loading || Boolean(error)} label="تفعيل الوصول لهذا المتجر" onPress={() => void submitInvitationAction(grant, "activate")} /></View> : null}
    </View>)}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
    <BthwaniButton disabled={busy || loading} label="إعادة القراءة" onPress={() => void reload()} variant="secondary" />
  </View>;
}
