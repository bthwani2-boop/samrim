import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import type { PublicPromotionView } from "@bthwani/dsh";
import { BthwaniButton, BthwaniIcon, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { resolveTheme, spacing, typography } from "@bthwani/design-system";
import { StyleSheet, Text, View } from "react-native";
import { useServiceCityScope } from "../../src/features/service-city/service-city-scope";
import { resolvedDiscoveryDestination } from "../../src/features/store-discovery/discovery-reel-destination";
import { listPublicPromotions, resolvePublicDiscoveryContentTarget } from "../../src/features/store-discovery/store-discovery-client";
import { PromotionCard } from "../../src/features/store-discovery/promotion-card";
import { ClientPublicShell, ClientScrollScreen } from "../../src/shell/client-shell";

export default function DiscoveryContentRoute() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = createStyles(theme);
  const { selectedCityID } = useServiceCityScope();
  const { contentId: rawContentId } = useLocalSearchParams<{ contentId?: string | string[] }>();
  const contentId = Array.isArray(rawContentId) ? rawContentId[0] ?? "" : rawContentId ?? "";
  const [message, setMessage] = useState("جارٍ فتح الوجهة المرتبطة…");
  const [platformPromotion, setPlatformPromotion] = useState<PublicPromotionView | null>(null);

  useEffect(() => {
    let active = true;
    if (!contentId || !selectedCityID) {
      setMessage("اختر مدينة الخدمة لفتح المحتوى.");
      return () => { active = false; };
    }
    void resolvePublicDiscoveryContentTarget(contentId, selectedCityID).then(target => {
      if (!active) return;
      const destination = resolvedDiscoveryDestination(target);
      if (destination) {
        // Replace only the transient resolver, not Home: Back returns to the reel.
        router.replace(destination as Href);
        return;
      }
      if (target.targetType === "PROMOTION" && target.targetId) {
        // Platform-funded promotions have no Store; reuse the existing promo
        // card, never create a second checkout or product surface in the reel.
        void listPublicPromotions(selectedCityID).then(page => {
          if (!active) return;
          const promotion = page.promotions.find(item => item.id === target.targetId);
          setPlatformPromotion(promotion ?? null);
          setMessage(promotion ? "" : "هذا العرض غير متاح حاليًا.");
        }).catch(() => {
          if (active) setMessage("تعذر تحميل العرض حاليًا.");
        });
        return;
      }
      setMessage(target.targetType === "INFO"
        ? "هذا الفيديو للمشاهدة فقط."
        : "لا تتوفر وجهة هذا المحتوى في مدينتك حاليًا.");
    }).catch(() => {
      if (active) setMessage("تعذر فتح الوجهة. ربما انتهى العرض أو لم يعد متاحًا.");
    });
    return () => { active = false; };
  }, [contentId, router, selectedCityID]);

  return (
    <ClientPublicShell>
      <ClientScrollScreen>
        <View style={styles.container}>
          <BthwaniSurface tone="inset" style={styles.card}>
            <BthwaniIcon name="store" color={theme.interactiveText} size={56} />
            <Text accessibilityRole="header" style={styles.title}>وجهة المحتوى</Text>
            {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            {platformPromotion ? <PromotionCard promotion={platformPromotion} /> : null}
            <BthwaniButton label="العودة للمشاهدة" onPress={() => router.canGoBack() ? router.back() : router.replace("/home" as Href)} variant="secondary" />
          </BthwaniSurface>
        </View>
      </ClientScrollScreen>
    </ClientPublicShell>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { alignItems: "center", justifyContent: "center", minHeight: 480, padding: spacing[4], width: "100%" },
    card: { alignItems: "center", borderRadius: 24, gap: spacing[3], padding: spacing[5], width: "100%" },
    title: { ...typography.titleLg, color: theme.color },
    message: { ...typography.body, color: theme.colorMuted, textAlign: "center" },
  });
}
