import { elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, BthwaniNavigationRow, BthwaniSectionHeader, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { logoutIdentity } from "../../bootstrap/identity";
import { PARTNER_SURFACE_ORDER, type PartnerSurface, partnerSurfacePath } from "../../shell/partner-authority";
import { PartnerAccessInvitationsCard } from "../partner-onboarding/partner-access-invitations";
import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";

type WorkspaceSurface = Exclude<PartnerSurface, "account">;

const workspaceActions: Readonly<Record<WorkspaceSurface, Readonly<{ description: string; icon: "store" | "orders" | "wallet"; label: string; route: ReturnType<typeof partnerSurfacePath> }>>> = {
  store: { description: "حدّث بيانات المتجر وإعداده", icon: "store", label: "إدارة المتجر", route: "/store" },
  orders: { description: "راجع الطلبات وحالتها", icon: "orders", label: "طلبات المتجر", route: "/orders" },
  wallet: { description: "راجع الرصيد وطلبات التسوية", icon: "wallet", label: "محفظة الشريك", route: "/wallet" },
};

export default function PartnerAccount() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { authority } = usePartnerStoreScope();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const actions = PARTNER_SURFACE_ORDER.filter((surface): surface is WorkspaceSurface => surface !== "account" && authority.canUse(surface)).map((surface) => workspaceActions[surface]);

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
    <View style={styles.container} accessibilityLabel="حساب الشريك">
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>مساحة الشريك</Text>
        <Text style={styles.title}>إدارة حساب الشريك</Text>
        <Text style={styles.description}>إعدادات حسابك ومساحات عملك المتاحة في مكان واحد.</Text>
      </View>

      <BthwaniSurface tone="raised" style={styles.profileCard}>
        <View style={styles.profileIcon}>
          <BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconXl} />
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>حساب الشريك</Text>
          <Text style={styles.profileDescription}>افتح مساحات عملك المتاحة لإدارة مهامك اليومية.</Text>
        </View>
      </BthwaniSurface>

      {actions.length > 0 ? <>
        <BthwaniSectionHeader title="مساحات العمل" subtitle="افتح الخدمة التي تحتاجها مباشرة." />
        <View style={styles.actions}>
          {actions.map((action) => (
            <BthwaniNavigationRow key={action.label} description={action.description} icon={action.icon} title={action.label} onPress={() => router.push(action.route as Href)} />
          ))}
        </View>
      </> : null}

      <BthwaniSectionHeader title="دعوات الوصول" subtitle="الدعوات الموجهة إلى حسابك من مالكي المتاجر." />
      <PartnerAccessInvitationsCard />

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
        <AppearancePicker title="مظهر التطبيق" helper="يُطبَّق التغيير مباشرة على كل شاشات التطبيق." />
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
