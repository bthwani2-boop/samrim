import { elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, BthwaniNavigationRow, BthwaniSectionHeader, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { currentIdentityState, logoutIdentity, subscribeIdentitySession } from "../../bootstrap/identity";
import { useServiceCityScope } from "../service-city/service-city-scope";

export default function ClientAccount() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { cities, clearSelectedCity, selectedCityID } = useServiceCityScope();
  const [isAuthenticated, setIsAuthenticated] = useState(() => currentIdentityState().kind === "authenticated");

  useEffect(() => {
    const unsubscribe = subscribeIdentitySession((state) => setIsAuthenticated(state.kind === "authenticated"));
    setIsAuthenticated(currentIdentityState().kind === "authenticated");
    return unsubscribe;
  }, []);
  const [busy, setBusy] = useState(false);
  const [changingCity, setChangingCity] = useState(false);
  const [notice, setNotice] = useState("");
  const cityName = cities.find((city) => city.id === selectedCityID)?.displayNameAr ?? "مدينة الخدمة";

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

  async function changeCity() {
    if (changingCity) return;
    setChangingCity(true);
    setNotice("");
    try {
      await clearSelectedCity();
    } catch {
      setChangingCity(false);
      setNotice("تعذر فتح اختيار المدينة. حاول مجددًا.");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="الحساب">
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>مساحتك</Text>
        <Text style={styles.title}>إدارة الحساب</Text>
        <Text style={styles.description}>طلباتك ومحفظتك وعناوين التوصيل في مكان واحد.</Text>
      </View>

      <BthwaniSurface tone="raised" style={styles.profileCard}>
        <View style={styles.profileIcon}>
          <BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} />
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>{isAuthenticated ? "حساب العميل" : "مرحبًا بك في بثواني"}</Text>
          <Text style={styles.profileDescription}>
            {isAuthenticated ? "يمكنك متابعة طلباتك وإدارة عناوين التوصيل من هنا." : "سجّل الدخول لمتابعة طلباتك وحفظ عناوينك."}
          </Text>
        </View>
        {!isAuthenticated ? <BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/account" as Href)} /> : null}
      </BthwaniSurface>

      <BthwaniSectionHeader title="خدمات الحساب" subtitle="انتقل مباشرة إلى ما تحتاجه." />
      <View style={styles.actions}>
        <BthwaniNavigationRow description="تابع الطلبات الحالية والسابقة" icon="orders" title="طلباتي" onPress={() => router.push("/orders" as Href)} />
        <BthwaniNavigationRow description="راجع حالة محفظة بثواني" icon="wallet" title="محفظتي" onPress={() => router.push("/wallet" as Href)} />
        <BthwaniNavigationRow description="أضف عناوين التوصيل أو حدّثها" icon="location" title="عناوين التوصيل" onPress={() => router.push("/addresses" as Href)} />
        <BthwaniNavigationRow description={changingCity ? "جارٍ فتح قائمة المدن" : `المدينة الحالية: ${cityName}`} disabled={changingCity} icon="location" title="تغيير المدينة" onPress={() => void changeCity()} />
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

      {isAuthenticated ? <BthwaniButton busy={busy} disabled={busy} label={busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"} onPress={() => void logout()} variant="secondary" /> : null}
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, flexGrow: 1, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
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
