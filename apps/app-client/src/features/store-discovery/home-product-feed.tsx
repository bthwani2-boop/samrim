import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CatalogStoreOffer, formatMoney } from "@bthwani/dsh";
import * as Haptics from "expo-haptics";
import { Image as ExpoImage } from "expo-image";
import { type Href, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Reanimated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { adjustSimpleOfferQuantity, listOwnOpenCarts, readOwnStoreCart } from "../cart-checkout/cart-client";
import { subscribeClientCartActorChanges } from "../cart-checkout/cart-session-scope";
import { searchPublicCatalog } from "./store-discovery-client";

type FeedState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "invalid_query" }
  | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer>; nextCursor: string };

const PAGE_SIZE = 18;

function currentHomeActorID(): string {
  const session = currentIdentityState();
  return session.kind === "authenticated" ? session.identity.subject.trim() : "";
}

type CatalogPriceSort = "" | "PRICE_ASC" | "PRICE_DESC";
const SORT_OPTIONS: ReadonlyArray<{ value: CatalogPriceSort; label: string }> = [
  { value: "", label: "الموصى به" },
  { value: "PRICE_ASC", label: "السعر: من الأقل للأعلى" },
  { value: "PRICE_DESC", label: "السعر: من الأعلى للأقل" },
];

export function HomeProductFeed({
  cityID, verticalID, categoryID, shortcutID, query = "", isAuthenticated, onRequireAuthentication, onClearCategory, pageSize = PAGE_SIZE,
}: {
  cityID: string | null;
  verticalID: string;
  categoryID: string;
  shortcutID: string;
  query?: string;
  isAuthenticated: boolean;
  onRequireAuthentication?: (() => void) | undefined;
  onClearCategory?: (() => void) | undefined;
  pageSize?: number;
}) {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const columns = width >= 1050 ? 5 : width >= 720 ? 4 : width >= 540 || (Platform.OS !== "web" && width >= 360) ? 3 : 2;
  const effectivePageSize = Number.isInteger(pageSize) ? Math.max(1, Math.min(PAGE_SIZE, pageSize)) : PAGE_SIZE;
  const normalizedQuery = query.trim();
  const [state, setState] = useState<FeedState>({ kind: "loading" });
  const [sort, setSort] = useState<CatalogPriceSort>("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [busyID, setBusyID] = useState("");
  const [cartMessage, setCartMessage] = useState("");
  const [cartQuantities, setCartQuantities] = useState<Readonly<Record<string, number>>>({});
  const busyOfferRef = useRef("");
  const requestID = useRef(0);
  const activeActorIDRef = useRef(currentHomeActorID());
  const cartReadRevisionRef = useRef(0);
  const [actorRevision, setActorRevision] = useState(0);

  const load = useCallback(async () => {
    const id = ++requestID.current;
    setState({ kind: "loading" });
    setLoadingMore(false);
    setMoreError(false);
    if (!cityID) {
      setState({ kind: "ready", offers: [], nextCursor: "" });
      return;
    }
    if (Array.from(normalizedQuery).length > 160) {
      if (id === requestID.current) setState({ kind: "invalid_query" });
      return;
    }
    try {
      const page = await searchPublicCatalog(cityID, normalizedQuery, categoryID, effectivePageSize, "", verticalID, shortcutID, sort);
      if (id === requestID.current) setState({ kind: "ready", offers: page.offers, nextCursor: page.nextCursor ?? "" });
    } catch {
      if (id === requestID.current) setState({ kind: "error" });
    }
  }, [cityID, verticalID, categoryID, shortcutID, effectivePageSize, normalizedQuery, sort]);

  useEffect(() => {
    if (normalizedQuery) {
      setState({ kind: "loading" });
      const timer = setTimeout(() => { void load(); }, 300);
      return () => { clearTimeout(timer); requestID.current += 1; };
    }
    void load();
    return () => { requestID.current += 1; };
  }, [load, normalizedQuery]);

  const loadMore = async () => {
    if (state.kind !== "ready" || !state.nextCursor || !cityID || loadingMore) return;
    const id = ++requestID.current;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await searchPublicCatalog(cityID, normalizedQuery, categoryID, PAGE_SIZE, state.nextCursor, verticalID, shortcutID, sort);
      if (id === requestID.current) {
        setState((current) => current.kind === "ready"
          ? { kind: "ready", offers: [...current.offers, ...page.offers], nextCursor: page.nextCursor ?? "" }
          : current);
      }
    } catch {
      if (id === requestID.current) setMoreError(true);
    } finally {
      if (id === requestID.current) setLoadingMore(false);
    }
  };

  useEffect(() => {
    const subscription = subscribeClientCartActorChanges(
      activeActorIDRef.current,
      currentHomeActorID,
      (listener) => subscribeIdentitySession((session) => {
        listener(session.kind === "authenticated" ? session.identity.subject.trim() : "");
      }),
      (actorID) => {
        activeActorIDRef.current = actorID;
        cartReadRevisionRef.current += 1;
        // Product catalog is public; cart quantities and pending mutations are not.
        setCartQuantities({});
        setCartMessage("");
        busyOfferRef.current = "";
        setBusyID("");
        setActorRevision((current) => current + 1);
      },
    );
    return () => {
      cartReadRevisionRef.current += 1;
      subscription.unsubscribe();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Actor revision must trigger a fresh private cart read when the signed-in account changes without changing public catalog state.
  useEffect(() => {
    if (!isAuthenticated || !currentHomeActorID() || state.kind !== "ready") {
      setCartQuantities({});
      return;
    }
    let cancelled = false;
    const revision = cartReadRevisionRef.current;
    const eligibleStores = new Set(state.offers.map((offer) => offer.storeId));
    void listOwnOpenCarts().then(async ({ carts }) => {
      const relevant = carts.filter((cart) => eligibleStores.has(cart.storeId));
      const results = await Promise.allSettled(relevant.map((cart) => readOwnStoreCart(cart.storeId)));
      if (cancelled || revision !== cartReadRevisionRef.current) return;
      const next: Record<string, number> = {};
      for (const result of results) {
        if (result.status !== "fulfilled" || !result.value) continue;
        for (const line of result.value.cart.lines) next[line.storeOfferId] = line.quantityBaseUnits;
      }
      setCartQuantities(next);
    }).catch(() => { /* The cart stays read-only until a successful DSH mutation. */ });
    return () => { cancelled = true; };
  }, [isAuthenticated, state, actorRevision]);

  const openOffer = (offer: CatalogStoreOffer) => {
    router.push((`/store/${encodeURIComponent(offer.storeId)}?productId=${encodeURIComponent(offer.productId)}`) as Href);
  };

  const adjust = async (offer: CatalogStoreOffer, direction: 1 | -1) => {
    if (busyOfferRef.current) return;
    const actorID = currentHomeActorID();
    if (!isAuthenticated || !actorID) {
      onRequireAuthentication?.();
      return;
    }
    if (offer.modifierGroups.length > 0 || offer.quantityPolicy !== "DISCRETE") {
      openOffer(offer);
      return;
    }
    if (!offer.availability) return;
    const revision = cartReadRevisionRef.current;
    busyOfferRef.current = offer.offerId;
    setBusyID(offer.offerId);
    setCartMessage("");
    try {
      const result = await adjustSimpleOfferQuantity(offer.storeId, offer, direction, actorID);
      if (revision !== cartReadRevisionRef.current) return;
      void Haptics.selectionAsync().catch(() => { /* Feedback is optional; the committed cart is authoritative. */ });
      setCartQuantities((current) => {
        const next = { ...current };
        for (const key of Object.keys(next)) {
          if (result.cart.lines.some((line) => line.storeOfferId === key)) continue;
          if (key === offer.offerId) delete next[key];
        }
        for (const line of result.cart.lines) next[line.storeOfferId] = line.quantityBaseUnits;
        return next;
      });
    } catch {
      if (revision === cartReadRevisionRef.current) setCartMessage("تعذر تحديث كمية المنتج. تحقق من اتصالك ثم أعد المحاولة.");
    } finally {
      if (revision === cartReadRevisionRef.current) {
        busyOfferRef.current = "";
        setBusyID("");
      }
    }
  };

  const withSort = (content: ReactNode) => <View style={styles.sortedContainer}>
    <CatalogPriceSortControl value={sort} onChange={setSort} />
    {content}
  </View>;
  if (!cityID) return null;
  if (state.kind === "loading") return withSort(<View style={styles.loading} accessibilityLabel="جارٍ البحث"><ActivityIndicator color={theme.brandAction} /><Text style={styles.muted}>{normalizedQuery ? "جارٍ البحث عن المنتجات…" : "جارٍ تحميل المنتجات المتاحة…"}</Text></View>);
  if (state.kind === "invalid_query") return withSort(<View style={styles.status}><Text accessibilityRole="alert" style={styles.muted}>البحث طويل جدًا. أدخل 160 حرفًا أو أقل للبحث عن المنتجات.</Text></View>);
  if (state.kind === "error") return withSort(<View style={styles.status}><Text accessibilityRole="alert" style={styles.muted}>{normalizedQuery ? "تعذر البحث عن المنتجات" : "تعذر تحميل المنتجات"}. تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View>);

  if (state.offers.length === 0 && state.nextCursor) return withSort(<View style={styles.status} accessibilityLabel="لا توجد نتائج في الصفحة الحالية">
    <Text style={styles.muted}>لم تظهر نتائج ضمن الجزء المحمّل، ويمكن متابعة البحث في بقية المتاجر.</Text>
    {moreError ? <Text accessibilityRole="alert" style={styles.muted}>تعذر متابعة البحث. أعد المحاولة.</Text> : null}
    <BthwaniButton busy={loadingMore} disabled={loadingMore} label={loadingMore ? "جارٍ البحث" : "متابعة البحث"} onPress={() => void loadMore()} variant="secondary" />
  </View>);
  if (state.offers.length === 0) return withSort(<View style={styles.status} accessibilityLabel="لا توجد نتائج بحث"><Text style={styles.muted}>{normalizedQuery ? "لا توجد منتجات مطابقة. جرّب اسمًا أقصر أو فئة أخرى." : "لا توجد منتجات منشورة ضمن هذا الاختيار. استكشف المتاجر أدناه."}</Text>{normalizedQuery && categoryID && onClearCategory ? <BthwaniButton label="مسح الفئة" onPress={onClearCategory} variant="secondary" /> : null}</View>);
  const cardWidth = columns === 5 ? "19%" : columns === 4 ? "24%" : columns === 3 ? "32%" : "49%";

  return withSort(
    <View style={styles.section} accessibilityLabel={normalizedQuery ? "نتائج البحث عن المنتجات" : "المنتجات المتاحة"}>
      {normalizedQuery ? <View style={styles.headingRow}><Text style={styles.heading}>نتائج المنتجات</Text><Text style={styles.count}>{state.offers.length} منتج معروض{state.nextCursor ? " · المزيد متاح" : ""}</Text></View> : null}
      {cartMessage ? <Text accessibilityRole="alert" style={styles.cartMessage}>{cartMessage}</Text> : null}
      <View style={styles.grid}>
        {state.offers.map((offer, index) => {
          const media = offer.media.find((item) => item.role === "primary") ?? offer.media[0];
          return (
            <Reanimated.View key={offer.offerId} entering={FadeInDown.delay(Math.min(index, 6) * 35).duration(260).reduceMotion(ReduceMotion.System)} style={[styles.item, { width: cardWidth }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`عرض ${offer.productName} من ${offer.storeName || "المتجر"}`} onPress={() => openOffer(offer)} style={({ pressed }) => pressed ? { opacity: 0.78 } : undefined}>
                <View style={styles.photoBox}>
                  {media?.uri
                    ? <ExpoImage cachePolicy="disk" source={{ uri: media.uri }} contentFit="contain" transition={180} style={styles.photo} />
                    : <View style={styles.fallback}><BthwaniIcon name="store" color={theme.colorMuted} size={28} /></View>}
                </View>
                <View style={styles.meta}>
                  {offer.storeName ? <Text numberOfLines={1} style={styles.store}>{offer.storeName}</Text> : null}
                  <Text numberOfLines={2} style={styles.product}>{offer.productName}</Text>
                  {offer.variantTitle ? <Text numberOfLines={1} style={styles.variant}>{offer.variantTitle}</Text> : null}
                  <Text style={styles.price}>{formatMoney(offer.priceMinor, offer.currency).replace(/ريال يمني/g, "ريال")}</Text>
                  {!offer.availability ? <Text style={styles.unavailable}>غير متاح حاليًا</Text> : null}
                </View>
              </Pressable>
              <View pointerEvents="box-none" style={styles.photoActions}>
                  <View style={styles.plusWrap}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`إضافة ${offer.productName} إلى السلة`} accessibilityState={{ disabled: Boolean(busyID) || !offer.availability }} disabled={Boolean(busyID) || !offer.availability} onPress={() => void adjust(offer, 1)} style={styles.plus}>
                      {busyID === offer.offerId ? <ActivityIndicator color={theme.interactiveText} size="small" /> : <BthwaniIcon name="add" color={offer.availability ? theme.interactiveText : theme.colorMuted} size={24} />}
                    </Pressable>
                  </View>
                  {(cartQuantities[offer.offerId] ?? 0) > 0 && offer.modifierGroups.length === 0 && offer.quantityPolicy === "DISCRETE" ? <View style={styles.cartBadge}>
                    <Text accessibilityLabel={`الكمية ${cartQuantities[offer.offerId]}`} style={styles.cartBadgeCount}>{cartQuantities[offer.offerId]}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`تقليل كمية ${offer.productName}`} disabled={Boolean(busyID)} onPress={() => void adjust(offer, -1)} style={styles.cartBadgeMinus}><Text style={styles.cartBadgeMinusText}>−</Text></Pressable>
                  </View> : null}
              </View>
            </Reanimated.View>
          );
        })}
      </View>
      {moreError ? <Text accessibilityRole="alert" style={styles.muted}>تعذر تحميل المزيد من المنتجات.</Text> : null}
      {state.nextCursor ? <BthwaniButton busy={loadingMore} disabled={loadingMore} label={loadingMore ? "جارٍ تحميل المزيد" : "عرض المزيد من المنتجات"} variant="secondary" onPress={() => void loadMore()} /> : null}
    </View>
  );
}

function CatalogPriceSortControl({ value, onChange }: {
  value: CatalogPriceSort;
  onChange: (next: CatalogPriceSort) => void;
}) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CatalogPriceSort>(value);
  const activeLabel = SORT_OPTIONS.find((option) => option.value === value)?.label ?? "الموصى به";
  const close = () => setOpen(false);
  return <>
    <View style={styles.sortToolbar}>
      <Pressable accessibilityRole="button" accessibilityLabel="ترتيب المنتجات"
        accessibilityState={{ selected: Boolean(value) }}
        accessibilityHint="اختر الترتيب حسب السعر لجميع صفحات النتائج"
        onPress={() => { setDraft(value); setOpen(true); }}
        style={[styles.sortTrigger, Boolean(value) && styles.sortTriggerSelected]}>
        <Text style={styles.sortTriggerText}>{value ? activeLabel : "الترتيب والتصفية"}</Text>
      </Pressable>
    </View>
    <Modal visible={open} transparent statusBarTranslucent animationType="slide" onRequestClose={close}>
      <View style={styles.sortOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="إغلاق ترتيب المنتجات" onPress={close}
          style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.sortSheet}>
          <View style={styles.sortSheetTitleRow}>
            <Text style={styles.sortTitle}>الترتيب والتصفية</Text>
            <BthwaniButton label="إغلاق" variant="secondary" onPress={close} />
          </View>
          <Text style={styles.sortSubtitle}>الترتيب حسب</Text>
          <View accessibilityRole="radiogroup" style={styles.sortOptions}>
            {SORT_OPTIONS.map((option) => <Pressable key={option.value || "recommended"}
              accessibilityRole="radio" accessibilityState={{ checked: draft === option.value }}
              accessibilityLabel={option.label} onPress={() => setDraft(option.value)}
              style={[styles.sortChoice, draft === option.value && styles.sortChoiceSelected]}>
              <Text style={styles.sortChoiceLabel}>{option.label}</Text>
              <Text style={styles.sortChoiceIndicator}>{draft === option.value ? "●" : "○"}</Text>
            </Pressable>)}
          </View>
          <View style={styles.sortButtons}>
            <BthwaniButton label="عرض النتائج" onPress={() => { onChange(draft); close(); }} />
            <BthwaniButton label="مسح الترتيب" variant="secondary" onPress={() => { onChange(""); setDraft(""); close(); }} />
          </View>
        </View>
      </View>
    </Modal>
  </>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    sortedContainer: { gap: spacing[2] },
    sortToolbar: { alignItems: "flex-start", paddingHorizontal: spacing[2] },
    sortTrigger: { minHeight: 44, paddingHorizontal: spacing[3], borderRadius: radius.round, borderColor: theme.borderColorStrong, borderWidth: borders.hairline, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
    sortTriggerSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    sortTriggerText: { ...typography.label, color: theme.interactiveText },
    sortOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.44)" },
    sortSheet: { backgroundColor: theme.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing[4], paddingBottom: spacing[6], paddingHorizontal: spacing[4], gap: spacing[3] },
    sortSheetTitleRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
    sortTitle: { ...typography.titleMd, color: theme.color },
    sortSubtitle: { ...typography.bodyStrong, color: theme.color },
    sortOptions: { gap: spacing[2] },
    sortChoice: { minHeight: 52, flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", borderRadius: radius.lg, borderWidth: borders.hairline, borderColor: theme.borderColor, paddingHorizontal: spacing[3], backgroundColor: theme.surface },
    sortChoiceSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    sortChoiceLabel: { ...typography.bodySm, color: theme.color },
    sortChoiceIndicator: { fontSize: 22, color: theme.interactiveText },
    sortButtons: { flexDirection: "row-reverse", justifyContent: "space-between", gap: spacing[2] },
    section: { gap: spacing[1], paddingBottom: spacing[3] },
    headingRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
    heading: { ...typography.titleSm, color: theme.color },
    count: { ...typography.caption, color: theme.colorMuted },
    grid: { flexDirection: "row-reverse", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing[3] },
    item: { gap: spacing[1], minWidth: 0 },
    photoActions: { position: "absolute", top: 0, left: 0, right: 0, aspectRatio: 1 },
    photoBox: { aspectRatio: 1, borderRadius: radius.xl, backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline, overflow: "hidden" },
    photo: { width: "100%", height: "100%" },
    fallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceInset },
    plusWrap: { position: "absolute", bottom: spacing[1], left: spacing[1] },
    cartBadge: { position: "absolute", right: spacing[1], top: spacing[1], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, height: 28, borderRadius: radius.md, paddingLeft: spacing[2], backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderWidth: borders.hairline, elevation: 2 },
    cartBadgeCount: { ...typography.caption, color: theme.interactiveText, fontWeight: "700", minWidth: 15, textAlign: "center" },
    cartBadgeMinus: { width: 27, height: 28, justifyContent: "center", alignItems: "center" },
    cartBadgeMinusText: { fontSize: 21, color: theme.interactiveText, fontWeight: "700" },
    plus: { backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderWidth: borders.hairline, borderRadius: radius.md, minHeight: 36, minWidth: 36, alignItems: "center", justifyContent: "center", elevation: 2 },
    meta: { gap: 2, paddingHorizontal: 2, alignItems: "flex-end" },
    store: { ...typography.caption, color: theme.interactiveText, backgroundColor: theme.actionSoft, paddingHorizontal: spacing[1], borderRadius: radius.round, overflow: "hidden" },
    product: { ...typography.bodySm, color: theme.color, textAlign: "right", minHeight: 32 },
    variant: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
    price: { ...typography.bodyStrong, color: theme.interactiveText, textAlign: "right" },
    unavailable: { ...typography.caption, color: theme.warningText },
    status: { alignItems: "center", justifyContent: "center", gap: spacing[2], paddingVertical: spacing[4] },
    loading: { alignItems: "center", justifyContent: "center", gap: spacing[2], paddingVertical: spacing[4] },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: "center" },
    cartMessage: { ...typography.bodySm, color: theme.successText, textAlign: "right" },
  });
}
