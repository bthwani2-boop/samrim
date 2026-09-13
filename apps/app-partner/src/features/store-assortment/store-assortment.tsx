import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, useColorScheme } from "react-native";
import * as Crypto from "expo-crypto";

import { resolveTheme } from "@bthwani/design-system";
import type { AssortmentPublicationState, CentralProduct, StoreAssortment } from "@bthwani/dsh";
import { createDshMobileClient } from "@bthwani/dsh";
import { readIdentityAccessToken } from "../../bootstrap/identity";

type AssortmentState = { kind: "loading" } | { kind: "ready"; assortments: ReadonlyArray<StoreAssortment> } | { kind: "error" };

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const dshClient = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { kind?: unknown; status?: unknown; code?: unknown; message?: unknown };
    if (value.kind === "http" && value.status === 401) return "انتهت جلسة الشريك. سجّل الدخول مجددًا.";
    if (value.kind === "http" && value.status === 403) return "لا تملك جلسة الشريك صلاحية إدارة هذا المتجر.";
    if (value.kind === "http" && value.status === 404) return "لم يعد المتجر أو المنتج المركزي متاحًا.";
    if (value.kind === "http" && value.status === 409) return "تعارض في إصدار العرض أو المنتج. أعد القراءة ثم حاول مرة أخرى.";
    if (value.kind === "network") return "تعذر الاتصال بخدمة المنتجات. تحقق من الاتصال ثم أعد المحاولة.";
  }
  return "تعذر الوصول إلى عروض المتجر. تحقق من الاتصال ثم أعد المحاولة.";
}

function reportError(error: unknown): void {
  console.error("DSH Store Assortment request failed", error);
}

export function StoreAssortmentManagement({ storeId }: { storeId: string }) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<AssortmentState>({ kind: "loading" });
  const [products, setProducts] = useState<ReadonlyArray<CentralProduct>>([]);
  const [query, setQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<CentralProduct | null>(null);
  const [priceMinor, setPriceMinor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setError("");
    try {
      const token = readIdentityAccessToken();
      if (!token) throw new Error("DSH_PARTNER_SESSION_UNAVAILABLE");
      const assortments = await dshClient().readOwnStoreAssortment(token, storeId);
      setState({ kind: "ready", assortments });
    } catch (nextError) {
      reportError(nextError);
      setState({ kind: "error" });
      setError(errorText(nextError));
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  async function searchProducts() {
    setError("");
    try {
      const token = readIdentityAccessToken();
      if (!token) throw new Error("DSH_PARTNER_SESSION_UNAVAILABLE");
      setProducts(await dshClient().listCentralProducts(token, query));
    } catch (nextError) {
      reportError(nextError);
      setError(errorText(nextError));
    }
  }

  async function addAssortment() {
    const parsedPrice = Number(priceMinor.trim());
    if (!selectedProduct || !Number.isSafeInteger(parsedPrice) || parsedPrice < 1 || busy) return;
    setBusy(true);
    setError("");
    try {
      const token = readIdentityAccessToken();
      if (!token) throw new Error("DSH_PARTNER_SESSION_UNAVAILABLE");
      await dshClient().createStoreAssortment(token, storeId, selectedProduct.id, parsedPrice);
      setSelectedProduct(null);
      setPriceMinor("");
      await load();
    } catch (nextError) {
      reportError(nextError);
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function updateAssortment(assortment: StoreAssortment, publicationState: AssortmentPublicationState, availability: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const token = readIdentityAccessToken();
      if (!token) throw new Error("DSH_PARTNER_SESSION_UNAVAILABLE");
      await dshClient().updateStoreAssortment(token, storeId, assortment.productId, assortment.priceMinor, publicationState, availability, assortment.version);
      await load();
    } catch (nextError) {
      reportError(nextError);
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  }

  const parsedPrice = Number(priceMinor.trim());
  const canAdd = selectedProduct !== null && Number.isSafeInteger(parsedPrice) && parsedPrice > 0;

  return (
    <View style={styles.container} accessibilityLabel="إدارة عروض المتجر">
      <Text style={styles.title}>منتجات المتجر وعروضه</Text>
      <Text style={styles.muted}>اختر منتجًا مركزيًا معتمدًا، ثم حدّد سعره وتوافره ونشره لهذا المتجر.</Text>
      <View style={styles.searchRow}>
        <TextInput accessibilityLabel="البحث في المنتجات المركزية" editable={!busy} onChangeText={setQuery} onSubmitEditing={() => void searchProducts()} placeholder="ابحث باسم المنتج" returnKeyType="search" value={query} style={styles.input} />
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void searchProducts()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>بحث</Text></Pressable>
      </View>
      {products.length ? <View style={styles.productList}>{products.map((product) => <Pressable accessibilityRole="button" accessibilityLabel={`اختيار ${product.canonicalName}`} key={product.id} onPress={() => setSelectedProduct(product)} style={[styles.product, selectedProduct?.id === product.id && styles.productSelected]}><Text style={styles.itemTitle}>{product.canonicalName}</Text><Text style={styles.muted}>{product.brand || "بدون علامة"} · يباع بـ {product.sellUnit === "kg" ? "الكيلو" : "القطعة"}</Text></Pressable>)}</View> : null}
      {selectedProduct ? <View style={styles.form}><Text style={styles.selected}>المحدد: {selectedProduct.canonicalName}</Text><TextInput accessibilityLabel="السعر بالريال اليمني" editable={!busy} keyboardType="number-pad" onChangeText={setPriceMinor} placeholder="السعر بالريال اليمني" value={priceMinor} style={styles.input} /><Pressable accessibilityRole="button" disabled={busy || !canAdd} onPress={() => void addAssortment()} style={styles.button}><Text style={styles.buttonText}>إضافة للمتجر</Text></Pressable></View> : null}
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة عروض المتجر…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text style={styles.muted}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
      {state.kind === "ready" ? state.assortments.length === 0 ? <Text style={styles.muted}>لا توجد عروض مرتبطة بهذا المتجر بعد.</Text> : <View style={styles.assortmentList}>{state.assortments.map((assortment) => <View key={assortment.productId} style={styles.item}><View style={styles.itemText}><Text style={styles.itemTitle}>{assortment.canonicalName}</Text><Text style={styles.muted}>{assortment.priceMinor} {assortment.currency} · الإصدار {assortment.version} · {assortment.publicationState}</Text></View><Switch accessibilityLabel={`توافر ${assortment.canonicalName}`} disabled={busy} onValueChange={(available) => void updateAssortment(assortment, assortment.publicationState, available)} value={assortment.availability} /><Pressable accessibilityRole="button" disabled={busy} onPress={() => void updateAssortment(assortment, assortment.publicationState === "published" ? "hidden" : "published", assortment.availability)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{assortment.publicationState === "published" ? "إخفاء" : "نشر"}</Text></Pressable></View>)}</View> : null}
      {error && state.kind !== "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 12, marginTop: 16, padding: 14, width: "100%" },
    state: { alignItems: "center", gap: 8 },
    title: { color: theme.structure, fontSize: 17, fontWeight: "800" },
    muted: { color: theme.colorMuted, fontSize: 13 },
    selected: { color: theme.structure, fontSize: 14, fontWeight: "700" },
    searchRow: { flexDirection: "row", gap: 8 },
    form: { gap: 8 },
    input: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.structure, flex: 1, minHeight: 44, paddingHorizontal: 10 },
    productList: { gap: 8 },
    product: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 3, padding: 10 },
    productSelected: { borderColor: theme.actionBackground, borderWidth: 2 },
    assortmentList: { gap: 10 },
    item: { alignItems: "center", borderColor: theme.borderColor, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingTop: 12 },
    itemText: { flex: 1, gap: 3 },
    itemTitle: { color: theme.structure, fontSize: 15, fontWeight: "700" },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
    buttonText: { color: theme.surface, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
    secondaryButtonText: { color: theme.structure, fontSize: 13, fontWeight: "700" },
    error: { color: theme.danger, fontSize: 13 },
  });
}
