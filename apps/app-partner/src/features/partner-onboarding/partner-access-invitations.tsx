import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreAccessGrant } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { grantStateLabel, permissionNames } from "./partner-store-access";
import { activateOwnStoreAccessInvitation, decideOwnStoreAccessInvitation, listOwnStoreAccessInvitations } from "./store-readback-client";

function attemptHeaders(prefix: string) {
  return { idempotencyKey: `${prefix}_${Crypto.randomUUID()}`, correlationID: `${prefix}_corr_${Crypto.randomUUID()}` };
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

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const page = await listOwnStoreAccessInvitations();
      setInvitations(page.items);
    } catch {
      setError("تعذرت قراءة دعوات الوصول الموجهة إلى حسابك.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function decide(grant: StoreAccessGrant, decision: "accept" | "decline") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const headers = attemptHeaders("store_access_decision");
      await decideOwnStoreAccessInvitation(grant.id, { decision, expectedVersion: grant.version }, headers.idempotencyKey, headers.correlationID);
      await reload();
    } catch {
      await reload();
      setError("تغيرت الدعوة أو انتهت صلاحيتها. أُعيدت قراءة الحالة المعتمدة.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(grant: StoreAccessGrant) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const headers = attemptHeaders("store_access_activation");
      await activateOwnStoreAccessInvitation(grant.id, grant.version, headers.idempotencyKey, headers.correlationID);
      await reload();
      await reloadScope();
    } catch {
      await reload();
      setError("تعذر تفعيل الوصول. يلزم تسجيل الدخول بدور الشريك ثم إعادة قراءة الحالة المعتمدة.");
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
      {grant.state === "pending_acceptance" ? <View style={{ flexDirection: "row", gap: 8 }}><View style={{ flex: 1 }}><BthwaniButton busy={busy} disabled={busy} label="قبول الدعوة" onPress={() => void decide(grant, "accept")} /></View><View style={{ flex: 1 }}><BthwaniButton disabled={busy} label="رفض الدعوة" onPress={() => void decide(grant, "decline")} variant="secondary" /></View></View> : null}
      {grant.state === "pending_partner_activation" ? <View style={{ gap: 8 }}><Text style={styles.muted}>قُبلت الدعوة واعتمد دور الشريك. سجّل الدخول بدور الشريك لإكمال تفعيل صلاحيات هذا المتجر.</Text><BthwaniButton busy={busy} disabled={busy} label="تفعيل الوصول لهذا المتجر" onPress={() => void activate(grant)} /></View> : null}
    </View>)}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <BthwaniButton disabled={busy || loading} label="إعادة القراءة" onPress={() => void reload()} variant="secondary" />
  </View>;
}
