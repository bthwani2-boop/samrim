import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreCaptainMembership } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";

type MembershipState = { kind: "loading" } | { kind: "ready"; memberships: ReadonlyArray<StoreCaptainMembership> } | { kind: "error" };

export function StoreCaptainMemberships() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<MembershipState>({ kind: "loading" });
  const [invitationCode, setInvitationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await captainClient().listOwnStoreCaptainMemberships(token);
      setState({ kind: "ready", memberships: result.memberships });
      setError("");
    } catch {
      setState({ kind: "error" });
      setError("تعذر قراءة عضويات المتاجر من المنصة.");
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function acceptInvitation() {
    const code = invitationCode.trim();
    if (busy || !code) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await captainClient().acceptOwnStoreCaptainInvitation(token, code);
      setInvitationCode("");
      setNotice(`تم ربط حسابك بمتجر ${result.membership.storeName}.`);
      await reload();
    } catch {
      await reload();
      setError("تعذر قبول الدعوة. تحقق من الرمز وصلاحيته، ثم أعد قراءة العضويات.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BthwaniSurface tone="base" style={styles.card}>
      <Text style={styles.title}>عضويات المتاجر</Text>
      <Text style={styles.description}>تظهر هنا المتاجر التي ربطت حساب الكابتن بها. العضوية وحدها لا تكلفك بطلب؛ يرسل المتجر عرضًا لمهمة محددة، وتبدأ بعد قبولك. لا تغيّر العضوية أهليتك في إسناد بثواني.</Text>
      <TextInput
        accessibilityLabel="رمز دعوة المتجر"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(value) => { setInvitationCode(value); setError(""); }}
        placeholder="أدخل رمز دعوة المتجر"
        placeholderTextColor={theme.colorMuted}
        style={styles.input}
        textAlign="center"
        textContentType="oneTimeCode"
      />
      <BthwaniButton busy={busy} disabled={busy || invitationCode.trim().length === 0} label="قبول دعوة المتجر" onPress={() => void acceptInvitation()} />
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.description}>جارٍ قراءة العضويات…</Text></View> : null}
      {state.kind === "error" ? <BthwaniButton disabled={busy} label="إعادة قراءة العضويات" onPress={() => void reload()} variant="secondary" /> : null}
      {state.kind === "ready" && state.memberships.length === 0 ? <Text style={styles.description}>لا توجد عضويات مرتبطة بحسابك.</Text> : null}
      {state.kind === "ready" ? state.memberships.map((membership) => {
        const label = membership.state === "active" ? "مفعّلة" : membership.state === "suspended" ? "موقوفة" : membership.state === "revoked" ? "ملغاة" : membership.state === "expired" ? "انتهت الدعوة" : "بانتظار القبول";
        return <View key={membership.id} style={styles.membership}>
          <Text style={styles.title}>{membership.storeName}</Text>
          <Text style={styles.description}>حالة العضوية: {label}</Text>
        </View>;
      }) : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton disabled={busy} label="تحديث العضويات" onPress={() => void reload()} variant="secondary" />
    </BthwaniSurface>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    title: { ...typography.bodyStrong, color: theme.color },
    description: { ...typography.bodySm, color: theme.colorMuted },
    input: { ...typography.body, backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 52, paddingHorizontal: spacing[3] },
    state: { alignItems: "center", gap: spacing[2], padding: spacing[3] },
    membership: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    success: { ...typography.bodySm, color: theme.actionBackground },
    error: { ...typography.bodySm, color: theme.danger },
  });
}
