import { BthwaniButton, BthwaniConfirmDialog, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreAccessGrant, StoreAccessPermission } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { createOwnStoreAccessInvitation, listOwnStoreAccessGrants, transitionOwnStoreAccessGrant, updateOwnStoreAccessPermissions } from "./store-readback-client";
import { usePartnerStoreScope } from "./partner-store-scope-context";

const rolePresets = [
  { value: "STORE_MANAGER", label: "مدير متجر", permissions: ["orders", "catalog", "store_operations", "promotions", "fulfillment"] as const },
  { value: "ORDER_STAFF", label: "موظف طلبات", permissions: ["orders"] as const },
  { value: "CATALOG_STAFF", label: "موظف كتالوج", permissions: ["catalog"] as const },
  { value: "ACCOUNTANT", label: "محاسب", permissions: ["finance_read"] as const },
  { value: "DELIVERY_STAFF", label: "موظف توصيل", permissions: ["fulfillment", "orders"] as const },
] as const;

type InviteAttempt = Readonly<{
  identity: string;
  headersByStore: Readonly<Record<string, ReturnType<typeof attemptHeaders>>>;
}>;

const permissions: ReadonlyArray<{ value: StoreAccessPermission; label: string }> = [
  { value: "orders", label: "الطلبات" },
  { value: "catalog", label: "الكتالوج" },
  { value: "store_operations", label: "ساعات وإتاحة المتجر" },
  { value: "promotions", label: "العروض والتخفيضات" },
  { value: "finance_read", label: "قراءة المالية" },
  { value: "payout_request", label: "طلب صرف المستحقات" },
  { value: "fulfillment", label: "التوصيل والاستلام" },
];

export function grantStateLabel(state: StoreAccessGrant["state"]): string {
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

export function permissionNames(values: ReadonlyArray<string>): string {
  return values.map((value) => permissions.find((item) => item.value === value)?.label ?? value).join("، ");
}

function attemptHeaders(prefix: string) {
  return { idempotencyKey: `${prefix}_${Crypto.randomUUID()}`, correlationID: `${prefix}_corr_${Crypto.randomUUID()}` };
}

export function PartnerStoreAccess({ storeID }: { storeID: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
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
    setSelectedStoreIDs([storeID]);
  }, [storeID]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const grantsResult = await listOwnStoreAccessGrants(storeID);
      setGrants(grantsResult.items);
    } catch {
      setError("تعذرت قراءة صلاحيات الوصول من المنصة.");
    } finally {
      setLoading(false);
    }
  }, [storeID]);

  useEffect(() => { void reload(); }, [reload]);

  function togglePermission(permission: StoreAccessPermission) {
    setSelectedPermissions((current) => {
      if (current.includes(permission)) {
        if (permission === "orders") return current.filter((item) => item !== "orders" && item !== "fulfillment");
        return current.filter((item) => item !== permission);
      }
      if (permission === "fulfillment") return [...new Set<StoreAccessPermission>([...current, "orders", "fulfillment"])];
      return [...current, permission];
    });
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
    if (busy || !phone.trim() || selectedPermissions.length === 0 || selectedStoreIDs.length === 0) return;
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
        setSelectedStoreIDs([storeID]);
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
    if (busy) return;
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

  async function updatePermissions(grant: StoreAccessGrant, next: ReadonlyArray<StoreAccessPermission>) {
    if (busy || next.length === 0) return;
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
    <TeamInvitationCard busy={busy} choosePreset={choosePreset} filteredOwnedStores={filteredOwnedStores} notice={notice} onInvite={() => void invite()} onPhoneChange={(value) => { setPhone(value); inviteAttempt.current = null; }} onPermissionToggle={togglePermission} onStoreSearchChange={setStoreSearch} onTargetStoreToggle={toggleTargetStore} phone={phone} selectedPermissions={selectedPermissions} selectedStoreIDs={selectedStoreIDs} storeSearch={storeSearch} styles={styles} />

    <StoreGrantsCard busy={busy} grants={grants} loading={loading} onPermissions={(grant, next) => void updatePermissions(grant, next)} onTransition={(grant, next) => void transition(grant, next)} styles={styles} />
  </View>;
}

function TeamInvitationCard({ styles, busy, phone, onPhoneChange, storeSearch, onStoreSearchChange, filteredOwnedStores, selectedStoreIDs, onTargetStoreToggle, selectedPermissions, onPermissionToggle, choosePreset, onInvite, notice }: Readonly<{
  styles: ReturnType<typeof createPartnerSurfaceStyles>;
  busy: boolean;
  phone: string;
  onPhoneChange: (value: string) => void;
  storeSearch: string;
  onStoreSearchChange: (value: string) => void;
  filteredOwnedStores: ReadonlyArray<{ id: string; name: string }>;
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
    <Text style={styles.metaLabel}>قوالب الدور</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{rolePresets.map((preset) => <Pressable accessibilityRole="button" disabled={busy} key={preset.value} onPress={() => choosePreset(preset)} style={{ backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: theme.color }}>{preset.label}</Text></Pressable>)}</View>
    <Text style={styles.metaLabel}>حدد أقل صلاحيات لازمة لهذا المتجر فقط</Text>
    <Text style={styles.muted}>صلاحية التوصيل تعتمد على قراءة الطلب، لذلك تضيف «الطلبات» معها تلقائيًا ولا يمكن إبقاء التوصيل منفردًا.</Text>
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

function StoreAccessGrantCard({ grant, busy, onTransition, onPermissions }: { grant: StoreAccessGrant; busy: boolean; onTransition: (state: "active" | "suspended" | "revoked") => void; onPermissions: (permissions: ReadonlyArray<StoreAccessPermission>) => void }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const selected = permissions.filter((permission) => grant.permissions.includes(permission.value)).map((permission) => permission.value);
  const nextPermissions = (permission: StoreAccessPermission) => {
    if (selected.includes(permission)) {
      if (permission === "orders") return selected.filter((item) => item !== "orders" && item !== "fulfillment");
      return selected.filter((item) => item !== permission);
    }
    if (permission === "fulfillment") return [...new Set<StoreAccessPermission>([...selected, "orders", "fulfillment"])];
    return [...selected, permission];
  };
  return <View style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 }}>
    <Text style={styles.value}>{[grant.delegateBeneficiaryName?.trim() || "عضو فريق", grant.delegatePhoneMasked?.trim()].filter(Boolean).join(" · ")}</Text>
    <Text style={styles.muted}>{grantStateLabel(grant.state)} · الصلاحيات الحالية: {permissionNames(grant.permissions)}</Text>
    {grant.state === "active" || grant.state === "suspended" || grant.state === "pending_role_admission" || grant.state === "pending_partner_activation" || grant.state === "pending_acceptance" ? <>
      <Text style={styles.metaLabel}>الصلاحيات المفوضة</Text>
      <Text style={styles.metaLabel}>يحفظ تغيير كل صلاحية مباشرة بعد تأكيد DSH.</Text>
      <Text style={styles.muted}>التوصيل يعتمد على الطلبات؛ إضافة التوصيل تضيف «الطلبات» تلقائيًا، وإزالة «الطلبات» تزيل التوصيل معها.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{permissions.map((permission) => {
        const checked = selected.includes(permission.value);
        return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: busy || (checked && selected.length <= 1) }} disabled={busy || (checked && selected.length <= 1)} key={permission.value} onPress={() => onPermissions(nextPermissions(permission.value))} style={{ backgroundColor: checked ? theme.actionBackground : theme.surfaceInset, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: checked ? theme.onAction : theme.color }}>{permission.label}</Text></Pressable>;
      })}</View>
      {grant.state === "active" ? <BthwaniButton disabled={busy} label="إيقاف الوصول مؤقتًا" onPress={() => onTransition("suspended")} variant="secondary" /> : null}
      {grant.state === "suspended" ? <BthwaniButton disabled={busy} label="إعادة تفعيل الوصول" onPress={() => onTransition("active")} /> : null}
      {grant.state === "active" || grant.state === "suspended" ? <BthwaniButton disabled={busy} label="إلغاء الوصول نهائيًا" onPress={() => setConfirmRevoke(true)} variant="secondary" /> : null}
    </> : null}
    {grant.state === "pending_role_admission" || grant.state === "pending_partner_activation" || grant.state === "pending_acceptance" ? <BthwaniButton disabled={busy} label="إلغاء الدعوة" onPress={() => setConfirmRevoke(true)} variant="secondary" /> : null}
    <BthwaniConfirmDialog
      busy={busy}
      confirmLabel={grant.state === "active" || grant.state === "suspended" ? "إلغاء الوصول نهائيًا" : "إلغاء الدعوة"}
      description={grant.state === "active" || grant.state === "suspended"
        ? `سيُلغى وصول ${grant.delegateBeneficiaryName?.trim() || grant.delegatePhoneMasked || "عضو الفريق"} إلى ${grant.storeName || "هذا المتجر"} نهائيًا، وسيلزم تفويض جديد لإعادته لاحقًا.`
        : `ستُلغى دعوة الوصول إلى ${grant.storeName || "هذا المتجر"} ولن يستطيع المدعو إكمالها بعد ذلك.`}
      intent="danger"
      onCancel={() => setConfirmRevoke(false)}
      onConfirm={() => { setConfirmRevoke(false); onTransition("revoked"); }}
      title={grant.state === "active" || grant.state === "suspended" ? "تأكيد إلغاء الوصول" : "تأكيد إلغاء الدعوة"}
      visible={confirmRevoke}
    />
  </View>;
}
