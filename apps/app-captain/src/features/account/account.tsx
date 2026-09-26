import { elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, BthwaniNavigationRow, BthwaniSectionHeader, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { logoutIdentity } from "../../bootstrap/identity";
import { StoreCaptainMemberships } from "../captain-operations/store-memberships";

const actions: ReadonlyArray<Readonly<{
  description: string;
  icon: "offers" | "deliveries" | "wallet";
  label: string;
  route: Href;
}>> = [
  { description: "استعرض العروض المتاحة", icon: "offers", label: "عروض التوصيل", route: "/offers" },
  { description: "تابع المهام المسندة إليك", icon: "deliveries", label: "توصيلاتي", route: "/deliveries" },
  { description: "راجع مستحقاتك وطلبات التسوية", icon: "wallet", label: "محفظة الكابتن", route: "/wallet" as Href },
];

export default function CaptainAccount() {
  const router = useRouter();
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
    <View style={styles.container} accessibilityLabel="حساب الكابتن">
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>مساحة الكابتن</Text>
        <Text style={styles.title}>إدارة حساب الكابتن</Text>
        <Text style={styles.description}>إعدادات الحساب وروابط التوصيل والمستحقات.</Text>
      </View>

      <BthwaniSurface tone="raised" style={styles.profileCard}>
        <View style={styles.profileIcon}>
          <BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} />
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>حساب الكابتن</Text>
          <Text style={styles.profileDescription}>تابع ارتباطات المتاجر والعروض والتوصيلات من هنا.</Text>
        </View>
      </BthwaniSurface>

      <BthwaniSectionHeader title="مساحات العمل" subtitle="افتح الخدمة التي تحتاجها مباشرة." />
      <View style={styles.actions}>
        {actions.map((action) => (
          <BthwaniNavigationRow key={action.label} description={action.description} icon={action.icon} title={action.label} onPress={() => router.push(action.route)} />
        ))}
      </View>

      <StoreCaptainMemberships />

      <BthwaniSectionHeader title="مظهر التطبيق" subtitle="غيّر المظهر في أي وقت؛ ويُحفظ اختيارك على هذا الجهاز." />
      <BthwaniSurface tone="raised" style={styles.appearancePanel}>
        <View style={styles.appearanceHeading}>
          <View style={styles.appearanceIcon}>
            <BthwaniIcon name="appearance" color={theme.interactiveText} size={sizing.iconLg} />
          </View>
          <View style={styles.appearanceCopy}>
            <Text style={styles.appearanceTitle}>اختيار النسق</Text>
            <Text style={styles.appearanceHelper}>فاتح، داكن، أو حسب إعدادات النظام.</Text>
          </View>
        </View>
        <AppearancePicker title="مظهر التطبيق" helper="يُطبَّق التغيير مباشرة على كل شاشات التطبيق." />
      </BthwaniSurface>

      <BthwaniButton busy={busy} disabled={busy} label={busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"} onPress={() => void logout()} variant="secondary" />
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { flexGrow: 1, gap: spacing[4], paddingTop: spacing[5], width: "100%" },
    heading: { gap: spacing[1] },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.hero, color: theme.color },
    description: { ...typography.body, color: theme.colorMuted },
    profileCard: { alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    profileIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    profileCopy: { flex: 1, gap: spacing[1], minWidth: 0 },
    profileTitle: { ...typography.titleSm, color: theme.color },
    profileDescription: { ...typography.bodySm, color: theme.colorMuted },
    actions: { gap: spacing[2] },
    appearancePanel: { borderRadius: radius.xl, gap: spacing[3], padding: spacing[4], ...elevation.raised },
    appearanceHeading: { alignItems: "center", flexDirection: "row", gap: spacing[3] },
    appearanceIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarMd, justifyContent: "center", width: sizing.avatarMd },
    appearanceCopy: { flex: 1, gap: spacing[1] },
    appearanceTitle: { ...typography.titleSm, color: theme.color },
    appearanceHelper: { ...typography.bodySm, color: theme.colorMuted },
    notice: { ...typography.bodySm, color: theme.warning },
  });
}
