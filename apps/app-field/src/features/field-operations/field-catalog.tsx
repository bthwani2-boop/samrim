import { type BaseUnit, baseUnitLabel, type CatalogIdentifierResolution, type CatalogProduct, type CatalogStoreOffer, type CatalogVariant, type CreateFieldCatalogProductRequest, type CreateStoreOfferRequest, type MeasurementKind, measurementKindLabel, type StoreOfferPublicationState, type UpdateStoreOfferRequest } from "@bthwani/dsh";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";

type CatalogSnapshot = Awaited<ReturnType<ReturnType<typeof fieldClient>["readFieldJoiningCaseCatalog"]>>;
type OfferDraft = Readonly<{ priceMinor: string; available: boolean; min: string; max: string; step: string; pricingUnit: string; inventoryOnHand: string }>;

function initialOfferDraft(kind: MeasurementKind): OfferDraft {
  return { priceMinor: "", available: true, min: "1", max: kind === "DISCRETE" ? "1" : "100000", step: "1", pricingUnit: kind === "DISCRETE" ? "1" : "1000", inventoryOnHand: "0" };
}

function idempotency(prefix: string) {
  return { idempotencyKey: `field_catalog_${prefix}_${Crypto.randomUUID()}`, correlationID: `field_catalog_corr_${Crypto.randomUUID()}` };
}

function messageFromError(cause: unknown): string {
  if (!cause || typeof cause !== "object") return "تعذر تنفيذ عملية الكتالوج.";
  const error = cause as { kind?: unknown; status?: unknown; code?: unknown };
  if (error.kind === "http" && error.status === 401) return "انتهت جلسة الميدان. سجّل الدخول مجددًا.";
  if (error.kind === "http" && error.status === 403) return "صلاحية الكتالوج الأولي تتطلب حالة انضمام معيّنة ومعتمدة ومتجرًا مرتبطًا وغير منشور.";
  if (error.kind === "http" && error.status === 409) return "تعارض في نسخة البيانات أو المعرّف. أعد القراءة قبل المحاولة مجددًا.";
  if (error.kind === "network") return "تعذر الاتصال بخدمة الكتالوج. أعد المحاولة بعد التحقق من الاتصال.";
  return typeof error.code === "string" ? `تعذر تنفيذ العملية (${error.code}).` : "تعذر تنفيذ عملية الكتالوج.";
}

export function FieldCatalog({ caseId }: { caseId: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    screen: { backgroundColor: theme.background, flex: 1 },
    content: { gap: 14, padding: 18, paddingBottom: 36 },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 18, borderWidth: 1, gap: 10, padding: 14 },
    raised: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 8, padding: 12 },
    title: { color: theme.color, fontSize: 24, fontWeight: "700" },
    heading: { color: theme.color, fontSize: 17, fontWeight: "700" },
    body: { color: theme.color, fontSize: 15 },
    muted: { color: theme.colorMuted, fontSize: 14, lineHeight: 21 },
    error: { color: theme.danger, fontSize: 14 },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.color, minHeight: 46, paddingHorizontal: 11 },
    number: { textAlign: "left", writingDirection: "ltr" },
    camera: { borderRadius: 12, height: 230, overflow: "hidden", width: "100%" },
  }), [theme]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [identifierType, setIdentifierType] = useState<CreateFieldCatalogProductRequest["identifierType"]>("EAN");
  const [resolution, setResolution] = useState<CatalogIdentifierResolution | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<CatalogVariant | null>(null);
  const [existingOffer, setExistingOffer] = useState<CatalogStoreOffer | null>(null);
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [variantTitle, setVariantTitle] = useState("الافتراضي");
  const [measurementKind, setMeasurementKind] = useState<MeasurementKind>("DISCRETE");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>("COUNT");
  const [offerDraft, setOfferDraft] = useState<OfferDraft>(initialOfferDraft("DISCRETE"));
  const [availabilityOnly, setAvailabilityOnly] = useState(true);
  const [wasCreatedLocally, setWasCreatedLocally] = useState(false);

  const load = useCallback(async (search = "", priorOffer: CatalogStoreOffer | null = null) => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const current = await fieldClient().readOwnFieldJoiningCase(token, caseId);
      if (current.case.state !== "approved") throw new Error("FIELD_CATALOG_CASE_NOT_APPROVED");
      const result = await fieldClient().readFieldJoiningCaseCatalog(token, caseId, 100, search);
      setSnapshot(result);
      const matchedOffer = priorOffer ? result.offers.find((offer) => offer.offerId === priorOffer.offerId) : undefined;
      if (priorOffer && matchedOffer) setExistingOffer(matchedOffer);
    } catch (cause) {
      console.warn("DSH Field initial catalog readback failed", cause);
      setError(messageFromError(cause));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void load(""); }, [load]);

  async function search() {
    const nextQuery = queryDraft.trim();
    setQuery(nextQuery);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setExistingOffer(null);
    setResolution(null);
    setNotice("");
    await load(nextQuery);
  }

  async function resolveIdentifier(value = identifier) {
    const normalized = value.trim();
    if (!normalized || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setResolution(null);
    setExistingOffer(null);
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().resolveFieldCatalogIdentifier(token, caseId, normalized);
      const match = response.resolution;
      setResolution(match);
      setIdentifier(normalized);
      if (match.outcome === "UNKNOWN_IDENTIFIER") {
        setProductName("");
        setWasCreatedLocally(false);
        setNotice("لم يُعثر على المعرّف. يمكنك تسجيل منتج خاص بهذا المتجر بعد مراجعة الاسم والنسخة.");
      } else if (match.outcome === "SHARED_PRODUCT_MATCH" || match.outcome === "STORE_LOCAL_PRODUCT_MATCH") {
        const product = snapshot?.products.find((item) => item.id === match.productId);
        const variant = product?.variants.find((item) => item.id === match.variantId);
        if (!product || !variant) {
          await load(query);
          setNotice("عُثر على المنتج. حدّث النتائج ثم اختر النسخة لإضافة عرضها.");
        } else {
          selectVariant(product, variant);
          setNotice(`${match.outcome === "SHARED_PRODUCT_MATCH" ? "منتج مشترك" : "منتج خاص بهذا المتجر"}: ${match.productName ?? product.canonicalName}.`);
        }
      } else if (match.outcome === "EXISTING_STORE_OFFER") {
        const offer = snapshot?.offers.find((item) => item.offerId === match.storeOfferId);
        if (offer) {
          setExistingOffer(offer);
          setSelectedProduct(snapshot?.products.find((item) => item.id === offer.productId) ?? null);
          setSelectedVariant(snapshot?.products.flatMap((item) => item.variants).find((item) => item.id === offer.variantId) ?? null);
          setOfferDraft({ priceMinor: String(offer.priceMinor), available: offer.availability, min: String(offer.quantityMinBaseUnits), max: String(offer.quantityMaxBaseUnits), step: String(offer.quantityStepBaseUnits), pricingUnit: String(offer.pricingUnitBaseUnits), inventoryOnHand: String(offer.inventoryOnHandBaseUnits) });
          setAvailabilityOnly(offer.inventoryPolicy === "AVAILABILITY_ONLY");
          setNotice("العرض موجود مسبقًا. راجع السعر والتوافر قبل أي تعديل.");
        } else {
          await load(query);
          setNotice("العرض موجود لهذا المتجر. حدّث القائمة لعرض حالته.");
        }
      } else if (match.outcome === "VARIABLE_MEASURE_IDENTIFIER") {
        setNotice("هذا معرّف لمنتج بكمية متغيرة، ولا يمكن إنشاء عرض قابل للطلب حتى يكتمل مسار الكمية الفعلية.");
      } else if (match.outcome === "UNAVAILABLE_IN_STORE") {
        setNotice("هذا المعرّف مرتبط بمنتج خاص بمتجر آخر، ولا يمكن استخدامه في هذا المتجر.");
      } else {
        setNotice("المعرّف يطابق أكثر من نتيجة. أوقف استخدامه واطلب مراجعة هوية المنتج.");
      }
    } catch (cause) {
      console.warn("DSH Field barcode resolution failed", cause);
      setError(messageFromError(cause));
    } finally {
      setBusy(false);
      setCameraOpen(false);
    }
  }

  function selectVariant(product: CatalogProduct, variant: CatalogVariant) {
    setSelectedProduct(product);
    setSelectedVariant(variant);
    const offer = snapshot?.offers.find((item) => item.variantId === variant.id);
    setExistingOffer(offer ?? null);
    if (offer) {
      setOfferDraft({ priceMinor: String(offer.priceMinor), available: offer.availability, min: String(offer.quantityMinBaseUnits), max: String(offer.quantityMaxBaseUnits), step: String(offer.quantityStepBaseUnits), pricingUnit: String(offer.pricingUnitBaseUnits), inventoryOnHand: String(offer.inventoryOnHandBaseUnits) });
      setAvailabilityOnly(offer.inventoryPolicy === "AVAILABILITY_ONLY");
    } else {
      setOfferDraft(initialOfferDraft(variant.measurementKind));
      setAvailabilityOnly(true);
    }
    setWasCreatedLocally(product.scope === "STORE_SCOPED" && product.storeId === snapshot?.storeId);
  }

  async function createLocalProduct() {
    if (busy || !snapshot || !productName.trim() || !variantTitle.trim()) return;
    if (measurementKind === "DISCRETE" && baseUnit !== "COUNT") { setError("المنتج المنفصل يحتاج وحدة عدد."); return; }
    if (measurementKind !== "DISCRETE" && baseUnit !== "GRAM" && baseUnit !== "MILLILITER") { setError("اختر وحدة قياس صالحة."); return; }
    const request: CreateFieldCatalogProductRequest = {
      canonicalName: productName.trim(), description: description.trim(), ...(brand.trim() ? { brand: brand.trim() } : {}),
      variantTitle: variantTitle.trim(), measurementKind, baseUnit,
      ...(identifier.trim() ? { identifierType: identifierType ?? "EAN", identifierValue: identifier.trim() } : {}),
    };
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const saved = await fieldClient().createFieldCatalogProduct(token, caseId, request, ...Object.values(idempotency("product")) as [string, string]);
      const product = saved.product;
      const variant = product.variants[0];
      if (!variant) throw new Error("FIELD_CREATED_PRODUCT_HAS_NO_VARIANT");
      setSnapshot((current) => current ? { ...current, products: [product, ...current.products.filter((item) => item.id !== product.id)] } : current);
      setProductName("");
      setDescription("");
      setBrand("");
      setWasCreatedLocally(true);
      selectVariant(product, variant);
      setNotice("سُجل المنتج الخاص بالمتجر. أكمل السعر والتوافر لإضافته إلى التشكيلة.");
    } catch (cause) {
      console.warn("DSH Field Store-local product creation failed", cause);
      setError(messageFromError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveInitialOffer() {
    if (busy || !selectedVariant || !selectedProduct || !snapshot) return;
    const priceMinor = Number(offerDraft.priceMinor);
    const min = Number(offerDraft.min);
    const max = Number(offerDraft.max);
    const step = Number(offerDraft.step);
    const pricingUnit = Number(offerDraft.pricingUnit);
    const inventory = Number(offerDraft.inventoryOnHand);
    if (selectedVariant.measurementKind === "VARIABLE_MEASURE") { setError("الكمية المتغيرة غير متاحة في كتالوج الإعداد الأولي."); return; }
    if (![priceMinor, min, max, step, pricingUnit, inventory].every(Number.isSafeInteger) || priceMinor < 1 || min < 1 || max < min || step < 1 || pricingUnit < 1 || inventory < 0 || (availabilityOnly && inventory !== 0)) {
      setError("أكمل سعرًا صحيحًا وحدود كمية ومخزونًا صالحًا قبل الحفظ.");
      return;
    }
    const quantityPolicy = selectedVariant.measurementKind;
    const pricingBasis: CreateStoreOfferRequest["pricingBasis"] = quantityPolicy === "DISCRETE" ? "PER_UNIT" : "PER_MEASURE";
    const inventoryPolicy: CreateStoreOfferRequest["inventoryPolicy"] = availabilityOnly ? "AVAILABILITY_ONLY" : "QUANTITY_ON_HAND";
    const productFacts: CreateStoreOfferRequest = {
      variantId: selectedVariant.id, priceMinor, quantityPolicy, quantityMinBaseUnits: min,
      quantityMaxBaseUnits: max, quantityStepBaseUnits: step, pricingBasis,
      pricingUnitBaseUnits: pricingUnit, inventoryPolicy, inventoryOnHandBaseUnits: inventory,
    };
    const state: StoreOfferPublicationState = existingOffer?.publicationState ?? "draft";
    const updateFacts: UpdateStoreOfferRequest = { priceMinor, availability: offerDraft.available, publicationState: state, quantityPolicy, quantityMinBaseUnits: min, quantityMaxBaseUnits: max, quantityStepBaseUnits: step, pricingBasis, pricingUnitBaseUnits: pricingUnit, inventoryPolicy, inventoryOnHandBaseUnits: inventory };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      let offer: CatalogStoreOffer;
      if (existingOffer) {
        const attempt = idempotency("offer_update");
        offer = (await fieldClient().updateFieldInitialCatalogOffer(token, caseId, existingOffer.offerId, updateFacts, existingOffer.version, attempt.idempotencyKey, attempt.correlationID)).offer;
      } else {
        const attempt = idempotency("offer_create");
        const created = await fieldClient().createFieldCatalogOffer(token, caseId, productFacts, attempt.idempotencyKey, attempt.correlationID);
        offer = created.offer;
        if (!offerDraft.available) {
          const followUp = idempotency("offer_availability");
          offer = (await fieldClient().updateFieldInitialCatalogOffer(token, caseId, offer.offerId, { ...updateFacts, publicationState: "draft" }, offer.version, followUp.idempotencyKey, followUp.correlationID)).offer;
        }
      }
      setSnapshot((current) => current ? { ...current, offers: [offer, ...current.offers.filter((item) => item.offerId !== offer.offerId)] } : current);
      setExistingOffer(offer);
      setOfferDraft((current) => ({ ...current, priceMinor: String(offer.priceMinor), available: offer.availability }));
      setNotice("حُفظ عرض الإعداد الأولي وسُجلت قرارات السعر والتوافر في DSH.");
    } catch (cause) {
      console.warn("DSH Field initial StoreOffer save failed", cause);
      setError(messageFromError(cause) + " أعد قراءة الكتالوج للتأكد من الحالة قبل إعادة المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  async function onBarcode(data: string) {
    if (busy || !data.trim()) return;
    setIdentifier(data.trim());
    await resolveIdentifier(data.trim());
  }

  const filteredProducts = snapshot?.products ?? [];
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>الكتالوج الأولي</Text>
    <Text style={styles.muted}>يظهر هذا المسار للحالة المعتمدة فقط. يتحقق DSH في كل قراءة وكتابة من الإسناد والارتباط بالمتجر وعدم إتمام Go-Live.</Text>
    {snapshot ? <View style={styles.card}><Text style={styles.heading}>المتجر المعتمد</Text><Text style={styles.body}>المتجر: {snapshot.storeId}</Text><Text style={styles.body}>المجال: {snapshot.verticalId}</Text></View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
    <View style={styles.card}>
      <Text style={styles.heading}>البحث عن منتج مشترك أو خاص بالمتجر</Text>
      <TextInput accessibilityLabel="بحث منتجات الكتالوج الأولي" editable={!busy} onChangeText={setQueryDraft} onSubmitEditing={() => void search()} placeholder="اسم المنتج" value={queryDraft} style={styles.input} />
      <View style={styles.row}><BthwaniButton busy={loading} disabled={busy || loading} label="بحث" onPress={() => void search()} /><BthwaniButton busy={loading} disabled={busy || loading} label="تحديث النتائج" onPress={() => void load(query, existingOffer)} variant="secondary" /></View>
      {loading ? <View style={{ alignItems: "center", gap: 6 }}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المنتجات…</Text></View> : null}
      {!loading && filteredProducts.length === 0 ? <Text style={styles.muted}>لا توجد نتائج؛ امسح البحث أو أنشئ منتجًا خاصًا بالمتجر.</Text> : null}
      {filteredProducts.map((product) => <View key={product.id} style={styles.raised}><Text style={styles.heading}>{product.canonicalName} · {product.scope === "SHARED" ? "مشترك" : "خاص بهذا المتجر"}</Text>{product.variants.map((variant) => <View key={variant.id} style={styles.row}><BthwaniChip disabled={busy} label={`${variant.title} · ${measurementKindLabel(variant.measurementKind)} · ${baseUnitLabel(variant.baseUnit)}`} onPress={() => selectVariant(product, variant)} selected={selectedVariant?.id === variant.id} /></View>)}</View>)}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading}>حلّ المعرّف الشريطي</Text>
      <Text style={styles.muted}>الباركود الدولي يُحل على مستوى النسخة. SKU يخص هذا المتجر فقط.</Text>
      <View style={styles.row}>{(["GTIN", "EAN", "UPC", "SKU"] as const).map((value) => <BthwaniChip key={value} disabled={busy} label={value} onPress={() => setIdentifierType(value)} selected={identifierType === value} />)}</View>
      <TextInput accessibilityLabel="الباركود أو SKU" autoCapitalize="characters" editable={!busy} onChangeText={setIdentifier} onSubmitEditing={() => void resolveIdentifier()} placeholder="امسح أو أدخل المعرّف" value={identifier} style={styles.input} />
      <View style={styles.row}><BthwaniButton busy={busy} disabled={busy || !identifier.trim()} label="حلّ المعرّف" onPress={() => void resolveIdentifier()} /><BthwaniButton disabled={busy} label={cameraOpen ? "إغلاق الكاميرا" : "مسح بالكاميرا"} onPress={async () => { if (cameraOpen) { setCameraOpen(false); return; } if (!cameraPermission?.granted) { const permission = await requestCameraPermission(); if (!permission.granted) { setError("يلزم السماح للكاميرا لمسح الباركود."); return; } } setCameraOpen(true); }} variant="secondary" /></View>
      {cameraOpen ? <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128"] }} onBarcodeScanned={({ data }) => { setCameraOpen(false); void onBarcode(data); }} /> : null}
      {resolution ? <Text style={styles.muted}>نتيجة الحل: {resolution.outcome}{resolution.productName ? ` · ${resolution.productName}` : ""}{resolution.variantTitle ? ` · ${resolution.variantTitle}` : ""}</Text> : null}
    </View>
    {resolution?.outcome === "UNKNOWN_IDENTIFIER" ? <View style={styles.card}>
      <Text style={styles.heading}>تسجيل منتج محلي</Text>
      <Text style={styles.muted}>ينشئ DSH منتجًا Store-scoped ونسخة جديدة داخل المتجر المرتبط بهذه الحالة. المعرّف العالمي يبقى فريدًا عبر النظام.</Text>
      <TextInput accessibilityLabel="اسم المنتج المحلي" editable={!busy} onChangeText={setProductName} placeholder="اسم المنتج" value={productName} style={styles.input} />
      <TextInput accessibilityLabel="وصف المنتج المحلي" editable={!busy} maxLength={4000} multiline onChangeText={setDescription} placeholder="وصف اختياري" value={description} style={styles.input} />
      <TextInput accessibilityLabel="علامة المنتج المحلية" editable={!busy} onChangeText={setBrand} placeholder="العلامة التجارية (اختياري)" value={brand} style={styles.input} />
      <TextInput accessibilityLabel="اسم نسخة المنتج" editable={!busy} onChangeText={setVariantTitle} placeholder="اسم النسخة" value={variantTitle} style={styles.input} />
      <View style={styles.row}>{(["DISCRETE", "MEASURED"] as const).map((value) => <BthwaniChip key={value} disabled={busy} label={measurementKindLabel(value)} onPress={() => { setMeasurementKind(value); setBaseUnit(value === "DISCRETE" ? "COUNT" : "GRAM"); }} selected={measurementKind === value} />)}</View>
      <View style={styles.row}>{(measurementKind === "DISCRETE" ? ["COUNT"] as const : ["GRAM", "MILLILITER"] as const).map((value) => <BthwaniChip key={value} disabled={busy} label={baseUnitLabel(value)} onPress={() => setBaseUnit(value)} selected={baseUnit === value} />)}</View>
      <BthwaniButton busy={busy} disabled={busy || !productName.trim() || !variantTitle.trim()} label="إنشاء منتج المتجر" onPress={() => void createLocalProduct()} />
    </View> : null}
    {selectedVariant && selectedProduct ? <View style={styles.card}>
      <Text style={styles.heading}>{existingOffer ? "تعديل عرض ما قبل Go-Live" : "إضافة العرض الأولي"}</Text>
      <Text style={styles.muted}>{selectedProduct.canonicalName} · {selectedVariant.title} · {wasCreatedLocally ? "منتج خاص بالمتجر" : selectedProduct.scope === "SHARED" ? "منتج مشترك" : "منتج محلي"}</Text>
      <TextInput accessibilityLabel="سعر العرض الأولي" editable={!busy} keyboardType="number-pad" onChangeText={(priceMinor) => setOfferDraft((current) => ({ ...current, priceMinor: priceMinor.replace(/[^0-9]/g, "") }))} placeholder="السعر بالريال اليمني" value={offerDraft.priceMinor} style={[styles.input, styles.number]} />
      <Text style={styles.muted}>التوافر: {offerDraft.available ? "متاح للطلب" : "غير متاح مؤقتًا"}</Text>
      <View style={styles.row}><BthwaniChip disabled={busy} label="متاح" onPress={() => setOfferDraft((current) => ({ ...current, available: true }))} selected={offerDraft.available} /><BthwaniChip disabled={busy} label="غير متاح" onPress={() => setOfferDraft((current) => ({ ...current, available: false }))} selected={!offerDraft.available} /></View>
      {selectedVariant.measurementKind === "VARIABLE_MEASURE" ? <Text style={styles.error}>الكمية المتغيرة غير مدعومة في الإعداد الأولي قبل اكتمال القياس الفعلي.</Text> : <>
        {selectedVariant.measurementKind !== "DISCRETE" ? <TextInput accessibilityLabel="وحدة التسعير الأساسية بالجرام أو الملليلتر" editable={!busy} keyboardType="number-pad" onChangeText={(pricingUnit) => setOfferDraft((current) => ({ ...current, pricingUnit: pricingUnit.replace(/[^0-9]/g, "") }))} placeholder="وحدة التسعير الأساسية" value={offerDraft.pricingUnit} style={[styles.input, styles.number]} /> : null}
        <View style={styles.row}><BthwaniChip disabled={busy} label="التوافر فقط" onPress={() => { setAvailabilityOnly(true); setOfferDraft((current) => ({ ...current, inventoryOnHand: "0" })); }} selected={availabilityOnly} /><BthwaniChip disabled={busy} label="إدارة مخزون فعلي" onPress={() => setAvailabilityOnly(false)} selected={!availabilityOnly} /></View>
        {!availabilityOnly ? <TextInput accessibilityLabel="المخزون الأولي" editable={!busy} keyboardType="number-pad" onChangeText={(inventoryOnHand) => setOfferDraft((current) => ({ ...current, inventoryOnHand: inventoryOnHand.replace(/[^0-9]/g, "") }))} placeholder="المخزون الأولي" value={offerDraft.inventoryOnHand} style={[styles.input, styles.number]} /> : null}
        <BthwaniButton busy={busy} disabled={busy || !offerDraft.priceMinor.trim()} label={existingOffer ? "حفظ التعديل الأولي" : "إضافة العرض إلى المتجر"} onPress={() => void saveInitialOffer()} />
      </>}
    </View> : null}
  </ScrollView>;
}
