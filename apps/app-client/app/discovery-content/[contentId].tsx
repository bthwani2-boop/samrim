import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import type { PublicPromotionView } from "@bthwani/dsh";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { Button, Heading, Text, View } from "tamagui";
import { useServiceCityScope } from "../../src/features/service-city/service-city-scope";
import { resolvedDiscoveryDestination } from "../../src/features/store-discovery/discovery-reel-destination";
import { listPublicPromotions, resolvePublicDiscoveryContentTarget } from "../../src/features/store-discovery/store-discovery-client";
import { PromotionCard } from "../../src/features/store-discovery/promotion-card";
import { ClientPublicShell, ClientScrollScreen } from "../../src/shell/client-shell";

export default function DiscoveryContentRoute() {
  const router = useRouter();
  const theme = useAppearanceTheme();
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
        <View style={{ alignItems: "center", justifyContent: "center", minHeight: 480, padding: 16, width: "100%" }}>
          <View gap="3" style={{ alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: 24, padding: 20, width: "100%" }}>
            <Heading accessibilityRole="header" fontSize="8" style={{ color: theme.color, textAlign: "center" }}>وجهة المحتوى</Heading>
            {message ? <Text accessibilityRole="alert" style={{ color: theme.colorMuted, textAlign: "center" }}>{message}</Text> : null}
            {platformPromotion ? <PromotionCard promotion={platformPromotion} /> : null}
            <Button
              accessibilityLabel="العودة للمشاهدة"
              style={{ backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderWidth: 1 }}
              onPress={() => router.canGoBack() ? router.back() : router.replace("/home" as Href)}
            >
              <Text style={{ color: theme.color }}>العودة للمشاهدة</Text>
            </Button>
          </View>
        </View>
      </ClientScrollScreen>
    </ClientPublicShell>
  );
}
