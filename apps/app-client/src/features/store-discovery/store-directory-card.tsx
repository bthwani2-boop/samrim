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
  const locationLabel = [activityLabel.trim(), store.addressLine?.trim() ?? ""].filter(Boolean).join(" · ");

  const platformDelivery = modes.includes("BTHWANI_CAPTAIN");
  const partnerDelivery = modes.includes("PARTNER_CAPTAIN");
  const deliveryLabel = platformDelivery && partnerDelivery ? "توصيل" : platformDelivery ? "توصيل بثواني" : partnerDelivery ? "توصيل المتجر" : "";
  const modeLabel = [deliveryLabel, modes.includes("CUSTOMER_PICKUP") ? "استلام" : ""].filter(Boolean).join(" · ");

  const hasRating = store.ratingCount > 0 && Number.isFinite(store.ratingAverage) && store.ratingAverage >= 1 && store.ratingAverage <= 5;
  const ratingValue = hasRating ? store.ratingAverage.toFixed(1) : "";
  const offerLabel = promotionCount !== null && promotionCount > 0
    ? promotionCount === 1 ? "عرض متاح" : `${promotionCount} عروض` : "";
  const serviceLabel = [modeLabel, offerLabel].filter(Boolean).join(" · ");

  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={[`فتح متجر ${store.name}`, statusLabel, hasRating ? `تقييم ${ratingValue} من خمسة` : "", offerLabel].filter(Boolean).join("، ")}
    onPress={onOpen}
    style={({ pressed }) => [styles.card, pressed && styles.pressed]}
  >
    <View style={styles.logoColumn}>
      <View style={styles.logoFrame}>
        {store.storeProfileImage?.uri && !imageFailed
          ? <Image
            accessibilityLabel={`شعار متجر ${store.name}`}
            onError={onImageError}
            source={{ uri: store.storeProfileImage.uri }}
            resizeMode="contain"
            style={styles.logo}
          />
          : <View style={styles.logoFallback}><BthwaniIcon name="store" size={sizing.iconLg} color={theme.interactiveText} /></View>}
      </View>
      {hasRating ? <View style={styles.ratingPill} accessibilityLabel={`تقييم المتجر ${ratingValue} من خمسة، من ${store.ratingCount} أشخاص`}>
        <Text style={styles.ratingStar}>★</Text>
        <Text style={styles.ratingValue}>{ratingValue}</Text>
      </View> : null}
    </View>

    <View style={styles.copy}>
      <Text style={styles.name} numberOfLines={2}>{store.name}</Text>
      {locationLabel ? <Text style={styles.location} numberOfLines={1}>{locationLabel}</Text> : null}
      {serviceLabel ? <Text style={styles.service} numberOfLines={1}>{serviceLabel}</Text> : null}
    </View>

    <View style={styles.actions}>
      {statusLabel ? <View style={[styles.status, open ? styles.statusOpen : paused ? styles.statusPaused : styles.statusClosed]}>
        <View style={[styles.statusDot, open ? styles.dotOpen : paused ? styles.dotPaused : styles.dotClosed]} />
        <Text style={[styles.statusText, open ? styles.statusTextOpen : paused ? styles.statusTextPaused : styles.statusTextClosed]} numberOfLines={2}>{statusLabel}</Text>
      </View> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${favorite ? "إزالة" : "إضافة"} ${store.name} ${favorite ? "من المفضلة" : "إلى المفضلة"}`}
        accessibilityState={{ checked: favorite, disabled: favoriteBusy }}
        disabled={favoriteBusy}
        hitSlop={8}
        onPress={(event) => { event.stopPropagation(); onFavorite(); }}
        style={[styles.favoriteAction, favorite && styles.favoriteSelected]}
      >
        <Text style={styles.favoriteGlyph}>{favorite ? "♥" : "♡"}</Text>
      </Pressable>
    </View>
  </Pressable>;
}

function makeStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], minHeight: 116, paddingVertical: spacing[2], paddingHorizontal: spacing[2], ...elevation.raised },
    logoColumn: { alignItems: "center", alignSelf: "center", gap: spacing[1], width: 84 },
    logoFrame: { alignItems: "center", justifyContent: "center", height: 78, width: 82, borderRadius: radius.md, backgroundColor: theme.surfaceInset, overflow: "hidden" },
    logo: { height: 74, width: 78 },
    logoFallback: { alignItems: "center", justifyContent: "center", height: 74, width: 78 },
    ratingPill: { alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing[1], backgroundColor: theme.warningSoft, borderRadius: radius.round, minHeight: 20, paddingHorizontal: spacing[2], maxWidth: 82 },
    ratingStar: { fontSize: 14, lineHeight: 18, color: theme.warning },
    ratingValue: { ...typography.label, color: theme.color },
    copy: { flex: 1, minWidth: 0, gap: spacing[1], justifyContent: "center" },
    name: { ...typography.titleSm, color: theme.color },
    location: { ...typography.caption, color: theme.colorMuted },
    service: { ...typography.caption, color: theme.colorSecondary },
    actions: { alignItems: "center", alignSelf: "stretch", justifyContent: "center", gap: spacing[2], width: 66 },
    status: { alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing[1], borderRadius: radius.round, paddingHorizontal: spacing[1], paddingVertical: spacing[1], width: 66, minHeight: 26 },
    statusOpen: { backgroundColor: theme.successSoft },
    statusPaused: { backgroundColor: theme.warningSoft },
    statusClosed: { backgroundColor: theme.dangerSoft },
    statusDot: { height: 6, width: 6, borderRadius: radius.round },
    dotOpen: { backgroundColor: theme.success },
    dotPaused: { backgroundColor: theme.warning },
    dotClosed: { backgroundColor: theme.danger },
    statusText: { ...typography.caption, flexShrink: 1, textAlign: "center" },
    statusTextOpen: { color: theme.success },
    statusTextPaused: { color: theme.warningText },
    statusTextClosed: { color: theme.dangerText },
    favoriteAction: { alignItems: "center", justifyContent: "center", height: sizing.controlMd, width: sizing.controlMd, borderRadius: radius.round, backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline },
    favoriteSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionSoft },
    favoriteGlyph: { color: theme.interactiveText, fontSize: 25, lineHeight: 31, textAlign: "center" },
    pressed: { opacity: 0.76 },
  });
}
