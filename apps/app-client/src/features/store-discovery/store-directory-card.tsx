import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, fulfillmentModeLabel, type PublicStoreView } from "@bthwani/dsh";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { listPublicPromotions } from "./store-discovery-client";

export type StorePromotionCache = Map<string, { count: number; checkedAt: number }>;

export function StoreDirectoryCard({
  store, activityLabel, cityId, favorite, favoriteBusy, imageFailed, onImageError, onOpen, onFavorite, promotionCache,
}: {
  store: PublicStoreView;
  activityLabel: string;
  cityId: string;
  favorite: boolean;
  favoriteBusy: boolean;
  imageFailed: boolean;
  onImageError: () => void;
  onOpen: () => void;
  onFavorite: () => void;
  promotionCache: StorePromotionCache;
}) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const cacheKey = cityId + ":" + store.id;
  const [promotionCount, setPromotionCount] = useState<number | null>(() => promotionCache.get(cacheKey)?.count ?? null);
  useEffect(() => {
    if (!cityId) return;
    const cached = promotionCache.get(cacheKey);
    if (cached && Date.now() - cached.checkedAt < 60_000) {
      setPromotionCount(cached.count);
      return;
    }
    let active = true;
    setPromotionCount(null);
    void listPublicPromotions(cityId, store.id).then((result) => {
      if (!active) return;
      const count = result.promotions.length;
      promotionCache.set(cacheKey, { count, checkedAt: Date.now() });
      setPromotionCount(count);
    }).catch(() => { if (active) setPromotionCount(null); });
    return () => { active = false; };
  }, [cityId, store.id, cacheKey, promotionCache]);

  const modes = availableCustomerFulfillmentModes(store.fulfillmentModes);
  const statuses = (store.orderabilityByMode ?? []).filter((item) => modes.includes(item.fulfillmentMode));
  const open = statuses.some((item) => item.state === "OPEN_FOR_ORDERS");
  const paused = statuses.some((item) => item.state === "PAUSED");
  const scheduledClosed = statuses.length > 0 && statuses.every((item) => item.state === "CLOSED_BY_SCHEDULE");
  const statusLabel = open ? "مفتوح" : paused ? "متوقف مؤقتًا" : scheduledClosed ? "مغلق" : statuses.length ? "غير متاح" : "التوفر غير مؤكد";
  const preparation = statuses.filter((item) => item.fulfillmentMode !== "CUSTOMER_PICKUP" && typeof item.preparationMinutes === "number" && item.preparationMinutes > 0);
  const preparationMinutes = preparation.length ? Math.min(...preparation.map((item) => item.preparationMinutes ?? Infinity)) : null;
  const address = store.addressLine?.trim() || "";
  const locationLabel = address || "العنوان غير محدد";
  const distanceLabel = typeof store.distanceMeters === "number" && store.distanceMeters > 0 ? (store.distanceMeters / 1000).toFixed(1) + " كم" : "";
  const reviewLabel = store.ratingCount > 0 ? "★ " + store.ratingAverage.toFixed(1) + " (" + store.ratingCount + ")" : "لا تقييمات بعد";
  const offersLabel = promotionCount === 1 ? "عرض متاح" : promotionCount + " عروض";
  return <Pressable accessibilityRole="button" accessibilityLabel={"فتح متجر " + store.name + "، " + statusLabel + "، " + reviewLabel} onPress={onOpen} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    {store.storeProfileImage?.uri && !imageFailed
      ? <Image accessibilityLabel={"شعار متجر " + store.name} onError={onImageError} source={{ uri: store.storeProfileImage.uri }} resizeMode="cover" style={styles.logo} />
      : <View style={styles.logoFallback}><BthwaniIcon name="store" size={sizing.iconLg} color={theme.interactiveText} /></View>}
    <View style={styles.copy}>
      <Text style={styles.name} numberOfLines={1}>{store.name}</Text>
      {activityLabel ? <Text style={styles.activity} numberOfLines={1}>{activityLabel}</Text> : null}
      {locationLabel ? <Text style={styles.location} numberOfLines={1}>{locationLabel}{distanceLabel ? " · " + distanceLabel : ""}</Text> : null}
      <View style={styles.facts}>
        <Text accessibilityLabel={store.ratingCount > 0 ? "تقييم المتجر " + store.ratingAverage.toFixed(1) + " من خمسة، من " + store.ratingCount + " أشخاص" : "لم يُقيّم المتجر بعد"} style={styles.rating}>{reviewLabel}</Text>
        <View style={[styles.status, open && styles.statusOpen]}>
          <View style={[styles.dot, open && styles.dotOpen]} />
          <Text numberOfLines={1} style={[styles.statusText, open && styles.statusTextOpen]}>{statusLabel}</Text>
        </View>
      </View>
      {preparationMinutes !== null ? <Text numberOfLines={1} style={styles.deliveryInfo}>وقت التجهيز: {preparationMinutes} دقيقة</Text> : null}
      {modes.length ? <Text numberOfLines={1} style={styles.modes}>{modes.map(fulfillmentModeLabel).join(" · ")}</Text> : null}
    </View>
    <View style={styles.actions}>
      <BthwaniIconButton icon="favorite" label={(favorite ? "إزالة " : "إضافة ") + store.name + (favorite ? " من المفضلة" : " إلى المفضلة")} disabled={favoriteBusy} tone={favorite ? "primary" : "soft"} onPress={(event) => { event.stopPropagation(); onFavorite(); }} size={sizing.controlMd} />
      {promotionCount !== null && promotionCount > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={"عرض " + offersLabel + " في متجر " + store.name} onPress={(event) => { event.stopPropagation(); onOpen(); }} style={styles.offerButton}><Text numberOfLines={1} style={styles.offerLabel}>{offersLabel}</Text></Pressable> : null}
    </View>
  </Pressable>;
}

function makeStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], minHeight: 112, overflow: "hidden", ...elevation.raised },
    logo: { alignSelf: "stretch", minHeight: 112, width: 100, backgroundColor: theme.surfaceInset },
    logoFallback: { alignSelf: "stretch", minHeight: 112, width: 100, alignItems: "center", justifyContent: "center", backgroundColor: theme.actionSoft },
    copy: { flex: 1, minWidth: 0, alignItems: "stretch", gap: spacing[1], paddingVertical: spacing[2] },
    name: { ...typography.titleSm, color: theme.color, textAlign: "auto" },
    activity: { ...typography.caption, color: theme.colorMuted, textAlign: "auto" },
    location: { ...typography.caption, color: theme.colorMuted, textAlign: "auto" },
    facts: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing[1] },
    rating: { ...typography.caption, color: theme.warning },
    status: { alignItems: "center", flexDirection: "row", gap: spacing[1], paddingHorizontal: spacing[1], paddingVertical: 2, backgroundColor: theme.surfaceInset, borderRadius: radius.round },
    statusOpen: { backgroundColor: theme.successSoft },
    dot: { height: 6, width: 6, borderRadius: radius.round, backgroundColor: theme.colorMuted },
    dotOpen: { backgroundColor: theme.success },
    statusText: { ...typography.caption, color: theme.colorMuted },
    statusTextOpen: { color: theme.success },
    deliveryInfo: { ...typography.caption, color: theme.interactiveText, textAlign: "auto" },
    modes: { ...typography.caption, color: theme.colorMuted, textAlign: "auto" },
    actions: { alignItems: "center", justifyContent: "space-between", gap: spacing[1], maxWidth: 72, paddingEnd: spacing[2] },
    offerButton: { backgroundColor: theme.actionSoft, borderRadius: radius.round, paddingHorizontal: spacing[1], minHeight: 27, justifyContent: "center" },
    offerLabel: { ...typography.caption, color: theme.interactiveText, textAlign: "center" },
    pressed: { opacity: 0.7 },
  });
}
