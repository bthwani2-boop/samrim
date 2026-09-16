import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, useColorScheme } from "react-native";
import * as Crypto from "expo-crypto";

import { direction, resolveRowDirection, resolveTextAlign, resolveTextInputAlign, resolveTheme, toAsciiDigits } from "@bthwani/design-system";
import { createDshMobileClient, formatMoney, type CatalogProduct, type CatalogProductProposal, type CatalogStoreOffer, type CatalogVariant } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type OfferState = { kind: "loading" } | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer>; proposals: ReadonlyArray<CatalogProductProposal> } | { kind: "error" };

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
  const [storeProductName, setStoreProductName] = useState("");
  const [storeProductVerticalID, setStoreProductVerticalID] = useState("");
  const [storeProductCategoryID, setStoreProductCategoryID] = useState("");
  const [proposalName, setProposalName] = useState("");
  const [proposalVerticalID, setProposalVerticalID] = useState("");
  const [proposalCategoryID, setProposalCategoryID] = useState("");
  const [modifierName, setModifierName] = useState("");
  const [modifierOptionName, setModifierOptionName] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [extensionOfferID, setExtensionOfferID] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" }); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const [offers, proposals] = await Promise.all([dshClient().readOwnStoreOffers(token, storeId), dshClient().listOwnCatalogProductProposals(token)]);
      setState({ kind: "ready", offers, proposals: proposals.proposals });
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
      const policy = offerPolicy(selectedVariant);
      await dshClient().createStoreOffer(token, storeId, selectedVariant.id, parsedPrice, policy.quantityPolicy, policy.pricingBasis, policy.quantityMinBaseUnits, policy.quantityMaxBaseUnits, policy.quantityStepBaseUnits, policy.pricingUnitBaseUnits);
      setSelectedProduct(null); setSelectedVariant(null); setPriceMinor(""); await load();
    } catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function updateOffer(offer: CatalogStoreOffer, publicationState: "draft" | "published" | "hidden", availability: boolean) {
    if (busy) return;
    setBusy(true); setError("");
      try { const token = await getUsableIdentityAccessToken(); await dshClient().updateStoreOffer(token, storeId, offer.offerId, offer.priceMinor, publicationState, availability, offer.version, offer.quantityPolicy, offer.pricingBasis, offer.quantityMinBaseUnits, offer.quantityMaxBaseUnits, offer.quantityStepBaseUnits, offer.pricingUnitBaseUnits); await load(); }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function createStoreProduct() {
    if (busy || !storeProductName.trim() || !storeProductVerticalID.trim() || !storeProductCategoryID.trim()) return;
    setBusy(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); await dshClient().createStoreScopedProduct(token, storeId, { canonicalName: storeProductName, verticalId: storeProductVerticalID, scope: "STORE_SCOPED", storeId, variantTitle: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [storeProductCategoryID] }); setStoreProductName(""); await load(); }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function createProposal() {
    if (busy || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim()) return;
    setBusy(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); await dshClient().createCatalogProductProposal(token, { id: Crypto.randomUUID(), verticalId: proposalVerticalID, categoryId: proposalCategoryID, proposedName: proposalName, proposedVariantTitle: "الافتراضي", proposedMeasurementKind: "DISCRETE", proposedBaseUnit: "COUNT" }); setProposalName(""); await load(); }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function createModifiersAndAttach() {
    if (busy || !modifierName.trim()) return;
    setBusy(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); const group = await dshClient().createCatalogModifierGroup(token, storeId, { nameAr: modifierName, required: false, minSelections: 0, maxSelections: 1, active: true }); if (modifierOptionName.trim()) await dshClient().createCatalogModifierOption(token, storeId, group.group.id, { nameAr: modifierOptionName, priceDeltaMinor: 0, availability: true, ordinal: 0 }); if (extensionOfferID) await dshClient().attachCatalogModifierGroup(token, storeId, extensionOfferID, group.group.id); setModifierName(""); setModifierOptionName(""); await load(); }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function createSectionAndAttach() {
    if (busy || !sectionName.trim()) return;
    setBusy(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); const section = await dshClient().createCatalogStorefrontSection(token, storeId, { nameAr: sectionName, ordinal: 0, active: true }); if (extensionOfferID) await dshClient().attachCatalogOfferToSection(token, storeId, section.section.id, extensionOfferID); setSectionName(""); await load(); }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  const parsedPrice = Number(priceMinor.trim());
  const canAdd = selectedVariant !== null && Number.isSafeInteger(parsedPrice) && parsedPrice > 0;
  return (
    <View style={styles.container} accessibilityLabel="إدارة عروض المتجر">
      <Text style={styles.title}>كتالوج المتجر وعروضه</Text><Text style={styles.muted}>اختر نسخة معتمدة، ثم حدّد سعرها وتوافرها ونشرها لهذا المتجر.</Text>
      <View style={styles.searchRow}><TextInput accessibilityLabel="البحث في الكتالوج" editable={!busy} onChangeText={setQuery} onSubmitEditing={() => void searchProducts()} placeholder="ابحث باسم المنتج" returnKeyType="search" value={query} style={[styles.input, busy && styles.disabledInput]} /><Pressable accessibilityRole="button" disabled={busy} onPress={() => void searchProducts()} style={[styles.secondaryButton, busy && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, busy && styles.disabledSecondaryButtonText]}>بحث</Text></Pressable></View>
      {products.length ? <View style={styles.productList}>{products.map((product) => <View key={product.id} style={styles.product}><Text style={styles.itemTitle}>{product.canonicalName}</Text>{product.variants.map((variant) => <Pressable accessibilityRole="button" accessibilityLabel={`اختيار ${product.canonicalName} ${variant.title}`} key={variant.id} onPress={() => { setSelectedProduct(product); setSelectedVariant(variant); }} style={[styles.variant, selectedVariant?.id === variant.id && styles.productSelected]}><Text style={styles.muted}>{variant.title} · {variant.measurementKind === "DISCRETE" ? "بالقطعة" : variant.baseUnit === "GRAM" ? "بالغرام" : "بالمليلتر"}</Text></Pressable>)}</View>)}</View> : null}
      {selectedVariant && selectedProduct ? <View style={styles.form}><Text style={styles.selected}>المحدد: {selectedProduct.canonicalName} · {selectedVariant.title}</Text><TextInput accessibilityLabel="السعر بالريال اليمني" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setPriceMinor(toAsciiDigits(value))} placeholder="السعر بالريال اليمني" value={priceMinor} style={[styles.input, busy && styles.disabledInput]} /><Pressable accessibilityRole="button" disabled={busy || !canAdd} onPress={() => void addOffer()} style={[styles.button, (busy || !canAdd) && styles.disabledButton]}><Text style={[styles.buttonText, (busy || !canAdd) && styles.disabledButtonText]}>إضافة عرض للمتجر</Text></Pressable></View> : null}
      <View style={styles.managementBlock}><Text style={styles.itemTitle}>منتج خاص بهذا المتجر</Text><Text style={styles.muted}>أضف منتجًا متاحًا لهذا المتجر ضمن المجال والتصنيف المعتمدين.</Text><TextInput accessibilityLabel="اسم منتج المتجر" editable={!busy} onChangeText={setStoreProductName} placeholder="اسم المنتج" value={storeProductName} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="المجال التجاري" editable={!busy} onChangeText={setStoreProductVerticalID} placeholder="المجال التجاري" value={storeProductVerticalID} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="التصنيف" editable={!busy} onChangeText={setStoreProductCategoryID} placeholder="التصنيف" value={storeProductCategoryID} style={[styles.input, busy && styles.disabledInput]} /><Pressable accessibilityRole="button" disabled={busy || !storeProductName.trim() || !storeProductVerticalID.trim() || !storeProductCategoryID.trim()} onPress={() => void createStoreProduct()} style={[styles.secondaryButton, (busy || !storeProductName.trim() || !storeProductVerticalID.trim() || !storeProductCategoryID.trim()) && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, (busy || !storeProductName.trim() || !storeProductVerticalID.trim() || !storeProductCategoryID.trim()) && styles.disabledSecondaryButtonText]}>إنشاء منتج المتجر</Text></Pressable></View>
      <View style={styles.managementBlock}><Text style={styles.itemTitle}>اقتراح منتج للمراجعة</Text><Text style={styles.muted}>أرسل اسم المنتج وتصنيفه للمراجعة؛ لا يظهر في الكتالوج قبل اعتماد المالك.</Text><TextInput accessibilityLabel="اسم المقترح" editable={!busy} onChangeText={setProposalName} placeholder="اسم المنتج المقترح" value={proposalName} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="مجال المقترح" editable={!busy} onChangeText={setProposalVerticalID} placeholder="المجال التجاري" value={proposalVerticalID} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="تصنيف المقترح" editable={!busy} onChangeText={setProposalCategoryID} placeholder="التصنيف" value={proposalCategoryID} style={[styles.input, busy && styles.disabledInput]} /><Pressable accessibilityRole="button" disabled={busy || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim()} onPress={() => void createProposal()} style={[styles.secondaryButton, (busy || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim()) && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, (busy || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim()) && styles.disabledSecondaryButtonText]}>إرسال المقترح</Text></Pressable>{state.kind === "ready" && state.proposals.length ? state.proposals.map((proposal) => <Text key={proposal.id} style={styles.muted}>{proposalStateLabel(proposal.state)}{proposal.correctionReason ? ` · ${proposal.correctionReason}` : ""}</Text>) : null}</View>
      <View style={styles.managementBlock}><Text style={styles.itemTitle}>أقسام وإضافات المتجر</Text><Text style={styles.muted}>اختر عرضًا بالاسم ثم أنشئ مجموعة إضافات أو قسم عرض.</Text><View style={styles.offerPicker}>{state.kind === "ready" ? state.offers.map((offer) => <Pressable accessibilityRole="button" key={offer.offerId} onPress={() => setExtensionOfferID(offer.offerId)} style={[styles.variant, extensionOfferID === offer.offerId && styles.productSelected]}><Text style={styles.muted}>{offer.productName}</Text></Pressable>) : null}</View><TextInput accessibilityLabel="اسم مجموعة الإضافات" editable={!busy} onChangeText={setModifierName} placeholder="اسم مجموعة الإضافات" value={modifierName} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="اسم خيار الإضافة" editable={!busy} onChangeText={setModifierOptionName} placeholder="اسم خيار اختياري" value={modifierOptionName} style={[styles.input, busy && styles.disabledInput]} /><Pressable accessibilityRole="button" disabled={busy || !modifierName.trim()} onPress={() => void createModifiersAndAttach()} style={[styles.secondaryButton, (busy || !modifierName.trim()) && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, (busy || !modifierName.trim()) && styles.disabledSecondaryButtonText]}>إنشاء مجموعة إضافات وربطها</Text></Pressable><TextInput accessibilityLabel="اسم القسم" editable={!busy} onChangeText={setSectionName} placeholder="اسم قسم المتجر" value={sectionName} style={[styles.input, busy && styles.disabledInput]} /><Pressable accessibilityRole="button" disabled={busy || !sectionName.trim()} onPress={() => void createSectionAndAttach()} style={[styles.secondaryButton, (busy || !sectionName.trim()) && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, (busy || !sectionName.trim()) && styles.disabledSecondaryButtonText]}>إنشاء قسم وربطه</Text></Pressable></View>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة عروض المتجر…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text style={styles.muted}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
      {state.kind === "ready" ? state.offers.length === 0 ? <Text style={styles.muted}>لا توجد عروض مرتبطة بهذا المتجر بعد.</Text> : <View style={styles.offerList}>{state.offers.map((offer) => <View key={offer.offerId} style={styles.item}><View style={styles.itemText}><Text style={styles.itemTitle}>{offer.productName}</Text><Text style={styles.muted}>{formatMoney(offer.priceMinor, offer.currency)} · {offer.measurementKind === "DISCRETE" ? "بالقطعة" : offer.baseUnit === "GRAM" ? "بالغرام" : "بالمليلتر"} · {publicationStateLabel(offer.publicationState)}</Text></View><Switch accessibilityLabel={`توافر ${offer.productName}`} disabled={busy} onValueChange={(available) => void updateOffer(offer, offer.publicationState, available)} value={offer.availability} /><Pressable accessibilityRole="button" disabled={busy} onPress={() => void updateOffer(offer, offer.publicationState === "published" ? "hidden" : "published", offer.availability)} style={[styles.secondaryButton, busy && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, busy && styles.disabledSecondaryButtonText]}>{offer.publicationState === "published" ? "إخفاء" : "نشر"}</Text></Pressable></View>)}</View> : null}
      {error && state.kind !== "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const startInputTextAlign = resolveTextInputAlign("start", activeDirection);
  const rowDirection = resolveRowDirection(activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 12, marginTop: 16, padding: 14, width: "100%", direction: activeDirection },
    state: { alignItems: "center", gap: 8 },
    title: { color: theme.color, fontSize: 17, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
    selected: { color: theme.color, fontSize: 14, fontWeight: "700", textAlign: startTextAlign },
    searchRow: { flexDirection: rowDirection, gap: 8 },
    form: { gap: 8 },
    managementBlock: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 },
    offerPicker: { gap: 6 },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, color: theme.color, flex: 1, minHeight: 44, paddingHorizontal: 10, textAlign: startInputTextAlign, writingDirection: activeDirection },
    productList: { gap: 8 },
    product: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 6, padding: 10 },
    variant: { borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, padding: 8 },
    productSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground, borderWidth: 2 },
    offerList: { gap: 10 },
    item: { alignItems: "center", borderColor: theme.borderColor, borderTopWidth: 1, flexDirection: rowDirection, gap: 10, paddingTop: 12 },
    itemText: { flex: 1, gap: 3 },
    itemTitle: { color: theme.color, fontSize: 15, fontWeight: "700", textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
    secondaryButtonText: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: "center" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    disabledSecondaryButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledSecondaryButtonText: { color: theme.disabledText },
    disabledInput: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground, color: theme.disabledText },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
  });
}

function proposalStateLabel(state: CatalogProductProposal["state"]): string {
  return { draft: "مسودة", submitted: "قيد المراجعة", needs_correction: "يحتاج إلى تصحيح", approved: "معتمد", rejected: "مرفوض" }[state];
}

function publicationStateLabel(state: CatalogStoreOffer["publicationState"]): string {
  return { draft: "مسودة", published: "منشور", hidden: "مخفي" }[state];
}

function offerPolicy(variant: CatalogVariant): { quantityPolicy: "DISCRETE" | "MEASURED" | "VARIABLE_MEASURE"; pricingBasis: "PER_UNIT" | "PER_MEASURE"; quantityMinBaseUnits: number; quantityMaxBaseUnits: number; quantityStepBaseUnits: number; pricingUnitBaseUnits: number } {
  if (variant.measurementKind === "DISCRETE") return { quantityPolicy: "DISCRETE", pricingBasis: "PER_UNIT", quantityMinBaseUnits: 1, quantityMaxBaseUnits: 1000, quantityStepBaseUnits: 1, pricingUnitBaseUnits: 1 };
  return { quantityPolicy: variant.measurementKind, pricingBasis: "PER_MEASURE", quantityMinBaseUnits: 1000, quantityMaxBaseUnits: 100000, quantityStepBaseUnits: 1000, pricingUnitBaseUnits: 1000 };
}
