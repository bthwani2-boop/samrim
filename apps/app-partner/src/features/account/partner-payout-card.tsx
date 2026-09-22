import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type BeneficiaryPayoutState } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

export function PartnerPayoutCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<BeneficiaryPayoutState | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(authenticated);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (!authenticated) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      setState((await client().readOwnPayoutState(token)).state);
    } catch (cause) {
      console.error("DSH partner payout state readback failed", cause);
      setError("تعذر قراءة حالة طلب التسوية.");
    } finally { setBusy(false); }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);
  const request = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    const normalizedAmount = toAsciiDigits(amount.trim()).replace(/[^0-9]/g, "");
    const parsed = mode === "SPECIFIED" ? Number(normalizedAmount) : undefined;
    if (mode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0)) {
      setError("أدخل مبلغ تسوية صحيحًا أكبر من صفر.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().createOwnPayoutIntent(token, mode, parsed);
      setNotice("تم تسجيل طلب التسوية ووضع المبلغ في الحجز للمراجعة.");
      setAmount("");
      await load();
    } catch (cause) {
      console.error("DSH partner payout intent failed", cause);
      setError("تعذر تسجيل طلب التسوية. تأكد من توفر وجهة محفظة رسمية معتمدة ورصيد مستحق.");
      setBusy(false);
    }
  };
  const destinationReady = state?.destination?.status === "ACTIVE_FOR_PAYOUT" && state.destination.verificationStatus === "VERIFIED";
  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="طلب تسوية الشريك"><Text style={styles.eyebrow}>التسوية المالية</Text><Text style={styles.title}>التسوية إلى المحفظة الرسمية</Text>{busy && !state ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة حالة التسوية…</Text></View> : null}{state ? <><Text style={styles.muted}>{destinationReady ? `الوجهة المعتمدة: ${state.destination?.walletIdentifierMasked}` : "لا توجد وجهة محفظة رسمية معتمدة بعد؛ تتم إدارتها من لوحة التحكم."}</Text><View style={styles.metrics}><Text style={styles.metric}>المتاح للتسوية: {formatMoney(state.eligibleAvailableMinor, state.currency)}</Text><Text style={styles.metric}>المحجوز: {formatMoney(state.heldMinor, state.currency)}</Text></View>{destinationReady && state.eligibleAvailableMinor > 0 ? <><BthwaniButton busy={busy} label="طلب تسوية كامل المتاح" onPress={() => void request("FULL_AVAILABLE")} variant="secondary" /><TextInput accessibilityLabel="مبلغ التسوية المحدد" keyboardType="number-pad" value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))} placeholder="مبلغ محدد عند الحاجة" placeholderTextColor={theme.colorMuted} style={styles.input} /><BthwaniButton busy={busy} label="طلب المبلغ المحدد" onPress={() => void request("SPECIFIED")} variant="secondary" /></> : null}</> : null}{notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{authenticated ? <BthwaniButton busy={busy} label="تحديث حالة التسوية" onPress={() => void load()} variant="secondary" /> : null}</BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.titleSm, color: theme.color }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, metrics: { gap: spacing[1] }, metric: { ...typography.bodySm, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning } }); }
