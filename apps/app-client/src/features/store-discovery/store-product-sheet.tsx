import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type PublicCatalogResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Image, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StoreProductGallery, type GallerySourceRect } from "./store-product-gallery";

type Offer = PublicCatalogResponse["offers"][number];
export type StoreProductSheetProps = {
  offer: Offer | null;
  galleryOffers: ReadonlyArray<Offer>;
  onBrowseOffer: (offerID: string) => void;
  isFavorite: (offerID: string) => boolean;
  favoriteBusy: boolean;
  onToggleFavorite: (offerID: string) => void;
  onShareOffer: (offerID: string, productID: string, title: string) => void;
  gallerySourceRect?: GallerySourceRect | undefined;
  onQuickAdd: (offerID: string) => void;
  presentation?: "gallery" | "quick";
  anchorY?: number | undefined;
  onShopOtherStore: () => void;
  quantityBaseUnits: number;
  selectedOptionIds: ReadonlyArray<string>;
  busy: boolean;
  added: boolean;
  fulfillmentSelected: boolean;
  orderingUnavailableMessage: string;
  error: string;
  onQuantityChange: (quantity: number) => void;
  onToggleModifier: (groupID: string, optionID: string, maxSelections: number) => void;
  onAdd: () => void;
  onClose: () => void;
  onGoToCart: () => void;
};

const localized = (value: number) => new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 3, useGrouping: false }).format(value);
const money = (value: number) => formatMoney(value, "YER").replace(/ريال يمني/g, "ريال");
const scaleFor = (offer: Offer) => offer.baseUnit === "GRAM" || offer.baseUnit === "MILLILITER" ? 1000 : 1;
const unitFor = (offer: Offer) => offer.baseUnit === "GRAM" ? "كجم" : offer.baseUnit === "MILLILITER" ? "لتر" : /^(عبوة|كيس|علبة|زجاجة|ربطة|كرتون)/.exec(offer.variantTitle?.trim() ?? "")?.[1] ?? "حبة";
const quantityText = (offer: Offer, value: number) => localized(value / scaleFor(offer));
const quantityLabel = (offer: Offer, value: number) => `${quantityText(offer, value)} ${unitFor(offer)}`;

// Parse the written decimal without floating-point multiplication or rounding.
function parseQuantity(text: string, offer: Offer): number | null {
  const normalized = text.trim().replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0)).replace(/[٫,]/g, ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized) || normalized.length > 24) return null;
  const [whole = "", fraction = ""] = normalized.split(".");
  const places = scaleFor(offer) === 1000 ? 3 : 0;
  if (fraction.length > places) return null;
  const value = BigInt(whole) * BigInt(scaleFor(offer)) + BigInt(fraction.padEnd(places, "0") || "0");
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function quantityAllowed(offer: Offer, value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= offer.quantityMinBaseUnits && value <= offer.quantityMaxBaseUnits && (value - offer.quantityMinBaseUnits) % offer.quantityStepBaseUnits === 0;
}

function modifierError(offer: Offer, selected: ReadonlyArray<string>): string {
  if (new Set(selected).size !== selected.length) return "أعد تحديد الإضافات؛ يوجد اختيار مكرر.";
  const options = new Map(offer.modifierGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)));
  if (selected.some((id) => !options.get(id)?.availability)) return "أحد الخيارات لم يعد متاحًا؛ أعد تحديد الإضافات.";
  for (const group of offer.modifierGroups) {
    const count = group.options.filter((option) => selected.includes(option.id)).length;
    if (count < group.minSelections) return `اختر ${group.minSelections} على الأقل من ${group.nameAr}.`;
    if (count > group.maxSelections) return `اختر ${group.maxSelections} كحد أقصى من ${group.nameAr}.`;
  }
  return "";
}

// Preview mirrors DSH CalculateCatalogLineAmount / AddCatalogModifierAmount.
// DSH rejects fractional minor units, and modifier deltas are per base unit.
function lineEstimate(offer: Offer, quantity: number, selected: ReadonlyArray<string>): number | null {
  if (![offer.priceMinor, offer.pricingUnitBaseUnits, quantity].every(Number.isSafeInteger) || offer.priceMinor <= 0 || offer.pricingUnitBaseUnits <= 0 || quantity <= 0 || (offer.pricingBasis === "PER_UNIT" && offer.pricingUnitBaseUnits !== 1)) return null;
  let amount = BigInt(offer.priceMinor) * BigInt(quantity);
  if (offer.pricingBasis === "PER_MEASURE") {
    const divisor = BigInt(offer.pricingUnitBaseUnits);
    if (amount % divisor !== 0n) return null;
    amount /= divisor;
  }
  for (const group of offer.modifierGroups) {
    for (const option of group.options) {
      if (!selected.includes(option.id)) continue;
      if (!Number.isSafeInteger(option.priceDeltaMinor) || option.priceDeltaMinor < 0) return null;
      amount += BigInt(option.priceDeltaMinor) * BigInt(quantity);
    }
  }
  return amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

export function StoreProductSheet(props: StoreProductSheetProps) {
  const { offer, galleryOffers, onBrowseOffer, isFavorite, favoriteBusy, onToggleFavorite, onShareOffer, gallerySourceRect, onQuickAdd, quantityBaseUnits, selectedOptionIds, busy, added, fulfillmentSelected, orderingUnavailableMessage, error, onQuantityChange, onToggleModifier, onAdd, onClose, onGoToCart, onShopOtherStore, presentation = "gallery", anchorY } = props;
  const quick = presentation === "quick";
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = Math.max(240, windowHeight - insets.top - spacing[3]);
  const compactHeight = Math.min(maxHeight, quick ? added ? 180 : Math.min(470, 236 + (offer?.modifierGroups.length ?? 0) * 74) : Math.max(420, windowHeight * 0.82));
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [draft, setDraft] = useState("");
  const sheetHeight = useRef(new Animated.Value(compactHeight)).current;
  const currentHeight = useRef(compactHeight);
  const dragStartHeight = useRef(compactHeight);
  const scrollOffset = useRef(0);
  const lastEmittedQuantity = useRef<number | null>(null);
  const offerId = offer?.offerId;
  const previousOfferId = useRef(offerId);
  const draftOfferId = useRef(offerId);
  const inputScale = offer ? scaleFor(offer) : 1;
  const browsableOffers = galleryOffers.length ? galleryOffers : offer ? [offer] : [];
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    // Reset only on product identity, not when the compact snap height changes.
    if (previousOfferId.current === offerId) return;
    previousOfferId.current = offerId;
    setExpanded(false);
    expandedRef.current = false;
    setDragging(false);
    scrollOffset.current = 0;
    lastEmittedQuantity.current = null;
    sheetHeight.stopAnimation();
    sheetHeight.setValue(compactHeight);
    currentHeight.current = compactHeight;
  }, [offerId, compactHeight, sheetHeight]);

  useEffect(() => {
    const changedOffer = draftOfferId.current !== offerId;
    draftOfferId.current = offerId;
    if (!changedOffer && quantityBaseUnits === lastEmittedQuantity.current) return;
    setDraft(localized(quantityBaseUnits / inputScale));
  }, [offerId, inputScale, quantityBaseUnits]);

  useEffect(() => {
    const nextHeight = expandedRef.current ? maxHeight : compactHeight;
    sheetHeight.stopAnimation();
    sheetHeight.setValue(nextHeight);
    currentHeight.current = nextHeight;
  }, [compactHeight, maxHeight, sheetHeight]);

  const snap = useCallback((toExpanded: boolean) => {
    const target = toExpanded ? maxHeight : compactHeight;
    sheetHeight.stopAnimation();
    setExpanded(toExpanded);
    expandedRef.current = toExpanded;
    if (reduceMotion) { sheetHeight.setValue(target); currentHeight.current = target; return; }
    Animated.timing(sheetHeight, { toValue: target, duration: 180, useNativeDriver: false }).start(({ finished }) => { if (finished) currentHeight.current = target; });
  }, [compactHeight, maxHeight, reduceMotion, sheetHeight]);

  const startDrag = useCallback(() => {
    Keyboard.dismiss();
    setDragging(true);
    sheetHeight.stopAnimation((height) => { currentHeight.current = height; dragStartHeight.current = height; });
  }, [sheetHeight]);

  const moveDrag = useCallback((dy: number) => {
    const value = Math.max(0, Math.min(maxHeight, dragStartHeight.current - dy));
    currentHeight.current = value;
    sheetHeight.setValue(value);
  }, [maxHeight, sheetHeight]);

  const finishDrag = useCallback((dy: number, vy: number) => {
    setDragging(false);
    if (currentHeight.current < compactHeight - 100 || (dragStartHeight.current <= compactHeight + 2 && dy > 85 && vy > 0.6)) { onClose(); return; }
    snap(vy < -0.4 || (vy <= 0.4 && currentHeight.current > (compactHeight + maxHeight) / 2));
  }, [compactHeight, maxHeight, onClose, snap]);

  const dragHandle = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: startDrag,
    onPanResponderMove: (_, gesture) => moveDrag(gesture.dy),
    onPanResponderRelease: (_, gesture) => finishDrag(gesture.dy, gesture.vy),
    onPanResponderTerminate: () => { setDragging(false); snap(expanded); },
  }), [expanded, finishDrag, moveDrag, snap, startDrag]);
  const dragContent = useMemo(() => PanResponder.create({
    // At the top, dragging down collapses the sheet. Horizontal photo swipes and
    // normal scrolling in the expanded sheet stay with their native scroll view.
    onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dy) > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.4 && ((!expanded && gesture.dy < 0) || (scrollOffset.current <= 0 && gesture.dy > 0)),
    onPanResponderGrant: startDrag,
    onPanResponderMove: (_, gesture) => moveDrag(gesture.dy),
    onPanResponderRelease: (_, gesture) => finishDrag(gesture.dy, gesture.vy),
    onPanResponderTerminate: () => { setDragging(false); snap(expanded); },
  }), [expanded, finishDrag, moveDrag, snap, startDrag]);

  if (!offer) return null;
  const parsed = parseQuantity(draft, offer);
  const validQuantity = quantityAllowed(offer, parsed);
  const modifiersInvalid = modifierError(offer, selectedOptionIds);
  const estimate = validQuantity && !modifiersInvalid ? lineEstimate(offer, parsed, selectedOptionIds) : null;
  const quantityError = !validQuantity ? `أدخل كمية بين ${quantityLabel(offer, offer.quantityMinBaseUnits)} و${quantityLabel(offer, offer.quantityMaxBaseUnits)}، بزيادة ${quantityLabel(offer, offer.quantityStepBaseUnits)}.` : "";
  const unavailable = !offer.availability || !offer.productActive || !offer.variantActive || offer.publicationState !== "published";

  function editQuantity(text: string) {
    setDraft(text);
    const value = parseQuantity(text, offer!);
    if (quantityAllowed(offer!, value)) { lastEmittedQuantity.current = value; onQuantityChange(value); }
  }

  function stepQuantity(direction: -1 | 1) {
    // Invalid drafts recover to the last valid canonical quantity on either key.
    const value = validQuantity ? parsed + direction * offer!.quantityStepBaseUnits : quantityAllowed(offer!, quantityBaseUnits) ? quantityBaseUnits : offer!.quantityMinBaseUnits;
    if (!quantityAllowed(offer!, value)) return;
    lastEmittedQuantity.current = value;
    setDraft(quantityText(offer!, value));
    onQuantityChange(value);
  }

  const canDecrease = !validQuantity || quantityAllowed(offer, parsed - offer.quantityStepBaseUnits);
  const canIncrease = !validQuantity || quantityAllowed(offer, parsed + offer.quantityStepBaseUnits);
  if (!quick) return <StoreProductGallery
    offer={offer}
    offers={browsableOffers}
    sourceRect={gallerySourceRect}
    isFavorite={isFavorite}
    favoriteBusy={favoriteBusy}
    onToggleFavorite={onToggleFavorite}
    onQuickAdd={onQuickAdd}
    onShare={onShareOffer}
    onBrowse={onBrowseOffer}
    onClose={onClose}
  />;

  const thumbnailUri = offer.media.find((media) => media.role === "primary")?.uri ?? offer.media[0]?.uri;
  return <Modal visible transparent animationType={quick ? "fade" : "slide"} onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={[styles.backdrop, quick && styles.quickBackdrop]}>
      <Pressable accessibilityRole="button" accessibilityLabel="إغلاق تفاصيل المنتج" onPress={onClose} style={StyleSheet.absoluteFill} />
      <Animated.View accessibilityViewIsModal style={[styles.sheet, quick && styles.quickSheet, quick ? { bottom: Math.max(insets.bottom + spacing[2], Math.min(windowHeight - (anchorY ?? windowHeight) + spacing[2], windowHeight - compactHeight - insets.top - spacing[2])) } : null, { height: sheetHeight, paddingBottom: quick ? spacing[3] : Math.max(insets.bottom, spacing[3]) }]}>
        {!quick ? <View {...dragHandle.panHandlers} style={styles.dragTarget} accessibilityLabel="اسحب لتمديد التفاصيل أو تصغيرها"><View style={styles.dragHandle} /></View> : null}
        <View style={styles.quickHeading}>
          <View style={styles.quickIdentity}>
            {thumbnailUri ? <Image accessibilityLabel={"صورة " + offer.productName} source={{ uri: thumbnailUri }} style={styles.quickThumb} resizeMode="cover" /> : <View style={[styles.quickThumb, styles.quickThumbFallback]}><BthwaniIcon name="store" size={sizing.iconSm} color={theme.colorMuted} /></View>}
            <View style={styles.quickIdentityCopy}>
              <Text numberOfLines={1} accessibilityRole="header" style={styles.quickName}>{offer.productName}</Text>
              <Text numberOfLines={1} style={styles.quickPrice}>{money(offer.priceMinor)} / {quantityLabel(offer, offer.pricingUnitBaseUnits)}</Text>
            </View>
          </View>
          <BthwaniIconButton icon="share" label="مشاركة المنتج" onPress={() => onShareOffer(offer.offerId,offer.productId,offer.productName)} size={sizing.controlMd} tone="soft" />
          <BthwaniIconButton icon="close" label="إغلاق اختيار الكمية" onPress={onClose} size={sizing.controlMd} tone="soft" />
        </View>
        {added ? <View style={styles.quickDone}>
          <Text accessibilityLiveRegion="polite" style={styles.success}>أُضيف إلى السلة</Text>
          <View style={styles.completionActions}>
            <Pressable accessibilityRole="button" onPress={onGoToCart} style={[styles.choiceTab, styles.choiceTabPrimary]}><Text numberOfLines={2} style={styles.choicePrimaryText}>الانتقال للسلة</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.choiceTab}><Text numberOfLines={2} style={styles.choiceTabText}>متابعة التسوق</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={onShopOtherStore} style={styles.choiceTab}><Text numberOfLines={2} style={styles.choiceTabText}>متجر آخر</Text></Pressable>
          </View>
        </View> : <>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quickForm}>
            <View style={styles.quantityRow}>
              <Text style={styles.quickQuantityLabel}>الكمية ({unitFor(offer)})</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="زيادة الكمية" accessibilityState={{ disabled: busy || !canIncrease }} disabled={busy || !canIncrease} onPress={() => stepQuantity(1)} style={[styles.step, (busy || !canIncrease) && styles.disabled]}><Text style={styles.stepText}>+</Text></Pressable>
              <TextInput accessibilityLabel={"الكمية بـ " + unitFor(offer)} accessibilityHint={"من " + quantityLabel(offer, offer.quantityMinBaseUnits) + " إلى " + quantityLabel(offer, offer.quantityMaxBaseUnits)} value={draft} onChangeText={editQuantity} editable={!busy} keyboardType={scaleFor(offer) === 1 ? "number-pad" : "decimal-pad"} selectTextOnFocus style={[styles.quantityInput, Boolean(quantityError) && styles.invalid]} />
              <Pressable accessibilityRole="button" accessibilityLabel="تقليل الكمية" accessibilityState={{ disabled: busy || !canDecrease }} disabled={busy || !canDecrease} onPress={() => stepQuantity(-1)} style={[styles.step, (busy || !canDecrease) && styles.disabled]}><Text style={styles.stepText}>−</Text></Pressable>
            </View>
            {offer.modifierGroups.map((group) => <View key={group.id} style={styles.quickGroup}>
              <Text style={styles.label}>{group.nameAr}{group.minSelections > 0 ? " *" : ""}</Text>
              <View style={styles.options}>{group.options.filter((option) => option.availability).map((option) => <BthwaniChip key={option.id} label={option.nameAr + (option.priceDeltaMinor ? " · +" + money(option.priceDeltaMinor) : "")} selected={selectedOptionIds.includes(option.id)} disabled={busy} onPress={() => onToggleModifier(group.id, option.id, group.maxSelections)} />)}</View>
            </View>)}
            {quantityError ? <Text accessibilityRole="alert" style={styles.error}>{quantityError}</Text> : null}
            {modifiersInvalid ? <Text accessibilityRole="alert" style={styles.error}>{modifiersInvalid}</Text> : null}
            {unavailable ? <Text accessibilityRole="alert" style={styles.error}>المنتج غير متاح.</Text> : null}
            {!fulfillmentSelected ? <Text style={styles.muted}>{orderingUnavailableMessage}</Text> : null}
            {validQuantity && !modifiersInvalid && estimate === null ? <Text accessibilityRole="alert" style={styles.error}>تعذر حساب قيمة الاختيار.</Text> : null}
            {offer.quantityPolicy === "VARIABLE_MEASURE" ? <Text style={styles.quickHint}>القيمة تقديرية حتى تأكيد الوزن.</Text> : null}
          </ScrollView>
          <View style={styles.quickFooter}>
            <Text numberOfLines={1} accessibilityLiveRegion="polite" style={styles.quickTotal}>{estimate === null ? "—" : money(estimate)}</Text>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <BthwaniButton label="إضافة للسلة" accessibilityLabel={"إضافة " + offer.productName + " إلى السلة"} busy={busy} disabled={busy || unavailable || !fulfillmentSelected || !validQuantity || Boolean(modifiersInvalid) || estimate === null} onPress={onAdd} />
          </View>
        </>}
      </Animated.View>
    </KeyboardAvoidingView>
  </Modal>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    backdrop: { backgroundColor: "rgba(0,0,0,0.42)", flex: 1, justifyContent: "flex-end" },
    quickBackdrop: { backgroundColor: "rgba(0,0,0,0.15)" },
    galleryOnlyBackdrop: { justifyContent: "center", paddingHorizontal: spacing[3] },
    galleryOnlyContainer: { width: "100%", maxHeight: "100%" },
    sheet: { backgroundColor: theme.surfaceRaised, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "100%", overflow: "hidden", paddingHorizontal: spacing[4] },
    quickSheet: { position: "absolute", left: spacing[2], right: spacing[2], borderRadius: radius.xl, borderColor: theme.borderColor, borderWidth: borders.hairline, elevation: 9, paddingHorizontal: spacing[3] },
    quickHeading: { alignItems: "center", flexDirection: "row", gap: spacing[1], paddingTop: spacing[2], paddingBottom: spacing[1] },
    quickIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing[2] },
    quickThumb: { width: 46, height: 46, borderRadius: radius.md },
    quickThumbFallback: { alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceInset },
    quickIdentityCopy: { flex: 1, minWidth: 0, gap: spacing[1] },
    quickName: { ...typography.bodyStrong, color: theme.color, textAlign: "auto" },
    quickPrice: { ...typography.caption, color: theme.interactiveText, textAlign: "auto" },
    quickForm: { gap: spacing[2], paddingBottom: spacing[1] },
    quickQuantityLabel: { ...typography.caption, color: theme.color, flexShrink: 1 },
    quickGroup: { gap: spacing[1] },
    quickHint: { ...typography.caption, color: theme.colorMuted },
    quickFooter: { borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, paddingTop: spacing[2], gap: spacing[1], paddingBottom: spacing[1] },
    quickTotal: { ...typography.bodyStrong, color: theme.interactiveText, textAlign: "auto" },
    quickDone: { gap: spacing[2], justifyContent: "center", flex: 1, paddingBottom: spacing[1] },
    choiceTab: { backgroundColor: theme.actionSoft, borderRadius: radius.md, minHeight: 43, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing[1], flex: 1 },
    choiceTabPrimary: { backgroundColor: theme.actionBackground },
    choiceTabText: { ...typography.caption, color: theme.interactiveText, textAlign: "center" },
    choicePrimaryText: { ...typography.caption, color: theme.onAction, textAlign: "center" },
    dragTarget: { alignItems: "center", height: sizing.controlMd, justifyContent: "center" },
    dragHandle: { backgroundColor: theme.borderColorStrong, borderRadius: radius.round, height: spacing[1], width: spacing[8] },
    heading: { alignItems: "center", flexDirection: "row", gap: spacing[2], paddingBottom: spacing[2] },
    title: { ...typography.titleSm, color: theme.color, flex: 1, textAlign: "right" },
    headingTitle: { flex: 1, minWidth: 0, textAlign: "auto" },
    fullWidthText: { alignSelf: "stretch", width: "100%", textAlign: "auto" },
    expand: { justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[2] },
    expandText: { ...typography.bodySm, color: theme.interactiveText },
    content: { flex: 1 },
    details: { gap: spacing[3], paddingBottom: spacing[4] },
    quickDetails: { gap: spacing[2], paddingBottom: spacing[2] },
    image: { backgroundColor: theme.surfaceInset, borderRadius: radius.lg },
    galleryBrowser: { gap: spacing[2] },
    galleryProductCard: { borderRadius: radius.xl, backgroundColor: theme.surface, padding: spacing[2], gap: spacing[2], alignItems: "stretch" },
    galleryProductInfo: { gap: spacing[1], alignItems: "stretch", width: "100%" },
    expandedProductCard: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.xl, padding: spacing[2], gap: spacing[2], ...elevation.raised },
    expandedImageFrame: { width: "100%", position: "relative", overflow: "hidden", borderRadius: radius.lg },
    expandedImage: { width: "100%", backgroundColor: theme.surfaceInset, borderRadius: radius.lg },
    expandedImagePlaceholder: { alignItems: "center", justifyContent: "center", gap: spacing[2], backgroundColor: theme.surfaceInset, borderRadius: radius.lg, minHeight: 218 },
    expandedFavorite: { position: "absolute", right: spacing[2], top: spacing[2] },
    expandedProductInfo: { gap: spacing[1], width: "100%", alignItems: "stretch" },
    expandedProductName: { ...typography.bodyStrong, color: theme.color, textAlign: "auto" },
    expandedProductUnit: { ...typography.caption, color: theme.colorMuted, textAlign: "auto" },
    expandedCardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2], paddingTop: spacing[1] },
    expandedProductPrice: { ...typography.bodyStrong, color: theme.interactiveText, flexShrink: 1, textAlign: "auto" },
    expandedAddButton: { backgroundColor: theme.actionBackground, minWidth: sizing.controlMd, minHeight: sizing.controlMd, borderRadius: radius.md, paddingHorizontal: spacing[2], justifyContent: "center", alignItems: "center", flexDirection: "row", gap: spacing[1] },
    expandedAddLabel: { ...typography.bodyStrong, color: theme.onAction },
    mediaThumbnails: { gap: spacing[2], paddingVertical: spacing[1] },
    thumbnailFrame: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, padding: 2 },
    thumbnailSelected: { borderColor: theme.interactiveText, borderWidth: 2 },
    thumbnailImage: { borderRadius: radius.sm, width: 44, height: 44 },
    neighbors: { gap: spacing[2], marginTop: spacing[2] },
    neighborCard: { alignItems: "center", flexDirection: "row", borderRadius: radius.lg, borderColor: theme.borderColor, borderWidth: borders.hairline, padding: spacing[2], gap: spacing[3] },
    neighborImage: { height: 76, width: 76, borderRadius: radius.md },
    neighborCopy: { flex: 1, minWidth: 0, alignItems: "stretch", gap: spacing[1] },
    imageFallback: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: radius.lg, gap: spacing[2], justifyContent: "center" },
    emptyMedia: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: radius.lg, gap: spacing[2], padding: spacing[4] },
    galleryControls: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
    counter: { ...typography.caption, color: theme.colorMuted, textAlign: "center" },
    price: { ...typography.bodyStrong, color: theme.interactiveText, textAlign: "auto" },
    label: { ...typography.bodyStrong, color: theme.color, textAlign: "auto" },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: "auto" },
    description: { ...typography.bodySm, color: theme.color, textAlign: "right" },
    quantityRow: { alignItems: "center", flexDirection: "row", gap: spacing[1] },
    quantityInput: { ...typography.bodyStrong, backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, flex: 1, minWidth: 36, minHeight: sizing.controlMd, paddingHorizontal: spacing[1], textAlign: "center" },
    invalid: { borderColor: theme.danger },
    step: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, justifyContent: "center", minHeight: sizing.controlMd, minWidth: sizing.controlMd },
    stepText: { ...typography.titleSm, color: theme.interactiveText },
    disabled: { opacity: 0.45 },
    group: { gap: spacing[2] },
    options: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], justifyContent: "flex-end" },
    footer: { borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[2], paddingTop: spacing[3] },
    estimate: { ...typography.bodyStrong, color: theme.color, textAlign: "auto" },
    success: { ...typography.bodyStrong, color: theme.success, textAlign: "right" },
    error: { ...typography.bodySm, color: theme.danger, textAlign: "right" },
    actions: { flexDirection: "row", gap: spacing[2] },
    completionActions: { flexDirection: "row", gap: spacing[1] },
    action: { flexGrow: 1, minWidth: 92 },
  });
}
