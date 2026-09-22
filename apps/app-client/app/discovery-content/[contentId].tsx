import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { BthwaniButton, BthwaniIcon, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { resolveTheme, spacing, typography } from "@bthwani/design-system";
import { StyleSheet, Text, View } from "react-native";
import { useServiceCityScope } from "../../src/features/service-city/service-city-scope";
import { resolvePublicDiscoveryContentTarget } from "../../src/features/store-discovery/store-discovery-client";
import { ClientPublicShell, ClientScrollScreen } from "../../src/shell/client-shell";

export default function DiscoveryContentRoute() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = createStyles(theme);
  const { selectedCityID } = useServiceCityScope();
  const { contentId: rawContentId } = useLocalSearchParams<{ contentId?: string | string[] }>();
  const contentId = Array.isArray(rawContentId) ? rawContentId[0] ?? "" : rawContentId ?? "";
  const [message, setMessage] = useState("جارٍ فتح الوجهة…");

  useEffect(() => {
    let active = true;
    if (!contentId || !selectedCityID) {
      setMessage("اختر مدينة خدمة أولًا لفتح هذا المحتوى.");
      return () => { active = false; };
    }
    void resolvePublicDiscoveryContentTarget(contentId, selectedCityID).then((target) => {
      if (!active) return;
      if (target.storeId) {
        const extra = target.targetType === "CATEGORY" ? `?categoryId=${encodeURIComponent(target.targetId)}` : target.targetType === "PRODUCT" ? `?productId=${encodeURIComponent(target.targetId)}` : "";
        router.replace(`/store/${encodeURIComponent(target.storeId)}${extra}` as Href);
        return;
      }
      setMessage(target.targetType === "PROMOTION" ? "العرض محفوظ، لكنه غير مرتبط بمتجر متاح في مدينتك حاليًا." : "هذا المحتوى معلوماتي ولا يملك وجهة تشغيلية بعد.");
    }).catch(() => {
      if (active) setMessage("تعذر فتح وجهة المحتوى. قد يكون المحتوى توقف أو لم يعد متاحًا.");
    });
    return () => { active = false; };
  }, [contentId, router, selectedCityID]);

  return <ClientPublicShell><ClientScrollScreen><View style={styles.container}><BthwaniSurface tone="inset" style={styles.card}><BthwaniIcon name="store" color={theme.interactiveText} size={56} /><Text accessibilityRole="header" style={styles.title}>وجهة المحتوى</Text><Text accessibilityRole="alert" style={styles.message}>{message}</Text><BthwaniButton label="العودة إلى الاكتشاف" onPress={() => router.replace("/home" as Href)} variant="secondary" /></BthwaniSurface></View></ClientScrollScreen></ClientPublicShell>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { alignItems: "center", justifyContent: "center", minHeight: 480, padding: spacing[4], width: "100%" },
    card: { alignItems: "center", borderRadius: 24, gap: spacing[3], padding: spacing[5], width: "100%" },
    title: { ...typography.titleLg, color: theme.color },
    message: { ...typography.body, color: theme.colorMuted, textAlign: "center" },
  });
}
