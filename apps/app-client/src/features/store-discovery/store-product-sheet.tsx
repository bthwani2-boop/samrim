import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type PublicCatalogResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Offer = PublicCatalogResponse["offers"][number];
export type StoreProductSheetProps = {
  offer: Offer | null;
  quantityBaseUnits: number;
  selectedOptionIds: ReadonlyArray<string>;
  busy: boolean;
  added: boolean;
  fulfillmentSelected: boolean;
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
const unitFor = (offer: Offer) => offer.baseUnit === "GRAM" ? "كجم" : offer.baseUnit === "MILLILITER" ? "لتر" : "حبة";
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
  const { offer, quantityBaseUnits, selectedOptionIds, busy, added, fulfillmentSelected, error, onQuantityChange, onToggleModifier, onAdd, onClose, onGoToCart } = props;
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const maxHeight = Math.max(240, windowHeight - insets.top - spacing[3]);
  const compactHeight = Math.min(maxHeight, Math.max(360, windowHeight * 0.72));
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [draft, setDraft] = useState("");
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(new Set());
  const [imageAttempts, setImageAttempts] = useState<Record<string, number>>({});
  const [imageIndex, setImageIndex] = useState(0);
  const [galleryWidth, setGalleryWidth] = useState(Math.max(1, windowWidth - spacing[4] * 2));
  const sheetHeight = useRef(new Animated.Value(compactHeight)).current;
  const currentHeight = useRef(compactHeight);
  const dragStartHeight = useRef(compactHeight);
  const scrollOffset = useRef(0);
  const lastEmittedQuantity = useRef<number | null>(null);
  const inputScale = offer ? scaleFor(offer) : 1;
  const galleryRef = useRef<FlatList<Offer["media"][number]> | null>(null);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    setExpanded(false);
    expandedRef.current = false;
    setDragging(false);
    setFailedImages(new Set());
    setImageAttempts({});
    setImageIndex(0);
    scrollOffset.current = 0;
    lastEmittedQuantity.current = null;
    // The next offer starts at the compact snap point, independent of old drags.
    sheetHeight.stopAnimation();
    sheetHeight.setValue(compactHeight);
    currentHeight.current = compactHeight;
  // Reset only on product identity; editing a valid decimal must retain its text.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer?.offerId]);

  useEffect(() => {
    if (quantityBaseUnits === lastEmittedQuantity.current) return;
    setDraft(localized(quantityBaseUnits / inputScale));
  }, [offer?.offerId, inputScale, quantityBaseUnits]);

  useEffect(() => {
    const nextHeight = expandedRef.current ? maxHeight : compactHeight;
    sheetHeight.stopAnimation();
    sheetHeight.setValue(nextHeight);
    currentHeight.current = nextHeight;
  }, [compactHeight, maxHeight, sheetHeight]);

  useEffect(() => {
    galleryRef.current?.scrollToOffset({ offset: imageIndex * galleryWidth, animated: false });
  }, [galleryWidth, imageIndex]);

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
  return <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="إغلاق تفاصيل المنتج" onPress={onClose} style={StyleSheet.absoluteFill} />
      <Animated.View accessibilityViewIsModal style={[styles.sheet, { height: sheetHeight, paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
        <View {...dragHandle.panHandlers} style={styles.dragTarget} accessibilityLabel="اسحب لتمديد التفاصيل أو تصغيرها"><View style={styles.dragHandle} /></View>
        <View style={styles.heading}>
          <BthwaniIconButton icon="close" label="إغلاق تفاصيل المنتج" onPress={onClose} size={sizing.controlMd} tone="soft" />
          <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "تصغير تفاصيل المنتج" : "تمديد تفاصيل المنتج"} accessibilityState={{ expanded }} onPress={() => snap(!expanded)} style={styles.expand}><Text style={styles.expandText}>{expanded ? "تصغير" : "تمديد"}</Text></Pressable>
          <Text accessibilityRole="header" style={styles.title}>{offer.productName}</Text>
        </View>
        <View {...dragContent.panHandlers} style={styles.content}>
          <ScrollView scrollEnabled={!dragging} scrollEventThrottle={16} onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.y; }} contentContainerStyle={styles.details} keyboardShouldPersistTaps="handled">
            <View onLayout={(event) => setGalleryWidth(Math.max(1, event.nativeEvent.layout.width))}>
              {offer.media.length ? <FlatList ref={galleryRef} horizontal pagingEnabled data={offer.media} keyExtractor={(media, index) => `${media.uri}:${index}`} showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(event) => setImageIndex(Math.max(0, Math.min(offer.media.length - 1, Math.round(event.nativeEvent.contentOffset.x / galleryWidth))))} renderItem={({ item: media, index }) => {
                const key = `${media.uri}:${index}`;
                const frame = { width: galleryWidth, height: Math.max(150, Math.min(260, galleryWidth * 0.65)) };
                return failedImages.has(key) ? <View style={[styles.imageFallback, frame]}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.muted}>تعذر تحميل هذه الصورة</Text><BthwaniButton label="إعادة تحميل الصورة" variant="secondary" onPress={() => { setFailedImages((current) => { const next = new Set(current); next.delete(key); return next; }); setImageAttempts((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 })); }} /></View> : <Image key={`${key}:${imageAttempts[key] ?? 0}`} accessibilityLabel={`صورة ${offer.productName} ${index + 1} من ${offer.media.length}`} source={{ uri: media.uri }} resizeMode="contain" style={[styles.image, frame]} onError={() => setFailedImages((current) => new Set(current).add(key))} />;
              }} /> : <View style={styles.emptyMedia}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.muted}>لا توجد صور لهذا المنتج</Text></View>}
              {offer.media.length > 1 ? <View style={styles.galleryControls}>
                <Pressable accessibilityRole="button" accessibilityLabel="الصورة السابقة" disabled={imageIndex === 0} accessibilityState={{ disabled: imageIndex === 0 }} onPress={() => setImageIndex((index) => Math.max(0, index - 1))} style={styles.expand}><Text style={[styles.expandText, imageIndex === 0 && styles.disabled]}>السابق</Text></Pressable>
                <Text accessibilityLiveRegion="polite" style={styles.counter}>{localized(imageIndex + 1)} / {localized(offer.media.length)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="الصورة التالية" disabled={imageIndex === offer.media.length - 1} accessibilityState={{ disabled: imageIndex === offer.media.length - 1 }} onPress={() => setImageIndex((index) => Math.min(offer.media.length - 1, index + 1))} style={styles.expand}><Text style={[styles.expandText, imageIndex === offer.media.length - 1 && styles.disabled]}>التالي</Text></Pressable>
              </View> : null}
            </View>
            <Text style={styles.price}>{money(offer.priceMinor)} / {quantityLabel(offer, offer.pricingUnitBaseUnits)}</Text>
            {offer.variantTitle ? <Text style={styles.muted}>{offer.variantTitle}</Text> : null}
            {offer.productDescription ? <Text style={styles.description}>{offer.productDescription}</Text> : null}
            <Text style={styles.label}>الكمية ({unitFor(offer)})</Text>
            <View style={styles.quantityRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="تقليل الكمية" accessibilityState={{ disabled: busy || !canDecrease }} disabled={busy || !canDecrease} onPress={() => stepQuantity(-1)} style={[styles.step, (busy || !canDecrease) && styles.disabled]}><Text style={styles.stepText}>−</Text></Pressable>
              <TextInput accessibilityLabel={`الكمية بـ ${unitFor(offer)}`} accessibilityHint={`من ${quantityLabel(offer, offer.quantityMinBaseUnits)} إلى ${quantityLabel(offer, offer.quantityMaxBaseUnits)}`} value={draft} onChangeText={editQuantity} editable={!busy} keyboardType={scaleFor(offer) === 1 ? "number-pad" : "decimal-pad"} selectTextOnFocus style={[styles.quantityInput, Boolean(quantityError) && styles.invalid]} />
              <Pressable accessibilityRole="button" accessibilityLabel="زيادة الكمية" accessibilityState={{ disabled: busy || !canIncrease }} disabled={busy || !canIncrease} onPress={() => stepQuantity(1)} style={[styles.step, (busy || !canIncrease) && styles.disabled]}><Text style={styles.stepText}>+</Text></Pressable>
            </View>
            <Text style={styles.muted}>الحد {quantityLabel(offer, offer.quantityMinBaseUnits)}–{quantityLabel(offer, offer.quantityMaxBaseUnits)} · الزيادة {quantityLabel(offer, offer.quantityStepBaseUnits)}</Text>
            {quantityError ? <Text accessibilityRole="alert" style={styles.error}>{quantityError}</Text> : null}
            {offer.modifierGroups.map((group) => <View key={group.id} style={styles.group}><Text style={styles.label}>{group.nameAr}{group.minSelections > 0 ? " · مطلوب" : " · اختياري"}</Text><Text style={styles.muted}>من {localized(group.minSelections)} إلى {localized(group.maxSelections)} خيارات</Text><View style={styles.options}>{group.options.filter((option) => option.availability).map((option) => <BthwaniChip key={option.id} label={`${option.nameAr}${option.priceDeltaMinor ? ` · +${money(option.priceDeltaMinor)}` : ""}`} selected={selectedOptionIds.includes(option.id)} disabled={busy} onPress={() => onToggleModifier(group.id, option.id, group.maxSelections)} />)}</View></View>)}
            {modifiersInvalid ? <Text accessibilityRole="alert" style={styles.error}>{modifiersInvalid}</Text> : null}
            {unavailable ? <Text accessibilityRole="alert" style={styles.error}>هذا المنتج غير متاح للإضافة الآن.</Text> : null}
            {!fulfillmentSelected ? <Text style={styles.muted}>اختر طريقة الطلب من صفحة المتجر قبل الإضافة.</Text> : null}
          </ScrollView>
        </View>
        <View style={styles.footer}>
          {!added ? <Text accessibilityLiveRegion="polite" style={styles.estimate}>{estimate === null ? "أكمل الكمية والخيارات لعرض القيمة" : `${offer.quantityPolicy === "VARIABLE_MEASURE" ? "القيمة التقديرية" : "قيمة الاختيار"}: ${money(estimate)}`}</Text> : <Text accessibilityLiveRegion="polite" style={styles.success}>أُضيف المنتج إلى السلة</Text>}
          {offer.quantityPolicy === "VARIABLE_MEASURE" && !added ? <Text style={styles.muted}>تُراجع القيمة عند تأكيد الوزن الفعلي.</Text> : null}
          {validQuantity && !modifiersInvalid && estimate === null ? <Text accessibilityRole="alert" style={styles.error}>لا يمكن حساب قيمة صحيحة لهذه الكمية؛ عدّلها وفق الزيادة المحددة.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {added ? <View style={styles.actions}><BthwaniButton style={styles.action} label="متابعة التسوق" variant="secondary" onPress={onClose} /><BthwaniButton style={styles.action} label="الانتقال للسلة" onPress={onGoToCart} /></View> : <BthwaniButton label="إضافة إلى السلة" accessibilityLabel={`إضافة ${offer.productName} إلى السلة`} busy={busy} disabled={busy || unavailable || !fulfillmentSelected || !validQuantity || Boolean(modifiersInvalid) || estimate === null} onPress={onAdd} />}
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  </Modal>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    backdrop: { backgroundColor: "rgba(0,0,0,0.42)", flex: 1, justifyContent: "flex-end" },
    sheet: { backgroundColor: theme.surfaceRaised, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "100%", overflow: "hidden", paddingHorizontal: spacing[4] },
    dragTarget: { alignItems: "center", height: sizing.controlMd, justifyContent: "center" },
    dragHandle: { backgroundColor: theme.borderColorStrong, borderRadius: radius.round, height: spacing[1], width: spacing[8] },
    heading: { alignItems: "center", flexDirection: "row", gap: spacing[2], paddingBottom: spacing[2] },
    title: { ...typography.titleSm, color: theme.color, flex: 1, textAlign: "right" },
    expand: { justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[2] },
    expandText: { ...typography.bodySm, color: theme.interactiveText },
    content: { flex: 1 },
    details: { gap: spacing[3], paddingBottom: spacing[4] },
    image: { backgroundColor: theme.surfaceInset, borderRadius: radius.lg },
    imageFallback: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: radius.lg, gap: spacing[2], justifyContent: "center" },
    emptyMedia: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: radius.lg, gap: spacing[2], padding: spacing[4] },
    galleryControls: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
    counter: { ...typography.caption, color: theme.colorMuted, textAlign: "center" },
    price: { ...typography.bodyStrong, color: theme.interactiveText, textAlign: "right" },
    label: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
    description: { ...typography.bodySm, color: theme.color, textAlign: "right" },
    quantityRow: { alignItems: "center", flexDirection: "row", gap: spacing[3] },
    quantityInput: { ...typography.bodyStrong, backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, flex: 1, minHeight: sizing.controlLg, paddingHorizontal: spacing[3], textAlign: "center" },
    invalid: { borderColor: theme.danger },
    step: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, justifyContent: "center", minHeight: sizing.controlLg, minWidth: sizing.controlLg },
    stepText: { ...typography.titleSm, color: theme.interactiveText },
    disabled: { opacity: 0.45 },
    group: { gap: spacing[2] },
    options: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], justifyContent: "flex-end" },
    footer: { borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[2], paddingTop: spacing[3] },
    estimate: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    success: { ...typography.bodyStrong, color: theme.success, textAlign: "right" },
    error: { ...typography.bodySm, color: theme.danger, textAlign: "right" },
    actions: { flexDirection: "row", gap: spacing[2] },
    action: { flex: 1 },
  });
}
