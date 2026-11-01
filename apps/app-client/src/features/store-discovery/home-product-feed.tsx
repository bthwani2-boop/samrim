import { borders, radius, spacing, typography, type resolveTheme } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CatalogStoreOffer, formatMoney } from "@bthwani/dsh";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Reanimated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { adjustSimpleOfferQuantity, listOwnOpenCarts, readOwnStoreCart, searchPublicCatalog } from "./store-discovery-client";

type FeedState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer>; nextCursor: string };

const PAGE_SIZE = 18;

export function HomeProductFeed({
  cityID, verticalID, categoryID, shortcutID, isAuthenticated, onRequireAuthentication, pageSize = PAGE_SIZE,
}: {
  cityID: string | null;
  verticalID: string;
  categoryID: string;
  shortcutID: string;
  isAuthenticated: boolean;
  onRequireAuthentication?: (() => void) | undefined;
  pageSize?: number;
}) {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const columns = width >= 1050 ? 5 : width >= 720 ? 4 : width >= 540 ? 3 : 2;
  const effectivePageSize = Number.isInteger(pageSize) ? Math.max(1, Math.min(PAGE_SIZE, pageSize)) : PAGE_SIZE;
  const [state, setState] = useState<FeedState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [busyID, setBusyID] = useState("");
  const [cartMessage, setCartMessage] = useState("");
  const [cartQuantities, setCartQuantities] = useState<Readonly<Record<string, number>>>({});
  const busyOfferRef = useRef("");
  const requestID = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestID.current;
    setState({ kind: "loading" });
    setMoreError(false);
    if (!cityID) {
      setState({ kind: "ready", offers: [], nextCursor: "" });
      return;
    }
    try {
      const page = await searchPublicCatalog(cityID, "", categoryID, effectivePageSize, "", verticalID, shortcutID);
      if (id === requestID.current) setState({ kind: "ready", offers: page.offers, nextCursor: page.nextCursor ?? "" });
    } catch {
      if (id === requestID.current) setState({ kind: "error" });
    }
  }, [cityID, verticalID, categoryID, shortcutID, effectivePageSize]);

  useEffect(() => {
    void load();
    return () => { requestID.current += 1; };
  }, [load]);

  const loadMore = async () => {
    if (state.kind !== "ready" || !state.nextCursor || !cityID || loadingMore) return;
    const id = ++requestID.current;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await searchPublicCatalog(cityID, "", categoryID, PAGE_SIZE, state.nextCursor, verticalID, shortcutID);
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
    if (!isAuthenticated || state.kind !== "ready") {
      setCartQuantities({});
      return;
    }
    let cancelled = false;
    const eligibleStores = new Set(state.offers.map((offer) => offer.storeId));
    void listOwnOpenCarts().then(async ({ carts }) => {
      const relevant = carts.filter((cart) => eligibleStores.has(cart.storeId));
      const results = await Promise.allSettled(relevant.map((cart) => readOwnStoreCart(cart.storeId)));
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const result of results) {
        if (result.status !== "fulfilled" || !result.value) continue;
        for (const line of result.value.cart.lines) next[line.storeOfferId] = line.quantityBaseUnits;
      }
      setCartQuantities(next);
    }).catch(() => { /* The cart stays read-only until a successful DSH mutation. */ });
    return () => { cancelled = true; };
  }, [isAuthenticated, state]);

  const openOffer = (offer: CatalogStoreOffer) => {
    router.push((`/store/${encodeURIComponent(offer.storeId)}?productId=${encodeURIComponent(offer.productId)}`) as Href);
  };

  const adjust = async (offer: CatalogStoreOffer, direction: 1 | -1) => {
    if (busyOfferRef.current) return;
    if (!isAuthenticated) {
      onRequireAuthentication?.();
      return;
    }
    if (offer.modifierGroups.length > 0 || offer.quantityPolicy !== "DISCRETE") {
      openOffer(offer);
      return;
    }
    if (!offer.availability) return;
    busyOfferRef.current = offer.offerId;
    setBusyID(offer.offerId);
    setCartMessage("");
    try {
      const result = await adjustSimpleOfferQuantity(offer.storeId, offer, direction);
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
      setCartMessage("تعذر تحديث كمية المنتج. تحقق من اتصالك ثم أعد المحاولة.");
    } finally {
      busyOfferRef.current = "";
      setBusyID("");
    }
  };

  if (!cityID) return null;
  if (state.kind === "loading") return <View style={styles.loading}><ActivityIndicator color={theme.brandAction} /><Text style={styles.muted}>جارٍ تحميل المنتجات المتاحة…</Text></View>;
  if (state.kind === "error") return <View style={styles.status}><Text accessibilityRole="alert" style={styles.muted}>تعذر تحميل المنتجات. تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View>;
  if (state.offers.length === 0) return <View style={styles.status}><Text style={styles.muted}>لا توجد منتجات منشورة ضمن هذا الاختيار. استكشف المتاجر أدناه.</Text></View>;
  const cardWidth = columns === 5 ? "19%" : columns === 4 ? "24%" : columns === 3 ? "32%" : "49%";

  return (
    <View style={styles.section} accessibilityLabel="المنتجات المتاحة">
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

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    section: { gap: spacing[1], paddingBottom: spacing[3] },
    headingRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
    heading: { ...typography.titleSm, color: theme.color },
    count: { ...typography.caption, color: theme.colorMuted },
    grid: { flexDirection: "row-reverse", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing[3] },
    item: { gap: spacing[1], minWidth: 0 },
    photoActions: { position: "absolute", top: 0, left: 0, right: 0, aspectRatio: 1 },
    photoBox: { aspectRatio: 1, borderRadius: radius.lg, backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline, overflow: "hidden" },
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
