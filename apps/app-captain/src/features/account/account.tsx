import { Button, Host } from "@expo/ui";
import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import { elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniIcon, BthwaniNavigationRow, BthwaniSectionHeader, BthwaniSurface, useMobileAppearance } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getUsableIdentityAccessToken, logoutIdentity } from "../../bootstrap/identity";
import { captainClient } from "../captain-operations/captain-client";
import { StoreCaptainMemberships } from "../captain-operations/store-memberships";
import { preferredCaptainProfileMembership } from "../captain-operations/captain-store-membership-policy";

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
  const { theme, themeName } = useMobileAppearance();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [profile, setProfile] = useState<Readonly<{ fullNameAr?: string | null; contactPhoneE164?: string | null; state: string }> | null>(null);
  const [profileState, setProfileState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const token = await getUsableIdentityAccessToken();
        const response = await captainClient().readOwnCaptainAdmission(token);
        if (current) { setProfile(response.admission); setProfileState("ready"); }
      } catch (cause) {
        // The Store owner may create a private Captain without admitting
        // them to the BThwani public dispatch pool.
        try {
          const token = await getUsableIdentityAccessToken();
          const memberships = await captainClient().listOwnStoreCaptainMemberships(token);
          const directed = preferredCaptainProfileMembership(memberships.memberships);
          if (directed) {
            if (current) {
              setProfile({ fullNameAr: directed.displayNameAr ?? null, state: directed.state === "active" ? "store_only" : "store_pending" });
              setProfileState("ready");
            }
            return;
          }
        } catch { /* Keep the original error state if both readbacks fail. */ }
        console.error("DSH Captain profile readback failed", cause);
        if (current) setProfileState("error");
      }
    })();
    return () => { current = false; };
  }, []);

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
          <Text style={styles.profileTitle}>{profile?.fullNameAr || "ملف الكابتن"}</Text>
          <Text style={styles.profileDescription}>{profileState === "loading" ? "جارٍ قراءة الملف…" : profileState === "error" ? "تعذر قراءة الملف الآن؛ أعد المحاولة لاحقًا." : profile?.state === "store_only" ? "حساب كابتن متجر نشط" : profile?.state === "store_pending" ? "بانتظار تفعيل عضوية المتجر" : profile?.contactPhoneE164 || "رقم الهاتف غير متاح"}</Text>
          {profileState === "ready" && profile ? <Text style={styles.profileDescription}>حالة الأهلية: {profile.state === "store_only" ? "عضوية متجر نشطة — دون توزيع بثواني العام" : profile.state === "store_pending" ? "عضوية متجر قيد الاعتماد — لا تستقبل المهام بعد" : profile.state === "eligible" ? "مؤهل لاستقبال المهام" : "قيد المراجعة"}</Text> : null}
        </View>
      </BthwaniSurface>

      <BthwaniSectionHeader title="مساحات العمل" subtitle="افتح الخدمة التي تحتاجها مباشرة." />
      <View style={styles.actions}>
        {actions.map((action) => (
          <BthwaniNavigationRow key={action.label} description={action.description} icon={action.icon} title={action.label} onPress={() => router.push(action.route)} />
        ))}
      </View>

      <StoreCaptainMemberships />

      <AppearancePicker compact title="المظهر" helper="" />

    <Pressable accessibilityRole="button" accessibilityLabel="نسخ معلومات إصدار التطبيق"
      onPress={() => void Clipboard.setStringAsync([
        "بثواني", Application.nativeApplicationVersion ?? "—",
        "build:" + (Application.nativeBuildVersion ?? "—"),
        Device.modelName ?? "جهاز غير معروف", Device.osVersion ?? "—",
      ].join(" · ")).then(() => setNotice("تم نسخ معلومات إصدار التطبيق")).catch(() => setNotice("تعذر نسخ معلومات التطبيق"))}
      style={{ paddingVertical: 7, alignItems: "center" }}>
      <Text style={{ color: theme.colorMuted, fontSize: 12 }}>
        {"إصدار التطبيق " + (Application.nativeApplicationVersion ?? "—") + " · نسخ معلومات الإصدار"}
      </Text>
    </Pressable>
      <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
        <Button disabled={busy} label={busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"} onPress={() => void logout()} testID="captain-account-logout" variant="outlined" />
      </Host>
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
    notice: { ...typography.bodySm, color: theme.warning },
  });
}
