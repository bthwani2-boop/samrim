import { direction, elevation, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, BthwaniSectionHeader, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { logoutIdentity } from "../../bootstrap/identity";
import LocationCore from "../location-core/location-core";

export default function ClientAccount() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function logout() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await logoutIdentity();
    } catch {
      setNotice("تم تسجيل الخروج من هذا الجهاز، لكن تعذر تأكيد إبطال الجلسة على الخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="الحساب">
      <Text style={styles.eyebrow}>مساحتك</Text>
      <Text style={styles.title}>إدارة حسابك</Text>
      <Text style={styles.description}>كل ما تحتاجه لإدارة التوصيل، العناوين، ومظهر تطبيق بثواني.</Text>

      <BthwaniSurface tone="raised" style={styles.profileCard}>
        <View style={styles.profileIcon}><BthwaniIcon name="account" color={theme.onAction} size={sizing.iconXl} /></View>
        <View style={styles.profileCopy}><Text style={styles.profileTitle}>حساب العميل</Text><Text style={styles.profileStatus}>مسجل الدخول وجاهز للطلب</Text></View>
        <BthwaniIcon name="success" color={theme.success} size={sizing.iconLg} />
      </BthwaniSurface>

      <BthwaniSectionHeader title="التوصيل" subtitle="احفظ عناوينك لتسهيل الطلب القادم." />
      <LocationCore />

      <BthwaniSectionHeader title="تفضيلات التطبيق" subtitle="اختر المظهر الذي يناسبك." />
      <AppearancePicker title="مظهر التطبيق" helper="يُحفظ اختيارك على هذا الجهاز." />

      <BthwaniButton label={busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"} busy={busy} disabled={busy} onPress={() => void logout()} variant="secondary" />
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.background, direction: activeDirection, flexGrow: 1, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.hero, color: theme.color, textAlign: startTextAlign },
    description: { ...typography.body, color: theme.colorMuted, textAlign: startTextAlign },
    profileCard: { alignItems: "center", borderRadius: radius.xl, direction: activeDirection, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    profileIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    profileCopy: { direction: activeDirection, flex: 1, gap: spacing[1] },
    profileTitle: { ...typography.titleSm, color: theme.color, textAlign: startTextAlign },
    profileStatus: { ...typography.bodySm, color: theme.success, textAlign: startTextAlign },
    notice: { ...typography.bodySm, color: theme.warning, textAlign: startTextAlign },
  });
}
