import { elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, BthwaniNavigationRow, BthwaniSectionHeader, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { fieldAdmissionStateLabel } from "@bthwani/dsh";
import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { logoutIdentity } from "../../bootstrap/identity";
import { useOwnFieldAdmission } from "../field-operations/use-field-admission";

const actions: ReadonlyArray<Readonly<{
  description: string;
  icon: "cases" | "store" | "wallet";
  label: string;
  route: Href;
}>> = [
  { description: "تابع الملفات التي قدمتها", icon: "cases", label: "ملفات الانضمام", route: "/cases" },
  { description: "أنشئ ملف انضمام لمتجر جديد", icon: "store", label: "طلب انضمام متجر", route: "/new-case" },
  { description: "راجع مكافآت الميدان", icon: "wallet", label: "محفظة الميداني", route: "/wallet" as Href },
];

type OwnAdmissionState = ReturnType<typeof useOwnFieldAdmission>["state"];

function profileDescription(state: OwnAdmissionState, phone?: string | null): string {
  if (state.kind === "loading") return "جارٍ قراءة الملف…";
  if (state.kind === "missing") return "لا يوجد سجل أهلية ميدانية لهذا الحساب في DSH. تواصل مع المشغّل لإكمال إجراءات التسجيل.";
  if (state.kind === "error") return "تعذر قراءة الملف الآن؛ أعد المحاولة عند توفر الاتصال.";
  return phone || "رقم الهاتف غير متاح";
}

export default function FieldAccount() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const { state: profileState, refresh: refreshProfile } = useOwnFieldAdmission();
  const profile = profileState.kind === "ready" ? profileState.admission : null;

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
    <View style={styles.container} accessibilityLabel="حساب الميدان">
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>مساحة الميدان</Text>
        <Text style={styles.title}>إدارة حساب الميداني</Text>
        <Text style={styles.description}>إعدادات الحساب وروابط ملفات الانضمام ومكافآت الميدان.</Text>
      </View>

      <BthwaniSurface tone="raised" style={styles.profileCard}>
        <View style={styles.profileIcon}>
          <BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} />
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>{profile?.fullNameAr || "ملف الميداني"}</Text>
          <Text style={styles.profileDescription}>{profileDescription(profileState, profile?.contactPhoneE164)}</Text>
          {profileState.kind === "ready" && profile ? <Text style={styles.profileDescription}>حالة الأهلية: {fieldAdmissionStateLabel(profile.state)}</Text> : null}
        </View>
      </BthwaniSurface>
      {profileState.kind === "missing" || profileState.kind === "error" ? <BthwaniButton label="تحديث حالة الأهلية" onPress={() => void refreshProfile()} variant="secondary" /> : null}

      <BthwaniSectionHeader title="مساحات العمل" subtitle="افتح الخدمة التي تحتاجها مباشرة." />
      <View style={styles.actions}>
        {actions.map((action) => (
          <BthwaniNavigationRow key={action.label} description={action.description} icon={action.icon} title={action.label} onPress={() => router.push(action.route)} />
        ))}
      </View>

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
