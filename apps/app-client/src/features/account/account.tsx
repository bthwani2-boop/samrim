import { elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, BthwaniSectionHeader, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { currentIdentityState, logoutIdentity } from "../../bootstrap/identity";
import LocationCore from "../location-core/location-core";
import { NotificationsInbox } from "../notifications/notifications-inbox";

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

      <NotificationsInbox />

      <BthwaniSectionHeader title="مظهر التطبيق" subtitle="غيّر المظهر في أي وقت؛ ويُحفظ اختيارك على هذا الجهاز." />
      <BthwaniSurface tone="raised" style={styles.appearancePanel}>
        <View style={styles.appearanceHeading}>
          <View style={styles.appearanceIcon}><BthwaniIcon name="appearance" color={theme.interactiveText} size={sizing.iconLg} /></View>
          <View style={styles.appearanceCopy}><Text style={styles.appearanceTitle}>اختيار النسق</Text><Text style={styles.appearanceHelper}>فاتح، داكن، أو حسب إعدادات النظام.</Text></View>
        </View>
        <AppearancePicker title="مظهر التطبيق" helper="يُطبَّق التغيير مباشرة على كل شاشات التطبيق." />
      </BthwaniSurface>

      <BthwaniSectionHeader title="التوصيل" subtitle="احفظ عناوينك لتسهيل الطلب القادم." />
      {isAuthenticated ? <LocationCore /> : <BthwaniSurface tone="inset" style={styles.guestAccess}><BthwaniIcon name="location" color={theme.interactiveText} size={sizing.iconLg} /><Text style={styles.guestText}>سجّل الدخول لإدارة عناوين التوصيل وإتمام الطلبات.</Text><BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/account" as Href)} /></BthwaniSurface>}

      <BthwaniButton label={busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"} busy={busy} disabled={busy} onPress={() => void logout()} variant="secondary" />
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, flexGrow: 1, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.hero, color: theme.color },
    description: { ...typography.body, color: theme.colorMuted },
    guestAccess: { alignItems: "center", borderRadius: radius.lg, gap: spacing[3], padding: spacing[4] },
    guestText: { ...typography.bodySm, color: theme.colorMuted, textAlign: "center" },
    appearancePanel: { borderRadius: radius.xl, gap: spacing[3], padding: spacing[4], ...elevation.raised },
    appearanceHeading: { alignItems: "center", flexDirection: "row", gap: spacing[3] },
    appearanceIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarMd, justifyContent: "center", width: sizing.avatarMd },
    appearanceCopy: { flex: 1, gap: spacing[1] },
    appearanceTitle: { ...typography.titleSm, color: theme.color },
    appearanceHelper: { ...typography.bodySm, color: theme.colorMuted },
    notice: { ...typography.bodySm, color: theme.warning },
  });
}
