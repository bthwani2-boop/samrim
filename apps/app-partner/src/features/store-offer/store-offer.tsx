import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, useColorScheme } from "react-native";
import * as Crypto from "expo-crypto";

import { resolveTheme } from "@bthwani/design-system";
import type { CatalogProduct, CatalogStoreOffer, CatalogVariant } from "@bthwani/dsh";
import { createDshMobileClient } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type OfferState = { kind: "loading" } | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer> } | { kind: "error" };

function baseUrl(): string { const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim(); if (!value) throw new Error("DSH_BASE_URL_REQUIRED"); return value; }
const dshClient = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { kind?: unknown; status?: unknown };
    if (value.kind === "http" && value.status === 401) return "انتهت جلسة الشريك. سجّل الدخول مجددًا.";
    if (value.kind === "http" && value.status === 403) return "لا تملك جلسة الشريك صلاحية إدارة هذا المتجر.";
    if (value.kind === "http" && value.status === 409) return "تعارض في إصدار العرض أو المنتج. أعد القراءة ثم حاول مرة أخرى.";
    if (value.kind === "network") return "تعذر الاتصال بخدمة الكتالوج. تحقق من الاتصال ثم أعد المحاولة.";
  }
  return "تعذر الوصول إلى عروض المتجر. تحقق من الاتصال ثم أعد المحاولة.";
}

function reportError(error: unknown): void { console.error("DSH StoreOffer request failed", error); }

export function StoreOfferManagement({ storeId }: { storeId: string }) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<OfferState>({ kind: "loading" });
  const [products, setProducts] = useState<ReadonlyArray<CatalogProduct>>([]);
  const [query, setQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<CatalogVariant | null>(null);
  const [priceMinor, setPriceMinor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" }); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      setState({ kind: "ready", offers: await dshClient().readOwnStoreOffers(token, storeId) });
    } catch (nextError) { reportError(nextError); setState({ kind: "error" }); setError(errorText(nextError)); }
  }, [storeId]);
  useEffect(() => { void load(); }, [load]);

  async function searchProducts() {
    setError("");
    try { const token = await getUsableIdentityAccessToken(); setProducts(await dshClient().listCatalogProducts(token, query)); }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); }
  }

  async function addOffer() {
    const parsedPrice = Number(priceMinor.trim());
    if (!selectedVariant || !Number.isSafeInteger(parsedPrice) || parsedPrice < 1 || busy) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const quantityPolicy = selectedVariant.sellUnit === "kg" ? "MEASURED" : "DISCRETE";
      const pricingBasis = selectedVariant.sellUnit === "kg" ? "PER_KILOGRAM" : "PER_UNIT";
      await dshClient().createStoreOffer(token, storeId, selectedVariant.id, parsedPrice, quantityPolicy, pricingBasis);
      setSelectedProduct(null); setSelectedVariant(null); setPriceMinor(""); await load();
    } catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function updateOffer(offer: CatalogStoreOffer, publicationState: "draft" | "published" | "hidden", availability: boolean) {
    if (busy) return;
    setBusy(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); await dshClient().updateStoreOffer(token, storeId, offer.offerId, offer.priceMinor, publicationState, availability, offer.version); await load(); }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  const parsedPrice = Number(priceMinor.trim());
  const canAdd = selectedVariant !== null && Number.isSafeInteger(parsedPrice) && parsedPrice > 0;
  return (
    <View style={styles.container} accessibilityLabel="إدارة عروض المتجر">
      <Text style={styles.title}>كتالوج المتجر وعروضه</Text><Text style={styles.muted}>اختر نسخة معتمدة، ثم حدّد سعرها وتوافرها ونشرها لهذا المتجر.</Text>
      <View style={styles.searchRow}><TextInput accessibilityLabel="البحث في الكتالوج" editable={!busy} onChangeText={setQuery} onSubmitEditing={() => void searchProducts()} placeholder="ابحث باسم المنتج" returnKeyType="search" value={query} style={styles.input} /><Pressable accessibilityRole="button" disabled={busy} onPress={() => void searchProducts()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>بحث</Text></Pressable></View>
      {products.length ? <View style={styles.productList}>{products.map((product) => <View key={product.id} style={styles.product}><Text style={styles.itemTitle}>{product.canonicalName}</Text>{product.variants.map((variant) => <Pressable accessibilityRole="button" accessibilityLabel={`اختيار ${product.canonicalName} ${variant.title}`} key={variant.id} onPress={() => { setSelectedProduct(product); setSelectedVariant(variant); }} style={[styles.variant, selectedVariant?.id === variant.id && styles.productSelected]}><Text style={styles.muted}>{variant.title} · {variant.sellUnit === "kg" ? "بالكيلو" : "بالقطعة"}</Text></Pressable>)}</View>)}</View> : null}
      {selectedVariant && selectedProduct ? <View style={styles.form}><Text style={styles.selected}>المحدد: {selectedProduct.canonicalName} · {selectedVariant.title}</Text><TextInput accessibilityLabel="السعر بالريال اليمني" editable={!busy} keyboardType="number-pad" onChangeText={setPriceMinor} placeholder="السعر بالريال اليمني" value={priceMinor} style={styles.input} /><Pressable accessibilityRole="button" disabled={busy || !canAdd} onPress={() => void addOffer()} style={styles.button}><Text style={styles.buttonText}>إضافة عرض للمتجر</Text></Pressable></View> : null}
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة عروض المتجر…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text style={styles.muted}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
      {state.kind === "ready" ? state.offers.length === 0 ? <Text style={styles.muted}>لا توجد عروض مرتبطة بهذا المتجر بعد.</Text> : <View style={styles.offerList}>{state.offers.map((offer) => <View key={offer.offerId} style={styles.item}><View style={styles.itemText}><Text style={styles.itemTitle}>{offer.productName}</Text><Text style={styles.muted}>{offer.priceMinor} {offer.currency} · {offer.sellUnit === "kg" ? "بالكيلو" : "بالقطعة"} · v{offer.version} · {offer.publicationState}</Text></View><Switch accessibilityLabel={`توافر ${offer.productName}`} disabled={busy} onValueChange={(available) => void updateOffer(offer, offer.publicationState, available)} value={offer.availability} /><Pressable accessibilityRole="button" disabled={busy} onPress={() => void updateOffer(offer, offer.publicationState === "published" ? "hidden" : "published", offer.availability)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{offer.publicationState === "published" ? "إخفاء" : "نشر"}</Text></Pressable></View>)}</View> : null}
      {error && state.kind !== "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 12, marginTop: 16, padding: 14, width: "100%" }, state: { alignItems: "center", gap: 8 }, title: { color: theme.structure, fontSize: 17, fontWeight: "800" }, muted: { color: theme.colorMuted, fontSize: 13 }, selected: { color: theme.structure, fontSize: 14, fontWeight: "700" }, searchRow: { flexDirection: "row", gap: 8 }, form: { gap: 8 }, input: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.structure, flex: 1, minHeight: 44, paddingHorizontal: 10 }, productList: { gap: 8 }, product: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 6, padding: 10 }, variant: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, padding: 8 }, productSelected: { borderColor: theme.actionBackground, borderWidth: 2 }, offerList: { gap: 10 }, item: { alignItems: "center", borderColor: theme.borderColor, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingTop: 12 }, itemText: { flex: 1, gap: 3 }, itemTitle: { color: theme.structure, fontSize: 15, fontWeight: "700" }, button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 }, buttonText: { color: theme.surface, fontWeight: "800" }, secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 }, secondaryButtonText: { color: theme.structure, fontSize: 13, fontWeight: "700" }, error: { color: theme.danger, fontSize: 13 } }); }
