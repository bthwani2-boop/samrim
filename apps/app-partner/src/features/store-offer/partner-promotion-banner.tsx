import { typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type PublicPromotionView } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

function offerLabel(promotion: PublicPromotionView): string {
  return promotion.kind === "PERCENTAGE"
    ? `خصم ${promotion.valueMinor}%`
    : `خصم ${formatMoney(promotion.valueMinor, "YER")}`;
}

/** Published promotions only: the same DSH readback used by the customer storefront. */
export function PartnerStorePromotionBanner({ storeId, serviceCityId, canManage, offersOnly = false }: Readonly<{
  storeId: string;
  serviceCityId: string;
  canManage: boolean;
  offersOnly?: boolean;
}>) {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => StyleSheet.create({
    wrap: { gap: 7 },
    banner: { backgroundColor: theme.actionSoft, borderColor: theme.borderColorStrong, borderWidth: 1, borderRadius: 14, minHeight: 108, padding: 13, flexDirection: "row", alignItems: "center", gap: 9 },
    copy: { flex: 1, gap: 5 },
    title: { ...typography.titleSm, fontWeight: "800", color: theme.color },
    benefit: { ...typography.bodyStrong, color: theme.brandAction },
    meta: { ...typography.caption, color: theme.colorMuted },
    graphic: { width: 60, height: 60, borderRadius: 15, backgroundColor: theme.surface, justifyContent: "center", alignItems: "center" },
    dots: { flexDirection: "row", justifyContent: "center", gap: 5 },
    dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colorMuted },
    selectedDot: { width: 13, backgroundColor: theme.brandAction },
    action: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
    actionText: { ...typography.caption, fontWeight: "700", color: theme.brandAction },
    empty: { ...typography.bodySm, color: theme.colorMuted, paddingVertical: 8 },
  }), [theme]);
  const [promotions, setPromotions] = useState<ReadonlyArray<PublicPromotionView> | null>(null);
  const [index, setIndex] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!base || !storeId || !serviceCityId) return;
    void createDshMobileClient(base, { cryptoRandomUUID: () => Crypto.randomUUID() })
      .listPublicPromotions(serviceCityId, storeId)
      .then((response) => { if (active) { setPromotions(response.promotions); setIndex(0); } })
      .catch(() => { if (active) setPromotions(null); });
    return () => { active = false; };
  }, [serviceCityId, storeId]));
  useEffect(() => {
    if (!promotions || promotions.length < 2) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % promotions.length), 5000);
    return () => clearInterval(timer);
  }, [promotions]);
  const current = promotions?.[index];
  const openManagement = () => router.push("/store?section=promotions&returnTo=products" as Href);
  if (!current) return offersOnly ? <View style={styles.wrap}>
    <Text style={styles.empty}>{promotions === null ? "تعذر تحميل العروض حاليًا." : "لا توجد عروض منشورة لهذا المتجر."}</Text>
    {canManage ? <Pressable accessibilityRole="button" accessibilityLabel="إدارة العروض" onPress={openManagement} style={styles.action}><Text style={styles.actionText}>إدارة العروض</Text></Pressable> : null}
  </View> : null;
  return <View style={styles.wrap} accessibilityLabel="عروض المتجر المنشورة">
    <Pressable accessibilityRole="button" accessibilityLabel={current.nameAr} onPress={() => { if (promotions.length > 1) setIndex((currentIndex) => (currentIndex + 1) % promotions.length); else if (canManage) openManagement(); }} style={styles.banner}>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.meta}>عروض المتجر</Text>
        <Text numberOfLines={2} style={styles.title}>{current.nameAr}</Text>
        <Text numberOfLines={1} style={styles.benefit}>{offerLabel(current)}</Text>
      </View>
      <View style={styles.graphic}><BthwaniIcon name="offers" size={34} color={theme.brandAction} /></View>
    </Pressable>
    {promotions.length > 1 ? <View style={styles.dots}>{promotions.map((item, i) => <View key={item.id} style={[styles.dot, index === i && styles.selectedDot]} />)}</View> : null}
    {offersOnly && canManage ? <Pressable accessibilityRole="button" accessibilityLabel="إدارة العروض" onPress={openManagement} style={styles.action}><Text style={styles.actionText}>إدارة العروض</Text></Pressable> : null}
  </View>;
}
