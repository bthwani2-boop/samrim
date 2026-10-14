import { BthwaniButton, BthwaniConfirmDialog, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreAccessGrant, StoreAccessPermission } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { usePartnerStoreScope } from "./partner-store-scope-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { storeInvitationReadbackConfirmed } from "./store-access-invite-readback";
import { storeAccessPermissionsMutationIdentity, storeAccessPermissionsReadbackConfirmed, toggleStoreAccessPermission } from "./store-access-permission-toggle";
import { createOwnStoreAccessInvitation, listOwnStoreAccessGrants, transitionOwnStoreAccessGrant, updateOwnStoreAccessPermissions } from "./store-readback-client";

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
  const [grantsForStoreID, setGrantsForStoreID] = useState("");
  const grantReadSequence = useRef(0);
  const activeStoreID = useRef(storeID);
  activeStoreID.current = storeID;
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
    // Preserve an unconfirmed invitation identity across store navigation.
    setNotice("");
  }, [storeID]);

  const reload = useCallback(async (): Promise<ReadonlyArray<StoreAccessGrant> | null> => {
    if (activeStoreID.current !== storeID) return null;
    const sequence = ++grantReadSequence.current;
    setLoading(true);
    setError("");
    try {
      const grantsResult = await listOwnStoreAccessGrants(storeID);
      if (sequence !== grantReadSequence.current || activeStoreID.current !== storeID) return null;
      setGrants(grantsResult.items);
      setGrantsForStoreID(storeID);
      return grantsResult.items;
    } catch {
      if (sequence !== grantReadSequence.current || activeStoreID.current !== storeID) return null;
      setGrants([]);
      setGrantsForStoreID(storeID);
      setError("تعذرت قراءة صلاحيات الوصول من المنصة.");
      return null;
    } finally {
      if (sequence === grantReadSequence.current && activeStoreID.current === storeID) setLoading(false);
    }
  }, [storeID]);

  useEffect(() => {
    void reload();
    return () => { grantReadSequence.current += 1; };
  }, [reload]);

  function togglePermission(permission: StoreAccessPermission) {
    setSelectedPermissions((current) => toggleStoreAccessPermission(current, permission));
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
      const targetStoreIDs = [...selectedStoreIDs];
      const requestedPermissions = [...selectedPermissions];
      const delegatePhone = phone.trim();
      const identity = `${delegatePhone}|${[...targetStoreIDs].sort((left, right) => left.localeCompare(right)).join(",")}|${[...requestedPermissions].sort((left, right) => left.localeCompare(right)).join(",")}`;
      if (inviteAttempt.current?.identity !== identity) {
        inviteAttempt.current = {
          identity,
          headersByStore: Object.fromEntries(targetStoreIDs.map((targetStoreID) => [targetStoreID, attemptHeaders("store_access_invite")])),
        };
      }
      const attempt = inviteAttempt.current;
      if (!attempt) throw new Error("STORE_ACCESS_INVITE_ATTEMPT_MISSING");
      const results = await Promise.allSettled(targetStoreIDs.map(async (targetStoreID) => {
        const headers = attempt.headersByStore[targetStoreID];
        if (!headers) throw new Error("STORE_ACCESS_INVITE_ATTEMPT_MISSING");
        const mutation = await createOwnStoreAccessInvitation(targetStoreID, { delegatePhoneE164: delegatePhone, permissions: requestedPermissions }, headers.idempotencyKey, headers.correlationID);
        const persisted = await listOwnStoreAccessGrants(targetStoreID);
        return storeInvitationReadbackConfirmed(targetStoreID, mutation.grant, requestedPermissions, persisted.items.find((item) => item.id === mutation.grant.id));
      }));
      // Mutation receipts and unconfirmed network responses are not durable proof.
      const confirmedCount = results.filter((result) => result.status === "fulfilled" && result.value === true).length;
      const unconfirmedCount = results.length - confirmedCount;
      if (activeStoreID.current !== storeID) return;
      await reload();
      if (activeStoreID.current !== storeID) return;
      setNotice(`تأكدت ${confirmedCount} دعوات من أصل ${results.length} من القراءة المعتمدة.`);
      if (unconfirmedCount > 0) {
        setError(`لم يتأكد حفظ ${unconfirmedCount} دعوات. أعد المحاولة بنفس البيانات لإعادة استخدام مفاتيح المحاولات الأصلية.`);
      } else {
        inviteAttempt.current = null;
        setPhone("");
        setSelectedPermissions(["orders"]);
        setSelectedStoreIDs([storeID]);
      }
    } catch (cause) {
      console.warn("DSH Store access invitation verification failed", cause);
      if (activeStoreID.current === storeID) {
        await reload();
        setError("تعذر تأكيد إنشاء الدعوة. أعد المحاولة بنفس البيانات للحفاظ على مفاتيح الطلب الأصلية.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function transition(grant: StoreAccessGrant, state: "active" | "suspended" | "revoked") {
    if (busy || grant.storeId !== storeID) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const headers = attemptHeaders("store_access_state");
      const changed = await transitionOwnStoreAccessGrant(storeID, grant.id, { state, expectedVersion: grant.version }, headers.idempotencyKey, headers.correlationID);
      const latest = await reload();
      if (activeStoreID.current !== storeID) return;
      const canonical = latest?.find((item) => item.id === grant.id);
      if (changed.grant.id !== grant.id || changed.grant.storeId !== storeID || changed.grant.state !== state ||
        changed.grant.version <= grant.version || !canonical ||
        canonical.storeId !== storeID || canonical.delegateActorId !== grant.delegateActorId ||
        canonical.ownerPartnerActorId !== grant.ownerPartnerActorId ||
        canonical.version < changed.grant.version || canonical.state !== state) {
        setError("لم يتأكد تغيير الوصول من المنصة. تحقق من الحالة المعتمدة قبل المحاولة مجددًا.");
      } else if (changed.idempotentReplay && state !== "active") {
        setError("تأكد تغير حالة الوصول، لكن إعادة تشغيل الطلب لا تثبت اكتمال مراجعة مستفيد الصرف لدى المالية.");
      } else {
        setNotice(state === "revoked" ? "تأكد إلغاء وصول الموظف."
          : state === "suspended" ? "تأكد إيقاف وصول الموظف مؤقتًا."
          : "تأكد إعادة تفعيل وصول الموظف.");
      }
    } catch (cause) {
      console.warn("DSH Store access grant state mutation failed", cause);
      const latest = await reload();
      if (activeStoreID.current !== storeID) return;
      const canonical = latest?.find((item) => item.id === grant.id);
      if ((state === "revoked" || state === "suspended") && canonical?.storeId === storeID && canonical.state === state) {
        setError("تغيّرت حالة وصول الموظف في المنصة، لكن لا يمكن تأكيد اكتمال مراجعة مستفيد الصرف المرتبط. يلزم التحقق من المالية قبل اعتبار الإجراء مكتملًا.");
      } else {
        setError("تعذر تأكيد تغيير وصول الموظف. أعد قراءة الحالة المعتمدة قبل المحاولة مجددًا.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function updatePermissions(grant: StoreAccessGrant, next: ReadonlyArray<StoreAccessPermission>) {
    if (busy || next.length === 0 || grant.storeId !== storeID) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = storeAccessPermissionsMutationIdentity(storeID, grant.id, grant.version, next);
      const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);
      try {
        await updateOwnStoreAccessPermissions(storeID, grant.id, next, grant.version, `store_access_perms_${digest}`, `store_access_perms_corr_${digest}`);
      } catch (cause) {
        // A lost response is not evidence that DSH rejected the update.
        console.warn("DSH Store access permissions response uncertain", cause);
      }
      const latest = await reload();
      if (activeStoreID.current !== storeID) return;
      if (storeAccessPermissionsReadbackConfirmed(grant, latest?.find((item) => item.id === grant.id), next)) {
        setNotice("تأكد تحديث صلاحيات الموظف من المنصة.");
      } else {
        setError(latest === null
          ? "تعذر قراءة نتيجة تعديل الصلاحيات. تحقق من القائمة المعتمدة قبل المحاولة مجددًا."
          : "لم يتأكد تعديل الصلاحيات. راجع حالة المنحة وإصدارها قبل المحاولة مجددًا.");
      }
    } catch (cause) {
      console.warn("DSH Store access permissions verification failed", cause);
      if (activeStoreID.current === storeID) setError("تعذر تأكيد تعديل الصلاحيات. أعد قراءة حالة المنحة.");
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.container}>
    <TeamInvitationCard busy={busy} choosePreset={choosePreset} filteredOwnedStores={filteredOwnedStores} onInvite={() => void invite()} onPhoneChange={(value) => { setPhone(value); inviteAttempt.current = null; }} onPermissionToggle={togglePermission} onStoreSearchChange={setStoreSearch} onTargetStoreToggle={toggleTargetStore} phone={phone} selectedPermissions={selectedPermissions} selectedStoreIDs={selectedStoreIDs} storeSearch={storeSearch} styles={styles} />

    {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
    {error && grantsForStoreID === storeID ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <StoreGrantsCard busy={busy} grants={grantsForStoreID === storeID ? grants : []} loading={loading || grantsForStoreID !== storeID} onPermissions={(grant, next) => void updatePermissions(grant, next)} onTransition={(grant, next) => void transition(grant, next)} styles={styles} />
  </View>;
}

function TeamInvitationCard({ styles, busy, phone, onPhoneChange, storeSearch, onStoreSearchChange, filteredOwnedStores, selectedStoreIDs, onTargetStoreToggle, selectedPermissions, onPermissionToggle, choosePreset, onInvite }: Readonly<{
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
}>) {
  const theme = useAppearanceTheme();
  const canInvite = !busy && phone.trim().length > 0 && selectedPermissions.length > 0 && selectedStoreIDs.length > 0;
  return <View style={styles.card}>
    <Text style={styles.value}>تفويض وصول لمتجر محدد</Text>
    <Text style={styles.muted}>أدخل رقم هاتف الموظف، واختر المتاجر والصلاحيات. تصل الدعوة إلى حسابه الموثّق، ويُستكمل اعتماد الدور عند الحاجة. لكل متجر صلاحية مستقلة.</Text>
    <TextInput accessibilityLabel="رقم هاتف الموظف" autoCapitalize="none" autoCorrect={false} editable={!busy} keyboardType="phone-pad" onChangeText={onPhoneChange} placeholder="رقم الهاتف مع مفتاح الدولة" placeholderTextColor={theme.colorMuted} style={[styles.formInput, { textAlign: "left", writingDirection: "ltr" }]} value={phone} />
    <Text style={styles.metaLabel}>متاجر الفريق المملوكة</Text>
    <TextInput accessibilityLabel="بحث المتاجر المملوكة" autoCapitalize="none" autoCorrect={false} editable={!busy} onChangeText={onStoreSearchChange} placeholder="ابحث باسم المتجر" placeholderTextColor={theme.colorMuted} style={styles.formInput} value={storeSearch} />
    <View style={{ gap: 8 }}>{filteredOwnedStores.map((store) => {
      const selected = selectedStoreIDs.includes(store.id);
      return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} key={store.id} onPress={() => onTargetStoreToggle(store.id)} style={[styles.choice, selected && styles.choiceSelected]}><Text style={selected ? styles.choiceTextSelected : styles.choiceText}>{selected ? "✓  " : ""}{store.name}</Text></Pressable>;
    })}</View>
    <Text style={styles.metaLabel}>قوالب الدور</Text>
    <View style={styles.choiceRow}>{rolePresets.map((preset) => {
      const selected = preset.permissions.length === selectedPermissions.length && preset.permissions.every((permission) => selectedPermissions.includes(permission));
      return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled: busy }} disabled={busy} key={preset.value} onPress={() => choosePreset(preset)} style={[styles.choice, selected && styles.choiceSelected]}><Text style={selected ? styles.choiceTextSelected : styles.choiceText}>{selected ? "✓  " : ""}{preset.label}</Text></Pressable>;
    })}</View>
    <Text style={styles.metaLabel}>حدد أقل صلاحيات لازمة لهذا المتجر فقط</Text>
    <Text style={styles.muted}>صلاحية التوصيل تعتمد على قراءة الطلب، لذلك تضيف «الطلبات» معها تلقائيًا ولا يمكن إبقاء التوصيل منفردًا.</Text>
    <View style={styles.choiceRow}>{permissions.map((permission) => {
      const selected = selectedPermissions.includes(permission.value);
      return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} key={permission.value} onPress={() => onPermissionToggle(permission.value)} style={[styles.choice, selected && styles.choiceSelected]}><Text style={selected ? styles.choiceTextSelected : styles.choiceText}>{selected ? "✓  " : ""}{permission.label}</Text></Pressable>;
    })}</View>
    <BthwaniButton busy={busy} disabled={!canInvite} label="إرسال دعوة الموظف" onPress={onInvite} />
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
    {grants.map((grant) => <StoreAccessGrantCard busy={busy} grant={grant} key={[grant.id, grant.version].join(":")} onPermissions={(next) => onPermissions(grant, next)} onTransition={(next) => onTransition(grant, next)} />)}
  </View>;
}

function StoreAccessGrantCard({ grant, busy, onTransition, onPermissions }: { grant: StoreAccessGrant; busy: boolean; onTransition: (state: "active" | "suspended" | "revoked") => void; onPermissions: (permissions: ReadonlyArray<StoreAccessPermission>) => void }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<ReadonlyArray<StoreAccessPermission> | null>(null);
  const selected = permissions.filter((permission) => grant.permissions.includes(permission.value)).map((permission) => permission.value);
  const newlyGranted = pendingPermissions?.filter((permission) => !selected.includes(permission)) ?? [];
  const newlyRemoved = pendingPermissions ? selected.filter((permission) => !pendingPermissions.includes(permission)) : [];

  return <View style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 }}>
    <Text style={styles.value}>{[grant.delegateBeneficiaryName?.trim() || "عضو فريق", grant.delegatePhoneMasked?.trim()].filter(Boolean).join(" · ")}</Text>
    <Text style={styles.muted}>{grantStateLabel(grant.state)} · الصلاحيات الحالية: {permissionNames(grant.permissions)}</Text>
    {grant.state === "active" || grant.state === "suspended" || grant.state === "pending_role_admission" || grant.state === "pending_partner_activation" || grant.state === "pending_acceptance" ? <>
      <Text style={styles.metaLabel}>الصلاحيات المفوضة</Text>
      <Text style={styles.metaLabel}>يُحفظ تغيير كل صلاحية بعد تأكيده.</Text>
      <Text style={styles.muted}>التوصيل يعتمد على الطلبات؛ إضافة التوصيل تضيف «الطلبات» تلقائيًا، وإزالة «الطلبات» تزيل التوصيل معها.</Text>
      <View style={styles.choiceRow}>{permissions.map((permission) => {
        const checked = selected.includes(permission.value);
        const next = toggleStoreAccessPermission(selected, permission.value);
        const disabled = busy || next.length === 0;
        return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} disabled={disabled} key={permission.value} onPress={() => setPendingPermissions(next)} style={[styles.choice, checked && styles.choiceSelected]}><Text style={checked ? styles.choiceTextSelected : styles.choiceText}>{checked ? "✓  " : ""}{permission.label}</Text></Pressable>;
      })}</View>
      {grant.state === "active" ? <BthwaniButton disabled={busy} label="إيقاف الوصول مؤقتًا" onPress={() => onTransition("suspended")} variant="secondary" /> : null}
      {grant.state === "suspended" ? <BthwaniButton disabled={busy} label="إعادة تفعيل الوصول" onPress={() => onTransition("active")} /> : null}
      {grant.state === "active" || grant.state === "suspended" ? <BthwaniButton disabled={busy} label="إلغاء الوصول نهائيًا" onPress={() => setConfirmRevoke(true)} variant="secondary" /> : null}
    </> : null}
    {grant.state === "pending_role_admission" || grant.state === "pending_partner_activation" || grant.state === "pending_acceptance" ? <BthwaniButton disabled={busy} label="إلغاء الدعوة" onPress={() => setConfirmRevoke(true)} variant="secondary" /> : null}
    <BthwaniConfirmDialog
      busy={busy}
      confirmLabel="تأكيد تحديث الصلاحيات"
      description={`ستتغير صلاحيات ${grant.delegateBeneficiaryName?.trim() || grant.delegatePhoneMasked || "عضو الفريق"} على ${grant.storeName || "هذا المتجر"}. ${newlyGranted.length ? `إضافة: ${permissionNames(newlyGranted)}. ` : ""}${newlyRemoved.length ? `إزالة: ${permissionNames(newlyRemoved)}.` : ""} لا يتم حفظ التغيير دون هذا التأكيد.`}
      onCancel={() => setPendingPermissions(null)}
      onConfirm={() => {
        const next = pendingPermissions;
        setPendingPermissions(null);
        if (!busy && next?.length) onPermissions(next);
      }}
      title="مراجعة صلاحيات عضو الفريق"
      visible={pendingPermissions !== null}
    />
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
