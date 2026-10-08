import { borders, opacity, radius, resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type StoreAccessGrant, type StorePayoutBeneficiaryProfile, type StorePayoutRecipientListResponse, type StorePayoutRecipientRecord } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

type RecipientConfirmation =
  | Readonly<{ kind: "select"; storeId: string; grantId: string; storeName: string; beneficiaryName: string; phoneMasked: string; providerKey: string; walletIdentifierMasked: string }>
  | Readonly<{ kind: "revert"; storeId: string; storeName: string }>
  | null;

type WalletProvider = Awaited<ReturnType<ReturnType<typeof client>["listWalletProviders"]>>["walletProviders"][number];

function providerLabel(providerKey: string, providers: ReadonlyArray<WalletProvider>): string {
  const key = providerKey.trim();
  return providers.find((provider) => provider.key === key)?.displayNameAr ?? key;
}

function profileSummary(profile: StorePayoutBeneficiaryProfile | undefined, providers: ReadonlyArray<WalletProvider>): string {
  if (!profile) return "بيانات المستلم المالية غير متاحة";
  const identity = [profile.beneficiaryName?.trim(), profile.phoneMasked?.trim()].filter((value): value is string => Boolean(value)).join(" · ");
  const wallet = profile.providerKey ? `جهة المحفظة: ${providerLabel(profile.providerKey, providers)}${profile.walletIdentifierMasked ? ` · ${profile.walletIdentifierMasked}` : ""}` : "جهة المحفظة الرسمية غير جاهزة";
  return [identity || "المستلم الموثّق", wallet].join(" · ");
}

function recipientStateLabel(record: StorePayoutRecipientRecord, profiles: Readonly<Record<string, StorePayoutBeneficiaryProfile>>, providers: ReadonlyArray<WalletProvider>): string {
  switch (record.state) {
    case "SELECTED_VERIFIED_STAFF":
      return `المستلم المسجّل: ${profileSummary(profiles[record.beneficiaryActorId ?? ""], providers)}`;
    case "RECIPIENT_REVIEW_REQUIRED":
      return `بانتظار إجراء المالك: المستلم المسجّل لم يعد مؤهلاً · ${profileSummary(profiles[record.beneficiaryActorId ?? ""], providers)}`;
    default:
      return `المالك (الافتراضي) · ${profileSummary(profiles[record.beneficiaryActorId ?? ""], providers)}`;
  }
}

export function StorePayoutRecipientsCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<StorePayoutRecipientListResponse | null>(null);
  const [walletProviders, setWalletProviders] = useState<ReadonlyArray<WalletProvider>>([]);
  const [busyStoreId, setBusyStoreId] = useState("");
  const [pickerStoreId, setPickerStoreId] = useState("");
  const [grants, setGrants] = useState<StoreAccessGrant[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<RecipientConfirmation>(null);

  const load = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getUsableIdentityAccessToken();
      const next = await client().listPartnerStorePayoutRecipients(token);
      setState(next);
      setError("");
    } catch (cause) {
      console.error("DSH store payout recipients readback failed", cause);
      setError("تعذر قراءة مستلمي الصرف للمتاجر.");
    }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);

  const loadWalletProviders = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await client().listWalletProviders(token);
      setWalletProviders(response.walletProviders.filter((provider) => provider.active));
    } catch (cause) {
      console.error("DSH wallet provider catalog read failed", cause);
    }
  }, [authenticated]);
  useEffect(() => { void loadWalletProviders(); }, [loadWalletProviders]);

  const openPicker = async (storeId: string) => {
    setBusyStoreId(storeId); setError(""); setNotice(""); setGrants([]);
    try {
      const token = await getUsableIdentityAccessToken();
      const page = await client().listPartnerStoreAccessGrants(token, storeId);
      const active = page.items.filter((grant) => grant.state === "active");
      setGrants(active);
      setPickerStoreId(storeId);
      if (active.length === 0) setNotice("لا يوجد موظف نشط على هذا المتجر؛ أضف عضو فريق أولًا من مساحة المتجر.");
    } catch (cause) {
      console.error("DSH store access grants read failed", cause);
      setError("تعذر قراءة فريق المتجر.");
    } finally { setBusyStoreId(""); }
  };

  const select = async (choice: Extract<RecipientConfirmation, { kind: "select" }>) => {
    setBusyStoreId(choice.storeId); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const mutation = await client().selectPartnerStorePayoutRecipient(token, choice.storeId, { grantId: choice.grantId, reason: "اختيار مستلم صرف المتجر من قِبل المالك بعد تأكيد بيانات المستلم والمحفظة" }, `recipient_select_${Crypto.randomUUID()}`, `recipient_select_corr_${Crypto.randomUUID()}`);
      const next = await client().listPartnerStorePayoutRecipients(token);
      const readback = next.readback.recipients.find((record) => record.storeId === choice.storeId);
      if (!readback || readback.state !== "SELECTED_VERIFIED_STAFF" || readback.beneficiaryActorId !== mutation.assignment.beneficiaryActorId) {
        throw new Error("RECIPIENT_READBACK_MISMATCH");
      }
      setState(next);
      setNotice(`تم تعيين ${choice.beneficiaryName} مستلمًا لصرف ${choice.storeName} وجرى تأكيد النتيجة من سجل المحفظة.`);
      setPickerStoreId("");
      setConfirmation(null);
    } catch (cause) {
      console.error("DSH payout recipient select failed", cause);
      setConfirmation(null);
      setError("تعذر تأكيد مستلم الصرف من سجل المحفظة. لم تُعرض العملية كناجحة؛ أعد القراءة قبل المحاولة مجددًا.");
    } finally { setBusyStoreId(""); }
  };

  const revert = async (choice: Extract<RecipientConfirmation, { kind: "revert" }>) => {
    setBusyStoreId(choice.storeId); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().revertPartnerStorePayoutRecipient(token, choice.storeId, { reason: "إعادة مستلم الصرف إلى مالك المتجر بعد تأكيد المالك" }, `recipient_revert_${Crypto.randomUUID()}`, `recipient_revert_corr_${Crypto.randomUUID()}`);
      const next = await client().listPartnerStorePayoutRecipients(token);
      const readback = next.readback.recipients.find((record) => record.storeId === choice.storeId);
      if (!readback || readback.state !== "DEFAULT_OWNER") throw new Error("RECIPIENT_REVERT_READBACK_MISMATCH");
      setState(next);
      setNotice(`أُعيد مستلم صرف ${choice.storeName} إلى المالك وجرى تأكيد النتيجة من سجل المحفظة.`);
      setPickerStoreId("");
      setConfirmation(null);
    } catch (cause) {
      console.error("DSH payout recipient revert failed", cause);
      setConfirmation(null);
      setError("تعذر تأكيد إعادة مستلم الصرف إلى المالك من سجل المحفظة. أعد القراءة قبل المحاولة مجددًا.");
    } finally { setBusyStoreId(""); }
  };

  if (!authenticated) return null;
  if (!state && !error) {
    return <BthwaniSurface style={styles.card}><View style={styles.loading}><ActivityIndicator accessibilityLabel="جارٍ قراءة مستلمي الصرف" color={theme.interactiveText} /></View></BthwaniSurface>;
  }
  const recipients = state?.readback.recipients ?? [];
  const storeNames = (state?.storeNames ?? {}) as Record<string, string>;
  const profiles = state?.beneficiaryProfiles ?? {};
  const reviewStores = new Set(state?.readback.reviewStores ?? []);
  return <BthwaniSurface style={styles.card}>
    <Text style={styles.title}>مستلمو صرف المتاجر</Text>
    <Text style={styles.muted}>افتراضيًا يُصرف استحقاق كل متجر إلى مالكه. يمكن للمالك تسجيل موظف موثّق كمستلم لصرف متجر بعينه، وتظل جهة المحفظة الرسمية موثّقة من المالية.</Text>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {reviewStores.size > 0 ? <View style={styles.reviewBanner}><Text style={styles.reviewText}>متاجر تحتاج إجراء المالك قبل أي صرف: {Array.from(reviewStores).map((storeId) => storeNames[storeId] ?? "متجر").join("، ")}</Text></View> : null}
    {!state ? <BthwaniButton label="إعادة القراءة" onPress={() => void load()} variant="secondary" /> : null}
    {state && recipients.length === 0 ? <Text style={styles.muted}>لا توجد متاجر مرتبطة بحسابك بعد.</Text> : null}
    <View style={styles.list}>
      {(state?.readback.recipients ?? []).map((record) => <View key={record.storeId}>
        <View style={styles.row}>
          <View style={styles.rowCopy}>
            <Text style={styles.storeName}>{storeNames[record.storeId] ?? "متجر"}</Text>
            <Text style={[styles.muted, record.state === "RECIPIENT_REVIEW_REQUIRED" ? styles.attention : null]}>{recipientStateLabel(record, profiles, walletProviders)}</Text>
            <Text style={styles.muted}>مستحقات مسندة: {formatMoney(record.partnerNetMinor, "YER")} · {record.orderCount.toLocaleString("ar-YE")} طلب</Text>
          </View>
          <View style={styles.actions}>
            {record.state === "DEFAULT_OWNER" ? <BthwaniButton busy={busyStoreId === record.storeId} label="تعيين موظف" onPress={() => void openPicker(record.storeId)} variant="secondary" /> : <BthwaniButton busy={busyStoreId === record.storeId} label="إعادة إلى المالك" onPress={() => setConfirmation({ kind: "revert", storeId: record.storeId, storeName: storeNames[record.storeId] ?? "المتجر" })} variant="secondary" />}
          </View>
        </View>
        {pickerStoreId === record.storeId ? <View style={styles.picker}>
          {grants.length === 0 ? <Text style={styles.muted}>لا يوجد موظف نشط قابل للاختيار.</Text> : grants.map((grant) => {
            const ready = Boolean(grant.delegateBeneficiaryName && grant.delegateWalletProviderKey);
            const beneficiaryName = grant.delegateBeneficiaryName?.trim() || "عضو فريق";
            const phoneMasked = grant.delegatePhoneMasked?.trim() || "";
            const providerKey = grant.delegateWalletProviderKey?.trim() || "";
            const walletIdentifierMasked = grant.delegateWalletIdentifierMasked?.trim() || "";
            return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready }} disabled={!ready || Boolean(busyStoreId)} key={grant.id} onPress={() => setConfirmation({ kind: "select", storeId: record.storeId, grantId: grant.id, storeName: storeNames[record.storeId] ?? "المتجر", beneficiaryName, phoneMasked, providerKey, walletIdentifierMasked })} style={[styles.pickRow, !ready && styles.pickRowDisabled]}>
              <View style={styles.pickCopy}>
                <Text style={styles.pickText}>{[beneficiaryName, phoneMasked].filter(Boolean).join(" · ")}</Text>
                <Text style={styles.muted}>{ready ? `جهة المحفظة: ${providerLabel(providerKey, walletProviders)}${walletIdentifierMasked ? ` · ${walletIdentifierMasked}` : ""}` : "لا يمكن اختياره حتى تجهز جهة المحفظة الرسمية"}</Text>
              </View>
              <Text style={styles.muted}>{ready ? "مراجعة وتأكيد" : "غير جاهز"}</Text>
            </Pressable>;
          })}
        </View> : null}
      </View>)}
    </View>
    <BthwaniConfirmDialog
      busy={Boolean(confirmation && busyStoreId === confirmation.storeId)}
      confirmLabel={confirmation?.kind === "revert" ? "إعادة الصرف إلى المالك" : "تأكيد مستلم الصرف"}
      description={confirmation?.kind === "select"
        ? `سيتم توجيه الصرف المستقبلي لمتجر ${confirmation.storeName} إلى ${confirmation.beneficiaryName}${confirmation.phoneMasked ? ` · ${confirmation.phoneMasked}` : ""}. جهة المحفظة: ${providerLabel(confirmation.providerKey, walletProviders)}${confirmation.walletIdentifierMasked ? ` · ${confirmation.walletIdentifierMasked}` : ""}. هذا تغيير مالي ويطبق على الصرف المستقبلي للمتجر.`
        : confirmation?.kind === "revert"
          ? `سيعود الصرف المستقبلي لمتجر ${confirmation.storeName} إلى مالك المتجر بدل الموظف المسجّل حاليًا.`
          : ""}
      intent={confirmation?.kind === "revert" ? "danger" : "primary"}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => {
        if (confirmation?.kind === "select") void select(confirmation);
        else if (confirmation?.kind === "revert") void revert(confirmation);
      }}
      title={confirmation?.kind === "revert" ? "تأكيد إعادة مستلم الصرف" : "تأكيد مستلم الصرف"}
      visible={Boolean(confirmation)}
    />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    notice: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.warning },
    loading: { alignItems: "center", padding: spacing[3] },
    list: { gap: spacing[2] },
    row: { alignItems: "flex-start", borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", padding: spacing[3] },
    rowCopy: { flex: 1, gap: spacing[1] },
    storeName: { ...typography.titleSm, color: theme.color },
    actions: { alignItems: "flex-end" },
    picker: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], marginTop: spacing[2], padding: spacing[3] },
    pickRow: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", padding: spacing[3] },
    pickRowDisabled: { opacity: opacity.disabled },
    pickCopy: { flex: 1, gap: spacing[1] },
    pickText: { ...typography.bodySm, color: theme.color },
    reviewBanner: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, padding: spacing[3] },
    reviewText: { ...typography.bodySm, color: theme.color },
    attention: { color: theme.warning },
  });
}
