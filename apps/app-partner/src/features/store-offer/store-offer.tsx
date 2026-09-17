import { borders, direction, radius, resolveTextAlign, resolveTextInputAlign, type resolveTheme, sizing, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { type BaseUnit, baseUnitLabel, type CatalogCategory, type CatalogProduct, type CatalogProductProposal, type CatalogStoreOffer, type CatalogVariant, type CommerceVertical, catalogProductProposalStateLabel, createDshMobileClient, formatMoney, type MeasurementKind, measurementKindLabel as sharedMeasurementKindLabel, pricingBasisLabel as sharedPricingBasisLabel, quantityPolicyLabel as sharedQuantityPolicyLabel, storeOfferPublicationStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type OfferState = { kind: "loading" } | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer>; proposals: ReadonlyArray<CatalogProductProposal> } | { kind: "error" };
type QuantityPolicy = "DISCRETE" | "MEASURED" | "VARIABLE_MEASURE";
type PricingBasis = "PER_UNIT" | "PER_MEASURE";

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
const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<OfferState>({ kind: "loading" });
  const [products, setProducts] = useState<ReadonlyArray<CatalogProduct>>([]);
  const [query, setQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const searchSequence = useRef(0);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<CatalogVariant | null>(null);
  const [priceMinor, setPriceMinor] = useState("");
  const [quantityPolicy, setQuantityPolicy] = useState<QuantityPolicy | "">("");
  const [pricingBasis, setPricingBasis] = useState<PricingBasis | "">("");
  const [quantityMinBaseUnits, setQuantityMinBaseUnits] = useState("");
  const [quantityMaxBaseUnits, setQuantityMaxBaseUnits] = useState("");
  const [quantityStepBaseUnits, setQuantityStepBaseUnits] = useState("");
  const [pricingUnitBaseUnits, setPricingUnitBaseUnits] = useState("");
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [storeProductCategories, setStoreProductCategories] = useState<ReadonlyArray<CatalogCategory>>([]);
  const [proposalCategories, setProposalCategories] = useState<ReadonlyArray<CatalogCategory>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storeProductName, setStoreProductName] = useState("");
  const [storeProductVerticalID, setStoreProductVerticalID] = useState("");
  const [storeProductCategoryID, setStoreProductCategoryID] = useState("");
  const [storeProductMeasurementKind, setStoreProductMeasurementKind] = useState<MeasurementKind | "">("");
  const [storeProductBaseUnit, setStoreProductBaseUnit] = useState<BaseUnit | "">("");
  const [proposalName, setProposalName] = useState("");
  const [proposalVerticalID, setProposalVerticalID] = useState("");
  const [proposalCategoryID, setProposalCategoryID] = useState("");
  const [proposalMeasurementKind, setProposalMeasurementKind] = useState<MeasurementKind | "">("");
  const [proposalBaseUnit, setProposalBaseUnit] = useState<BaseUnit | "">("");
  const [modifierName, setModifierName] = useState("");
  const [modifierOptionName, setModifierOptionName] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [extensionOfferID, setExtensionOfferID] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" }); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const [offers, proposals, registry] = await Promise.all([dshClient().readOwnStoreOffers(token, storeId), dshClient().listOwnCatalogProductProposals(token), dshClient().listCatalogVerticals()]);
      setVerticals(registry);
      setState({ kind: "ready", offers, proposals: proposals.proposals });
    } catch (nextError) { reportError(nextError); setState({ kind: "error" }); setError(errorText(nextError)); }
  }, [storeId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!storeProductVerticalID) { setStoreProductCategories([]); return; }
    void dshClient().listCatalogCategories(storeProductVerticalID).then(setStoreProductCategories).catch((nextError) => { reportError(nextError); setError(errorText(nextError)); });
  }, [storeProductVerticalID]);

  useEffect(() => {
    if (!proposalVerticalID) { setProposalCategories([]); return; }
    void dshClient().listCatalogCategories(proposalVerticalID).then(setProposalCategories).catch((nextError) => { reportError(nextError); setError(errorText(nextError)); });
  }, [proposalVerticalID]);

  async function searchProducts() {
    const requestSequence = ++searchSequence.current;
    setSearchSubmitted(true);
    setError("");
    try { const token = await getUsableIdentityAccessToken(); const result = await dshClient().listCatalogProducts(token, query); if (requestSequence === searchSequence.current) setProducts(result); }
    catch (nextError) { if (requestSequence === searchSequence.current) { reportError(nextError); setError(errorText(nextError)); } }
  }

  async function addOffer() {
    const parsedPrice = Number(priceMinor.trim());
    const parsedMin = Number(quantityMinBaseUnits.trim());
    const parsedMax = Number(quantityMaxBaseUnits.trim());
    const parsedStep = Number(quantityStepBaseUnits.trim());
    const parsedPricingUnit = Number(pricingUnitBaseUnits.trim());
    const expectedPricingBasis = selectedVariant?.measurementKind === "DISCRETE" ? "PER_UNIT" : selectedVariant?.measurementKind === "MEASURED" ? "PER_MEASURE" : "";
    if (!selectedVariant || selectedVariant.measurementKind === "VARIABLE_MEASURE" || !quantityPolicy || pricingBasis !== expectedPricingBasis || !Number.isSafeInteger(parsedPrice) || parsedPrice < 1 || ![parsedMin, parsedMax, parsedStep, parsedPricingUnit].every(Number.isSafeInteger) || parsedMin < 1 || parsedMax < parsedMin || parsedStep < 1 || parsedPricingUnit < 1 || busy) return;
    const submittedPricingBasis = pricingBasis as PricingBasis;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await dshClient().createStoreOffer(token, storeId, selectedVariant.id, parsedPrice, quantityPolicy, submittedPricingBasis, parsedMin, parsedMax, parsedStep, parsedPricingUnit);
      setSelectedProduct(null); setSelectedVariant(null); setPriceMinor(""); setQuantityPolicy(""); setPricingBasis(""); setQuantityMinBaseUnits(""); setQuantityMaxBaseUnits(""); setQuantityStepBaseUnits(""); setPricingUnitBaseUnits(""); await load();
    } catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function updateOffer(offer: CatalogStoreOffer, publicationState: "draft" | "published" | "hidden", availability: boolean) {
    if (busy) return;
    setBusy(true); setError("");
      try { const token = await getUsableIdentityAccessToken(); await dshClient().updateStoreOffer(token, storeId, offer.offerId, offer.priceMinor, publicationState, availability, offer.version, offer.quantityPolicy, offer.pricingBasis, offer.quantityMinBaseUnits, offer.quantityMaxBaseUnits, offer.quantityStepBaseUnits, offer.pricingUnitBaseUnits); await load(); }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function createStoreProduct() {
    if (busy || !storeProductName.trim() || !storeProductVerticalID.trim() || !storeProductCategoryID.trim() || !storeProductMeasurementKind || !storeProductBaseUnit) return;
    setBusy(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); await dshClient().createStoreScopedProduct(token, storeId, { canonicalName: storeProductName, verticalId: storeProductVerticalID, scope: "STORE_SCOPED", storeId, variantTitle: "الافتراضي", measurementKind: storeProductMeasurementKind, baseUnit: storeProductBaseUnit, categoryIds: [storeProductCategoryID] }); setStoreProductName(""); await load(); }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function createProposal() {
    if (busy || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim() || !proposalMeasurementKind || !proposalBaseUnit) return;
    setBusy(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); await dshClient().createCatalogProductProposal(token, { id: Crypto.randomUUID(), verticalId: proposalVerticalID, categoryId: proposalCategoryID, proposedName: proposalName, proposedVariantTitle: "الافتراضي", proposedMeasurementKind: proposalMeasurementKind, proposedBaseUnit: proposalBaseUnit }); setProposalName(""); await load(); }
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
  const parsedMin = Number(quantityMinBaseUnits.trim());
  const parsedMax = Number(quantityMaxBaseUnits.trim());
  const parsedStep = Number(quantityStepBaseUnits.trim());
  const parsedPricingUnit = Number(pricingUnitBaseUnits.trim());
  const expectedPricingBasis = selectedVariant?.measurementKind === "DISCRETE" ? "PER_UNIT" : selectedVariant?.measurementKind === "MEASURED" ? "PER_MEASURE" : "";
  const canAdd = selectedVariant !== null && selectedVariant.measurementKind !== "VARIABLE_MEASURE" && Boolean(quantityPolicy && pricingBasis) && pricingBasis === expectedPricingBasis && Number.isSafeInteger(parsedPrice) && parsedPrice > 0 && [parsedMin, parsedMax, parsedStep, parsedPricingUnit].every(Number.isSafeInteger) && parsedMin >= 1 && parsedMax >= parsedMin && parsedStep >= 1 && parsedPricingUnit >= 1;
  return (
    <View style={styles.container} accessibilityLabel="إدارة عروض المتجر">
      <Text style={styles.title}>كتالوج المتجر وعروضه</Text><Text style={styles.muted}>اختر نسخة معتمدة، ثم حدّد سعرها وتوافرها ونشرها لهذا المتجر.</Text>
      <View style={styles.searchRow}><TextInput accessibilityLabel="البحث في الكتالوج" editable={!busy} onChangeText={setQuery} onSubmitEditing={() => void searchProducts()} placeholder="ابحث باسم المنتج" returnKeyType="search" value={query} style={[styles.input, busy && styles.disabledInput]} />{query ? <Pressable accessibilityRole="button" accessibilityLabel="مسح البحث" disabled={busy} onPress={() => { ++searchSequence.current; setQuery(""); setProducts([]); setSearchSubmitted(false); setError(""); }} style={styles.clearSearch}><Text style={styles.clearSearchText}>مسح</Text></Pressable> : null}<Pressable accessibilityRole="button" disabled={busy} onPress={() => void searchProducts()} style={[styles.secondaryButton, busy && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, busy && styles.disabledSecondaryButtonText]}>بحث</Text></Pressable></View>
      {searchSubmitted && !products.length && !error ? <Text style={styles.muted}>لا توجد نتائج مطابقة. جرّب اسمًا آخر أو امسح البحث.</Text> : null}
      {products.length ? <View style={styles.productList}>{products.map((product) => <View key={product.id} style={styles.product}><Text style={styles.itemTitle}>{product.canonicalName}</Text>{product.variants.map((variant) => <Pressable accessibilityRole="button" accessibilityLabel={`اختيار ${product.canonicalName} ${variant.title}`} key={variant.id} onPress={() => { setSelectedProduct(product); setSelectedVariant(variant); setQuantityPolicy(""); setPricingBasis(""); setQuantityMinBaseUnits(""); setQuantityMaxBaseUnits(""); setQuantityStepBaseUnits(""); setPricingUnitBaseUnits(""); }} style={[styles.variant, selectedVariant?.id === variant.id && styles.productSelected]}><Text style={styles.muted}>{variant.title} · {measurementKindLabel(variant.measurementKind, variant.baseUnit)}</Text></Pressable>)}</View>)}</View> : null}
      {selectedVariant && selectedProduct ? <View style={styles.form}><Text style={styles.selected}>المحدد: {selectedProduct.canonicalName} · {selectedVariant.title}</Text><Text style={styles.muted}>هوية القياس: {measurementKindLabel(selectedVariant.measurementKind, selectedVariant.baseUnit)}</Text>{selectedVariant.measurementKind === "VARIABLE_MEASURE" ? <Text style={styles.warning}>القياس المتغير غير متاح للطلب حتى يكتمل مسار الكمية الفعلية.</Text> : <><Text style={styles.fieldLabel}>سياسة الكمية</Text><View style={styles.choiceRow}>{([selectedVariant.measurementKind] as QuantityPolicy[]).map((value) => <Pressable accessibilityRole="button" key={value} onPress={() => setQuantityPolicy(value)} style={[styles.choice, quantityPolicy === value && styles.choiceSelected]}><Text style={styles.choiceText}>{quantityPolicyLabel(value)}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>أساس التسعير</Text><View style={styles.choiceRow}>{([expectedPricingBasis] as PricingBasis[]).map((value) => <Pressable accessibilityRole="button" key={value} onPress={() => setPricingBasis(value)} style={[styles.choice, pricingBasis === value && styles.choiceSelected]}><Text style={styles.choiceText}>{pricingBasisLabel(value)}</Text></Pressable>)}</View><TextInput accessibilityLabel="الحد الأدنى للكمية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantityMinBaseUnits(toAsciiDigits(value))} placeholder="الحد الأدنى للكمية" value={quantityMinBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="الحد الأعلى للكمية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantityMaxBaseUnits(toAsciiDigits(value))} placeholder="الحد الأعلى للكمية" value={quantityMaxBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="خطوة الكمية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantityStepBaseUnits(toAsciiDigits(value))} placeholder="خطوة الكمية" value={quantityStepBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="وحدة التسعير الأساسية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setPricingUnitBaseUnits(toAsciiDigits(value))} placeholder="وحدة التسعير الأساسية" value={pricingUnitBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="السعر بالريال اليمني" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setPriceMinor(toAsciiDigits(value))} placeholder="السعر بالريال اليمني" value={priceMinor} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><Pressable accessibilityRole="button" disabled={busy || !canAdd} onPress={() => void addOffer()} style={[styles.button, (busy || !canAdd) && styles.disabledButton]}><Text style={[styles.buttonText, (busy || !canAdd) && styles.disabledButtonText]}>إضافة عرض للمتجر</Text></Pressable></>}</View> : null}
      <View style={styles.managementBlock}><Text style={styles.itemTitle}>منتج خاص بهذا المتجر</Text><Text style={styles.muted}>أضف منتجًا لهذا المتجر باختيار مجال وتصنيف من السجل المتاح.</Text><TextInput accessibilityLabel="اسم منتج المتجر" editable={!busy} onChangeText={setStoreProductName} placeholder="اسم المنتج" value={storeProductName} style={[styles.input, busy && styles.disabledInput]} /><Text style={styles.fieldLabel}>المجال التجاري</Text><View style={styles.choiceList}>{verticals.map((vertical) => <Pressable accessibilityRole="button" key={vertical.id} onPress={() => { setStoreProductVerticalID(vertical.id); setStoreProductCategoryID(""); }} style={[styles.choice, storeProductVerticalID === vertical.id && styles.choiceSelected]}><Text style={styles.choiceText}>{vertical.nameAr}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>التصنيف</Text><View style={styles.choiceList}>{storeProductCategories.map((category) => <Pressable accessibilityRole="button" key={category.id} onPress={() => setStoreProductCategoryID(category.id)} style={[styles.choice, storeProductCategoryID === category.id && styles.choiceSelected]}><Text style={styles.choiceText}>{category.nameAr}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>هوية القياس</Text><View style={styles.choiceList}>{(["DISCRETE", "MEASURED", "VARIABLE_MEASURE"] as MeasurementKind[]).map((value) => <Pressable accessibilityRole="button" key={value} onPress={() => { setStoreProductMeasurementKind(value); setStoreProductBaseUnit(""); }} style={[styles.choice, storeProductMeasurementKind === value && styles.choiceSelected]}><Text style={styles.choiceText}>{measurementKindLabel(value)}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>الوحدة الأساسية</Text><View style={styles.choiceRow}>{baseUnitOptions(storeProductMeasurementKind).map((value) => <Pressable accessibilityRole="button" key={value} onPress={() => setStoreProductBaseUnit(value)} style={[styles.choice, storeProductBaseUnit === value && styles.choiceSelected]}><Text style={styles.choiceText}>{baseUnitLabel(value)}</Text></Pressable>)}</View><Pressable accessibilityRole="button" disabled={busy || !storeProductName.trim() || !storeProductVerticalID.trim() || !storeProductCategoryID.trim() || !storeProductMeasurementKind || !storeProductBaseUnit} onPress={() => void createStoreProduct()} style={[styles.secondaryButton, (busy || !storeProductName.trim() || !storeProductVerticalID.trim() || !storeProductCategoryID.trim() || !storeProductMeasurementKind || !storeProductBaseUnit) && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, (busy || !storeProductName.trim() || !storeProductVerticalID.trim() || !storeProductCategoryID.trim() || !storeProductMeasurementKind || !storeProductBaseUnit) && styles.disabledSecondaryButtonText]}>إنشاء منتج المتجر</Text></Pressable></View>
       <View style={styles.managementBlock}><Text style={styles.itemTitle}>اقتراح منتج للمراجعة</Text><Text style={styles.muted}>أرسل اسم المنتج وتصنيفه للمراجعة؛ لا يظهر قبل اعتماد المراجعة.</Text><TextInput accessibilityLabel="اسم المقترح" editable={!busy} onChangeText={setProposalName} placeholder="اسم المنتج المقترح" value={proposalName} style={[styles.input, busy && styles.disabledInput]} /><Text style={styles.fieldLabel}>المجال التجاري</Text><View style={styles.choiceList}>{verticals.map((vertical) => <Pressable accessibilityRole="button" key={vertical.id} onPress={() => { setProposalVerticalID(vertical.id); setProposalCategoryID(""); }} style={[styles.choice, proposalVerticalID === vertical.id && styles.choiceSelected]}><Text style={styles.choiceText}>{vertical.nameAr}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>التصنيف</Text><View style={styles.choiceList}>{proposalCategories.map((category) => <Pressable accessibilityRole="button" key={category.id} onPress={() => setProposalCategoryID(category.id)} style={[styles.choice, proposalCategoryID === category.id && styles.choiceSelected]}><Text style={styles.choiceText}>{category.nameAr}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>هوية القياس</Text><View style={styles.choiceList}>{(["DISCRETE", "MEASURED", "VARIABLE_MEASURE"] as MeasurementKind[]).map((value) => <Pressable accessibilityRole="button" key={value} onPress={() => { setProposalMeasurementKind(value); setProposalBaseUnit(""); }} style={[styles.choice, proposalMeasurementKind === value && styles.choiceSelected]}><Text style={styles.choiceText}>{measurementKindLabel(value)}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>الوحدة الأساسية</Text><View style={styles.choiceRow}>{baseUnitOptions(proposalMeasurementKind).map((value) => <Pressable accessibilityRole="button" key={value} onPress={() => setProposalBaseUnit(value)} style={[styles.choice, proposalBaseUnit === value && styles.choiceSelected]}><Text style={styles.choiceText}>{baseUnitLabel(value)}</Text></Pressable>)}</View><Pressable accessibilityRole="button" disabled={busy || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim() || !proposalMeasurementKind || !proposalBaseUnit} onPress={() => void createProposal()} style={[styles.secondaryButton, (busy || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim() || !proposalMeasurementKind || !proposalBaseUnit) && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, (busy || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim() || !proposalMeasurementKind || !proposalBaseUnit) && styles.disabledSecondaryButtonText]}>إرسال المقترح</Text></Pressable>{state.kind === "ready" && state.proposals.length ? state.proposals.map((proposal) => <Text key={proposal.id} style={styles.muted}>{catalogProductProposalStateLabel(proposal.state)}{proposal.correctionReason ? ` · ${proposal.correctionReason}` : ""}</Text>) : null}</View>
      <View style={styles.managementBlock}><Text style={styles.itemTitle}>أقسام وإضافات المتجر</Text><Text style={styles.muted}>اختر عرضًا بالاسم ثم أنشئ مجموعة إضافات أو قسم عرض.</Text><View style={styles.offerPicker}>{state.kind === "ready" ? state.offers.map((offer) => <Pressable accessibilityRole="button" key={offer.offerId} onPress={() => setExtensionOfferID(offer.offerId)} style={[styles.variant, extensionOfferID === offer.offerId && styles.productSelected]}><Text style={styles.muted}>{offer.productName}</Text></Pressable>) : null}</View><TextInput accessibilityLabel="اسم مجموعة الإضافات" editable={!busy} onChangeText={setModifierName} placeholder="اسم مجموعة الإضافات" value={modifierName} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="اسم خيار الإضافة" editable={!busy} onChangeText={setModifierOptionName} placeholder="اسم خيار اختياري" value={modifierOptionName} style={[styles.input, busy && styles.disabledInput]} /><Pressable accessibilityRole="button" disabled={busy || !modifierName.trim()} onPress={() => void createModifiersAndAttach()} style={[styles.secondaryButton, (busy || !modifierName.trim()) && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, (busy || !modifierName.trim()) && styles.disabledSecondaryButtonText]}>إنشاء مجموعة إضافات وربطها</Text></Pressable><TextInput accessibilityLabel="اسم القسم" editable={!busy} onChangeText={setSectionName} placeholder="اسم قسم المتجر" value={sectionName} style={[styles.input, busy && styles.disabledInput]} /><Pressable accessibilityRole="button" disabled={busy || !sectionName.trim()} onPress={() => void createSectionAndAttach()} style={[styles.secondaryButton, (busy || !sectionName.trim()) && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, (busy || !sectionName.trim()) && styles.disabledSecondaryButtonText]}>إنشاء قسم وربطه</Text></Pressable></View>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة عروض المتجر…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text style={styles.muted}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
       {state.kind === "ready" ? state.offers.length === 0 ? <Text style={styles.muted}>لا توجد عروض مرتبطة بهذا المتجر بعد.</Text> : <View style={styles.offerList}>{state.offers.map((offer) => <View key={offer.offerId} style={styles.item}><View style={styles.itemText}><Text style={styles.itemTitle}>{offer.productName}</Text><Text style={styles.muted}>{formatMoney(offer.priceMinor, offer.currency)} · {measurementKindLabel(offer.measurementKind, offer.baseUnit)} · {storeOfferPublicationStateLabel(offer.publicationState)}</Text></View><Switch accessibilityLabel={`توافر ${offer.productName}`} disabled={busy} onValueChange={(available) => void updateOffer(offer, offer.publicationState, available)} value={offer.availability} /><Pressable accessibilityRole="button" disabled={busy} onPress={() => void updateOffer(offer, offer.publicationState === "published" ? "hidden" : "published", offer.availability)} style={[styles.secondaryButton, busy && styles.disabledSecondaryButton]}><Text style={[styles.secondaryButtonText, busy && styles.disabledSecondaryButtonText]}>{offer.publicationState === "published" ? "إخفاء" : "نشر"}</Text></Pressable></View>)}</View> : null}
      {error && state.kind !== "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const startInputTextAlign = resolveTextInputAlign("start", activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%", direction: activeDirection },
    state: { alignItems: "center", gap: spacing[2] },
    title: { ...typography.titleSm, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    selected: { ...typography.bodySm, color: theme.color, textAlign: startTextAlign },
    searchRow: { direction: activeDirection, flexDirection: "row", gap: spacing[2] },
    clearSearch: { alignItems: "center", justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[1] },
    clearSearchText: { ...typography.label, color: theme.interactiveText, textDecorationLine: "underline" },
    form: { gap: spacing[2] },
    fieldLabel: { ...typography.label, color: theme.color, textAlign: startTextAlign },
    choiceList: { gap: spacing[1] },
    choiceRow: { direction: activeDirection, flexDirection: "row", flexWrap: "wrap", gap: spacing[1] },
    choice: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, minHeight: sizing.controlMd, paddingHorizontal: spacing[2], paddingVertical: spacing[2] },
    choiceSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground, borderWidth: borders.strong },
    choiceText: { ...typography.label, color: theme.color, textAlign: startTextAlign },
    warning: { ...typography.bodySm, color: theme.warning, textAlign: startTextAlign },
    managementBlock: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    offerPicker: { gap: spacing[1] },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, flex: 1, minHeight: sizing.controlMd, paddingHorizontal: spacing[2], textAlign: startInputTextAlign, writingDirection: activeDirection },
    numericInput: { textAlign: resolveTextInputAlign("start", "ltr"), writingDirection: "ltr" },
    productList: { gap: spacing[2] },
    product: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2] },
    variant: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, minHeight: sizing.controlMd, padding: spacing[2] },
    productSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground, borderWidth: borders.strong },
    offerList: { gap: spacing[3] },
    item: { alignItems: "center", borderColor: theme.borderColor, borderTopWidth: borders.hairline, direction: activeDirection, flexDirection: "row", gap: spacing[3], paddingTop: spacing[3] },
    itemText: { flex: 1, gap: spacing[1] },
    itemTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.sm, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    buttonText: { ...typography.bodyStrong, color: theme.onAction },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[2] },
    secondaryButtonText: { ...typography.label, color: theme.color, textAlign: "center" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    disabledSecondaryButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledSecondaryButtonText: { color: theme.disabledText },
    disabledInput: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground, color: theme.disabledText },
    error: { ...typography.label, color: theme.danger, textAlign: startTextAlign },
  });
}

function measurementKindLabel(kind: MeasurementKind, baseUnit?: BaseUnit): string {
  const label = sharedMeasurementKindLabel(kind);
  if (kind === "DISCRETE" || !baseUnit) return label;
  return `${label} · ${baseUnitLabel(baseUnit)}`;
}

function quantityPolicyLabel(policy: QuantityPolicy): string {
  return sharedQuantityPolicyLabel(policy);
}

function pricingBasisLabel(basis: PricingBasis): string {
  return sharedPricingBasisLabel(basis);
}

function baseUnitOptions(kind: MeasurementKind | ""): BaseUnit[] {
  if (kind === "DISCRETE") return ["COUNT"];
  if (kind === "MEASURED" || kind === "VARIABLE_MEASURE") return ["GRAM", "MILLILITER"];
  return [];
}
