import { borders, radius, resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type StoreAccessGrant, type StorePayoutRecipientListResponse, type StorePayoutRecipientRecord } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function recipientStateLabel(record: StorePayoutRecipientRecord, phones: Record<string, string>): string {
  switch (record.state) {
    case "SELECTED_VERIFIED_STAFF":
      return `المستلم المسجّل: ${phones[record.beneficiaryActorId ?? ""] ?? "عضو فريق"}`;
    case "RECIPIENT_REVIEW_REQUIRED":
      return "بانتظار إجراء المالك: المستلم المسجّل لم يعد مؤهلاً";
    default:
      return "المالك (الافتراضي)";
  }
}

export function StorePayoutRecipientsCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<StorePayoutRecipientListResponse | null>(null);
  const [busyStoreId, setBusyStoreId] = useState("");
  const [pickerStoreId, setPickerStoreId] = useState("");
  const [grants, setGrants] = useState<StoreAccessGrant[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  const select = async (storeId: string, grantId: string) => {
    setBusyStoreId(storeId); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().selectPartnerStorePayoutRecipient(token, storeId, { grantId, reason: "اختيار مستلم صرف المتجر من قِبل المالك" }, `recipient_select_${Crypto.randomUUID()}`, `recipient_select_corr_${Crypto.randomUUID()}`);
      setNotice("سُجّل مستلم الصرف وفق الحالة المعتمدة في المحفظة.");
      setPickerStoreId("");
      await load();
    } catch (cause) {
      console.error("DSH payout recipient select failed", cause);
      setError("تعذر تسجيل المستلم؛ تحقق من جهة المحفظة الرسمية للموظف ثم أعد المحاولة.");
    } finally { setBusyStoreId(""); }
  };

  const revert = async (storeId: string) => {
    setBusyStoreId(storeId); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().revertPartnerStorePayoutRecipient(token, storeId, { reason: "إعادة مستلم الصرف إلى مالك المتجر" }, `recipient_revert_${Crypto.randomUUID()}`, `recipient_revert_corr_${Crypto.randomUUID()}`);
      setNotice("أُعيد مستلم الصرف إلى المالك.");
      setPickerStoreId("");
      await load();
    } catch (cause) {
      console.error("DSH payout recipient revert failed", cause);
      setError("تعذر إعادة مستلم الصرف؛ أعد المحاولة.");
    } finally { setBusyStoreId(""); }
  };

  if (!authenticated) return null;
  if (!state && !error) {
    return <BthwaniSurface style={styles.card}><View style={styles.loading}><ActivityIndicator accessibilityLabel="جارٍ قراءة مستلمي الصرف" color={theme.interactiveText} /></View></BthwaniSurface>;
  }
  const recipients = state?.readback.recipients ?? [];
  const storeNames = (state?.storeNames ?? {}) as Record<string, string>;
  const phones = (state?.beneficiaryPhones ?? {}) as Record<string, string>;
  const reviewStores = new Set(state?.readback.reviewStores ?? []);
  return <BthwaniSurface style={styles.card}>
    <Text style={styles.title}>مستلمو صرف المتاجر</Text>
    <Text style={styles.muted}>افتراضيًا يُصرف استحقاق كل متجر إلى مالكه. يمكن للمالك تسجيل موظف موثّق كمستلم لصرف متجر بعينه، وتظل جهة المحفظة الرسمية موثّقة من المالية.</Text>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {reviewStores.size > 0 ? <View style={styles.reviewBanner}><Text style={styles.reviewText}>متاجر تحتاج إجراء المالك قبل أي صرف: {Array.from(reviewStores).map((storeId) => storeNames[storeId] ?? storeId).join("، ")}</Text></View> : null}
    {!state ? <BthwaniButton label="إعادة القراءة" onPress={() => void load()} variant="secondary" /> : null}
    {state && recipients.length === 0 ? <Text style={styles.muted}>لا توجد متاجر مرتبطة بحسابك بعد.</Text> : null}
    <View style={styles.list}>
      {(state?.readback.recipients ?? []).map((record) => <View key={record.storeId}>
        <View style={styles.row}>
          <View style={styles.rowCopy}>
            <Text style={styles.storeName}>{storeNames[record.storeId] ?? record.storeId}</Text>
            <Text style={[styles.muted, record.state === "RECIPIENT_REVIEW_REQUIRED" ? styles.attention : null]}>{recipientStateLabel(record, phones)}</Text>
            <Text style={styles.muted}>مستحقات مسندة: {formatMoney(record.partnerNetMinor, "YER")} · {record.orderCount.toLocaleString("ar-YE")} طلب</Text>
          </View>
          <View style={styles.actions}>
            {record.state === "DEFAULT_OWNER" ? <BthwaniButton busy={busyStoreId === record.storeId} label="تعيين موظف" onPress={() => void openPicker(record.storeId)} variant="secondary" /> : <BthwaniButton busy={busyStoreId === record.storeId} label="إعادة إلى المالك" onPress={() => void revert(record.storeId)} variant="secondary" />}
          </View>
        </View>
        {pickerStoreId === record.storeId ? <View style={styles.picker}>
          {grants.length === 0 ? <Text style={styles.muted}>لا يوجد موظف نشط قابل للاختيار.</Text> : grants.map((grant) => <Pressable accessibilityRole="button" key={grant.id} onPress={() => void select(record.storeId, grant.id)} style={styles.pickRow}>
            <Text style={styles.pickText}>{grant.delegatePhoneMasked ?? "عضو فريق"}</Text>
            <Text style={styles.muted}>اختيار كمستلم</Text>
          </Pressable>)}
        </View> : null}
      </View>)}
    </View>
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
    pickRow: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", padding: spacing[3] },
    pickText: { ...typography.bodySm, color: theme.color },
    reviewBanner: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, padding: spacing[3] },
    reviewText: { ...typography.bodySm, color: theme.color },
    attention: { color: theme.warning },
  });
}
