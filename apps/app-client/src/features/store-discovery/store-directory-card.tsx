import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, type PublicStoreView } from "@bthwani/dsh";
import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

export function StoreDirectoryCard({
  store, activityLabel, favorite, favoriteBusy, imageFailed, onImageError, onOpen, onFavorite, promotionCount,
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
}) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const modes = availableCustomerFulfillmentModes(store.fulfillmentModes);
  const statuses = (store.orderabilityByMode ?? []).filter((item) => modes.includes(item.fulfillmentMode));
  const open = statuses.some((item) => item.state === "OPEN_FOR_ORDERS");
  const paused = !open && statuses.some((item) => item.state === "PAUSED");
  const scheduledClosed = statuses.length > 0 && statuses.every((item) => item.state === "CLOSED_BY_SCHEDULE");
  const statusLabel = !statuses.length ? "" : open ? "مفتوح" : paused ? "متوقف مؤقتًا" : scheduledClosed ? "مغلق" : "غير متاح";
  const address = store.addressLine?.trim() ?? "";
  const distanceLabel = typeof store.distanceMeters === "number" && Number.isFinite(store.distanceMeters) && store.distanceMeters > 0
    ? (store.distanceMeters / 1000).toFixed(1) + " كم" : "";
  const locationLabel = [activityLabel.trim(), address, distanceLabel].filter(Boolean).join(" · ");
  const hasPlatformDelivery = modes.includes("BTHWANI_CAPTAIN");
  const hasPartnerDelivery = modes.includes("PARTNER_CAPTAIN");
  let deliveryLabel = "";
  if (hasPlatformDelivery && hasPartnerDelivery) deliveryLabel = "توصيل";
  else if (hasPlatformDelivery) deliveryLabel = "توصيل بثواني";
  else if (hasPartnerDelivery) deliveryLabel = "توصيل المتجر";
  const modeLabel = [deliveryLabel, modes.includes("CUSTOMER_PICKUP") ? "استلام" : ""].filter(Boolean).join(" · ");
  const hasRating = store.ratingCount > 0 && Number.isFinite(store.ratingAverage);
  const reviewLabel = hasRating ? "★ " + store.ratingAverage.toFixed(1) : "";
  const offerLabel = promotionCount !== null && promotionCount > 0
    ? promotionCount === 1 ? "عرض متاح" : promotionCount + " عروض" : "";

  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={["فتح متجر " + store.name, statusLabel, hasRating ? "تقييم " + store.ratingAverage.toFixed(1) + " من خمسة" : "", offerLabel].filter(Boolean).join("، ")}
    onPress={onOpen}
    style={({ pressed }) => [styles.card, pressed && styles.pressed]}
  >
    {store.storeProfileImage?.uri && !imageFailed
      ? <Image
        accessibilityLabel={"شعار متجر " + store.name}
        onError={onImageError}
        source={{ uri: store.storeProfileImage.uri }}
        resizeMode="contain"
        style={styles.logo}
      />
      : <View style={styles.logoFallback}><BthwaniIcon name="store" size={sizing.iconLg} color={theme.interactiveText} /></View>}
    <View style={styles.copy}>
      <Text style={styles.name} numberOfLines={1}>{store.name}</Text>
      {locationLabel ? <Text style={styles.location} numberOfLines={1}>{locationLabel}</Text> : null}
      {statusLabel || modeLabel ? <View style={styles.serviceRow}>
        {statusLabel ? <View style={[styles.status, open && styles.statusOpen]}>
          <View style={[styles.dot, open && styles.dotOpen]} />
          <Text numberOfLines={1} style={[styles.statusText, open && styles.statusTextOpen]}>{statusLabel}</Text>
        </View> : null}
        {modeLabel ? <Text style={styles.modes} numberOfLines={1}>{modeLabel}</Text> : null}
      </View> : null}
      {hasRating || offerLabel ? <View style={styles.benefits}>
        {hasRating ? <Text accessibilityLabel={"تقييم المتجر " + store.ratingAverage.toFixed(1) + " من خمسة، من " + store.ratingCount + " أشخاص"} style={styles.rating}>{reviewLabel}</Text> : null}
        {offerLabel ? <Text style={styles.offerLabel} numberOfLines={1}>{offerLabel}</Text> : null}
      </View> : null}
    </View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={(favorite ? "إزالة " : "إضافة ") + store.name + (favorite ? " من المفضلة" : " إلى المفضلة")}
      accessibilityState={{ checked: favorite, disabled: favoriteBusy }}
      disabled={favoriteBusy}
      hitSlop={8}
      onPress={(event) => { event.stopPropagation(); onFavorite(); }}
      style={[styles.favoriteAction, favorite && styles.favoriteSelected]}
    >
      <Text style={styles.favoriteGlyph}>{favorite ? "♥" : "♡"}</Text>
    </Pressable>
  </Pressable>;
}

function makeStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], minHeight: 100, overflow: "hidden", ...elevation.raised },
    logo: { alignSelf: "stretch", minHeight: 100, width: 92, backgroundColor: theme.surfaceInset },
    logoFallback: { alignSelf: "stretch", minHeight: 100, width: 92, alignItems: "center", justifyContent: "center", backgroundColor: theme.actionSoft },
    copy: { flex: 1, minWidth: 0, gap: spacing[1], paddingVertical: spacing[2] },
    name: { ...typography.titleSm, color: theme.color, textAlign: "auto" },
    location: { ...typography.caption, color: theme.colorMuted, textAlign: "auto" },
    serviceRow: { alignItems: "center", flexDirection: "row", gap: spacing[2], minWidth: 0 },
    status: { alignItems: "center", flexDirection: "row", gap: spacing[1], backgroundColor: theme.surfaceInset, borderRadius: radius.round, paddingHorizontal: spacing[1], paddingVertical: 2 },
    statusOpen: { backgroundColor: theme.successSoft },
    dot: { height: 6, width: 6, borderRadius: radius.round, backgroundColor: theme.colorMuted },
    dotOpen: { backgroundColor: theme.success },
    statusText: { ...typography.caption, color: theme.colorMuted },
    statusTextOpen: { color: theme.success },
    modes: { ...typography.caption, color: theme.colorMuted, flex: 1, minWidth: 0, textAlign: "auto" },
    benefits: { alignItems: "center", flexDirection: "row", gap: spacing[2], minWidth: 0 },
    rating: { ...typography.caption, color: theme.warning },
    offerLabel: { ...typography.caption, color: theme.interactiveText },
    favoriteAction: { alignItems: "center", justifyContent: "center", height: sizing.controlMd, width: sizing.controlMd, borderRadius: radius.round, backgroundColor: theme.actionSoft, marginEnd: spacing[2] },
    favoriteSelected: { backgroundColor: theme.surfaceInset },
    favoriteGlyph: { color: theme.interactiveText, fontSize: 26, lineHeight: 32, textAlign: "center" },
    pressed: { opacity: 0.7 },
  });
}
