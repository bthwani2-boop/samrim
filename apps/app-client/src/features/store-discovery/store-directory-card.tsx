import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, type PublicStoreView } from "@bthwani/dsh";
import { Image as ExpoImage } from "expo-image";
import { useEffect, useMemo, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

/** A compact visual store tile. Store images, ratings, offers and orderability are all DSH-owned facts. */
export function StoreDirectoryCard({
  store, activityLabel, favorite, favoriteBusy, imageFailed, onImageError, onOpen, onFavorite, promotionCount, index = 0, compact = false,
}: {
  store: PublicStoreView;
  activityLabel: string;
  favorite: boolean;
  favoriteBusy: boolean;
  imageFailed: boolean;
  onImageError: () => void;
  onOpen: () => void;
  onFavorite: () => void;
  promotionCount: number | null;
  index?: number;
  compact?: boolean;
}) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!active) return;
      if (reduced) { entrance.setValue(1); return; }
      Animated.timing(entrance, {
        toValue: 1, duration: 300, delay: Math.min(index, 5) * 45,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    }).catch(() => entrance.setValue(1));
    return () => { active = false; entrance.stopAnimation(); };
  }, [entrance, index]);

  const modes = availableCustomerFulfillmentModes(store.fulfillmentModes);
  const statuses = (store.orderabilityByMode ?? []).filter((item) => modes.includes(item.fulfillmentMode));
  const open = statuses.some((item) => item.state === "OPEN_FOR_ORDERS");
  const paused = !open && statuses.some((item) => item.state === "PAUSED");
  const scheduledClosed = statuses.length > 0 && statuses.every((item) => item.state === "CLOSED_BY_SCHEDULE");
  const statusLabel = !statuses.length ? "" : open ? "مفتوح" : paused ? "متوقف مؤقتًا" : scheduledClosed ? "مغلق" : "غير متاح";
  const hasRating = store.ratingCount > 0 && Number.isFinite(store.ratingAverage) && store.ratingAverage >= 1 && store.ratingAverage <= 5;
  const ratingValue = hasRating ? store.ratingAverage.toFixed(1) : "";
  const offerLabel = promotionCount !== null && promotionCount > 0
    ? promotionCount === 1 ? "عرض متاح" : `${promotionCount} عروض` : "";
  const media = !imageFailed ? (store.storeCoverImage?.uri || store.storeProfileImage?.uri) : undefined;
  const isCover = Boolean(store.storeCoverImage?.uri && !imageFailed);
  const serviceLabel = [
    modes.includes("BTHWANI_CAPTAIN") ? "توصيل بثواني" : "",
    modes.includes("PARTNER_CAPTAIN") ? "توصيل المتجر" : "",
    modes.includes("CUSTOMER_PICKUP") ? "استلام" : "",
  ].filter(Boolean).join(" · ");

  return (
    <Animated.View style={[styles.card, compact && styles.compactCard, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[`فتح متجر ${store.name}`, statusLabel, hasRating ? `تقييم ${ratingValue} من خمسة` : "", offerLabel].filter(Boolean).join("، ")}
        onPress={onOpen}
        style={({ pressed }) => [styles.openArea, pressed && styles.pressed]}
      >
        <View style={[styles.imageFrame, compact && styles.compactImageFrame]}>
          {media ? <ExpoImage
            accessibilityLabel={`صورة متجر ${store.name}`}
            cachePolicy="disk"
            source={{ uri: media }}
            contentFit={isCover ? "cover" : "contain"}
            onError={onImageError}
            style={styles.image}
          /> : <View style={styles.imageFallback}><BthwaniIcon name="store" size={sizing.iconXl} color={theme.interactiveText} /></View>}
          {offerLabel ? <View style={[styles.offerBadge, compact && styles.compactOfferBadge]}><BthwaniIcon name="offers" size={sizing.iconSm} color="#FFFFFF" /><Text style={styles.offerText} numberOfLines={1}>{offerLabel}</Text></View> : null}
          {statusLabel ? <View style={[styles.statusBadge, compact && styles.compactStatusBadge, open ? styles.statusOpen : paused ? styles.statusPaused : styles.statusClosed]}>
            <View style={[styles.statusDot, { backgroundColor: open ? theme.success : paused ? theme.warning : theme.colorMuted }]} />
            <Text style={[styles.statusText, { color: open ? theme.successText : paused ? theme.warningText : theme.colorSecondary }]} numberOfLines={1}>{statusLabel}</Text>
          </View> : null}
        </View>
        <View style={[styles.copy, compact && styles.compactCopy]}>
          <Text numberOfLines={2} style={[styles.name, compact && styles.compactName]}>{store.name}</Text>
          {activityLabel ? <Text numberOfLines={1} style={styles.activity}>{activityLabel}</Text> : null}
          {hasRating ? <View accessibilityLabel={`تقييم ${ratingValue} من خمسة بواسطة ${store.ratingCount} مستخدم`} style={styles.ratingRow}>
            <Text style={styles.ratingStar}>★</Text>
            <Text style={styles.ratingValue}>{ratingValue}</Text>
            <Text style={styles.ratingCount}>({store.ratingCount})</Text>
          </View> : null}
          {serviceLabel && !compact ? <Text numberOfLines={1} style={styles.service}>{serviceLabel}</Text> : null}
          <View style={[styles.cardAction, compact && styles.compactCardAction]}><BthwaniIcon name="forward" size={sizing.iconSm} color={theme.interactiveText} /><Text style={styles.openLabel}>{compact ? "تصفح" : "تصفح المتجر"}</Text></View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${favorite ? "إزالة" : "إضافة"} ${store.name} ${favorite ? "من المفضلة" : "إلى المفضلة"}`}
        accessibilityState={{ checked: favorite, disabled: favoriteBusy }}
        disabled={favoriteBusy}
        hitSlop={8}
        onPress={onFavorite}
        style={[styles.favoriteAction, compact && styles.compactFavoriteAction, favorite && styles.favoriteSelected]}
      >
        <BthwaniIcon name="favorite" size={sizing.iconMd} color={favorite ? theme.brandAction : theme.colorSecondary} />
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    compactCard: { borderRadius: radius.lg, elevation: 0 },
    compactImageFrame: { height: 105, margin: 2, borderRadius: radius.md },
    compactOfferBadge: { paddingHorizontal: spacing[1], paddingVertical: 2 },
    compactStatusBadge: { bottom: spacing[1], left: spacing[1], paddingHorizontal: spacing[1], paddingVertical: 2 },
    compactCopy: { gap: 2, padding: spacing[1] },
    compactName: { ...typography.bodySm, fontWeight: "700", lineHeight: 18, minHeight: 36 },
    compactCardAction: { minHeight: 28, paddingVertical: spacing[1], marginTop: 0 },
    compactFavoriteAction: { top: spacing[1], left: spacing[1], width: 32, height: 32 },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.xl, overflow: "hidden", flex: 1, ...elevation.raised },
    openArea: { flex: 1 },
    imageFrame: { height: 160, backgroundColor: theme.surfaceInset, position: "relative", overflow: "hidden", borderRadius: radius.lg, margin: spacing[1] },
    image: { width: "100%", height: "100%" },
    imageFallback: { alignItems: "center", justifyContent: "center", height: "100%", backgroundColor: theme.actionSoft },
    offerBadge: { position: "absolute", top: 0, right: 0, backgroundColor: theme.brandAction, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing[2], paddingVertical: spacing[1], gap: spacing[1], borderBottomLeftRadius: radius.md },
    offerText: { ...typography.caption, color: "#FFFFFF", fontWeight: "700" },
    statusBadge: { position: "absolute", bottom: spacing[2], left: spacing[2], backgroundColor: theme.surfaceOverlay, borderRadius: radius.round, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing[2], paddingVertical: spacing[1], gap: spacing[1] },
    statusOpen: { backgroundColor: theme.successSoft },
    statusPaused: { backgroundColor: theme.warningSoft },
    statusClosed: { backgroundColor: theme.surfaceOverlay },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { ...typography.caption, fontWeight: "600" },
    copy: { flex: 1, padding: spacing[2], paddingTop: spacing[1], gap: spacing[1], alignItems: "stretch" },
    name: { ...typography.titleSm, color: theme.color, textAlign: "right", minHeight: 38 },
    activity: { ...typography.caption, color: theme.colorSecondary, textAlign: "right" },
    ratingRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing[1] },
    ratingStar: { color: theme.warning, fontSize: 15 },
    ratingValue: { ...typography.label, color: theme.color },
    ratingCount: { ...typography.caption, color: theme.colorMuted },
    service: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
    cardAction: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[1], backgroundColor: theme.actionSoft, borderRadius: radius.round, paddingVertical: spacing[2], marginTop: spacing[1], minHeight: 40 },
    openLabel: { ...typography.label, color: theme.interactiveText },
    favoriteAction: { position: "absolute", top: spacing[3], left: spacing[3], backgroundColor: theme.surface, borderRadius: radius.round, width: 42, height: 42, alignItems: "center", justifyContent: "center", ...elevation.raised },
    favoriteSelected: { backgroundColor: theme.actionSoft },
    pressed: { opacity: 0.83, transform: [{ scale: 0.985 }] },
  });
}
