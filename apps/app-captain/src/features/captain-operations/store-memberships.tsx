import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreCaptainMembership } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";

type MembershipState = { kind: "loading" } | { kind: "ready"; memberships: ReadonlyArray<StoreCaptainMembership> } | { kind: "error" };

export function StoreCaptainMemberships() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<MembershipState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [legacyCode, setLegacyCode] = useState("");

  const reload = useCallback(async (): Promise<ReadonlyArray<StoreCaptainMembership> | null> => {
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await captainClient().listOwnStoreCaptainMemberships(token);
      setState({ kind: "ready", memberships: result.memberships });
      return result.memberships;
    } catch {
      setState({ kind: "error" });
      setError("تعذر قراءة المتاجر المرتبطة بحسابك.");
      return null;
    }
  }, []);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  async function acceptMembership(membership: StoreCaptainMembership) {
    if (busy || membership.state !== "pending") return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().acceptTargetedStoreCaptainInvitation(token, membership.id);
      const latest = await reload();
      if (latest?.some((item) => item.id === membership.id && item.state === "active")) {
        setNotice("تم تفعيل عضويتك في " + membership.storeName + ".");
      } else {
        setError("لم يتأكد قبول العضوية. حاول إعادة فتح الصفحة.");
      }
    } catch {
      await reload();
      setError("تعذر تأكيد قبول العضوية. راجع الدعوة ثم حاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptLegacyCode() {
    if (busy || !legacyCode.trim()) return;
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().acceptOwnStoreCaptainInvitation(token, legacyCode.trim());
      setLegacyCode("");
      setLegacyOpen(false);
      setNotice("تم قبول الدعوة.");
      await reload();
    } catch {
      await reload();
      setError("تعذر قبول الرمز. تحقق من صلاحيته.");
    } finally {
      setBusy(false);
    }
  }

  return <BthwaniSurface tone="base" style={styles.card}>
    <Text style={styles.title}>متاجر التوصيل</Text>
    {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.interactiveText} /><Text style={styles.description}>جارٍ التحميل…</Text></View> : null}
    {state.kind === "error" ? <BthwaniButton label="إعادة المحاولة" onPress={() => void reload()} variant="secondary" /> : null}
    {state.kind === "ready" && state.memberships.length === 0 ? <Text style={styles.description}>لا توجد متاجر مرتبطة بحسابك.</Text> : null}
    {state.kind === "ready" ? state.memberships.map((membership) => {
      const stateLabel = membership.state === "active" ? "نشط" : membership.state === "pending" ? "بانتظار قبولك" : membership.state === "suspended" ? "موقوف" : membership.state === "expired" ? "منتهي" : "ملغى";
      return <View key={membership.id} style={styles.membership}>
        <Text style={styles.title}>{membership.storeName}</Text>
        <Text style={styles.description}>{membership.displayNameAr ? membership.displayNameAr + " · " : ""}{stateLabel}</Text>
        {membership.state === "pending" ? <BthwaniButton disabled={busy} busy={busy} label="قبول الانضمام" onPress={() => void acceptMembership(membership)} /> : null}
      </View>;
    }) : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <BthwaniButton label={legacyOpen ? "إخفاء الرمز القديم" : "لدي دعوة قديمة برمز"} variant="quiet" onPress={() => setLegacyOpen((value) => !value)} disabled={busy} />
    {legacyOpen ? <>
      <TextInput accessibilityLabel="رمز الدعوة القديمة" editable={!busy} placeholder="رمز الدعوة" placeholderTextColor={theme.colorMuted} onChangeText={setLegacyCode} value={legacyCode} style={styles.input} />
      <BthwaniButton label="قبول الرمز" busy={busy} disabled={busy || !legacyCode.trim()} onPress={() => void acceptLegacyCode()} />
    </> : null}
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    title: { ...typography.bodyStrong, color: theme.color },
    description: { ...typography.bodySm, color: theme.colorMuted },
    input: { ...typography.body, backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 52, paddingHorizontal: spacing[3] },
    state: { alignItems: "center", flexDirection: "row", gap: spacing[2], padding: spacing[3] },
    membership: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    success: { ...typography.bodySm, color: theme.actionBackground },
    error: { ...typography.bodySm, color: theme.danger },
  });
}
