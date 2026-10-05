import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreAccessGrant, StoreAccessPermission } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { activateOwnStoreAccessInvitation, createOwnStoreAccessInvitation, decideOwnStoreAccessInvitation, listOwnStoreAccessGrants, listOwnStoreAccessInvitations, transitionOwnStoreAccessGrant, updateOwnStoreAccessPermissions } from "./store-readback-client";
import { usePartnerStoreScope } from "./partner-store-scope-context";

const rolePresets = [
  { value: "STORE_MANAGER", label: "مدير متجر", permissions: ["orders", "catalog", "store_operations"] as const },
  { value: "ORDER_STAFF", label: "موظف طلبات", permissions: ["orders"] as const },
  { value: "CATALOG_STAFF", label: "موظف كتالوج", permissions: ["catalog"] as const },
] as const;

type InviteAttempt = Readonly<{
  identity: string;
  headersByStore: Readonly<Record<string, ReturnType<typeof attemptHeaders>>>;
}>;

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

export function PartnerStoreAccess({ storeID }: { storeID?: string | undefined }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [invitations, setInvitations] = useState<ReadonlyArray<StoreAccessGrant>>([]);
  const [grants, setGrants] = useState<ReadonlyArray<StoreAccessGrant>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phone, setPhone] = useState("");
  const [storeSearch, setStoreSearch] = useState("");
  const [selectedStoreIDs, setSelectedStoreIDs] = useState<ReadonlyArray<string>>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<ReadonlyArray<StoreAccessPermission>>(["orders"]);
  const inviteAttempt = useRef<InviteAttempt | null>(null);
  const storeScope = usePartnerStoreScope();
  const ownedStores = useMemo(() => storeScope.stores.filter((store) => store.owned), [storeScope.stores]);
  const filteredOwnedStores = useMemo(() => ownedStores.filter((store) => store.name.toLocaleLowerCase().includes(storeSearch.trim().toLocaleLowerCase())), [ownedStores, storeSearch]);
  useEffect(() => {
    setSelectedStoreIDs(storeID ? [storeID] : []);
  }, [storeID]);

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
    inviteAttempt.current = null;
  }

  function choosePreset(preset: typeof rolePresets[number]) {
    setSelectedPermissions(preset.permissions);
    inviteAttempt.current = null;
  }

  function toggleTargetStore(targetStoreID: string) {
    setSelectedStoreIDs((current) => current.includes(targetStoreID) ? current.filter((item) => item !== targetStoreID) : [...current, targetStoreID]);
    inviteAttempt.current = null;
  }

  async function invite() {
    if (!storeID || busy || !phone.trim() || selectedPermissions.length === 0 || selectedStoreIDs.length === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const identity = `${phone.trim()}|${[...selectedStoreIDs].sort((left, right) => left.localeCompare(right)).join(",")}|${[...selectedPermissions].sort((left, right) => left.localeCompare(right)).join(",")}`;
      if (inviteAttempt.current?.identity !== identity) {
        inviteAttempt.current = {
          identity,
          headersByStore: Object.fromEntries(selectedStoreIDs.map((targetStoreID) => [targetStoreID, attemptHeaders("store_access_invite")])),
        };
      }
      const results = await Promise.allSettled(selectedStoreIDs.map((targetStoreID) => {
        const headers = inviteAttempt.current?.headersByStore[targetStoreID];
        if (!headers) throw new Error("STORE_ACCESS_INVITE_ATTEMPT_MISSING");
        return createOwnStoreAccessInvitation(targetStoreID, { delegatePhoneE164: phone.trim(), permissions: [...selectedPermissions] }, headers.idempotencyKey, headers.correlationID);
      }));
      const createdCount = results.filter((result) => result.status === "fulfilled").length;
      const failedCount = results.length - createdCount;
      setNotice(`أُكدت الدعوة على ${createdCount} من ${results.length} متاجر مختارة.`);
      if (failedCount > 0) setError(`تعذر تأكيد ${failedCount} دعوات. أعد المحاولة بنفس البيانات لإعادة قراءة المحاولات المحفوظة بأمان.`);
      else {
        inviteAttempt.current = null;
        setPhone("");
        setSelectedPermissions(["orders"]);
        setSelectedStoreIDs(storeID ? [storeID] : []);
      }
      await reload();
    } catch {
      await reload();
      setError("تعذر إنشاء الدعوة. تحقّق من رقم الهاتف وأن صاحبه فعّل حسابه في Identity، ثم أعد قراءة القائمة.");
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
    {storeID ? <TeamInvitationCard busy={busy} choosePreset={choosePreset} filteredOwnedStores={filteredOwnedStores} hasMoreStores={storeScope.state.kind === "ready" && Boolean(storeScope.state.nextCursor)} loadMoreStores={() => void storeScope.loadMore()} notice={notice} onInvite={() => void invite()} onPhoneChange={(value) => { setPhone(value); inviteAttempt.current = null; }} onPermissionToggle={togglePermission} onStoreSearchChange={setStoreSearch} onTargetStoreToggle={toggleTargetStore} phone={phone} selectedPermissions={selectedPermissions} selectedStoreIDs={selectedStoreIDs} storeSearch={storeSearch} styles={styles} /> : null}

    {storeID ? <StoreGrantsCard busy={busy} grants={grants} loading={loading} onPermissions={(grant, next) => void updatePermissions(grant, next)} onTransition={(grant, next) => void transition(grant, next)} styles={styles} /> : null}

    <PartnerInvitationsCard activate={(grant) => void activate(grant)} busy={busy} decide={(grant, decision) => void decide(grant, decision)} error={error} invitations={invitations} loading={loading} reload={() => void reload()} styles={styles} />
  </View>;
}

function TeamInvitationCard({ styles, busy, phone, onPhoneChange, storeSearch, onStoreSearchChange, filteredOwnedStores, hasMoreStores, loadMoreStores, selectedStoreIDs, onTargetStoreToggle, selectedPermissions, onPermissionToggle, choosePreset, onInvite, notice }: Readonly<{
  styles: ReturnType<typeof createPartnerSurfaceStyles>;
  busy: boolean;
  phone: string;
  onPhoneChange: (value: string) => void;
  storeSearch: string;
  onStoreSearchChange: (value: string) => void;
  filteredOwnedStores: ReadonlyArray<{ id: string; name: string }>;
  hasMoreStores: boolean;
  loadMoreStores: () => void;
  selectedStoreIDs: ReadonlyArray<string>;
  onTargetStoreToggle: (targetStoreID: string) => void;
  selectedPermissions: ReadonlyArray<StoreAccessPermission>;
  onPermissionToggle: (permission: StoreAccessPermission) => void;
  choosePreset: (preset: typeof rolePresets[number]) => void;
  onInvite: () => void;
  notice: string;
}>) {
  const theme = useAppearanceTheme();
  const canInvite = !busy && phone.trim().length > 0 && selectedPermissions.length > 0 && selectedStoreIDs.length > 0;
  return <View style={styles.card}>
    <Text style={styles.value}>تفويض وصول لمتجر محدد</Text>
    <Text style={styles.muted}>أرسل الدعوة برقم الهاتف المرتبط بحساب موثّق. تتحقق المنصة من هوية الموظف وتربط الدعوة بحسابه المعتمد داخليًا. يقبل الموظف الدعوة ثم يكمل اعتماد دور الشريك عند الحاجة. كل متجر يحصل على منحة مستقلة.</Text>
    <TextInput accessibilityLabel="رقم هاتف الموظف" autoCapitalize="none" autoCorrect={false} editable={!busy} keyboardType="phone-pad" onChangeText={onPhoneChange} placeholder="رقم الهاتف مع مفتاح الدولة" placeholderTextColor={theme.colorMuted} style={{ borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, color: theme.color, padding: 12, textAlign: "left" }} value={phone} />
    <Text style={styles.metaLabel}>متاجر الفريق المملوكة</Text>
    <TextInput accessibilityLabel="بحث المتاجر المملوكة" autoCapitalize="none" autoCorrect={false} editable={!busy} onChangeText={onStoreSearchChange} placeholder="ابحث باسم المتجر" placeholderTextColor={theme.colorMuted} style={{ borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, color: theme.color, padding: 12 }} value={storeSearch} />
    <View style={{ gap: 8 }}>{filteredOwnedStores.map((store) => {
      const selected = selectedStoreIDs.includes(store.id);
      return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} key={store.id} onPress={() => onTargetStoreToggle(store.id)} style={{ backgroundColor: selected ? theme.actionBackground : theme.surfaceInset, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, padding: 12 }}><Text style={{ color: selected ? theme.onAction : theme.color }}>{store.name}</Text></Pressable>;
    })}</View>
    {hasMoreStores ? <BthwaniButton disabled={busy} label="تحميل متاجر أخرى" onPress={loadMoreStores} variant="secondary" /> : null}
    <Text style={styles.metaLabel}>قوالب الدور</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{rolePresets.map((preset) => <Pressable accessibilityRole="button" disabled={busy} key={preset.value} onPress={() => choosePreset(preset)} style={{ backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: theme.color }}>{preset.label}</Text></Pressable>)}</View>
    <Text style={styles.metaLabel}>حدد أقل صلاحيات لازمة لهذا المتجر فقط</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{permissions.map((permission) => {
      const selected = selectedPermissions.includes(permission.value);
      return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} key={permission.value} onPress={() => onPermissionToggle(permission.value)} style={{ backgroundColor: selected ? theme.actionBackground : theme.surfaceInset, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: selected ? theme.onAction : theme.color }}>{permission.label}</Text></Pressable>;
    })}</View>
    <BthwaniButton busy={busy} disabled={!canInvite} label="إرسال دعوة الموظف" onPress={onInvite} />
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
  </View>;
}

function StoreGrantsCard({ styles, busy, grants, loading, onTransition, onPermissions }: Readonly<{
  styles: ReturnType<typeof createPartnerSurfaceStyles>;
  busy: boolean;
  grants: ReadonlyArray<StoreAccessGrant>;
  loading: boolean;
  onTransition: (grant: StoreAccessGrant, state: "active" | "suspended" | "revoked") => void;
  onPermissions: (grant: StoreAccessGrant, permissions: ReadonlyArray<StoreAccessPermission>) => void;
}>) {
  const theme = useAppearanceTheme();
  return <View style={styles.card}>
    <Text style={styles.value}>الصلاحيات على هذا المتجر</Text>
    {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة صلاحيات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الحالة المعتمدة…</Text></View> : null}
    {!loading && grants.length === 0 ? <Text style={styles.muted}>لا توجد صلاحيات مفوضة على هذا المتجر.</Text> : null}
    {grants.map((grant) => <StoreAccessGrantCard busy={busy} grant={grant} key={grant.id} onPermissions={(next) => onPermissions(grant, next)} onTransition={(next) => onTransition(grant, next)} />)}
  </View>;
}

function PartnerInvitationsCard({ styles, busy, loading, invitations, decide, activate, error, reload }: Readonly<{
  styles: ReturnType<typeof createPartnerSurfaceStyles>;
  busy: boolean;
  loading: boolean;
  invitations: ReadonlyArray<StoreAccessGrant>;
  decide: (grant: StoreAccessGrant, decision: "accept" | "decline") => void;
  activate: (grant: StoreAccessGrant) => void;
  error: string;
  reload: () => void;
}>) {
  const theme = useAppearanceTheme();
  return <View style={styles.card}>
    <Text style={styles.value}>دعوات الوصول الموجهة إليك</Text>
    {loading ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة دعوات الوصول" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الحالة المعتمدة…</Text></View> : null}
    {!loading && invitations.length === 0 ? <Text style={styles.muted}>لا توجد دعوات وصول موجهة إلى حسابك.</Text> : null}
    {invitations.map((grant) => <View key={grant.id} style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 }}>
      <Text style={styles.value}>{grant.storeName}</Text>
      <Text style={styles.muted}>الصلاحيات: {permissionNames(grant.permissions)} · {grantStateLabel(grant.state)}</Text>
      {grant.state === "pending_role_admission" ? <Text style={styles.muted}>ينتظر اعتماد مشغّل المنصة لدور الشريك.</Text> : null}
      {grant.state === "pending_acceptance" ? <View style={{ flexDirection: "row", gap: 8 }}><View style={{ flex: 1 }}><BthwaniButton busy={busy} disabled={busy} label="قبول الدعوة" onPress={() => decide(grant, "accept")} /></View><View style={{ flex: 1 }}><BthwaniButton disabled={busy} label="رفض الدعوة" onPress={() => decide(grant, "decline")} variant="secondary" /></View></View> : null}
      {grant.state === "pending_partner_activation" ? <View style={{ gap: 8 }}><Text style={styles.muted}>قُبلت الدعوة واعتمد دور الشريك. سجّل الدخول بدور الشريك لإكمال تفعيل صلاحيات هذا المتجر.</Text><BthwaniButton busy={busy} disabled={busy} label="تفعيل الوصول لهذا المتجر" onPress={() => activate(grant)} /></View> : null}
    </View>)}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <BthwaniButton disabled={busy || loading} label="إعادة القراءة" onPress={reload} variant="secondary" />
  </View>;
}

function StoreAccessGrantCard({ grant, busy, onTransition, onPermissions }: { grant: StoreAccessGrant; busy: boolean; onTransition: (state: "active" | "suspended" | "revoked") => void; onPermissions: (permissions: ReadonlyArray<StoreAccessPermission>) => void }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const selected = permissions.filter((permission) => grant.permissions.includes(permission.value)).map((permission) => permission.value);
  const nextPermissions = (permission: StoreAccessPermission) => selected.includes(permission) ? selected.filter((item) => item !== permission) : [...selected, permission];
  return <View style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 }}>
    <Text style={styles.value}>{grant.delegatePhoneMasked ?? "عضو فريق"}</Text>
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
