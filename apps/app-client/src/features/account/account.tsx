import { direction, elevation, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, BthwaniSectionHeader, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { currentIdentityState, logoutIdentity } from "../../bootstrap/identity";
import LocationCore from "../location-core/location-core";

export default function ClientAccount() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isAuthenticated = currentIdentityState().kind === "authenticated";
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
        <View style={styles.profileCopy}><Text style={styles.profileTitle}>حساب العميل</Text><Text style={[styles.profileStatus, !isAuthenticated && styles.profileStatusGuest]}>{isAuthenticated ? "مسجل الدخول وجاهز للطلب" : "تصفّح كمستخدم ضيف"}</Text></View>
        <BthwaniIcon name={isAuthenticated ? "success" : "account"} color={isAuthenticated ? theme.success : theme.interactiveText} size={sizing.iconLg} />
      </BthwaniSurface>

      <BthwaniSectionHeader title="التوصيل" subtitle="احفظ عناوينك لتسهيل الطلب القادم." />
      {isAuthenticated ? <LocationCore /> : <BthwaniSurface tone="inset" style={styles.guestAccess}><BthwaniIcon name="location" color={theme.interactiveText} size={sizing.iconLg} /><Text style={styles.guestText}>سجّل الدخول لإدارة عناوين التوصيل وإتمام الطلبات.</Text><BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/account" as Href)} /></BthwaniSurface>}

      <BthwaniSectionHeader title="مظهر التطبيق" subtitle="غيّر المظهر في أي وقت؛ ويُحفظ اختيارك على هذا الجهاز." />
      <BthwaniSurface tone="raised" style={styles.appearancePanel}>
        <View style={styles.appearanceHeading}>
          <View style={styles.appearanceIcon}><BthwaniIcon name="appearance" color={theme.interactiveText} size={sizing.iconLg} /></View>
          <View style={styles.appearanceCopy}><Text style={styles.appearanceTitle}>اختيار النسق</Text><Text style={styles.appearanceHelper}>فاتح، داكن، أو حسب إعدادات النظام.</Text></View>
        </View>
        <AppearancePicker title="مظهر التطبيق" helper="يُطبَّق التغيير مباشرة على كل شاشات التطبيق." />
      </BthwaniSurface>

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
    profileStatusGuest: { color: theme.colorMuted },
    guestAccess: { alignItems: "center", borderRadius: radius.lg, gap: spacing[3], padding: spacing[4] },
    guestText: { ...typography.bodySm, color: theme.colorMuted, textAlign: "center" },
    appearancePanel: { borderRadius: radius.xl, gap: spacing[3], padding: spacing[4], ...elevation.raised },
    appearanceHeading: { alignItems: "center", direction: activeDirection, flexDirection: "row", gap: spacing[3] },
    appearanceIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarMd, justifyContent: "center", width: sizing.avatarMd },
    appearanceCopy: { direction: activeDirection, flex: 1, gap: spacing[1] },
    appearanceTitle: { ...typography.titleSm, color: theme.color, textAlign: startTextAlign },
    appearanceHelper: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    notice: { ...typography.bodySm, color: theme.warning, textAlign: startTextAlign },
  });
}
