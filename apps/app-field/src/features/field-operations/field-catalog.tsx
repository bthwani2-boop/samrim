import { type BaseUnit, baseUnitLabel, type CatalogAttributeRule, type CatalogAttributeValueInput, type CatalogIdentifierResolution, type CatalogProduct, type CatalogProductProposal, type CatalogStoreOffer, type CatalogVariant, type CreateCatalogProductProposalRequest, type CreateFieldCatalogProductRequest, type CreateStoreOfferRequest, type MeasurementKind, measurementKindLabel, type StoreOfferPublicationState, type UpdateCatalogProductProposalRequest, type UpdateStoreOfferRequest } from "@bthwani/dsh";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { MobileStoreCatalogImportWorkspace } from "@bthwani/dsh/mobile/store-catalog-import";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { FieldQuickPrices } from "./field-quick-prices";

type CatalogSnapshot = Awaited<ReturnType<ReturnType<typeof fieldClient>["readFieldJoiningCaseCatalog"]>>;
type OfferDraft = Readonly<{ priceMinor: string; available: boolean; min: string; max: string; step: string; pricingUnit: string; inventoryOnHand: string }>;
type SharedIdentifierType = "GTIN" | "EAN" | "UPC";
type ProposalAttributeDraft = Readonly<{ value: string; measurementUnit: string }>;
type ProposalMutationAttempt =
  | Readonly<{ kind: "create"; input: CreateCatalogProductProposalRequest; idempotencyKey: string; correlationID: string }>
  | Readonly<{ kind: "update"; proposalID: string; expectedVersion: number; input: UpdateCatalogProductProposalRequest; idempotencyKey: string; correlationID: string }>
  | Readonly<{ kind: "submit"; proposalID: string; expectedVersion: number; idempotencyKey: string; correlationID: string }>;

const proposalStateLabels: Readonly<Record<CatalogProductProposal["state"], string>> = {
  draft: "مسودة",
  submitted: "مرسل للمراجعة",
  needs_correction: "يتطلب تصحيحًا",
  approved: "معتمد",
  rejected: "مرفوض",
};

function initialOfferDraft(kind: MeasurementKind): OfferDraft {
  return { priceMinor: "", available: true, min: "1", max: kind === "DISCRETE" ? "1" : "100000", step: "1", pricingUnit: kind === "DISCRETE" ? "1" : "1000", inventoryOnHand: "0" };
}

function idempotency(prefix: string) {
  return { idempotencyKey: `field_catalog_${prefix}_${Crypto.randomUUID()}`, correlationID: `field_catalog_corr_${Crypto.randomUUID()}` };
}

function proposalAttributeValues(rules: ReadonlyArray<CatalogAttributeRule>, drafts: Readonly<Record<string, ProposalAttributeDraft>>, enumOptions: Readonly<Record<string, ReadonlyArray<string>>>): { attributeValues: CatalogAttributeValueInput[]; variantAttributeValues: CatalogAttributeValueInput[] } | null {
  const attributeValues: CatalogAttributeValueInput[] = [];
  const variantAttributeValues: CatalogAttributeValueInput[] = [];
  for (const rule of rules) {
    const draft = drafts[rule.attributeId];
    const value = draft?.value.trim() ?? "";
    if (!draft || !value) {
      if (rule.required) return null;
      continue;
    }
    let input: CatalogAttributeValueInput;
    if (rule.valueKind === "TEXT") input = { attributeId: rule.attributeId, valueKind: rule.valueKind, textValue: value };
    else if (rule.valueKind === "INTEGER") {
      const integerValue = Number(value);
      if (!Number.isSafeInteger(integerValue)) return null;
      input = { attributeId: rule.attributeId, valueKind: rule.valueKind, integerValue };
    } else if (rule.valueKind === "DECIMAL") {
      if (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) return null;
      input = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: value };
    } else if (rule.valueKind === "BOOLEAN") {
      if (value !== "true" && value !== "false") return null;
      input = { attributeId: rule.attributeId, valueKind: rule.valueKind, booleanValue: value === "true" };
    } else if (rule.valueKind === "ENUM") {
      if (!(enumOptions[rule.attributeId] ?? []).includes(value)) return null;
      input = { attributeId: rule.attributeId, valueKind: rule.valueKind, enumValue: value };
    } else if (rule.valueKind === "DATE") {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) return null;
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (date.toISOString().slice(0, 10) !== value) return null;
      input = { attributeId: rule.attributeId, valueKind: rule.valueKind, dateValue: value };
    } else {
      const measurementUnit = draft.measurementUnit.trim();
      if (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || !measurementUnit) return null;
      input = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: value, measurementUnit };
    }
    (rule.variantAxis ? variantAttributeValues : attributeValues).push(input);
  }
  return { attributeValues, variantAttributeValues };
}

function attributeDraftFromProposalValue(value: CatalogAttributeValueInput): ProposalAttributeDraft {
  const raw = value.textValue ?? value.integerValue?.toString() ?? value.decimalValue ?? value.enumValue ?? value.dateValue ?? (value.booleanValue === undefined || value.booleanValue === null ? "" : String(value.booleanValue));
  return { value: raw, measurementUnit: value.measurementUnit ?? "" };
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

function isOutcomeUncertain(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { kind?: unknown; status?: unknown };
  return error.kind === "network" || (error.kind === "http" && typeof error.status === "number" && error.status >= 500);
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
    label: { color: theme.color, fontSize: 15, fontWeight: "600" },
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
  const [offersNextCursor, setOffersNextCursor] = useState("");
  const [offersLoadingMore, setOffersLoadingMore] = useState(false);
  const [offersPageError, setOffersPageError] = useState("");
  const [proposals, setProposals] = useState<ReadonlyArray<CatalogProductProposal>>([]);
  const [activeProposal, setActiveProposal] = useState<CatalogProductProposal | null>(null);
  const [proposalCategories, setProposalCategories] = useState<ReadonlyArray<{ id: string; nameAr: string; pathAr: string; active: boolean }>>([]);
  const [proposalCategoryCursor, setProposalCategoryCursor] = useState("");
  const [proposalCategoryQuery, setProposalCategoryQuery] = useState("");
  const [proposalCategoryID, setProposalCategoryID] = useState("");
  const [proposalRules, setProposalRules] = useState<ReadonlyArray<CatalogAttributeRule>>([]);
  const [proposalRulesLoadedForCategory, setProposalRulesLoadedForCategory] = useState("");
  const [proposalEnumOptions, setProposalEnumOptions] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({});
  const [proposalAttributes, setProposalAttributes] = useState<Readonly<Record<string, ProposalAttributeDraft>>>({});
  const [proposalName, setProposalName] = useState("");
  const [proposalBrand, setProposalBrand] = useState("");
  const [proposalVariantTitle, setProposalVariantTitle] = useState("الافتراضي");
  const [proposalMeasurementKind, setProposalMeasurementKind] = useState<MeasurementKind>("DISCRETE");
  const [proposalBaseUnit, setProposalBaseUnit] = useState<BaseUnit>("COUNT");
  const [proposalIdentifierType, setProposalIdentifierType] = useState<SharedIdentifierType | "">("EAN");
  const [proposalIdentifierValue, setProposalIdentifierValue] = useState("");
  const [proposalMutationAttempt, setProposalMutationAttempt] = useState<ProposalMutationAttempt | null>(null);
  const [proposalError, setProposalError] = useState("");
  const [proposalCategoryLoading, setProposalCategoryLoading] = useState(false);
  const [proposalCategoriesLoadingMore, setProposalCategoriesLoadingMore] = useState(false);
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
      const [proposalPage, categoryPage] = await Promise.all([
        fieldClient().listFieldCatalogProductProposals(token, caseId, "", 100),
        fieldClient().listCatalogCategories(result.verticalId, "", 100),
      ]);
      setSnapshot(result);
      setOffersNextCursor(result.nextCursor ?? "");
      setOffersPageError("");
      setProposals(proposalPage.proposals);
      setActiveProposal((currentProposal) => currentProposal ? proposalPage.proposals.find((item) => item.id === currentProposal.id) ?? null : null);
      setProposalCategories(categoryPage.categories.filter((category) => category.active));
      setProposalCategoryCursor(categoryPage.nextCursor ?? "");
      const matchedOffer = priorOffer ? result.offers.find((offer) => offer.offerId === priorOffer.offerId) : undefined;
      if (priorOffer && matchedOffer) setExistingOffer(matchedOffer);
    } catch (cause) {
      console.warn("DSH Field initial catalog readback failed", cause);
      setError(messageFromError(cause));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  async function loadMoreOffers() {
    if (!snapshot || !offersNextCursor || offersLoadingMore || busy || loading) return;
    setOffersLoadingMore(true);
    setOffersPageError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const page = await fieldClient().readFieldJoiningCaseCatalog(token, caseId, 100, "", offersNextCursor);
      setSnapshot((current) => {
        if (!current) return current;
        const existingIDs = new Set(current.offers.map((offer) => offer.offerId));
        return { ...current, offers: [...current.offers, ...page.offers.filter((offer) => !existingIDs.has(offer.offerId))] };
      });
      setOffersNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      console.warn("DSH Field catalog offer page read failed", cause);
      setOffersPageError("تعذر قراءة بقية عروض المتجر. أعد المحاولة.");
    } finally {
      setOffersLoadingMore(false);
    }
  }

  function openExistingOffer(offer: CatalogStoreOffer) {
    setExistingOffer(offer);
    setSelectedProduct(snapshot?.products.find((item) => item.id === offer.productId) ?? null);
    setSelectedVariant(snapshot?.products.flatMap((item) => item.variants).find((item) => item.id === offer.variantId) ?? null);
    setOfferDraft({ priceMinor: String(offer.priceMinor), available: offer.availability, min: String(offer.quantityMinBaseUnits), max: String(offer.quantityMaxBaseUnits), step: String(offer.quantityStepBaseUnits), pricingUnit: String(offer.pricingUnitBaseUnits), inventoryOnHand: String(offer.inventoryOnHandBaseUnits) });
    setAvailabilityOnly(offer.inventoryPolicy === "AVAILABILITY_ONLY");
    setNotice("العرض موجود مسبقًا. راجع السعر والتوافر قبل أي تعديل.");
  }

  useEffect(() => { void load(""); }, [load]);

  useEffect(() => {
    const categoryID = proposalCategoryID.trim();
    setProposalRules([]);
    setProposalEnumOptions({});
    setProposalRulesLoadedForCategory("");
    if (!categoryID) {
      setProposalCategoryLoading(false);
      return;
    }
    let active = true;
    setProposalCategoryLoading(true);
    setProposalError("");
    void (async () => {
      try {
        const rules = await fieldClient().listPublicCatalogCategoryAttributeRules(categoryID);
        const enumRules = rules.filter((rule) => rule.valueKind === "ENUM");
        const optionPairs = await Promise.all(enumRules.map(async (rule) => [rule.attributeId, await fieldClient().listPublicCatalogAttributeEnumOptions(rule.attributeId).then((options) => options.filter((option) => option.active).map((option) => option.optionValue))] as const));
        if (!active) return;
        setProposalRules(rules);
        setProposalEnumOptions(Object.fromEntries(optionPairs));
        setProposalRulesLoadedForCategory(categoryID);
      } catch (cause) {
        console.warn("DSH Field proposal category rules read failed", cause);
        if (active) setProposalError("تعذر قراءة خصائص هذا التصنيف المطلوبة. أعد المحاولة قبل إرسال المقترح.");
      } finally {
        if (active) setProposalCategoryLoading(false);
      }
    })();
    return () => { active = false; };
  }, [proposalCategoryID]);

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
    if (proposalMutationAttempt) {
      setProposalError("أكمل إعادة محاولة المقترح الحالية قبل بدء عملية باركود أخرى.");
      return;
    }
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
        const isSharedIdentifier = identifierType === "GTIN" || identifierType === "EAN" || identifierType === "UPC";
        setActiveProposal(null);
        setProposalCategoryID("");
        setProposalAttributes({});
        setProposalName("");
        setProposalBrand("");
        setProposalVariantTitle("الافتراضي");
        setProposalMeasurementKind("DISCRETE");
        setProposalBaseUnit("COUNT");
        setProposalIdentifierType(isSharedIdentifier ? identifierType : "");
        setProposalIdentifierValue(isSharedIdentifier ? normalized : "");
        setProposalError("");
        setProductName("");
        setWasCreatedLocally(false);
        setNotice(isSharedIdentifier
          ? "لم يُعثر على الباركود الدولي. يمكنك إعداد مقترح لمنتج مشترك لمراجعته، أو إنشاء منتج خاص بهذا المتجر بصورة منفصلة."
          : "لم يُعثر على SKU. هذا المعرّف خاص بهذا المتجر؛ يمكنك تسجيل منتج محلي له، ولا يُرفق SKU بمقترح منتج مشترك.");
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
          openExistingOffer(offer);
        } else {
          setNotice("العرض موجود لهذا المتجر. حمّل صفحات العروض الإضافية لفتحه وتعديله.");
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
    if (busy || !snapshot || (!existingOffer && (!selectedVariant || !selectedProduct))) return;
    const measurementKind = existingOffer?.measurementKind ?? selectedVariant?.measurementKind;
    const variantID = existingOffer?.variantId ?? selectedVariant?.id;
    if (!measurementKind || !variantID) return;
    const priceMinor = Number(offerDraft.priceMinor);
    const min = Number(offerDraft.min);
    const max = Number(offerDraft.max);
    const step = Number(offerDraft.step);
    const pricingUnit = Number(offerDraft.pricingUnit);
    const inventory = Number(offerDraft.inventoryOnHand);
    if (measurementKind === "VARIABLE_MEASURE") { setError("الكمية المتغيرة غير متاحة في كتالوج الإعداد الأولي."); return; }
    if (![priceMinor, min, max, step, pricingUnit, inventory].every(Number.isSafeInteger) || priceMinor < 1 || min < 1 || max < min || step < 1 || pricingUnit < 1 || inventory < 0 || (availabilityOnly && inventory !== 0)) {
      setError("أكمل سعرًا صحيحًا وحدود كمية ومخزونًا صالحًا قبل الحفظ.");
      return;
    }
    const quantityPolicy = measurementKind;
    const pricingBasis: CreateStoreOfferRequest["pricingBasis"] = quantityPolicy === "DISCRETE" ? "PER_UNIT" : "PER_MEASURE";
    const inventoryPolicy: CreateStoreOfferRequest["inventoryPolicy"] = availabilityOnly ? "AVAILABILITY_ONLY" : "QUANTITY_ON_HAND";
    const productFacts: CreateStoreOfferRequest = {
      variantId: variantID, priceMinor, quantityPolicy, quantityMinBaseUnits: min,
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
      setNotice("حُفظ عرض الإعداد الأولي وسُجلت قرارات السعر والتوافر.");
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

  function openProposal(proposal: CatalogProductProposal) {
    setActiveProposal(proposal);
    setProposalCategoryID(proposal.categoryId);
    setProposalName(proposal.proposedName);
    setProposalBrand(proposal.proposedBrand ?? "");
    setProposalVariantTitle(proposal.proposedVariantTitle);
    setProposalMeasurementKind(proposal.proposedMeasurementKind);
    setProposalBaseUnit(proposal.proposedBaseUnit);
    const identifierType = proposal.proposedIdentifierType;
    setProposalIdentifierType(identifierType === "GTIN" || identifierType === "EAN" || identifierType === "UPC" ? identifierType : "");
    setProposalIdentifierValue(proposal.proposedIdentifierValue ?? "");
    const values: Record<string, ProposalAttributeDraft> = {};
    for (const value of [...(proposal.attributeValues ?? []), ...(proposal.variantAttributeValues ?? [])]) values[value.attributeId] = attributeDraftFromProposalValue(value);
    setProposalAttributes(values);
    setProposalError("");
  }

  function clearProposalEditor() {
    setActiveProposal(null);
    setProposalCategoryID("");
    setProposalName("");
    setProposalBrand("");
    setProposalVariantTitle("الافتراضي");
    setProposalMeasurementKind("DISCRETE");
    setProposalBaseUnit("COUNT");
    setProposalIdentifierType("EAN");
    setProposalIdentifierValue("");
    setProposalAttributes({});
    setProposalError("");
  }

  async function loadMoreProposalCategories() {
    if (!snapshot || !proposalCategoryCursor || proposalCategoriesLoadingMore) return;
    setProposalCategoriesLoadingMore(true);
    setProposalError("");
    try {
      const page = await fieldClient().listCatalogCategories(snapshot.verticalId, "", 100, proposalCategoryCursor);
      setProposalCategories((current) => [...current, ...page.categories.filter((category) => category.active && !current.some((item) => item.id === category.id))]);
      setProposalCategoryCursor(page.nextCursor ?? "");
    } catch (cause) {
      console.warn("DSH Field proposal category page read failed", cause);
      setProposalError("تعذر قراءة بقية التصنيفات. أعد المحاولة.");
    } finally {
      setProposalCategoriesLoadingMore(false);
    }
  }

  function makeProposalPayload(): Omit<CreateCatalogProductProposalRequest, "id"> | null {
    if (!snapshot || !proposalCategoryID || !proposalName.trim() || !proposalVariantTitle.trim()) {
      setProposalError("أدخل اسم المنتج والنسخة واختر تصنيفًا.");
      return null;
    }
    if (proposalRulesLoadedForCategory !== proposalCategoryID || proposalCategoryLoading) {
      setProposalError("انتظر حتى تكتمل قراءة خصائص التصنيف المطلوبة.");
      return null;
    }
    const identifierValue = proposalIdentifierValue.trim();
    if ((identifierValue && !proposalIdentifierType) || (!activeProposal && (!identifierValue || !proposalIdentifierType))) {
      setProposalError("مقترح الباركود المجهول يحتاج نوعًا عالميًا GTIN أو EAN أو UPC ورقم المعرّف.");
      return null;
    }
    const typedValues = proposalAttributeValues(proposalRules, proposalAttributes, proposalEnumOptions);
    if (!typedValues) {
      setProposalError("أكمل كل خاصية مطلوبة بقيمة من نوعها الصحيح، بما في ذلك وحدة القياس عند الحاجة.");
      return null;
    }
    return {
      verticalId: snapshot.verticalId,
      categoryId: proposalCategoryID,
      proposedName: proposalName.trim(),
      ...(proposalBrand.trim() ? { proposedBrand: proposalBrand.trim() } : {}),
      proposedVariantTitle: proposalVariantTitle.trim(),
      proposedMeasurementKind: proposalMeasurementKind,
      proposedBaseUnit: proposalBaseUnit,
      ...(identifierValue && proposalIdentifierType ? { proposedIdentifierType: proposalIdentifierType, proposedIdentifierValue: identifierValue } : {}),
      attributeValues: typedValues.attributeValues,
      variantAttributeValues: typedValues.variantAttributeValues,
    };
  }

  function updateProposalReadback(proposal: CatalogProductProposal) {
    setProposals((current) => [proposal, ...current.filter((item) => item.id !== proposal.id)]);
    setActiveProposal(proposal);
  }

  async function saveSharedProductProposal() {
    if (busy || !snapshot) return;
    let attempt = proposalMutationAttempt?.kind === "create" || proposalMutationAttempt?.kind === "update" ? proposalMutationAttempt : null;
    if (!attempt) {
      if (activeProposal && activeProposal.state !== "draft" && activeProposal.state !== "needs_correction") {
        setProposalError("يمكن تعديل المقترح فقط إذا كان مسودة أو معادًا للتصحيح.");
        return;
      }
      const payload = makeProposalPayload();
      if (!payload) return;
      const keys = idempotency(activeProposal ? "proposal_update" : "proposal_create");
      attempt = activeProposal
        ? { kind: "update", proposalID: activeProposal.id, expectedVersion: activeProposal.version, input: payload, ...keys }
        : { kind: "create", input: { id: `catalog_proposal_${Crypto.randomUUID()}`, ...payload }, ...keys };
      setProposalMutationAttempt(attempt);
    }
    setBusy(true);
    setProposalError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = attempt.kind === "create"
        ? await fieldClient().createFieldCatalogProductProposal(token, caseId, attempt.input, attempt.idempotencyKey, attempt.correlationID)
        : await fieldClient().updateFieldCatalogProductProposal(token, caseId, attempt.proposalID, attempt.input, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setProposalMutationAttempt(null);
      updateProposalReadback(response.proposal);
      setProposalError("");
      setNotice(response.proposal.state === "draft" && attempt.kind === "update" ? "حُفظ التصحيح كمسودة. أرسل النسخة المحدّثة للمراجعة عند اكتمالها." : "حُفظ مقترح المنتج المشترك كمسودة. أرسله للمراجعة بعد مراجعة البيانات.");
    } catch (cause) {
      console.warn("DSH Field shared Product proposal save failed", cause);
      if (!isOutcomeUncertain(cause)) setProposalMutationAttempt(null);
      setProposalError(messageFromError(cause) + (isOutcomeUncertain(cause) ? " أعد المحاولة للتحقق من نتيجة الطلب نفسه." : ""));
    } finally {
      setBusy(false);
    }
  }

  async function submitSharedProductProposal() {
    if (busy || !snapshot || !activeProposal) return;
    if (activeProposal.state !== "draft") {
      setProposalError(activeProposal.state === "needs_correction" ? "احفظ التعديلات أولًا؛ ستتحول إلى مسودة قابلة للإرسال." : "هذا المقترح غير جاهز للإرسال من هذه الحالة.");
      return;
    }
    const attempt = proposalMutationAttempt?.kind === "submit" ? proposalMutationAttempt : {
      kind: "submit" as const,
      proposalID: activeProposal.id,
      expectedVersion: activeProposal.version,
      ...idempotency("proposal_submit"),
    };
    setProposalMutationAttempt(attempt);
    setBusy(true);
    setProposalError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().submitFieldCatalogProductProposal(token, caseId, attempt.proposalID, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setProposalMutationAttempt(null);
      updateProposalReadback(response.proposal);
      setNotice("أُرسل مقترح المنتج المشترك للمراجعة. ستظهر نتيجة المراجعة هنا.");
    } catch (cause) {
      console.warn("DSH Field shared Product proposal submit failed", cause);
      if (!isOutcomeUncertain(cause)) setProposalMutationAttempt(null);
      setProposalError(messageFromError(cause) + (isOutcomeUncertain(cause) ? " أعد المحاولة للتحقق من نتيجة الطلب نفسه." : ""));
    } finally {
      setBusy(false);
    }
  }

  const filteredProducts = snapshot?.products ?? [];
  const filteredProposalCategories = proposalCategories.filter((category) => `${category.pathAr} ${category.nameAr}`.toLocaleLowerCase().includes(proposalCategoryQuery.trim().toLocaleLowerCase()));
  const canProposeFromUnknownBarcode = resolution?.outcome === "UNKNOWN_IDENTIFIER" && (identifierType === "GTIN" || identifierType === "EAN" || identifierType === "UPC");
  const showProposalEditor = Boolean(activeProposal) || canProposeFromUnknownBarcode || proposalMutationAttempt?.kind === "create";
  const proposalReadOnly = Boolean(activeProposal && activeProposal.state !== "draft" && activeProposal.state !== "needs_correction");
  const proposalFormLocked = busy || Boolean(proposalMutationAttempt) || proposalReadOnly;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>الكتالوج الأولي</Text>
    <Text style={styles.muted}>يظهر هذا المسار للحالة المعتمدة فقط. يتحقق النظام في كل قراءة وكتابة من الإسناد والارتباط بالمتجر وعدم إتمام إطلاق المتجر.</Text>
    {snapshot ? <View style={styles.card}><Text style={styles.heading}>المتجر المعتمد</Text><Text style={styles.body}>المتجر: {snapshot.storeId}</Text><Text style={styles.body}>المجال: {snapshot.verticalId}</Text></View> : null}
    {snapshot ? <View style={styles.card}>
      <Text style={styles.heading}>عروض المتجر الأولية · {snapshot.offers.length}</Text>
      <Text style={styles.muted}>تعرض هذه القائمة صفحات عروض المتجر كلها؛ اختر أي عرض لمراجعة سعره وتوافره وتعديله.</Text>
      {snapshot.offers.map((offer) => <View key={offer.offerId} style={styles.row}>
        <Text style={[styles.body, { flex: 1 }]}>{offer.productName} · {offer.variantTitle} · {offer.priceMinor} ريال</Text>
        <BthwaniButton disabled={busy || offersLoadingMore} label="تعديل" onPress={() => openExistingOffer(offer)} variant="secondary" />
      </View>)}
      {offersPageError ? <Text accessibilityRole="alert" style={styles.error}>{offersPageError}</Text> : null}
      {offersNextCursor ? <BthwaniButton busy={offersLoadingMore} disabled={busy || loading || offersLoadingMore} label="تحميل المزيد من العروض" onPress={() => void loadMoreOffers()} variant="secondary" /> : null}
    </View> : null}
    {snapshot ? <MobileStoreCatalogImportWorkspace
      client={fieldClient()}
      scope={{ kind: "FIELD", joiningCaseID: caseId }}
      getAccessToken={getUsableIdentityAccessToken}
      createUUID={() => Crypto.randomUUID()}
      onCommitted={() => load(query)}
      pickFile={async () => {
        const selected = await DocumentPicker.getDocumentAsync({
          type: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (selected.canceled || !selected.assets[0]) return null;
        const asset = selected.assets[0];
        if (asset.size !== undefined && asset.size > 20 * 1024 * 1024) throw new Error("STORE_CATALOG_IMPORT_FILE_TOO_LARGE");
        return { uri: asset.uri, name: asset.name, ...(asset.mimeType ? { type: asset.mimeType } : {}) };
      }}
    /> : null}
    {snapshot ? <FieldQuickPrices caseId={caseId} verticalId={snapshot.verticalId} onPricesCommitted={() => load(query)} /> : null}
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
      <View style={styles.row}>{(["GTIN", "EAN", "UPC", "SKU"] as const).map((value) => <BthwaniChip key={value} disabled={busy || Boolean(proposalMutationAttempt)} label={value} onPress={() => { setIdentifierType(value); setResolution(null); }} selected={identifierType === value} />)}</View>
      <TextInput accessibilityLabel="الباركود أو SKU" autoCapitalize="characters" editable={!busy && !proposalMutationAttempt} onChangeText={(value) => { setIdentifier(value); setResolution(null); }} onSubmitEditing={() => void resolveIdentifier()} placeholder="امسح أو أدخل المعرّف" value={identifier} style={styles.input} />
      <View style={styles.row}><BthwaniButton busy={busy} disabled={busy || Boolean(proposalMutationAttempt) || !identifier.trim()} label="حلّ المعرّف" onPress={() => void resolveIdentifier()} /><BthwaniButton disabled={busy || Boolean(proposalMutationAttempt)} label={cameraOpen ? "إغلاق الكاميرا" : "مسح بالكاميرا"} onPress={async () => { if (cameraOpen) { setCameraOpen(false); return; } if (!cameraPermission?.granted) { const permission = await requestCameraPermission(); if (!permission.granted) { setError("يلزم السماح للكاميرا لمسح الباركود."); return; } } setCameraOpen(true); }} variant="secondary" /></View>
      {cameraOpen ? <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128"] }} onBarcodeScanned={({ data }) => { setCameraOpen(false); void onBarcode(data); }} /> : null}
      {resolution ? <Text style={styles.muted}>نتيجة الحل: {resolution.outcome}{resolution.productName ? ` · ${resolution.productName}` : ""}{resolution.variantTitle ? ` · ${resolution.variantTitle}` : ""}</Text> : null}
    </View>
    {snapshot ? <View style={styles.card}>
      <Text style={styles.heading}>مقترحات المنتجات المشتركة لهذه الحالة</Text>
      <Text style={styles.muted}>هذه المقترحات مرتبطة بحالة الانضمام الحالية ويراجعها مشغّل الكتالوج. لا تنشئ منتجًا محليًا أو عرض سعر.</Text>
      {proposals.length === 0 ? <Text style={styles.muted}>لا توجد مقترحات لهذه الحالة حتى الآن.</Text> : proposals.map((proposal) => <View key={proposal.id} style={styles.raised}>
        <Text style={styles.body}>{proposal.proposedName} · {proposalStateLabels[proposal.state]}</Text>
        {proposal.correctionReason ? <Text style={styles.error}>سبب التصحيح: {proposal.correctionReason}</Text> : null}
        <Text style={styles.muted}>{proposal.categoryId} · الإصدار {proposal.version}</Text>
        <BthwaniButton disabled={busy || Boolean(proposalMutationAttempt)} label={proposal.state === "needs_correction" ? "فتح التصحيح" : proposal.state === "draft" ? "فتح المسودة" : "عرض الحالة"} onPress={() => openProposal(proposal)} variant="secondary" />
      </View>)}
    </View> : null}
    {showProposalEditor ? <View style={styles.card}>
      <Text style={styles.heading}>{activeProposal ? activeProposal.state === "needs_correction" ? "تصحيح مقترح المنتج المشترك" : "مقترح المنتج المشترك" : "اقتراح منتج مشترك للباركود المجهول"}</Text>
      <Text style={styles.muted}>يرسل المقترح للمراجعة؛ المنتج المشترك لا يُنشأ ولا يُضاف للمتجر قبل الاعتماد. استخدم معرّفًا عالميًا GTIN أو EAN أو UPC، واترك SKU المحلي في مسار المنتج الخاص بالمتجر.</Text>
      {activeProposal?.correctionReason ? <Text style={styles.error}>مطلوب تصحيح: {activeProposal.correctionReason}</Text> : null}
      <Text style={styles.label}>التصنيف المطلوب</Text>
      <TextInput accessibilityLabel="البحث عن تصنيف للمقترح" editable={!proposalFormLocked} onChangeText={setProposalCategoryQuery} placeholder="ابحث باسم التصنيف" value={proposalCategoryQuery} style={styles.input} />
      <View style={styles.row}>{filteredProposalCategories.slice(0, 20).map((category) => <BthwaniChip key={category.id} disabled={proposalFormLocked} label={category.pathAr || category.nameAr} onPress={() => { setProposalCategoryID(category.id); setProposalAttributes({}); setProposalError(""); }} selected={proposalCategoryID === category.id} />)}</View>
      {proposalCategories.length === 0 ? <Text style={styles.error}>لا يوجد تصنيف نشط لهذا المجال؛ اطلب إعداد التصنيف قبل إرسال المقترح.</Text> : null}
      {filteredProposalCategories.length === 0 && proposalCategories.length > 0 ? <Text style={styles.muted}>لا توجد تصنيفات تطابق البحث الحالي.</Text> : null}
      {proposalCategoryCursor ? <BthwaniButton busy={proposalCategoriesLoadingMore} disabled={proposalCategoriesLoadingMore || proposalFormLocked} label="قراءة تصنيفات إضافية" onPress={() => void loadMoreProposalCategories()} variant="secondary" /> : null}
      <Text style={styles.label}>اسم المنتج المقترح</Text>
      <TextInput accessibilityLabel="اسم المنتج المشترك المقترح" editable={!proposalFormLocked} maxLength={160} onChangeText={setProposalName} placeholder="اسم المنتج" value={proposalName} style={styles.input} />
      <Text style={styles.label}>العلامة التجارية · اختياري</Text>
      <TextInput accessibilityLabel="علامة المنتج المقترح" editable={!proposalFormLocked} maxLength={160} onChangeText={setProposalBrand} placeholder="العلامة التجارية" value={proposalBrand} style={styles.input} />
      <Text style={styles.label}>اسم النسخة</Text>
      <TextInput accessibilityLabel="اسم نسخة المنتج المقترح" editable={!proposalFormLocked} maxLength={160} onChangeText={setProposalVariantTitle} placeholder="النسخة الافتراضية" value={proposalVariantTitle} style={styles.input} />
      <Text style={styles.label}>نوع القياس</Text>
      <View style={styles.row}>{(["DISCRETE", "MEASURED", "VARIABLE_MEASURE"] as const).map((kind) => <BthwaniChip key={kind} disabled={proposalFormLocked} label={measurementKindLabel(kind)} onPress={() => { setProposalMeasurementKind(kind); setProposalBaseUnit(kind === "DISCRETE" ? "COUNT" : "GRAM"); }} selected={proposalMeasurementKind === kind} />)}</View>
      <Text style={styles.label}>الوحدة الأساسية</Text>
      <View style={styles.row}>{(proposalMeasurementKind === "DISCRETE" ? ["COUNT"] as const : ["GRAM", "MILLILITER"] as const).map((unit) => <BthwaniChip key={unit} disabled={proposalFormLocked} label={baseUnitLabel(unit)} onPress={() => setProposalBaseUnit(unit)} selected={proposalBaseUnit === unit} />)}</View>
      <Text style={styles.label}>المعرّف العالمي</Text>
      <View style={styles.row}>{(["GTIN", "EAN", "UPC"] as const).map((kind) => <BthwaniChip key={kind} disabled={proposalFormLocked} label={kind} onPress={() => setProposalIdentifierType(kind)} selected={proposalIdentifierType === kind} />)}<BthwaniChip disabled={proposalFormLocked} label="بدون معرّف" onPress={() => { setProposalIdentifierType(""); setProposalIdentifierValue(""); }} selected={!proposalIdentifierType} /></View>
      <TextInput accessibilityLabel="قيمة المعرّف العالمي للمقترح" autoCapitalize="characters" editable={!proposalFormLocked} maxLength={128} onChangeText={setProposalIdentifierValue} placeholder="GTIN أو EAN أو UPC" value={proposalIdentifierValue} style={styles.input} />
      <Text style={styles.label}>الخصائص المطلوبة للتصنيف</Text>
      {!proposalCategoryID ? <Text style={styles.muted}>اختر تصنيفًا لقراءة خصائصه المطلوبة.</Text> : proposalCategoryLoading ? <Text style={styles.muted}>جارٍ قراءة الخصائص وقيم القوائم…</Text> : proposalRulesLoadedForCategory === proposalCategoryID && proposalRules.filter((rule) => rule.required).length === 0 ? <Text style={styles.muted}>لا توجد خصائص إلزامية لهذا التصنيف.</Text> : null}
      {proposalRules.map((rule) => {
        const value = proposalAttributes[rule.attributeId]?.value ?? "";
        return <View key={rule.attributeId} style={styles.raised}>
          <Text style={styles.body}>{rule.nameAr} · {rule.required ? "مطلوب" : "اختياري"}{rule.variantAxis ? " · خاص بالنسخة" : " · خاص بالمنتج"}</Text>
          {rule.valueKind === "BOOLEAN" ? <View style={styles.row}>
            <BthwaniChip disabled={proposalFormLocked} label="نعم" onPress={() => setProposalAttributes((current) => ({ ...current, [rule.attributeId]: { value: "true", measurementUnit: current[rule.attributeId]?.measurementUnit ?? "" } }))} selected={value === "true"} />
            <BthwaniChip disabled={proposalFormLocked} label="لا" onPress={() => setProposalAttributes((current) => ({ ...current, [rule.attributeId]: { value: "false", measurementUnit: current[rule.attributeId]?.measurementUnit ?? "" } }))} selected={value === "false"} />
          </View> : rule.valueKind === "ENUM" ? <View style={styles.row}>
            {(proposalEnumOptions[rule.attributeId] ?? []).map((option) => <BthwaniChip key={option} disabled={proposalFormLocked} label={option} onPress={() => setProposalAttributes((current) => ({ ...current, [rule.attributeId]: { value: option, measurementUnit: current[rule.attributeId]?.measurementUnit ?? "" } }))} selected={value === option} />)}
            {(proposalEnumOptions[rule.attributeId] ?? []).length === 0 ? <Text style={rule.required ? styles.error : styles.muted}>{rule.required ? "لا توجد قيم مفعّلة لهذه الخاصية؛ أوقف الإرسال واطلب إعداد قائمة القيم." : "لا توجد قيم مفعّلة؛ يمكن ترك الخاصية الاختيارية فارغة."}</Text> : null}
          </View> : <>
            <TextInput accessibilityLabel={rule.nameAr} editable={!proposalFormLocked} keyboardType={rule.valueKind === "INTEGER" ? "number-pad" : rule.valueKind === "DECIMAL" || rule.valueKind === "MEASUREMENT" ? "decimal-pad" : "default"} maxLength={256} onChangeText={(nextValue) => setProposalAttributes((current) => ({ ...current, [rule.attributeId]: { value: nextValue, measurementUnit: current[rule.attributeId]?.measurementUnit ?? "" } }))} placeholder={rule.valueKind === "DATE" ? "YYYY-MM-DD" : `أدخل ${rule.nameAr}`} value={value} style={styles.input} />
            {rule.valueKind === "MEASUREMENT" ? <TextInput accessibilityLabel={`وحدة ${rule.nameAr}`} editable={!proposalFormLocked} maxLength={64} onChangeText={(measurementUnit) => setProposalAttributes((current) => ({ ...current, [rule.attributeId]: { value: current[rule.attributeId]?.value ?? "", measurementUnit } }))} placeholder="وحدة القياس" value={proposalAttributes[rule.attributeId]?.measurementUnit ?? ""} style={styles.input} /> : null}
          </>}
        </View>;
      })}
      {proposalError ? <Text accessibilityRole="alert" style={styles.error}>{proposalError}</Text> : null}
      {proposalReadOnly ? <Text style={styles.muted}>هذا المقترح للعرض فقط في حالته الحالية.</Text> : <>
        <BthwaniButton busy={busy} disabled={busy || proposalReadOnly || proposalMutationAttempt?.kind === "submit" || (proposalMutationAttempt !== null && proposalMutationAttempt.kind !== "create" && proposalMutationAttempt.kind !== "update")} label={proposalMutationAttempt?.kind === "create" || proposalMutationAttempt?.kind === "update" ? "إعادة التحقق من حفظ المقترح" : activeProposal ? "حفظ التصحيح كمسودة" : "حفظ مسودة المنتج المشترك"} onPress={() => void saveSharedProductProposal()} />
        {activeProposal?.state === "draft" ? <BthwaniButton busy={busy} disabled={busy || proposalMutationAttempt !== null && proposalMutationAttempt.kind !== "submit"} label={proposalMutationAttempt?.kind === "submit" ? "إعادة التحقق من الإرسال" : "إرسال المقترح للمراجعة"} onPress={() => void submitSharedProductProposal()} /> : null}
      </>}
      {activeProposal ? <BthwaniButton disabled={busy || Boolean(proposalMutationAttempt)} label="إغلاق المقترح" onPress={clearProposalEditor} variant="secondary" /> : null}
    </View> : null}
    {resolution?.outcome === "UNKNOWN_IDENTIFIER" ? <View style={styles.card}>
      <Text style={styles.heading}>تسجيل منتج محلي</Text>
      <Text style={styles.muted}>ينشئ النظام منتجًا خاصًا بالمتجر ونسخة جديدة داخل المتجر المرتبط بهذه الحالة. المعرّف العالمي يبقى فريدًا عبر النظام.</Text>
      <TextInput accessibilityLabel="اسم المنتج المحلي" editable={!busy} onChangeText={setProductName} placeholder="اسم المنتج" value={productName} style={styles.input} />
      <TextInput accessibilityLabel="وصف المنتج المحلي" editable={!busy} maxLength={4000} multiline onChangeText={setDescription} placeholder="وصف اختياري" value={description} style={styles.input} />
      <TextInput accessibilityLabel="علامة المنتج المحلية" editable={!busy} onChangeText={setBrand} placeholder="العلامة التجارية (اختياري)" value={brand} style={styles.input} />
      <TextInput accessibilityLabel="اسم نسخة المنتج" editable={!busy} onChangeText={setVariantTitle} placeholder="اسم النسخة" value={variantTitle} style={styles.input} />
      <View style={styles.row}>{(["DISCRETE", "MEASURED"] as const).map((value) => <BthwaniChip key={value} disabled={busy} label={measurementKindLabel(value)} onPress={() => { setMeasurementKind(value); setBaseUnit(value === "DISCRETE" ? "COUNT" : "GRAM"); }} selected={measurementKind === value} />)}</View>
      <View style={styles.row}>{(measurementKind === "DISCRETE" ? ["COUNT"] as const : ["GRAM", "MILLILITER"] as const).map((value) => <BthwaniChip key={value} disabled={busy} label={baseUnitLabel(value)} onPress={() => setBaseUnit(value)} selected={baseUnit === value} />)}</View>
      <BthwaniButton busy={busy} disabled={busy || !productName.trim() || !variantTitle.trim()} label="إنشاء منتج المتجر" onPress={() => void createLocalProduct()} />
    </View> : null}
    {existingOffer || (selectedVariant && selectedProduct) ? <View style={styles.card}>
      <Text style={styles.heading}>{existingOffer ? "تعديل عرض ما قبل الإطلاق" : "إضافة العرض الأولي"}</Text>
      <Text style={styles.muted}>{selectedProduct?.canonicalName ?? existingOffer?.productName} · {selectedVariant?.title ?? existingOffer?.variantTitle} · {wasCreatedLocally ? "منتج خاص بالمتجر" : selectedProduct?.scope === "SHARED" ? "منتج مشترك" : "عرض قائم"}</Text>
      <TextInput accessibilityLabel="سعر العرض الأولي" editable={!busy} keyboardType="number-pad" onChangeText={(priceMinor) => setOfferDraft((current) => ({ ...current, priceMinor: priceMinor.replace(/[^0-9]/g, "") }))} placeholder="السعر بالريال اليمني" value={offerDraft.priceMinor} style={[styles.input, styles.number]} />
      <Text style={styles.muted}>التوافر: {offerDraft.available ? "متاح للطلب" : "غير متاح مؤقتًا"}</Text>
      <View style={styles.row}><BthwaniChip disabled={busy} label="متاح" onPress={() => setOfferDraft((current) => ({ ...current, available: true }))} selected={offerDraft.available} /><BthwaniChip disabled={busy} label="غير متاح" onPress={() => setOfferDraft((current) => ({ ...current, available: false }))} selected={!offerDraft.available} /></View>
      {(existingOffer?.measurementKind ?? selectedVariant?.measurementKind) === "VARIABLE_MEASURE" ? <Text style={styles.error}>الكمية المتغيرة غير مدعومة في الإعداد الأولي قبل اكتمال القياس الفعلي.</Text> : <>
        {(existingOffer?.measurementKind ?? selectedVariant?.measurementKind) !== "DISCRETE" ? <TextInput accessibilityLabel="وحدة التسعير الأساسية بالجرام أو الملليلتر" editable={!busy} keyboardType="number-pad" onChangeText={(pricingUnit) => setOfferDraft((current) => ({ ...current, pricingUnit: pricingUnit.replace(/[^0-9]/g, "") }))} placeholder="وحدة التسعير الأساسية" value={offerDraft.pricingUnit} style={[styles.input, styles.number]} /> : null}
        <View style={styles.row}><BthwaniChip disabled={busy} label="التوافر فقط" onPress={() => { setAvailabilityOnly(true); setOfferDraft((current) => ({ ...current, inventoryOnHand: "0" })); }} selected={availabilityOnly} /><BthwaniChip disabled={busy} label="إدارة مخزون فعلي" onPress={() => setAvailabilityOnly(false)} selected={!availabilityOnly} /></View>
        {!availabilityOnly ? <TextInput accessibilityLabel="المخزون الأولي" editable={!busy} keyboardType="number-pad" onChangeText={(inventoryOnHand) => setOfferDraft((current) => ({ ...current, inventoryOnHand: inventoryOnHand.replace(/[^0-9]/g, "") }))} placeholder="المخزون الأولي" value={offerDraft.inventoryOnHand} style={[styles.input, styles.number]} /> : null}
        <BthwaniButton busy={busy} disabled={busy || !offerDraft.priceMinor.trim()} label={existingOffer ? "حفظ التعديل الأولي" : "إضافة العرض إلى المتجر"} onPress={() => void saveInitialOffer()} />
      </>}
    </View> : null}
  </ScrollView>;
}
