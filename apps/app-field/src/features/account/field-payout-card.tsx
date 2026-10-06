import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type BeneficiaryPayoutState } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "../field-operations/field-client";

type PayoutAttempt = Readonly<{ mode: "FULL_AVAILABLE" | "SPECIFIED"; amountMinor?: number; idempotencyKey: string; correlationID: string }>;

export function FieldPayoutCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<BeneficiaryPayoutState | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(authenticated);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PayoutAttempt | null>(null);
  const [confirmMode, setConfirmMode] = useState<"FULL_AVAILABLE" | "SPECIFIED" | null>(null);
  const load = useCallback(async () => {
    if (!authenticated) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const actor = currentIdentityState();
      if (actor.kind === "authenticated") {
        const raw = await SecureStore.getItemAsync(`bthwani.field.payout.pending.v1.${encodeURIComponent(actor.identity.subject)}`);
        if (raw) setPendingAttempt(JSON.parse(raw) as PayoutAttempt);
      }
      setState((await fieldClient().readOwnPayoutState(token)).state);
    } catch (cause) {
      console.warn("DSH field payout state readback failed", cause);
      setError("تعذر قراءة حالة طلب التسوية.");
    } finally { setBusy(false); }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);
  const request = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    if (pendingAttempt) mode = pendingAttempt.mode;
    const normalizedAmount = toAsciiDigits(amount.trim()).replace(/\D/g, "");
    const parsed = pendingAttempt?.amountMinor ?? (mode === "SPECIFIED" ? Number(normalizedAmount) : undefined);
    if (!pendingAttempt && mode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0 || (state && (parsed ?? 0) > state.eligibleAvailableMinor)) {
      setError(state && (parsed ?? 0) > state.eligibleAvailableMinor ? "المبلغ المحدد يتجاوز المتاح للتسوية." : "أدخل مبلغ تسوية صحيحًا أكبر من صفر.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const actor = currentIdentityState();
      if (actor.kind !== "authenticated" || !actor.identity.subject.trim()) throw new Error("FIELD_SESSION_REQUIRED");
      const storageKey = `bthwani.field.payout.pending.v1.${encodeURIComponent(actor.identity.subject)}`;
      const attempt = pendingAttempt ?? { mode, ...(parsed === undefined ? {} : { amountMinor: parsed }), idempotencyKey: `field_payout_${Crypto.randomUUID()}`, correlationID: `field_payout_corr_${Crypto.randomUUID()}` };
      await SecureStore.setItemAsync(storageKey, JSON.stringify(attempt));
      setPendingAttempt(attempt);
      const created = await fieldClient().createOwnPayoutIntent(token, mode, parsed, attempt.idempotencyKey, attempt.correlationID);
      const canonical = (await fieldClient().readOwnPayoutState(token)).state;
      if (!canonical.latestPayout ||
        canonical.latestPayout.id !== created.payout.id ||
        canonical.latestPayout.actorType !== "field" ||
        canonical.latestPayout.resolvedAmountMinor !== created.payout.resolvedAmountMinor ||
        canonical.latestPayout.status !== created.payout.status) {
        throw new Error("FIELD_PAYOUT_CANONICAL_READBACK_MISMATCH");
      }
      setState(canonical);
      await SecureStore.deleteItemAsync(storageKey);
      setPendingAttempt(null);
      setNotice(`تم تسجيل طلب التسوية وتأكيد حجز ${formatMoney(created.payout.resolvedAmountMinor, created.payout.currency)} من القراءة المعتمدة.`);
      setAmount("");
    } catch (cause) {
      console.warn("DSH field payout intent failed", cause);
      setError(pendingAttempt ? "لم نتأكد من نتيجة الطلب؛ أعد المحاولة بالمفتاح المحفوظ لمنع تكرار الحجز." : "تعذر تسجيل طلب التسوية. تأكد من توفر وجهة محفظة رسمية معتمدة ورصيد مستحق.");
    } finally {
      setBusy(false);
    }
  };
  const destinationReady = state?.destination?.status === "ACTIVE_FOR_PAYOUT" && state.destination.verificationStatus === "VERIFIED";
  let payoutActions: ReactNode = null;
  if (pendingAttempt) {
    payoutActions = <><Text style={styles.muted}>هناك طلب سابق لم تُحسم حالته بعد. تحقّق منه قبل طلب تسوية أخرى.</Text><BthwaniButton busy={busy} label="التحقق من الطلب المحفوظ" onPress={() => void request(pendingAttempt.mode)} /></>;
  } else if (destinationReady && state && state.eligibleAvailableMinor > 0) {
    payoutActions = <><BthwaniButton busy={busy} label="طلب تسوية كامل المتاح" onPress={() => setConfirmMode("FULL_AVAILABLE")} variant="secondary" /><TextInput accessibilityLabel="مبلغ تسوية الميداني المحدد بالريال اليمني" keyboardType="number-pad" value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/\D/g, ""))} placeholder="المبلغ بالريال اليمني" placeholderTextColor={theme.colorMuted} style={styles.input} /><BthwaniButton busy={busy} disabled={!specifiedAmountReady} label="طلب المبلغ المحدد" onPress={() => setConfirmMode("SPECIFIED")} variant="secondary" /></>;
  }
  const parsedConfirmAmount = Number(toAsciiDigits(amount.trim()).replace(/\D/g, ""));
  const confirmAmount = confirmMode === "FULL_AVAILABLE" ? state?.eligibleAvailableMinor ?? 0 : Number.isSafeInteger(parsedConfirmAmount) ? parsedConfirmAmount : 0;
  const specifiedAmountReady = Number.isSafeInteger(parsedConfirmAmount) && parsedConfirmAmount > 0 && Boolean(state) && parsedConfirmAmount <= (state?.eligibleAvailableMinor ?? 0);
  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="طلب تسوية الميداني"><Text style={styles.eyebrow}>التسوية المالية</Text><Text style={styles.title}>تسوية مستحقات الميداني</Text>{busy && !state ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة حالة التسوية…</Text></View> : null}{state ? <><Text style={styles.muted}>{destinationReady ? `الوجهة المعتمدة: ${state.destination?.walletIdentifierMasked}` : "لا توجد وجهة محفظة رسمية معتمدة بعد؛ تتم إدارتها من لوحة التحكم."}</Text><View style={styles.metrics}><Text style={styles.metric}>المتاح للتسوية: {formatMoney(state.eligibleAvailableMinor, state.currency)}</Text><Text style={styles.metric}>المحجوز: {formatMoney(state.heldMinor, state.currency)}</Text></View>{payoutActions}</> : null}{notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{authenticated ? <BthwaniButton busy={busy} label="تحديث حالة التسوية" onPress={() => void load()} variant="secondary" /> : null}<BthwaniConfirmDialog busy={busy} confirmLabel="تأكيد طلب التسوية" description={confirmMode && state ? `سيُنشأ طلب تسوية بمبلغ ${formatMoney(confirmAmount, state.currency)} إلى وجهة المحفظة الرسمية المعتمدة، وسيُحجز المبلغ للمراجعة.` : ""} onCancel={() => setConfirmMode(null)} onConfirm={() => { const mode = confirmMode; setConfirmMode(null); if (mode) void request(mode); }} title="مراجعة طلب التسوية" visible={Boolean(confirmMode)} /></BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.titleSm, color: theme.color }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, metrics: { gap: spacing[1] }, metric: { ...typography.bodySm, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning } }); }
