import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreAccessGrant, StoreAccessPermission } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { activateOwnStoreAccessInvitation, createOwnStoreAccessInvitation, decideOwnStoreAccessInvitation, listOwnStoreAccessGrants, listOwnStoreAccessInvitations, transitionOwnStoreAccessGrant, updateOwnStoreAccessPermissions } from "./store-readback-client";

const permissions: ReadonlyArray<{ value: StoreAccessPermission; label: string }> = [
  { value: "orders", label: "الطلبات" },
  { value: "catalog", label: "الكتالوج والعروض" },
  { value: "store_operations", label: "ساعات وإتاحة المتجر" },
];

function grantStateLabel(state: StoreAccessGrant["state"]): string {
  switch (state) {
    case "pending_role_admission": return "قبلت الدعوة؛ بانتظار اعتماد المشغّل";
    case "pending_acceptance": return "بانتظار قبول المدعو";
    case "pending_partner_activation": return "بانتظار تفعيل الوصول من حساب الشريك";
    case "active": return "نشط";
    case "suspended": return "موقوف";
    case "revoked": return "ملغى";
    case "declined": return "مرفوض";
    case "expired": return "منتهٍ";
  }
}

function permissionNames(values: ReadonlyArray<string>): string {
  return values.map((value) => permissions.find((item) => item.value === value)?.label ?? value).join("، ");
}

function attemptHeaders(prefix: string) {
  return { idempotencyKey: `${prefix}_${Crypto.randomUUID()}`, correlationID: `${prefix}_corr_${Crypto.randomUUID()}` };
}

export function PartnerStoreAccess({ storeID }: { storeID?: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [invitations, setInvitations] = useState<ReadonlyArray<StoreAccessGrant>>([]);
  const [grants, setGrants] = useState<ReadonlyArray<StoreAccessGrant>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actorID, setActorID] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<ReadonlyArray<StoreAccessPermission>>(["orders"]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    const [invitationsResult, grantsResult] = await Promise.allSettled([
      listOwnStoreAccessInvitations(),
      storeID ? listOwnStoreAccessGrants(storeID) : Promise.resolve({ items: [] as ReadonlyArray<StoreAccessGrant> }),
    ]);
    if (invitationsResult.status === "fulfilled") setInvitations(invitationsResult.value.items);
    if (grantsResult.status === "fulfilled") setGrants(grantsResult.value.items);
    if (invitationsResult.status === "rejected" || grantsResult.status === "rejected") setError("تعذرت قراءة دعوات أو صلاحيات الوصول من المنصة.");
    setLoading(false);
  }, [storeID]);

  useEffect(() => { void reload(); }, [reload]);

  function togglePermission(permission: StoreAccessPermission) {
    setSelectedPermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  }

  async function invite() {
    if (!storeID || busy || !actorID.trim() || selectedPermissions.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const headers = attemptHeaders("store_access_invite");
      await createOwnStoreAccessInvitation(storeID, { delegateActorId: actorID.trim(), permissions: [...selectedPermissions] }, headers.idempotencyKey, headers.correlationID);
      setActorID("");
      setSelectedPermissions(["orders"]);
      await reload();
    } catch {
      await reload();
      setError("تعذر إنشاء الدعوة. استخدم معرّف Actor قائمًا في Identity، ثم أعد قراءة القائمة قبل المحاولة مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(grant: StoreAccessGrant, state: "active" | "suspended" | "revoked") {
    if (!storeID || busy) return;
    setBusy(true);
    setError("");
    try {
      const headers = attemptHeaders("store_access_state");
      await transitionOwnStoreAccessGrant(storeID, grant.id, { state, expectedVersion: grant.version }, headers.idempotencyKey, headers.correlationID);
      await reload();
    } catch {
      await reload();
      setError("تغيرت الدعوة في جلسة أخرى أو تعذر تأكيد الإجراء. أُعيدت قراءة الحالة المعتمدة.");
    } finally {
      setBusy(false);
    }
  }

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
    } catch {
      await reload();
      setError("تعذر تفعيل الوصول. يلزم تسجيل الدخول بدور الشريك ثم إعادة قراءة الحالة المعتمدة.");
    } finally {
      setBusy(false);
    }
  }

  async function updatePermissions(grant: StoreAccessGrant, next: ReadonlyArray<StoreAccessPermission>) {
    if (!storeID || busy || next.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const headers = attemptHeaders("store_access_permissions");
      await updateOwnStoreAccessPermissions(storeID, grant.id, next, grant.version, headers.idempotencyKey, headers.correlationID);
      await reload();
    } catch {
      await reload();
      setError("تعذر تحديث الصلاحيات أو أصبحت نسخة الدعوة قديمة. أُعيدت قراءة الحالة المعتمدة.");
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.container}>
    {storeID ? <View style={styles.card}>
      <Text style={styles.value}>تفويض وصول لمتجر محدد</Text>
      <Text style={styles.muted}>أدخل معرّف حساب Actor الموجود في Identity. يقبل المدعو الدعوة أولًا؛ ثم يعتمد المشغّل دور الشريك عند الحاجة؛ وبعدها يسجل المدعو بدور الشريك لتفعيل صلاحيات المتجر.</Text>
      <TextInput accessibilityLabel="معرّف Actor في Identity" autoCapitalize="none" autoCorrect={false} editable={!busy} onChangeText={setActorID} placeholder="معرّف Actor في Identity" placeholderTextColor={theme.colorMuted} style={{ borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, color: theme.color, padding: 12, textAlign: "left" }} value={actorID} />
      <Text style={styles.metaLabel}>حدد أقل صلاحيات لازمة لهذا المتجر فقط</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{permissions.map((permission) => {
        const selected = selectedPermissions.includes(permission.value);
        return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} key={permission.value} onPress={() => togglePermission(permission.value)} style={{ backgroundColor: selected ? theme.actionBackground : theme.surfaceInset, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: selected ? theme.onAction : theme.color }}>{permission.label}</Text></Pressable>;
      })}</View>
      <BthwaniButton busy={busy} disabled={busy || !actorID.trim() || selectedPermissions.length === 0} label="إرسال دعوة المتجر" onPress={() => void invite()} />
    </View> : null}

    {storeID ? <View style={styles.card}>
      <Text style={styles.value}>الصلاحيات على هذا المتجر</Text>
      {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة صلاحيات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الحالة المعتمدة…</Text></View> : null}
      {!loading && grants.length === 0 ? <Text style={styles.muted}>لا توجد صلاحيات مفوضة على هذا المتجر.</Text> : null}
      {grants.map((grant) => <StoreAccessGrantCard busy={busy} grant={grant} key={grant.id} onPermissions={(next) => void updatePermissions(grant, next)} onTransition={(next) => void transition(grant, next)} />)}
    </View> : null}

    <View style={styles.card}>
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
    </View>
  </View>;
}

function StoreAccessGrantCard({ grant, busy, onTransition, onPermissions }: { grant: StoreAccessGrant; busy: boolean; onTransition: (state: "active" | "suspended" | "revoked") => void; onPermissions: (permissions: ReadonlyArray<StoreAccessPermission>) => void }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const selected = permissions.filter((permission) => grant.permissions.includes(permission.value)).map((permission) => permission.value);
  const nextPermissions = (permission: StoreAccessPermission) => selected.includes(permission) ? selected.filter((item) => item !== permission) : [...selected, permission];
  return <View style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 }}>
    <Text style={styles.value}><Text selectable>{grant.delegateActorId}</Text></Text>
    <Text style={styles.muted}>{grantStateLabel(grant.state)} · الصلاحيات الحالية: {permissionNames(grant.permissions)}</Text>
    {grant.state === "active" || grant.state === "suspended" || grant.state === "pending_role_admission" || grant.state === "pending_partner_activation" || grant.state === "pending_acceptance" ? <>
      <Text style={styles.metaLabel}>الصلاحيات المفوضة</Text>
      <Text style={styles.metaLabel}>يحفظ تغيير كل صلاحية مباشرة بعد تأكيد DSH.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{permissions.map((permission) => {
        const checked = selected.includes(permission.value);
        return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: busy || (checked && selected.length <= 1) }} disabled={busy || (checked && selected.length <= 1)} key={permission.value} onPress={() => onPermissions(nextPermissions(permission.value))} style={{ backgroundColor: checked ? theme.actionBackground : theme.surfaceInset, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: checked ? theme.onAction : theme.color }}>{permission.label}</Text></Pressable>;
      })}</View>
      {grant.state === "active" ? <BthwaniButton disabled={busy} label="إيقاف الوصول مؤقتًا" onPress={() => onTransition("suspended")} variant="secondary" /> : null}
      {grant.state === "suspended" ? <BthwaniButton disabled={busy} label="إعادة تفعيل الوصول" onPress={() => onTransition("active")} /> : null}
      {grant.state === "active" || grant.state === "suspended" ? <BthwaniButton disabled={busy} label="إلغاء الوصول نهائيًا" onPress={() => onTransition("revoked")} variant="secondary" /> : null}
    </> : null}
    {grant.state === "pending_role_admission" || grant.state === "pending_partner_activation" || grant.state === "pending_acceptance" ? <BthwaniButton disabled={busy} label="إلغاء الدعوة" onPress={() => onTransition("revoked")} variant="secondary" /> : null}
  </View>;
}
