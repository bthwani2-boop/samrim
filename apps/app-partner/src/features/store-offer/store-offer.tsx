import { borders, radius, type resolveTheme, sizing, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { type BaseUnit, baseUnitLabel, type CatalogCategory, type CatalogMedia, type CatalogProduct, type CatalogProductProposal, type CatalogStoreOffer, type CatalogVariant, type CommerceVertical, catalogProductProposalStateLabel, createDshMobileClient, type DshImageUploadInput, formatMoney, type MeasurementKind, measurementKindLabel as sharedMeasurementKindLabel, pricingBasisLabel as sharedPricingBasisLabel, quantityPolicyLabel as sharedQuantityPolicyLabel, storeOfferPublicationStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type OfferState = { kind: "loading" } | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer>; proposals: ReadonlyArray<CatalogProductProposal> } | { kind: "error" };
type QuantityPolicy = "DISCRETE" | "MEASURED" | "VARIABLE_MEASURE";
type PricingBasis = "PER_UNIT" | "PER_MEASURE";
type PendingProductMedia = Readonly<{ productID: string; expectedVersion: number; image: DshImageUploadInput }>;

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
  const [productNextCursor, setProductNextCursor] = useState("");
  const [proposalNextCursor, setProposalNextCursor] = useState("");
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
  const [storeProductImageURI, setStoreProductImageURI] = useState("");
  const [storeProductImage, setStoreProductImage] = useState<DshImageUploadInput | null>(null);
  const [pendingProductMedia, setPendingProductMedia] = useState<PendingProductMedia | null>(null);
  const [mediaDraft, setMediaDraft] = useState<ReadonlyArray<CatalogMedia>>([]);
  const [mediaUpload, setMediaUpload] = useState<DshImageUploadInput | null>(null);
  const [mediaUploadRole, setMediaUploadRole] = useState<"primary" | "gallery">("gallery");
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaBusyRef = useRef(false);
  const [storeProductVerticalID, setStoreProductVerticalID] = useState("");
  const [storeProductCategoryID, setStoreProductCategoryID] = useState("");
  const [storeProductMeasurementKind, setStoreProductMeasurementKind] = useState<MeasurementKind | "">("");
  const [storeProductBaseUnit, setStoreProductBaseUnit] = useState<BaseUnit | "">("");
  const [proposalName, setProposalName] = useState("");
  const [proposalImageURI, setProposalImageURI] = useState("");
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
      setProposalNextCursor(proposals.nextCursor ?? "");
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

  async function searchProducts(cursor = "", append = false) {
    const requestSequence = ++searchSequence.current;
    setSearchSubmitted(true);
    setError("");
    try { const token = await getUsableIdentityAccessToken(); const result = await dshClient().listCatalogProducts(token, query, "", 100, cursor); if (requestSequence === searchSequence.current) { setProducts((current) => append ? [...current, ...result.products] : result.products); setProductNextCursor(result.nextCursor ?? ""); } }
    catch (nextError) { if (requestSequence === searchSequence.current) { reportError(nextError); setError(errorText(nextError)); } }
  }

  async function loadMoreProposals() {
    if (!proposalNextCursor || state.kind !== "ready" || busy) return;
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await dshClient().listOwnCatalogProductProposals(token, "", 50, proposalNextCursor);
      setState((current) => current.kind === "ready" ? { ...current, proposals: [...current.proposals, ...result.proposals] } : current);
      setProposalNextCursor(result.nextCursor ?? "");
    } catch (nextError) { reportError(nextError); setError(errorText(nextError)); }
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
    try {
      const token = await getUsableIdentityAccessToken();
      const image = storeProductImage;
      const created = await dshClient().createStoreScopedProduct(token, storeId, { canonicalName: storeProductName, verticalId: storeProductVerticalID, scope: "STORE_SCOPED", storeId, variantTitle: "الافتراضي", measurementKind: storeProductMeasurementKind, baseUnit: storeProductBaseUnit, categoryIds: [storeProductCategoryID], ...(!image && storeProductImageURI.trim() ? { imageUri: storeProductImageURI.trim() } : {}) });
      if (image) {
        try {
          await dshClient().uploadStoreProductMedia(token, storeId, created.product.id, image, "primary", created.product.version);
          setPendingProductMedia(null);
        } catch (uploadError) {
          reportError(uploadError);
          setPendingProductMedia({ productID: created.product.id, expectedVersion: created.product.version, image });
          setError("تم إنشاء المنتج، لكن رفع الصورة تعذر. أعد المحاولة من زر رفع الصورة.");
          return;
        }
      }
      setStoreProductName(""); setStoreProductImageURI(""); setStoreProductImage(null); setBusy(false); void load();
    }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function retryProductMedia() {
    if (!pendingProductMedia || busy) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await dshClient().uploadStoreProductMedia(token, storeId, pendingProductMedia.productID, pendingProductMedia.image, "primary", pendingProductMedia.expectedVersion);
      setPendingProductMedia(null); setStoreProductImage(null); await load();
    } catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function pickStoreProductImage() {
    if (busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("يلزم السماح بالوصول إلى الصور لاختيار صورة المنتج."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    const type = asset.mimeType ?? "image/jpeg";
    const name = asset.fileName ?? "product-image.jpg";
    const imageURI = asset.uri;
    try {
      const imageResponse = await fetch(imageURI);
      if (!imageResponse.ok) throw new Error("PRODUCT_IMAGE_READ_FAILED");
      const blob = await imageResponse.blob();
      const image = {
        uri: imageURI,
        name,
        type,
        blob,
      } satisfies DshImageUploadInput;
      setStoreProductImage(image);
      setPendingProductMedia((current) => current ? { ...current, image } : current);
      setError("");
    } catch (nextError) {
      reportError(nextError);
      setError("تعذر تجهيز صورة المنتج للرفع. اختر الصورة مرة أخرى.");
    }
  }

  function selectProduct(product: CatalogProduct, variant: CatalogVariant) {
    setSelectedProduct(product);
    setSelectedVariant(variant);
    setMediaDraft(product.media);
    setMediaUpload(null);
    setMediaUploadRole("gallery");
    setQuantityPolicy(""); setPricingBasis(""); setQuantityMinBaseUnits(""); setQuantityMaxBaseUnits(""); setQuantityStepBaseUnits(""); setPricingUnitBaseUnits("");
  }

  function replaceProductInSearch(product: CatalogProduct) {
    setSelectedProduct(product);
    setMediaDraft(product.media);
    setProducts((current) => current.map((item) => item.id === product.id ? product : item));
  }

  function beginMediaMutation(): boolean {
    if (mediaBusyRef.current || mediaBusy) return false;
    mediaBusyRef.current = true;
    setMediaBusy(true);
    return true;
  }

  function endMediaMutation(): void {
    mediaBusyRef.current = false;
    setMediaBusy(false);
  }

  async function pickSelectedProductMedia() {
    if (mediaBusy || !selectedProduct || selectedProduct.scope !== "STORE_SCOPED" || selectedProduct.storeId !== storeId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("يلزم السماح بالوصول إلى الصور لاختيار صورة المنتج."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    try {
      const imageResponse = await fetch(asset.uri);
      if (!imageResponse.ok) throw new Error("PRODUCT_IMAGE_READ_FAILED");
      setMediaUpload({ uri: asset.uri, name: asset.fileName ?? "product-image.jpg", type: asset.mimeType ?? "image/jpeg", blob: await imageResponse.blob() });
      setError("");
    } catch (nextError) {
      reportError(nextError);
      setError("تعذر تجهيز صورة المنتج للرفع. اختر الصورة مرة أخرى.");
    }
  }

  async function uploadSelectedProductMedia() {
    if (!mediaUpload || !selectedProduct || selectedProduct.scope !== "STORE_SCOPED" || selectedProduct.storeId !== storeId || !beginMediaMutation()) return;
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await dshClient().uploadStoreProductMedia(token, storeId, selectedProduct.id, mediaUpload, mediaUploadRole, selectedProduct.version);
      replaceProductInSearch(result.product);
      setMediaUpload(null);
    } catch (nextError) {
      reportError(nextError);
      setError(errorText(nextError));
    } finally { endMediaMutation(); }
  }

  function moveMedia(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= mediaDraft.length || (index === 0 && direction === 1) || (nextIndex === 0 && mediaDraft[index]?.role !== "primary")) return;
    const next = [...mediaDraft];
    const current = next[index];
    const target = next[nextIndex];
    if (!current || !target) return;
    [next[index], next[nextIndex]] = [target, current];
    setMediaDraft(next.map((item, ordinal) => ({ ...item, role: ordinal === 0 ? "primary" : "gallery", ordinal })));
  }

  function removeMedia(index: number) {
    const next = mediaDraft.filter((_, itemIndex) => itemIndex !== index);
    setMediaDraft(next.map((item, ordinal) => ({ ...item, role: ordinal === 0 ? "primary" : "gallery", ordinal })));
  }

  async function saveSelectedProductMedia() {
    if (selectedProduct?.scope !== "STORE_SCOPED" || selectedProduct.storeId !== storeId) return;
    if (mediaDraft.length > 0 && mediaDraft[0]?.role !== "primary") { setError("يجب أن تكون الصورة الأولى هي الصورة الأساسية."); return; }
    if (!beginMediaMutation()) return;
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await dshClient().replaceStoreProductMedia(token, storeId, selectedProduct.id, { media: mediaDraft.map((item, ordinal) => ({ uri: item.uri, role: ordinal === 0 ? "primary" : "gallery", ordinal })) }, selectedProduct.version);
      replaceProductInSearch(result.product);
    } catch (nextError) {
      reportError(nextError);
      setError(errorText(nextError));
    } finally { endMediaMutation(); }
  }

  async function createProposal() {
    if (busy || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim() || !proposalMeasurementKind || !proposalBaseUnit) return;
    setBusy(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); await dshClient().createCatalogProductProposal(token, { id: Crypto.randomUUID(), verticalId: proposalVerticalID, categoryId: proposalCategoryID, proposedName: proposalName, proposedVariantTitle: "الافتراضي", proposedMeasurementKind: proposalMeasurementKind, proposedBaseUnit: proposalBaseUnit, ...(proposalImageURI.trim() ? { proposedImageUri: proposalImageURI.trim() } : {}) }); setProposalName(""); setProposalImageURI(""); await load(); }
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
       <View style={styles.searchRow}><TextInput accessibilityLabel="البحث في الكتالوج" editable={!busy} onChangeText={setQuery} onSubmitEditing={() => void searchProducts()} placeholder="ابحث باسم المنتج" returnKeyType="search" value={query} style={[styles.input, busy && styles.disabledInput]} />{query ? <BthwaniButton accessibilityLabel="مسح البحث" disabled={busy} label="مسح" onPress={() => { ++searchSequence.current; setQuery(""); setProducts([]); setProductNextCursor(""); setSearchSubmitted(false); setError(""); }} style={styles.clearSearch} variant="quiet" /> : null}<BthwaniButton busy={busy} disabled={busy} label="بحث" onPress={() => void searchProducts()} variant="secondary" /></View>
      {searchSubmitted && !products.length && !error ? <Text style={styles.muted}>لا توجد نتائج مطابقة. جرّب اسمًا آخر أو امسح البحث.</Text> : null}
       {products.length ? <><View style={styles.productList}>{products.map((product) => { const primaryMedia = getPrimaryMedia(product.media); return <View key={product.id} style={styles.product}><View style={styles.productHeader}>{primaryMedia ? <Image accessibilityLabel={`صورة ${product.canonicalName}`} source={{ uri: primaryMedia.uri }} resizeMode="cover" style={styles.productImage} /> : <View accessibilityLabel={`لا توجد صورة لـ ${product.canonicalName}`} style={styles.productImagePlaceholder}><Text style={styles.imagePlaceholderText}>لا توجد صورة</Text></View>}<View style={styles.productCopy}><Text style={styles.itemTitle}>{product.canonicalName}</Text><Text style={styles.muted}>{product.variants.length} نسخة متاحة للاختيار</Text></View></View>{product.variants.map((variant) => <BthwaniChip key={variant.id} label={`${variant.title} · ${measurementKindLabel(variant.measurementKind, variant.baseUnit)}`} onPress={() => selectProduct(product, variant)} selected={selectedVariant?.id === variant.id} />)}</View>; })}</View>{productNextCursor ? <BthwaniButton busy={busy} disabled={busy} label="تحميل المزيد من المنتجات" onPress={() => void searchProducts(productNextCursor, true)} variant="secondary" /> : null}</> : null}
      {selectedVariant && selectedProduct ? <View style={styles.form}><Text style={styles.selected}>المحدد: {selectedProduct.canonicalName} · {selectedVariant.title}</Text><Text style={styles.muted}>هوية القياس: {measurementKindLabel(selectedVariant.measurementKind, selectedVariant.baseUnit)}</Text>{selectedVariant.measurementKind === "VARIABLE_MEASURE" ? <Text style={styles.warning}>القياس المتغير غير متاح للطلب حتى يكتمل مسار الكمية الفعلية.</Text> : <><Text style={styles.fieldLabel}>سياسة الكمية</Text><View style={styles.choiceRow}>{([selectedVariant.measurementKind] as QuantityPolicy[]).map((value) => <BthwaniChip key={value} label={quantityPolicyLabel(value)} onPress={() => setQuantityPolicy(value)} selected={quantityPolicy === value} />)}</View><Text style={styles.fieldLabel}>أساس التسعير</Text><View style={styles.choiceRow}>{([expectedPricingBasis] as PricingBasis[]).map((value) => <BthwaniChip key={value} label={pricingBasisLabel(value)} onPress={() => setPricingBasis(value)} selected={pricingBasis === value} />)}</View><TextInput accessibilityLabel="الحد الأدنى للكمية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantityMinBaseUnits(toAsciiDigits(value))} placeholder="الحد الأدنى للكمية" value={quantityMinBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="الحد الأعلى للكمية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantityMaxBaseUnits(toAsciiDigits(value))} placeholder="الحد الأعلى للكمية" value={quantityMaxBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="خطوة الكمية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantityStepBaseUnits(toAsciiDigits(value))} placeholder="خطوة الكمية" value={quantityStepBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="وحدة التسعير الأساسية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setPricingUnitBaseUnits(toAsciiDigits(value))} placeholder="وحدة التسعير الأساسية" value={pricingUnitBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="السعر بالريال اليمني" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setPriceMinor(toAsciiDigits(value))} placeholder="السعر بالريال اليمني" value={priceMinor} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><BthwaniButton busy={busy} disabled={!canAdd} label="إضافة عرض للمتجر" onPress={() => void addOffer()} /></>}</View> : null}
      {selectedProduct?.scope === "STORE_SCOPED" && selectedProduct.storeId === storeId ? <View style={styles.mediaManager} accessibilityLabel={`إدارة صور ${selectedProduct.canonicalName}`}><Text style={styles.itemTitle}>صور المنتج: {selectedProduct.canonicalName}</Text><Text style={styles.muted}>ارفع صورة أساسية أو صورة معرض، ثم احفظ الترتيب أو احذف الصور غير المطلوبة.</Text>{mediaDraft.length ? mediaDraft.map((item, index) => <View key={item.uri} style={styles.mediaRow}><Image accessibilityLabel={`${item.role === "primary" ? "الصورة الأساسية" : "صورة المعرض"} ${index + 1}`} source={{ uri: item.uri }} resizeMode="cover" style={styles.mediaImage} /><View style={styles.mediaCopy}><Text style={styles.muted}>{item.role === "primary" ? "أساسية" : "معرض"} · {index + 1}</Text><Text numberOfLines={1} style={styles.muted}>{item.uri}</Text></View><BthwaniButton disabled={mediaBusy || index === 0} label="أعلى" onPress={() => moveMedia(index, -1)} variant="quiet" /><BthwaniButton disabled={mediaBusy || index === mediaDraft.length - 1 || index === 0} label="أسفل" onPress={() => moveMedia(index, 1)} variant="quiet" /><BthwaniButton disabled={mediaBusy} label="حذف" onPress={() => removeMedia(index)} variant="danger" /></View>) : <Text style={styles.muted}>لا توجد صور لهذا المنتج.</Text>}<View style={styles.choiceRow}><BthwaniChip label="صورة أساسية" selected={mediaUploadRole === "primary"} onPress={() => setMediaUploadRole("primary")} /><BthwaniChip label="صورة معرض" selected={mediaUploadRole === "gallery"} onPress={() => setMediaUploadRole("gallery")} /></View><BthwaniButton busy={mediaBusy} disabled={mediaBusy} label="اختيار صورة" onPress={() => void pickSelectedProductMedia()} variant="secondary" />{mediaUpload ? <View style={styles.mediaUploadPreview}><Image accessibilityLabel="معاينة الصورة الجديدة" source={{ uri: mediaUpload.uri }} resizeMode="cover" style={styles.mediaImage} /><BthwaniButton busy={mediaBusy} disabled={mediaBusy} label="رفع الصورة" onPress={() => void uploadSelectedProductMedia()} /></View> : null}<BthwaniButton busy={mediaBusy} disabled={mediaBusy} label="حفظ معرض الصور" onPress={() => void saveSelectedProductMedia()} variant="secondary" /></View> : null}
      <View style={styles.managementBlock}><Text style={styles.itemTitle}>منتج خاص بهذا المتجر</Text><Text style={styles.muted}>أضف منتجًا لهذا المتجر باختيار مجال وتصنيف من السجل المتاح.</Text><TextInput accessibilityLabel="اسم منتج المتجر" editable={!busy} onChangeText={setStoreProductName} placeholder="اسم المنتج" value={storeProductName} style={[styles.input, busy && styles.disabledInput]} /><BthwaniButton busy={busy} disabled={busy} label={storeProductImage ? "تغيير صورة المنتج" : "اختيار صورة من الجهاز"} onPress={() => void pickStoreProductImage()} variant="secondary" />{storeProductImage ? <Image accessibilityLabel={`معاينة صورة ${storeProductName || "المنتج"}`} source={{ uri: storeProductImage.uri }} resizeMode="cover" style={styles.productImage} /> : <TextInput accessibilityLabel="رابط صورة منتج المتجر" autoCapitalize="none" autoCorrect={false} editable={!busy} keyboardType="url" onChangeText={setStoreProductImageURI} placeholder="رابط صورة المنتج (اختياري)" value={storeProductImageURI} style={[styles.input, busy && styles.disabledInput]} />}{pendingProductMedia ? <BthwaniButton busy={busy} disabled={busy} label="إعادة رفع صورة المنتج" onPress={() => void retryProductMedia()} /> : null}<Text style={styles.fieldLabel}>المجال التجاري</Text><View style={styles.choiceList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} label={vertical.nameAr} onPress={() => { setStoreProductVerticalID(vertical.id); setStoreProductCategoryID(""); }} selected={storeProductVerticalID === vertical.id} />)}</View><Text style={styles.fieldLabel}>التصنيف</Text><View style={styles.choiceList}>{storeProductCategories.map((category) => <BthwaniChip key={category.id} label={category.nameAr} onPress={() => setStoreProductCategoryID(category.id)} selected={storeProductCategoryID === category.id} />)}</View><Text style={styles.fieldLabel}>هوية القياس</Text><View style={styles.choiceList}>{(["DISCRETE", "MEASURED", "VARIABLE_MEASURE"] as MeasurementKind[]).map((value) => <BthwaniChip key={value} label={measurementKindLabel(value)} onPress={() => { setStoreProductMeasurementKind(value); setStoreProductBaseUnit(""); }} selected={storeProductMeasurementKind === value} />)}</View><Text style={styles.fieldLabel}>الوحدة الأساسية</Text><View style={styles.choiceRow}>{baseUnitOptions(storeProductMeasurementKind).map((value) => <BthwaniChip key={value} label={baseUnitLabel(value)} onPress={() => setStoreProductBaseUnit(value)} selected={storeProductBaseUnit === value} />)}</View><BthwaniButton busy={busy} disabled={!storeProductName.trim() || !storeProductVerticalID.trim() || !storeProductCategoryID.trim() || !storeProductMeasurementKind || !storeProductBaseUnit} label="إنشاء منتج المتجر" onPress={() => void createStoreProduct()} variant="secondary" /></View>
       <View style={styles.managementBlock}><Text style={styles.itemTitle}>اقتراح منتج للمراجعة</Text><Text style={styles.muted}>أرسل اسم المنتج وتصنيفه للمراجعة؛ لا يظهر قبل اعتماد المراجعة.</Text><TextInput accessibilityLabel="اسم المقترح" editable={!busy} onChangeText={setProposalName} placeholder="اسم المنتج المقترح" value={proposalName} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="رابط صورة المقترح" autoCapitalize="none" autoCorrect={false} editable={!busy} keyboardType="url" onChangeText={setProposalImageURI} placeholder="رابط صورة المقترح (اختياري)" value={proposalImageURI} style={[styles.input, busy && styles.disabledInput]} />{proposalImageURI.trim() ? <Image accessibilityLabel={`معاينة صورة ${proposalName || "المقترح"}`} source={{ uri: proposalImageURI.trim() }} resizeMode="cover" style={styles.productImage} /> : null}<Text style={styles.fieldLabel}>المجال التجاري</Text><View style={styles.choiceList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} label={vertical.nameAr} onPress={() => { setProposalVerticalID(vertical.id); setProposalCategoryID(""); }} selected={proposalVerticalID === vertical.id} />)}</View><Text style={styles.fieldLabel}>التصنيف</Text><View style={styles.choiceList}>{proposalCategories.map((category) => <BthwaniChip key={category.id} label={category.nameAr} onPress={() => setProposalCategoryID(category.id)} selected={proposalCategoryID === category.id} />)}</View><Text style={styles.fieldLabel}>هوية القياس</Text><View style={styles.choiceList}>{(["DISCRETE", "MEASURED", "VARIABLE_MEASURE"] as MeasurementKind[]).map((value) => <BthwaniChip key={value} label={measurementKindLabel(value)} onPress={() => { setProposalMeasurementKind(value); setProposalBaseUnit(""); }} selected={proposalMeasurementKind === value} />)}</View><Text style={styles.fieldLabel}>الوحدة الأساسية</Text><View style={styles.choiceRow}>{baseUnitOptions(proposalMeasurementKind).map((value) => <BthwaniChip key={value} label={baseUnitLabel(value)} onPress={() => setProposalBaseUnit(value)} selected={proposalBaseUnit === value} />)}</View><BthwaniButton busy={busy} disabled={!proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim() || !proposalMeasurementKind || !proposalBaseUnit} label="إرسال المقترح" onPress={() => void createProposal()} variant="secondary" />{state.kind === "ready" && state.proposals.length ? state.proposals.map((proposal) => <Text key={proposal.id} style={styles.muted}>{catalogProductProposalStateLabel(proposal.state)}{proposal.correctionReason ? ` · ${proposal.correctionReason}` : ""}</Text>) : null}{proposalNextCursor ? <BthwaniButton busy={busy} disabled={busy} label="تحميل المزيد من المقترحات" onPress={() => void loadMoreProposals()} variant="secondary" /> : null}</View>
       <View style={styles.managementBlock}><Text style={styles.itemTitle}>أقسام وإضافات المتجر</Text><Text style={styles.muted}>اختر عرضًا بالاسم ثم أنشئ مجموعة إضافات أو قسم عرض.</Text><View style={styles.offerPicker}>{state.kind === "ready" ? state.offers.map((offer) => <BthwaniChip key={offer.offerId} label={offer.productName} onPress={() => setExtensionOfferID(offer.offerId)} selected={extensionOfferID === offer.offerId} />) : null}</View><TextInput accessibilityLabel="اسم مجموعة الإضافات" editable={!busy} onChangeText={setModifierName} placeholder="اسم مجموعة الإضافات" value={modifierName} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="اسم خيار الإضافة" editable={!busy} onChangeText={setModifierOptionName} placeholder="اسم خيار اختياري" value={modifierOptionName} style={[styles.input, busy && styles.disabledInput]} /><BthwaniButton busy={busy} disabled={!modifierName.trim()} label="إنشاء مجموعة إضافات وربطها" onPress={() => void createModifiersAndAttach()} variant="secondary" /><TextInput accessibilityLabel="اسم القسم" editable={!busy} onChangeText={setSectionName} placeholder="اسم قسم المتجر" value={sectionName} style={[styles.input, busy && styles.disabledInput]} /><BthwaniButton busy={busy} disabled={!sectionName.trim()} label="إنشاء قسم وربطه" onPress={() => void createSectionAndAttach()} variant="secondary" /></View>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة عروض المتجر…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text style={styles.muted}>{error}</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View> : null}
        {state.kind === "ready" ? state.offers.length === 0 ? <Text style={styles.muted}>لا توجد عروض مرتبطة بهذا المتجر بعد.</Text> : <View style={styles.offerList}>{state.offers.map((offer) => { const primaryMedia = getPrimaryMedia(offer.media); return <View key={offer.offerId} style={styles.item}>{primaryMedia ? <Image accessibilityLabel={`صورة ${offer.productName}`} source={{ uri: primaryMedia.uri }} resizeMode="cover" style={styles.offerImage} /> : <View accessibilityLabel={`لا توجد صورة لـ ${offer.productName}`} style={styles.offerImagePlaceholder}><Text style={styles.imagePlaceholderText}>لا توجد صورة</Text></View>}<View style={styles.itemText}><Text style={styles.itemTitle}>{offer.productName}</Text><Text style={styles.muted}>{formatMoney(offer.priceMinor, offer.currency)} · {measurementKindLabel(offer.measurementKind, offer.baseUnit)} · {storeOfferPublicationStateLabel(offer.publicationState)}</Text></View><Switch accessibilityLabel={`توافر ${offer.productName}`} disabled={busy} onValueChange={(available) => void updateOffer(offer, offer.publicationState, available)} value={offer.availability} /><BthwaniButton busy={busy} disabled={busy} label={offer.publicationState === "published" ? "إخفاء" : "نشر"} onPress={() => void updateOffer(offer, offer.publicationState === "published" ? "hidden" : "published", offer.availability)} variant="secondary" /></View>; })}</View> : null}
      {error && state.kind !== "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%" },
    state: { alignItems: "center", gap: spacing[2] },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    selected: { ...typography.bodySm, color: theme.color },
    searchRow: { flexDirection: "row", gap: spacing[2] },
    clearSearch: { alignItems: "center", justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[1] },
    form: { gap: spacing[2] },
    fieldLabel: { ...typography.label, color: theme.color },
    choiceList: { gap: spacing[1] },
    choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[1] },
    warning: { ...typography.bodySm, color: theme.warning },
    managementBlock: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    offerPicker: { gap: spacing[1] },
    mediaManager: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    mediaRow: { alignItems: "center", borderColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", gap: spacing[1], paddingTop: spacing[2] },
    mediaCopy: { flex: 1, gap: spacing[1] },
    mediaImage: { backgroundColor: theme.surface, borderRadius: radius.sm, height: 56, width: 56 },
    mediaUploadPreview: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, flex: 1, minHeight: sizing.controlMd, paddingHorizontal: spacing[2] },
    numericInput: { textAlign: "left", writingDirection: "ltr" },
    productList: { gap: spacing[2] },
    product: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2] },
    productHeader: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    productCopy: { flex: 1, gap: spacing[1] },
    productImage: { backgroundColor: theme.surface, borderRadius: radius.sm, height: 64, width: 64 },
    productImagePlaceholder: { alignItems: "center", backgroundColor: theme.surface, borderRadius: radius.sm, height: 64, justifyContent: "center", width: 64 },
    offerImage: { backgroundColor: theme.surface, borderRadius: radius.sm, height: 64, width: 64 },
    offerImagePlaceholder: { alignItems: "center", backgroundColor: theme.surface, borderRadius: radius.sm, height: 64, justifyContent: "center", width: 64 },
    imagePlaceholderText: { ...typography.caption, color: theme.colorMuted, textAlign: "center" },
    offerList: { gap: spacing[3] },
    item: { alignItems: "center", borderColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", gap: spacing[3], paddingTop: spacing[3] },
    itemText: { flex: 1, gap: spacing[1] },
    itemTitle: { ...typography.bodyStrong, color: theme.color },
    disabledInput: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground, color: theme.disabledText },
    error: { ...typography.label, color: theme.danger },
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

function getPrimaryMedia(media: ReadonlyArray<CatalogMedia>): CatalogMedia | null {
  const candidate = media.find((item) => item.role === "primary") ?? media[0];
  return candidate?.uri.trim() ? candidate : null;
}
