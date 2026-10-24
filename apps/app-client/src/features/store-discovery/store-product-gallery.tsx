import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type PublicCatalogResponse } from "@bthwani/dsh";
import { Image as ExpoImage } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Offer = PublicCatalogResponse["offers"][number];
export type GallerySourceRect = { x: number; y: number; width: number; height: number };

export type StoreProductGalleryProps = {
  offer: Offer;
  offers: ReadonlyArray<Offer>;
  sourceRect?: GallerySourceRect | undefined;
  isFavorite: (offerId: string) => boolean;
  favoriteBusy: boolean;
  onToggleFavorite: (offerId: string) => void;
  onQuickAdd: (offerId: string) => void;
  onShare: (offerId: string, productId: string, title: string) => void;
  onBrowse: (offerId: string) => void;
  onClose: () => void;
};

const price = (offer: Offer) => formatMoney(offer.priceMinor, offer.currency).replace(/ريال يمني/g, "ريال");
const unit = (offer: Offer) => offer.variantTitle?.trim() || (offer.baseUnit === "GRAM" ? "بالكيلو" : offer.baseUnit === "MILLILITER" ? "باللتر" : "للوحدة");

export function StoreProductGallery({ offer, offers, sourceRect, isFavorite, favoriteBusy, onToggleFavorite, onQuickAdd, onShare, onBrowse, onClose }: StoreProductGalleryProps) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [columns, setColumns] = useState(1);
  const [cardHeight, setCardHeight] = useState(0);
  const motion = useRef(new Animated.Value(0)).current;
  const started = useRef(false);
  const closing = useRef(false);
  const reduceMotion = useRef(false);
  const pinchScale = useSharedValue(1);
  const activeOffers = offers.length ? offers : [offer];
  const effectiveIndex = Math.max(0, activeOffers.findIndex((item) => item.offerId === offer.offerId));
  const latest = useRef({ offers: activeOffers, index: effectiveIndex, onBrowse });
  latest.current = { offers: activeOffers, index: effectiveIndex, onBrowse };

  const navigate = useCallback((direction: -1 | 1) => {
    const current = latest.current;
    const next = current.offers[current.index + direction];
    if (next) current.onBrowse(next.offerId);
  }, []);

  const finishPinch = useCallback((factor: number) => {
    if (factor < 0.84) setColumns((value) => Math.min(4, value + 1));
    else if (factor > 1.2) setColumns((value) => Math.max(1, value - 1));
  }, []);

  const toggleZoom = useCallback(() => setColumns((value) => value === 1 ? 2 : 1), []);

  const pan = useMemo(() => Gesture.Pan()
    .enabled(columns === 1)
    .minDistance(34)
    .onEnd((event) => {
      const delta = Math.abs(event.translationX) > Math.abs(event.translationY) ? event.translationX : event.translationY;
      if (Math.abs(delta) >= 62) runOnJS(navigate)(delta < 0 ? 1 : -1);
    }), [columns, navigate]);

  const pinch = useMemo(() => Gesture.Pinch()
    .onUpdate((event) => {
      pinchScale.value = Math.max(0.64, Math.min(1.65, event.scale));
    })
    .onEnd((event) => {
      pinchScale.value = withTiming(1, { duration: 160 });
      runOnJS(finishPinch)(event.scale);
    }), [finishPinch, pinchScale]);

  const doubleTap = useMemo(() => Gesture.Tap().numberOfTaps(2).maxDuration(240).onEnd((_event, success) => {
    if (success) runOnJS(toggleZoom)();
  }), [toggleZoom]);
  const gesture = useMemo(() => Gesture.Simultaneous(pinch, pan, doubleTap), [pinch, pan, doubleTap]);
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: pinchScale.value }] }));

  const beginEntrance = useCallback((height: number) => {
    if (started.current || height < 1) return;
    started.current = true;
    setCardHeight(height);
    Animated.timing(motion, { toValue: 1, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [motion]);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (alive && reduced) { reduceMotion.current = true; motion.stopAnimation(); motion.setValue(1); }
    });
    return () => { alive = false; };
  }, [motion]);

  const closeGallery = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (reduceMotion.current) { onClose(); return; }
    Animated.timing(motion, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());
  }, [motion, onClose]);

  const cardWidth = Math.max(1, screenWidth - spacing[3] * 2);
  const targetLeft = (screenWidth - cardWidth) / 2;
  const targetTop = (screenHeight - cardHeight) / 2;
  const startScale = sourceRect ? Math.min(1, Math.max(0.13, sourceRect.width / cardWidth)) : 0.92;
  const fromX = sourceRect ? sourceRect.x + sourceRect.width / 2 - (targetLeft + cardWidth / 2) : 0;
  const fromY = sourceRect ? sourceRect.y + sourceRect.height / 2 - (targetTop + cardHeight / 2) : 0;
  const enterStyle = {
    opacity: motion,
    transform: [
      { translateX: motion.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
      { translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
      { scale: motion.interpolate({ inputRange: [0, 1], outputRange: [startScale, 1] }) },
    ],
  };

  const renderCard = (item: Offer, compact = false) => {
    const media = item.media.find((entry) => entry.role === "primary") ?? item.media[0];
    const imageHeight = compact ? undefined : Math.max(190, Math.min(300, screenHeight * 0.30));
    return <View key={item.offerId} style={[styles.card, compact && styles.gridCard]}>
      <Pressable accessibilityRole="button" accessibilityLabel={"عرض بطاقة " + item.productName} onPress={compact ? () => { onBrowse(item.offerId); setColumns(1); } : undefined} style={styles.imageFrame}>
        {media ? <ExpoImage cachePolicy="disk" source={{ uri: media.uri }} contentFit="cover" accessibilityLabel={"صورة " + item.productName} style={[styles.image, compact ? { aspectRatio: 1 } : { height: imageHeight }]} /> :
          <View style={[styles.imageFallback, compact ? { aspectRatio: 1 } : { height: imageHeight }]}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconLg} /></View>}
      </Pressable>
      <View pointerEvents="box-none" style={styles.favorite}>
        <BthwaniIconButton icon="favorite" size={compact ? sizing.controlSm : sizing.controlMd} tone={isFavorite(item.offerId) ? "primary" : "soft"} label={isFavorite(item.offerId) ? "إزالة المنتج من المفضلة" : "إضافة المنتج للمفضلة"} disabled={favoriteBusy} onPress={() => onToggleFavorite(item.offerId)} />
      </View>
      <View pointerEvents="box-none" style={styles.share}>
        <BthwaniIconButton icon="share" size={compact ? sizing.controlSm : sizing.controlMd} tone="soft" label={"مشاركة " + item.productName} onPress={() => onShare(item.offerId, item.productId, item.productName)} />
      </View>
      <View style={styles.info}>
        <Text numberOfLines={compact ? 1 : 2} style={[styles.name, compact && styles.compactName]}>{item.productName}</Text>
        {columns < 4 ? <Text numberOfLines={1} style={styles.unit}>{unit(item)}</Text> : null}
        <View style={styles.bottom}>
          <Text numberOfLines={1} style={[styles.price, compact && styles.compactPrice]}>{price(item)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={"تحديد كمية " + item.productName} onPress={() => onQuickAdd(item.offerId)} style={[styles.add, compact && styles.compactAdd]}><BthwaniIcon name="cart" size={sizing.iconSm} color={theme.onAction} />{!compact ? <Text style={styles.plus}>+</Text> : null}</Pressable>
        </View>
      </View>
    </View>;
  };

  const gridWidth = Math.max(45, (cardWidth - spacing[2] * (columns - 1)) / columns);
  return <Modal visible transparent animationType="none" onRequestClose={closeGallery} statusBarTranslucent>
    <GestureHandlerRootView style={styles.fill}>
      <View style={[styles.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="إغلاق معرض المنتجات" onPress={closeGallery} />
        <Animated.View style={[styles.modalContent, { width: cardWidth }, enterStyle]} onLayout={(event) => beginEntrance(event.nativeEvent.layout.height)}>
          <GestureDetector gesture={gesture}>
            <Reanimated.View style={zoomStyle}>
              {columns === 1
                ? renderCard(offer)
                : <ScrollView style={{ maxHeight: screenHeight - insets.top - insets.bottom - spacing[5] }} contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
                    {activeOffers.map((item) => <View key={item.offerId} style={{ width: gridWidth }}>{renderCard(item, true)}</View>)}
                  </ScrollView>}
            </Reanimated.View>
          </GestureDetector>
        </Animated.View>
      </View>
    </GestureHandlerRootView>
  </Modal>;
}

function makeStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    fill: { flex: 1 },
    backdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.40)" },
    modalContent: { alignItems: "stretch", justifyContent: "center" },
    card: { backgroundColor: theme.surfaceRaised, borderRadius: radius.xl, borderColor: theme.borderColor, borderWidth: borders.hairline, padding: spacing[2], gap: spacing[2], ...elevation.raised },
    gridCard: { borderRadius: radius.lg, padding: spacing[1], gap: spacing[1] },
    imageFrame: { width: "100%", overflow: "hidden", borderRadius: radius.lg },
    image: { width: "100%", backgroundColor: theme.surfaceInset, borderRadius: radius.lg },
    imageFallback: { width: "100%", backgroundColor: theme.surfaceInset, justifyContent: "center", alignItems: "center", borderRadius: radius.lg },
    favorite: { position: "absolute", top: spacing[3], right: spacing[3] },
    share: { position: "absolute", top: spacing[3], left: spacing[3] },
    info: { width: "100%", alignItems: "stretch", gap: spacing[1] },
    name: { ...typography.bodyStrong, color: theme.color, textAlign: "auto", alignSelf: "stretch" },
    compactName: { ...typography.caption, minHeight: 18 },
    unit: { ...typography.caption, color: theme.colorMuted, textAlign: "auto" },
    bottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[1], marginTop: spacing[1] },
    add: { minHeight: sizing.controlMd, minWidth: sizing.controlMd, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: theme.actionBackground, gap: spacing[1] },
    compactAdd: { minHeight: sizing.controlSm, minWidth: sizing.controlSm },
    plus: { ...typography.bodyStrong, color: theme.onAction },
    price: { ...typography.bodyStrong, color: theme.interactiveText, flexShrink: 1, textAlign: "auto" },
    compactPrice: { ...typography.caption },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], paddingVertical: spacing[1] },
  });
}
