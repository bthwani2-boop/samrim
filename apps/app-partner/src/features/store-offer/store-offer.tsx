import { createStyles } from "./store-offer-styles";
import { toAsciiDigits } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { type BaseUnit, baseUnitLabel, type CatalogAttributeRule, type CatalogAttributeValueInput, type CatalogCategoryListResponse, type CatalogIdentifierResolution, type CatalogMedia, type CatalogProduct, type CatalogProductProposal, type CatalogStorefrontSection, type CatalogStoreOffer, type CatalogVariant, type CommerceVertical, catalogProductProposalStateLabel, createDshMobileClient, type DshImageUploadInput, formatMoney, isMediaProvenanceInputValid, type MeasurementKind, type MediaProvenanceInput, measurementKindLabel as sharedMeasurementKindLabel, pricingBasisLabel as sharedPricingBasisLabel, quantityPolicyLabel as sharedQuantityPolicyLabel, storeOfferPublicationStateLabel } from "@bthwani/dsh";
import { MobileStoreCatalogImportWorkspace } from "./mobile-store-catalog-import";
import { MobileStoreQuickPricesWorkspace } from "./mobile-store-quick-prices";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useKeepAwake } from "expo-keep-awake";

function AwakeWhileBarcodeScanning() {
  useKeepAwake();
  return null;
}
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Image as ExpoImage } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { onPartnerProductAction } from "../../shell/partner-product-actions";
import { PartnerStorePromotionBanner } from "./partner-promotion-banner";
import { buildPartnerOfferShareURL, buildPartnerStoreWhatsAppURL } from "../partner-onboarding/partner-storefront-url";
import { StoreCatalogExportCard } from "./store-catalog-export";
import { StoreProductTrash } from "./store-product-trash";
import { isOfferStockout } from "./inventory-stockout";
import { storeOfferServerQuery, type StoreOfferListFilter } from "./catalog-offer-filters";
import { isCurrentCatalogProductRequest, mergeCatalogProductPage, releaseCatalogProductPageRequest, replaceCatalogProductInPage } from "./catalog-product-pages";
import { acquireOfferMutation } from "./offer-mutation-lock";
import { reconcileStoreProductSave } from "./store-product-save";

type OfferState = { kind: "loading" } | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer>; proposals: ReadonlyArray<CatalogProductProposal> } | { kind: "error" };
type RemoteOfferState = { kind: "idle" | "loading" | "error" } | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer>; nextCursor: string };
function isOfferListFilter(value: string | undefined): value is StoreOfferListFilter {
  return value === "all" || value === "popular" || value === "offers" || value === "published"
    || value === "unavailable" || value === "hidden" || value === "stockout";
}
type QuantityPolicy = "DISCRETE" | "MEASURED" | "VARIABLE_MEASURE";
type PricingBasis = "PER_UNIT" | "PER_MEASURE";
type InventoryPolicy = "AVAILABILITY_ONLY" | "QUANTITY_ON_HAND";
type PendingProductMedia = Readonly<{ productID: string; expectedVersion: number; image: DshImageUploadInput; provenance: MediaProvenanceInput; idempotencyKey: string }>;
type AttributeDrafts = Readonly<Record<string, string>>;
type AttributeInputSet = Readonly<{ productValues: ReadonlyArray<CatalogAttributeValueInput>; variantValues: ReadonlyArray<CatalogAttributeValueInput> }>;

function expectedPricingBasisFor(measurementKind: MeasurementKind | undefined): PricingBasis | "" {
  if (measurementKind === "DISCRETE") return "PER_UNIT";
  if (measurementKind === "MEASURED") return "PER_MEASURE";
  return "";
}

function emptyMediaProvenance(): MediaProvenanceInput {
  return { creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false };
}

function MediaProvenanceFields({ value, onChange, disabled, styles }: {
  value: MediaProvenanceInput;
  onChange: (value: MediaProvenanceInput) => void;
  disabled: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return <View style={styles.provenanceFields}>
    <Text style={styles.fieldLabel}>مصدر الصورة وحقوق استخدامها</Text>
    <TextInput accessibilityLabel="اسم المنشئ أو المصوّر" editable={!disabled} maxLength={200} onChangeText={(creator) => onChange({ ...value, creator })} placeholder="اسم المنشئ أو المصوّر" value={value.creator} style={[styles.input, disabled && styles.disabledInput]} />
    <TextInput accessibilityLabel="مصدر الصورة" editable={!disabled} maxLength={1000} multiline onChangeText={(sourceDescription) => onChange({ ...value, sourceDescription })} placeholder="مصدر الصورة ووصفه" value={value.sourceDescription} style={[styles.input, disabled && styles.disabledInput]} />
    <TextInput accessibilityLabel="رابط مصدر الصورة (اختياري)" autoCapitalize="none" editable={!disabled} keyboardType="url" maxLength={2048} onChangeText={(sourceUri) => onChange({ ...value, sourceUri })} placeholder="رابط المصدر (اختياري)" value={value.sourceUri ?? ""} style={[styles.input, disabled && styles.disabledInput]} />
    <TextInput accessibilityLabel="بيان الإذن أو الترخيص" editable={!disabled} maxLength={2000} multiline onChangeText={(rightsStatement) => onChange({ ...value, rightsStatement })} placeholder="بيان الإذن أو الترخيص الذي يسمح بعرض الصورة" value={value.rightsStatement} style={[styles.input, disabled && styles.disabledInput]} />
    <TextInput accessibilityLabel="رابط بيان الحقوق (اختياري)" autoCapitalize="none" editable={!disabled} keyboardType="url" maxLength={2048} onChangeText={(rightsUri) => onChange({ ...value, rightsUri })} placeholder="رابط بيان الحقوق (اختياري)" value={value.rightsUri ?? ""} style={[styles.input, disabled && styles.disabledInput]} />
    <View style={styles.provenanceToggle}><Text style={styles.muted}>أقرّ بوجود إذن يسمح بعرض هذه الصورة</Text><Switch accessibilityLabel="إقرار الإذن بعرض الصورة" disabled={disabled} onValueChange={(rightsAttested) => onChange({ ...value, rightsAttested })} value={value.rightsAttested} /></View>
  </View>;
}

function sortStoreOffersByCreation(offers: ReadonlyArray<CatalogStoreOffer>): CatalogStoreOffer[] {
  return [...offers].sort((left, right) => {
    const leftMillis = Date.parse(left.createdAt);
    const rightMillis = Date.parse(right.createdAt);
    if (Number.isFinite(leftMillis) && Number.isFinite(rightMillis) && leftMillis !== rightMillis) return leftMillis - rightMillis;
    const fraction = (value: string) => value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1]?.padEnd(9, "0").slice(0, 9) ?? "000000000";
    const leftFraction = fraction(left.createdAt);
    const rightFraction = fraction(right.createdAt);
    if (leftFraction !== rightFraction) return leftFraction < rightFraction ? -1 : 1;
    if (left.offerId < right.offerId) return -1;
    if (left.offerId > right.offerId) return 1;
    return 0;
  });
}

function buildAttributeInputs(rules: ReadonlyArray<CatalogAttributeRule>, drafts: AttributeDrafts): AttributeInputSet | null {
  const productValues: CatalogAttributeValueInput[] = [];
  const variantValues: CatalogAttributeValueInput[] = [];
  for (const rule of rules) {
    const raw = drafts[rule.attributeId]?.trim() ?? "";
    if (!raw) { if (rule.required) return null; continue; }
    let value: CatalogAttributeValueInput | null = null;
    switch (rule.valueKind) {
      case "TEXT": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, textValue: raw }; break;
      case "INTEGER": { const parsed = Number(raw); if (!Number.isSafeInteger(parsed)) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, integerValue: parsed }; break; }
      case "DECIMAL": { if (!Number.isFinite(Number(raw))) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: raw }; break; }
      case "MEASUREMENT": { const measurementUnit = drafts[rule.attributeId + ":unit"]?.trim() ?? ""; if (!Number.isFinite(Number(raw)) || !measurementUnit) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: raw, measurementUnit }; break; }
      case "BOOLEAN": if (raw !== "true" && raw !== "false") return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, booleanValue: raw === "true" }; break;
      case "ENUM": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, enumValue: raw }; break;
      case "DATE": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, dateValue: raw }; break;
    }
    if (!value) return null;
    (rule.variantAxis ? variantValues : productValues).push(value);
  }
  return { productValues, variantValues };
}

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

function identifierResolutionNotice(match: CatalogIdentifierResolution): string {
  switch (match.outcome) {
    case "EXISTING_STORE_OFFER":
      return match.productName ? `هذا المنتج له عرض قائم في متجرك: ${match.productName}. عدّله من قائمة العروض أدناه.` : "هذا المنتج له عرض قائم في متجرك. عدّله من قائمة العروض أدناه.";
    case "UNKNOWN_IDENTIFIER":
      return "لم يُعثر على المنتج. أنشئ منتجًا خاصًا بهذا المتجر من قسم منتجات المتجر، أو أرسل مقترحًا للمراجعة.";
    case "VARIABLE_MEASURE_IDENTIFIER":
      return "هذا المنتج يباع بكمية متغيرة، ولا يمكن إنشاء عرض قابل للطلب حتى يكتمل مسار الكمية الفعلية.";
    case "UNAVAILABLE_IN_STORE":
      return "هذا المنتج مرتبط بمتجر آخر، ولا يمكن استخدامه في هذا المتجر.";
    default:
      return "تطابق الرمز مع أكثر من منتج. أوقف استخدامه واطلب مراجعة اسم المنتج.";
  }
}

type ResolvedProductMatch = CatalogIdentifierResolution & { readonly outcome: "SHARED_PRODUCT_MATCH" | "STORE_LOCAL_PRODUCT_MATCH" };

function isResolvedProductMatch(match: CatalogIdentifierResolution): match is ResolvedProductMatch {
  return match.outcome === "SHARED_PRODUCT_MATCH" || match.outcome === "STORE_LOCAL_PRODUCT_MATCH";
}

export function StoreOfferManagement({ storeId, verticalId, serviceCityId, storePublicationState, canManagePromotions = false, toolsView = false }: { storeId: string; verticalId: string; serviceCityId: string; storePublicationState: string; canManagePromotions?: boolean; toolsView?: boolean }) {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<OfferState>({ kind: "loading" });
  const [panel, setPanel] = useState<"prices" | "create" | "tools" | null>(toolsView ? "tools" : null);
  useEffect(() => { setPanel(toolsView ? "tools" : null); }, [toolsView]);
  const [expandedInventoryId, setExpandedInventoryId] = useState<string | null>(null);
  const router = useRouter();
  const { q: rawListQuery } = useLocalSearchParams<{ q?: string | string[] }>();
  const listQuery = Array.isArray(rawListQuery) ? rawListQuery[0] ?? "" : rawListQuery ?? "";
  const { filter: rawRouteFilter } = useLocalSearchParams<{ filter?: string | string[] }>();
  const routeFilter = Array.isArray(rawRouteFilter) ? rawRouteFilter[0] : rawRouteFilter;
  const [listFilter, setListFilter] = useState<StoreOfferListFilter>(isOfferListFilter(routeFilter) ? routeFilter : "all");
  useEffect(() => {
    setListFilter(isOfferListFilter(routeFilter) ? routeFilter : "all");
  }, [routeFilter]);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [popularIDs, setPopularIDs] = useState<ReadonlyArray<string> | null>(null);
  const [popularError, setPopularError] = useState(false);
  useEffect(() => onPartnerProductAction((action) => setPanel((previous) => action === "list" || action === previous ? null : action)), []);
  useEffect(() => {
    if (listFilter !== "popular" || !storeId || !serviceCityId) return;
    let active = true;
    setPopularIDs(null);
    setPopularError(false);
    void dshClient().readPublicStoreCatalog(storeId, serviceCityId, "", "", 100, "", "", "MOST_ORDERED_30_DAYS")
      .then((result) => { if (active) setPopularIDs(result.offers.map((offer) => offer.offerId)); })
      .catch(() => { if (active) { setPopularIDs([]); setPopularError(true); } });
    return () => { active = false; };
  }, [listFilter, storeId, serviceCityId]);
  const [offerNextCursor, setOfferNextCursor] = useState("");
  const [loadingMoreOffers, setLoadingMoreOffers] = useState(false);
  const [remoteOffers, setRemoteOffers] = useState<RemoteOfferState>({ kind: "idle" });
  const remoteOfferSequence = useRef(0);
  const [loadingMoreRemoteOffers, setLoadingMoreRemoteOffers] = useState(false);
  const [remoteOfferRefresh, setRemoteOfferRefresh] = useState(0);
  const serverOfferQuery = useMemo(() => storeOfferServerQuery(listFilter, listQuery), [listFilter, listQuery]);
  const remoteOfferRequest = useMemo(() => ({ filters: serverOfferQuery, revision: remoteOfferRefresh }), [serverOfferQuery, remoteOfferRefresh]);
  const offerLoadedPageCount = useRef(1);
  const offerLoadSequence = useRef(0);
  const offerLoadedStoreID = useRef(storeId);
  const [products, setProducts] = useState<ReadonlyArray<CatalogProduct>>([]);
  const [productNextCursor, setProductNextCursor] = useState("");
  const [proposalNextCursor, setProposalNextCursor] = useState("");
  const [proposalLoadError, setProposalLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [scanNotice, setScanNotice] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const searchSequence = useRef(0);
  const productPageRequest = useRef<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const selectedProductRef = useRef<CatalogProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<CatalogVariant | null>(null);
  const [priceMinor, setPriceMinor] = useState("");
  const [quantityPolicy, setQuantityPolicy] = useState<QuantityPolicy | "">("");
  const [pricingBasis, setPricingBasis] = useState<PricingBasis | "">("");
  const [quantityMinBaseUnits, setQuantityMinBaseUnits] = useState("");
  const [quantityMaxBaseUnits, setQuantityMaxBaseUnits] = useState("");
  const [quantityStepBaseUnits, setQuantityStepBaseUnits] = useState("");
  const [pricingUnitBaseUnits, setPricingUnitBaseUnits] = useState("");
  const [inventoryPolicy, setInventoryPolicy] = useState<InventoryPolicy>("AVAILABILITY_ONLY");
  const [inventoryOnHandBaseUnits, setInventoryOnHandBaseUnits] = useState("0");
  const [inventoryDrafts, setInventoryDrafts] = useState<Record<string, string>>({});
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const catalogReady = verticals.some((vertical) => vertical.id === verticalId && vertical.active);
  const [proposalCategories, setProposalCategories] = useState<CatalogCategoryListResponse["categories"]>([]);
  const [proposalCategoryQuery, setProposalCategoryQuery] = useState("");
  const [proposalCategoryNextCursor, setProposalCategoryNextCursor] = useState("");
  const [proposalCategoriesLoading, setProposalCategoriesLoading] = useState(false);
  const proposalCategorySequence = useRef(0);
  const [proposalAttributeRules, setProposalAttributeRules] = useState<ReadonlyArray<CatalogAttributeRule>>([]);
  const [proposalRuleState, setProposalRuleState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [proposalAttributeDrafts, setProposalAttributeDrafts] = useState<AttributeDrafts>({});
  const [proposalEnumOptions, setProposalEnumOptions] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({});
  const [busy, setBusy] = useState(false);
  const offerMutationLock = useRef(false);
  const [error, setError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [sharingOfferID, setSharingOfferID] = useState("");
  const [productSaveFeedback, setProductSaveFeedback] = useState("");
  const [storeProductName, setStoreProductName] = useState("");
  const [storeProductInitialPrice, setStoreProductInitialPrice] = useState("");
  const [storeProductDescription, setStoreProductDescription] = useState("");
  const [storeProductCategoryID, setStoreProductCategoryID] = useState("");
  const [selectedProductName, setSelectedProductName] = useState("");
  const [selectedProductDescription, setSelectedProductDescription] = useState("");
  const [selectedProductCategoryID, setSelectedProductCategoryID] = useState("");
  const [storeProductImage, setStoreProductImage] = useState<DshImageUploadInput | null>(null);
  const [storeProductImageProvenance, setStoreProductImageProvenance] = useState<MediaProvenanceInput>(emptyMediaProvenance());
  const [storeProductImageIdempotencyKey, setStoreProductImageIdempotencyKey] = useState("");
  const [pendingProductMedia, setPendingProductMedia] = useState<PendingProductMedia | null>(null);
  const productCreateAttempt = useRef<Readonly<{ signature: string; idempotencyKey: string; correlationID: string }> | null>(null);
  const offerCreateAttempt = useRef<Readonly<{ signature: string; idempotencyKey: string; correlationID: string }> | null>(null);
  const [mediaDraft, setMediaDraft] = useState<ReadonlyArray<CatalogMedia>>([]);
  const [mediaUpload, setMediaUpload] = useState<DshImageUploadInput | null>(null);
  const [mediaUploadProvenance, setMediaUploadProvenance] = useState<MediaProvenanceInput>(emptyMediaProvenance());
  const [mediaUploadIdempotencyKey, setMediaUploadIdempotencyKey] = useState("");
  const [mediaUploadAttempted, setMediaUploadAttempted] = useState(false);
  const [mediaUploadRole, setMediaUploadRole] = useState<"primary" | "gallery">("gallery");
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaBusyRef = useRef(false);
  const [storeProductMeasurementKind, setStoreProductMeasurementKind] = useState<MeasurementKind | "">("DISCRETE");
  const [storeProductBaseUnit, setStoreProductBaseUnit] = useState<BaseUnit | "">("COUNT");
  const [proposalName, setProposalName] = useState("");
  const [proposalVerticalID, setProposalVerticalID] = useState(verticalId);
  const [proposalCategoryID, setProposalCategoryID] = useState("");
  const [proposalMeasurementKind, setProposalMeasurementKind] = useState<MeasurementKind | "">("");
  const [proposalBaseUnit, setProposalBaseUnit] = useState<BaseUnit | "">("");
  const [modifierName, setModifierName] = useState("");
  const [modifierOptionName, setModifierOptionName] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [sections, setSections] = useState<ReadonlyArray<CatalogStorefrontSection>>([]);
  const [sectionLoadError, setSectionLoadError] = useState("");
  const [selectedSectionID, setSelectedSectionID] = useState("");
  const [extensionOfferID, setExtensionOfferID] = useState("");

  // Filter the canonical Store-wide result before pagination, not merely the first loaded page.
  // DSH's existing Quick Prices registry enforces the same Store ownership and provides safe cursors.
  useEffect(() => {
    const sequence = ++remoteOfferSequence.current;
    setLoadingMoreRemoteOffers(false);
    if (!remoteOfferRequest.filters || state.kind !== "ready") {
      setRemoteOffers({ kind: "idle" });
      return;
    }
    let active = true;
    setRemoteOffers({ kind: "loading" });
    void (async () => {
      try {
        const token = await getUsableIdentityAccessToken();
        const page = await dshClient().listOwnStoreQuickPrices(token, storeId, { ...remoteOfferRequest.filters, limit: 50 });
        if (active && remoteOfferSequence.current === sequence) {
          setRemoteOffers({ kind: "ready", offers: page.offers, nextCursor: page.nextCursor ?? "" });
        }
      } catch (nextError) {
        if (active && remoteOfferSequence.current === sequence) {
          reportError(nextError);
          setRemoteOffers({ kind: "error" });
        }
      }
    })();
    return () => { active = false; remoteOfferSequence.current += 1; };
  }, [remoteOfferRequest, state.kind, storeId]);

  const load = useCallback(async (): Promise<boolean> => {
    const requestSequence = ++offerLoadSequence.current;
    const requestedPageCount = Math.max(1, offerLoadedPageCount.current);
    setState({ kind: "loading" }); setOfferNextCursor(""); setLoadingMoreOffers(false); setError(""); setSectionLoadError(""); setProposalLoadError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const [firstPage, registry, existingSections] = await Promise.all([
        dshClient().readOwnStoreOffers(token, storeId),
        dshClient().listCatalogVerticals(),
        dshClient().listCatalogStorefrontSections(token, storeId).catch((cause: unknown) => { reportError(cause); return null; }),
      ]);
      const offers = [...firstPage.offers];
      let nextCursor = firstPage.nextCursor ?? "";
      let loadedPageCount = 1;
      for (let pageIndex = 1; pageIndex < requestedPageCount && nextCursor; pageIndex += 1) {
        const page = await dshClient().readOwnStoreOffers(token, storeId, 50, nextCursor);
        if (requestSequence !== offerLoadSequence.current) return false;
        const seen = new Set(offers.map((offer) => offer.offerId));
        offers.push(...page.offers.filter((offer) => !seen.has(offer.offerId)));
        nextCursor = page.nextCursor ?? "";
        loadedPageCount += 1;
      }
      if (requestSequence !== offerLoadSequence.current) return false;
      setVerticals(registry);
      setSections(existingSections?.sections ?? []);
      if (!existingSections) setSectionLoadError("تعذر تحميل أقسام المتجر. العروض متاحة، ويمكن إعادة تحميل الأقسام.");
      const proposals = await dshClient().listOwnCatalogProductProposals(token).catch((cause: unknown) => { reportError(cause); return null; });
      if (requestSequence !== offerLoadSequence.current) return false;
      offerLoadedPageCount.current = loadedPageCount;
      setOfferNextCursor(nextCursor);
      setState({ kind: "ready", offers: sortStoreOffersByCreation(offers), proposals: proposals?.proposals ?? [] });
      setProposalNextCursor(proposals?.nextCursor ?? "");
      if (!proposals) setProposalLoadError("تعذرت قراءة مقترحات المنتجات. يمكنك متابعة إدارة العروض وإعادة تحميل المقترحات.");
      return true;
    } catch (nextError) { if (requestSequence === offerLoadSequence.current) { reportError(nextError); setState({ kind: "error" }); setError(errorText(nextError)); } return false; }
  }, [storeId]);
  useEffect(() => {
    if (offerLoadedStoreID.current !== storeId) {
      offerLoadedStoreID.current = storeId;
      offerLoadedPageCount.current = 1;
      setSelectedSectionID("");
      setSections([]);
    }
    void load();
    return () => { offerLoadSequence.current += 1; };
  }, [load, storeId]);
  useEffect(() => { setProposalVerticalID(verticalId); }, [verticalId]);

  useEffect(() => {
    const sequence = ++proposalCategorySequence.current;
    setProposalCategories([]);
    setProposalCategoryNextCursor("");
    setProposalCategoryID("");
    if (!proposalVerticalID) { setProposalCategoriesLoading(false); return; }
    const timer = setTimeout(() => {
      setProposalCategoriesLoading(true);
      void dshClient().listCatalogCategories(proposalVerticalID, proposalCategoryQuery, 25).then((page) => {
        if (sequence === proposalCategorySequence.current) { setProposalCategories(page.categories); setProposalCategoryNextCursor(page.nextCursor ?? ""); }
      }).catch((nextError) => { if (sequence === proposalCategorySequence.current) { reportError(nextError); setError(errorText(nextError)); } }).finally(() => {
        if (sequence === proposalCategorySequence.current) setProposalCategoriesLoading(false);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [proposalVerticalID, proposalCategoryQuery]);

  async function loadMoreProposalCategories() {
    if (!proposalCategoryNextCursor || proposalCategoriesLoading || !proposalVerticalID) return;
    setProposalCategoriesLoading(true);
    try {
      const page = await dshClient().listCatalogCategories(proposalVerticalID, proposalCategoryQuery, 25, proposalCategoryNextCursor);
      setProposalCategories((current) => [...current, ...page.categories]);
      setProposalCategoryNextCursor(page.nextCursor ?? "");
    } catch (nextError) { reportError(nextError); setError(errorText(nextError)); }
    finally { setProposalCategoriesLoading(false); }
  }

  useEffect(() => {
    let current = true;
    if (!proposalCategoryID) { setProposalAttributeRules([]); setProposalRuleState("idle"); return () => { current = false; }; }
    setProposalAttributeRules([]); setProposalRuleState("loading");
    void dshClient().listPublicCatalogCategoryAttributeRules(proposalCategoryID).then(async (rules) => { const pairs = await Promise.all(rules.filter((rule) => rule.valueKind === "ENUM").map(async (rule) => [rule.attributeId, (await dshClient().listPublicCatalogAttributeEnumOptions(rule.attributeId)).map((option) => option.optionValue)] as const)); if (current) { setProposalAttributeRules(rules); setProposalEnumOptions(Object.fromEntries(pairs)); setProposalRuleState("ready"); } }).catch((nextError) => { if (current) { setProposalRuleState("error"); reportError(nextError); setError(errorText(nextError)); } });
    return () => { current = false; };
  }, [proposalCategoryID]);

  async function searchProducts(cursor = "", append = false) {
    if (!catalogReady || !verticalId || (append && productPageRequest.current !== null)) return;
    const requestSequence = ++searchSequence.current;
    if (append) productPageRequest.current = requestSequence;
    else {
      productPageRequest.current = null;
      setProducts([]);
      setProductNextCursor("");
    }
    setSearchSubmitted(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await dshClient().listCatalogProducts(token, query, verticalId, 100, cursor);
      if (isCurrentCatalogProductRequest(requestSequence, searchSequence.current)) {
        setProducts((current) => mergeCatalogProductPage(current, result.products, append));
        setProductNextCursor(result.nextCursor ?? "");
      }
    } catch (nextError) {
      if (isCurrentCatalogProductRequest(requestSequence, searchSequence.current)) { reportError(nextError); setError(errorText(nextError)); }
    } finally {
      if (append) productPageRequest.current = releaseCatalogProductPageRequest(productPageRequest.current, requestSequence);
    }
  }

  async function resolveIdentifier(value = identifier) {
    const normalized = value.trim();
    if (busy || !normalized) return;
    setBusy(true); setError(""); setScanNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await dshClient().resolveOwnStoreCatalogIdentifier(token, storeId, normalized);
      await applyIdentifierResolution(response.resolution);
    } catch (nextError) { reportError(nextError); setError(errorText(nextError)); }
    finally { setBusy(false); setCameraOpen(false); }
  }

  async function applyIdentifierResolution(match: CatalogIdentifierResolution) {
    if (isResolvedProductMatch(match)) {
      await selectResolvedProduct(match);
      return;
    }
    setScanNotice(identifierResolutionNotice(match));
  }

  async function selectResolvedProduct(match: ResolvedProductMatch) {
    const token = await getUsableIdentityAccessToken();
    const productsPage = await dshClient().listCatalogProducts(token, match.productName ?? "", verticalId, 100);
    const product = productsPage.products.find((item) => item.id === match.productId);
    const variant = product?.variants.find((item) => item.id === match.variantId);
    if (!product || !variant) {
      setScanNotice("عُثر على المنتج. ابحث باسمه في الكتالوج ثم اختر النسخة لإضافة عرضها.");
      return;
    }
    ++searchSequence.current;
    setQuery(match.productName ?? product.canonicalName);
    setProducts(productsPage.products);
    setProductNextCursor(productsPage.nextCursor ?? "");
    setSearchSubmitted(true);
    selectProduct(product, variant);
    const kindLabel = match.outcome === "SHARED_PRODUCT_MATCH" ? "منتج مشترك" : "منتج خاص بمتجرك";
    setScanNotice(`${kindLabel}: ${match.productName ?? product.canonicalName}. أكمل بيانات العرض ثم أضفه.`);
  }

  async function onBarcode(data: string) {
    if (busy || !data.trim()) return;
    setIdentifier(data.trim());
    await resolveIdentifier(data.trim());
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

  async function loadMoreRemoteOffers() {
    if (!serverOfferQuery || remoteOffers.kind !== "ready" || !remoteOffers.nextCursor || loadingMoreRemoteOffers) return;
    const requestSequence = remoteOfferSequence.current;
    const cursor = remoteOffers.nextCursor;
    setLoadingMoreRemoteOffers(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const page = await dshClient().listOwnStoreQuickPrices(token, storeId, { ...serverOfferQuery, limit: 50, cursor });
      if (requestSequence !== remoteOfferSequence.current) return;
      setRemoteOffers((current) => {
        if (current.kind !== "ready") return current;
        const seen = new Set(current.offers.map((offer) => offer.offerId));
        return { kind: "ready", offers: [...current.offers, ...page.offers.filter((offer) => !seen.has(offer.offerId))], nextCursor: page.nextCursor ?? "" };
      });
    } catch (nextError) {
      if (requestSequence === remoteOfferSequence.current) { reportError(nextError); setError(errorText(nextError)); }
    } finally {
      if (requestSequence === remoteOfferSequence.current) setLoadingMoreRemoteOffers(false);
    }
  }

  async function loadMoreOffers() {
    if (!offerNextCursor || loadingMoreOffers || state.kind !== "ready") return;
    const requestSequence = offerLoadSequence.current;
    setLoadingMoreOffers(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const page = await dshClient().readOwnStoreOffers(token, storeId, 50, offerNextCursor);
      if (requestSequence !== offerLoadSequence.current) return;
      setState((current) => {
        if (current.kind !== "ready") return current;
        const seen = new Set(current.offers.map((offer) => offer.offerId));
        return { ...current, offers: sortStoreOffersByCreation([...current.offers, ...page.offers.filter((offer) => !seen.has(offer.offerId))]) };
      });
      setOfferNextCursor(page.nextCursor ?? "");
      offerLoadedPageCount.current += 1;
    } catch (nextError) {
      if (requestSequence === offerLoadSequence.current) { reportError(nextError); setError(errorText(nextError)); }
    } finally {
      if (requestSequence === offerLoadSequence.current) setLoadingMoreOffers(false);
    }
  }

  async function addOffer() {
    const parsedPrice = Number(priceMinor.trim());
    const parsedMin = Number(quantityMinBaseUnits.trim());
    const parsedMax = Number(quantityMaxBaseUnits.trim());
    const parsedStep = Number(quantityStepBaseUnits.trim());
    const parsedPricingUnit = Number(pricingUnitBaseUnits.trim());
    const parsedInventoryOnHand = Number(inventoryOnHandBaseUnits.trim());
    const expectedPricingBasis = expectedPricingBasisFor(selectedVariant?.measurementKind);
    if (!selectedVariant || selectedVariant.measurementKind === "VARIABLE_MEASURE" || !quantityPolicy || pricingBasis !== expectedPricingBasis || !Number.isSafeInteger(parsedPrice) || parsedPrice < 1 || ![parsedMin, parsedMax, parsedStep, parsedPricingUnit, parsedInventoryOnHand].every(Number.isSafeInteger) || parsedMin < 1 || parsedMax < parsedMin || parsedStep < 1 || parsedPricingUnit < 1 || parsedInventoryOnHand < 0 || (inventoryPolicy === "AVAILABILITY_ONLY" && parsedInventoryOnHand !== 0) || busy) return;
    const submittedPricingBasis = pricingBasis as PricingBasis;
    const signature = JSON.stringify([storeId, selectedVariant.id, parsedPrice, quantityPolicy, submittedPricingBasis, parsedMin, parsedMax, parsedStep, parsedPricingUnit, inventoryPolicy, parsedInventoryOnHand]);
    const attempt = offerCreateAttempt.current?.signature === signature
      ? offerCreateAttempt.current
      : { signature, idempotencyKey: Crypto.randomUUID(), correlationID: Crypto.randomUUID() };
    offerCreateAttempt.current = attempt;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const created = await dshClient().createStoreOffer(token, storeId, selectedVariant.id, parsedPrice, quantityPolicy, submittedPricingBasis, parsedMin, parsedMax, parsedStep, parsedPricingUnit, inventoryPolicy, parsedInventoryOnHand, attempt.idempotencyKey, attempt.correlationID);
      offerCreateAttempt.current = null;
      setCurrentSelectedProduct(null); setProductSaveFeedback(""); setSelectedVariant(null); setPriceMinor(""); setQuantityPolicy(""); setPricingBasis(""); setQuantityMinBaseUnits(""); setQuantityMaxBaseUnits(""); setQuantityStepBaseUnits(""); setPricingUnitBaseUnits(""); setInventoryPolicy("AVAILABILITY_ONLY"); setInventoryOnHandBaseUnits("0");
      const createdOffer = { ...created.offer, media: selectedProduct?.media ?? created.offer.media };
      setState((current) => current.kind === "ready" ? { ...current, offers: sortStoreOffersByCreation([...current.offers.filter((offer) => offer.offerId !== createdOffer.offerId), createdOffer]) } : current);
      setRemoteOfferRefresh((value) => value + 1);
    } catch (nextError) {
      reportError(nextError);
      const cause = nextError as { kind?: unknown; status?: unknown } | null;
      const uncertain = cause?.kind === "network" || (cause?.kind === "http" && typeof cause.status === "number" && cause.status >= 500);
      if (!uncertain) offerCreateAttempt.current = null;
      setError(errorText(nextError) + (uncertain ? " أعد المحاولة بنفس البيانات؛ لن ينشئ النظام عرضًا مكررًا." : ""));
    } finally { setBusy(false); }
  }

  async function updateOffer(offer: CatalogStoreOffer, publicationState: "draft" | "published" | "hidden", availability: boolean, nextInventoryPolicy: InventoryPolicy = offer.inventoryPolicy as InventoryPolicy, nextInventoryOnHandBaseUnits = offer.inventoryOnHandBaseUnits) {
    const release = acquireOfferMutation(offerMutationLock);
    if (!release || busy) { release?.(); return; }
    setBusy(true); setError("");
      try {
        const token = await getUsableIdentityAccessToken();
        const result = await dshClient().updateStoreOffer(token, storeId, offer.offerId, offer.priceMinor, publicationState, availability, offer.version, offer.quantityPolicy, offer.pricingBasis, offer.quantityMinBaseUnits, offer.quantityMaxBaseUnits, offer.quantityStepBaseUnits, offer.pricingUnitBaseUnits, nextInventoryPolicy, nextInventoryOnHandBaseUnits);
        setState((current) => current.kind === "ready" ? { ...current, offers: current.offers.map((item) => item.offerId === result.offer.offerId ? { ...result.offer, media: item.media, modifierGroups: item.modifierGroups } : item) } : current);
        setRemoteOfferRefresh((value) => value + 1);
      }
      catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { release(); setBusy(false); }
  }

  async function saveSelectedStoreProduct() {
    if (!selectedProduct || selectedProduct.scope !== "STORE_SCOPED" || selectedProduct.storeId !== storeId || !selectedProductName.trim() || busy) return;
    const requestProductID = selectedProduct.id;
    setBusy(true); setError(""); setProductSaveFeedback("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await dshClient().updateStoreScopedProduct(token, storeId, requestProductID, { canonicalName: selectedProductName.trim(), description: selectedProductDescription.trim(), verticalId, scope: "STORE_SCOPED", active: selectedProduct.active, ...(selectedProductCategoryID === (selectedProduct.categoryIds[0] ?? "") ? {} : { categoryIds: selectedProductCategoryID ? [selectedProductCategoryID] : [] }) }, selectedProduct.version);
      const selected = reconcileStoreProductSave(
        requestProductID,
        result.product,
        selectedProductRef.current?.id ?? null,
        (product) => {
          setProducts((current) => replaceCatalogProductInPage(current, product));
          setState((current) => current.kind === "ready" ? { ...current, offers: current.offers.map((offer) => offer.productId === product.id ? { ...offer, productName: product.canonicalName, productDescription: product.description ?? "", brand: product.brand ?? null, productActive: product.active, productVersion: product.version, media: product.media } : offer) } : current);
        },
        (product) => {
          setCurrentSelectedProduct(product);
          setSelectedProductName(product.canonicalName);
          setSelectedProductDescription(product.description ?? "");
          setSelectedProductCategoryID(product.categoryIds[0] ?? "");
          setMediaDraft(product.media);
        },
      );
      const reloaded = await load();
      if (selected && reloaded) setProductSaveFeedback("تم حفظ بيانات المنتج وتحديث عروض المتجر.");
    } catch (nextError) {
      if (selectedProductRef.current?.id === requestProductID) { reportError(nextError); setError(errorText(nextError)); }
    }
    finally { setBusy(false); }
  }

  async function createStoreProduct() {
    if (busy || pendingProductMedia || !catalogReady || !storeProductName.trim() || !verticalId || !storeProductMeasurementKind || !storeProductBaseUnit) return;
    const requestedPrice = storeProductInitialPrice.trim();
    const initialPrice = requestedPrice ? Number(requestedPrice) : null;
    if (initialPrice !== null && (!Number.isSafeInteger(initialPrice) || initialPrice < 1 || storeProductMeasurementKind !== "DISCRETE")) { setError("أدخل سعرًا صحيحًا لمنتج بالقطعة، أو اترك السعر فارغًا لحفظ المنتج أولًا."); return; }
    if (storeProductImage && (!storeProductImageIdempotencyKey || !isMediaProvenanceInputValid(storeProductImageProvenance))) { setError("أكمل مصدر الصورة وبيان الحقوق وأكّد الإذن قبل إنشاء المنتج بصورته."); return; }
    const request = { canonicalName: storeProductName, description: storeProductDescription, verticalId, scope: "STORE_SCOPED" as const, storeId, variantTitle: "الافتراضي", measurementKind: storeProductMeasurementKind, baseUnit: storeProductBaseUnit, categoryIds: storeProductCategoryID ? [storeProductCategoryID] : [] };
    const signature = JSON.stringify(request);
    const attempt = productCreateAttempt.current?.signature === signature
      ? productCreateAttempt.current
      : { signature, idempotencyKey: Crypto.randomUUID(), correlationID: Crypto.randomUUID() };
    productCreateAttempt.current = attempt;
    setBusy(true); setError(""); setProductSaveFeedback("");
    try {
      const token = await getUsableIdentityAccessToken();
      const image = storeProductImage;
      let created = await dshClient().createStoreScopedProduct(token, storeId, request, attempt.idempotencyKey, attempt.correlationID);
      productCreateAttempt.current = null;
      if (image) {
        try {
          created = await dshClient().uploadStoreProductMedia(token, storeId, created.product.id, image, "primary", storeProductImageProvenance, created.product.version, storeProductImageIdempotencyKey);
          setPendingProductMedia(null);
        } catch (uploadError) {
          reportError(uploadError);
          setPendingProductMedia({ productID: created.product.id, expectedVersion: created.product.version, image, provenance: storeProductImageProvenance, idempotencyKey: storeProductImageIdempotencyKey });
          setError("تم إنشاء المنتج، لكن رفع الصورة تعذر. أعد المحاولة من زر رفع الصورة. يمكن إكمال السعر والعرض دون إعادة إنشاء المنتج.");
          const defaultVariant = created.product.variants[0];
          if (defaultVariant) selectProduct(created.product, defaultVariant);
          if (initialPrice !== null) setPriceMinor(String(initialPrice));
          return;
        }
      }
      setStoreProductName(""); setStoreProductInitialPrice(""); setStoreProductDescription(""); setStoreProductCategoryID(""); setStoreProductImage(null); setStoreProductImageProvenance(emptyMediaProvenance()); setStoreProductImageIdempotencyKey("");
      const defaultVariant = created.product.variants[0];
      if (defaultVariant) selectProduct(created.product, defaultVariant);
      if (initialPrice !== null && defaultVariant?.measurementKind === "DISCRETE") {
        setPriceMinor(String(initialPrice));
        const offerSignature = JSON.stringify([storeId, defaultVariant.id, initialPrice, "DISCRETE", "PER_UNIT", 1, 100, 1, 1, "AVAILABILITY_ONLY", 0]);
        const offerAttempt = offerCreateAttempt.current?.signature === offerSignature
          ? offerCreateAttempt.current
          : { signature: offerSignature, idempotencyKey: Crypto.randomUUID(), correlationID: Crypto.randomUUID() };
        offerCreateAttempt.current = offerAttempt;
        try {
          const result = await dshClient().createStoreOffer(token, storeId, defaultVariant.id, initialPrice, "DISCRETE", "PER_UNIT", 1, 100, 1, 1, "AVAILABILITY_ONLY", 0, offerAttempt.idempotencyKey, offerAttempt.correlationID);
          offerCreateAttempt.current = null;
          const offer = { ...result.offer, media: created.product.media };
          setState((current) => current.kind === "ready" ? { ...current, offers: sortStoreOffersByCreation([...current.offers.filter((item) => item.offerId !== offer.offerId), offer]) } : current);
          setRemoteOfferRefresh((value) => value + 1);
          setCurrentSelectedProduct(null); setSelectedVariant(null); setPriceMinor("");
          setProductSaveFeedback("تم إنشاء المنتج وعرض سعره كمسودة. انشر العرض عندما يصبح جاهزًا للعملاء.");
        } catch (offerError) {
          reportError(offerError);
          const cause = offerError as { kind?: unknown; status?: unknown } | null;
          const uncertain = cause?.kind === "network" || (cause?.kind === "http" && typeof cause.status === "number" && cause.status >= 500);
          if (!uncertain) offerCreateAttempt.current = null;
          setError("تم إنشاء المنتج، لكن تعذر تأكيد عرض السعر. المنتج محفوظ؛ أعد إضافة العرض من الحقول الظاهرة دون إنشاء منتج آخر.");
        }
      } else {
        setProductSaveFeedback("تم إنشاء المنتج. أضف سعره وعرضه عندما يصبح جاهزًا.");
      }
    }
    catch (nextError) {
      reportError(nextError);
      const cause = nextError as { kind?: unknown; status?: unknown } | null;
      const uncertain = cause?.kind === "network" || (cause?.kind === "http" && typeof cause.status === "number" && cause.status >= 500);
      if (!uncertain) productCreateAttempt.current = null;
      setError(errorText(nextError) + (uncertain ? " أعد المحاولة بنفس البيانات؛ سيتحقق النظام من الطلب نفسه دون تكرار المنتج." : ""));
    } finally { setBusy(false); }
  }

  async function retryProductMedia() {
    if (!pendingProductMedia || busy) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await dshClient().uploadStoreProductMedia(token, storeId, pendingProductMedia.productID, pendingProductMedia.image, "primary", pendingProductMedia.provenance, pendingProductMedia.expectedVersion, pendingProductMedia.idempotencyKey);
      setCurrentSelectedProduct(result.product);
      setSelectedProductName(result.product.canonicalName);
      setSelectedProductDescription(result.product.description ?? "");
      setState((current) => current.kind === "ready" ? { ...current, offers: current.offers.map((offer) => offer.productId === result.product.id ? { ...offer, productName: result.product.canonicalName, productDescription: result.product.description ?? "", brand: result.product.brand ?? null, productActive: result.product.active, productVersion: result.product.version, media: result.product.media } : offer) } : current);
      setPendingProductMedia(null); setStoreProductName(""); setStoreProductInitialPrice(""); setStoreProductImage(null); setStoreProductImageProvenance(emptyMediaProvenance()); setStoreProductImageIdempotencyKey("");
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
      setStoreProductImageProvenance(emptyMediaProvenance());
      setStoreProductImageIdempotencyKey(Crypto.randomUUID());
      setError("");
    } catch (nextError) {
      reportError(nextError);
      setError("تعذر تجهيز صورة المنتج للرفع. اختر الصورة مرة أخرى.");
    }
  }

  function setCurrentSelectedProduct(product: CatalogProduct | null): void {
    selectedProductRef.current = product;
    setSelectedProduct(product);
  }

  function selectProduct(product: CatalogProduct, variant: CatalogVariant) {
    setCurrentSelectedProduct(product);
    setProductSaveFeedback("");
    setSelectedProductName(product.canonicalName);
    setSelectedProductDescription(product.description ?? "");
    setSelectedProductCategoryID(product.categoryIds[0] ?? "");
    setSelectedVariant(variant);
    setMediaDraft(product.media);
    setMediaUpload(null);
    setMediaUploadProvenance(emptyMediaProvenance());
    setMediaUploadIdempotencyKey("");
    setMediaUploadAttempted(false);
    setMediaUploadRole("gallery");
    const simple = variant.measurementKind === "DISCRETE";
    setQuantityPolicy(variant.measurementKind === "VARIABLE_MEASURE" ? "" : variant.measurementKind);
    setPricingBasis(expectedPricingBasisFor(variant.measurementKind));
    setQuantityMinBaseUnits(simple ? "1" : "");
    setQuantityMaxBaseUnits(simple ? "100" : "");
    setQuantityStepBaseUnits(simple ? "1" : "");
    setPricingUnitBaseUnits(simple ? "1" : "");
    setInventoryPolicy("AVAILABILITY_ONLY");
    setInventoryOnHandBaseUnits("0");
    setPriceMinor("");
  }

  function replaceProductInSearch(product: CatalogProduct) {
    setCurrentSelectedProduct(product);
    setMediaDraft(product.media);
    setProducts((current) => replaceCatalogProductInPage(current, product));
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
      setMediaUploadProvenance(emptyMediaProvenance());
      setMediaUploadIdempotencyKey(Crypto.randomUUID());
      setMediaUploadAttempted(false);
      setError("");
    } catch (nextError) {
      reportError(nextError);
      setError("تعذر تجهيز صورة المنتج للرفع. اختر الصورة مرة أخرى.");
    }
  }

  async function uploadSelectedProductMedia() {
    if (!mediaUpload || !selectedProduct || selectedProduct.scope !== "STORE_SCOPED" || selectedProduct.storeId !== storeId) return;
    if (!isMediaProvenanceInputValid(mediaUploadProvenance)) { setError("أكمل مصدر الصورة وبيان الحقوق وأكّد الإذن قبل الرفع."); return; }
    if (!beginMediaMutation()) return;
    setMediaUploadAttempted(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await dshClient().uploadStoreProductMedia(token, storeId, selectedProduct.id, mediaUpload, mediaUploadRole, mediaUploadProvenance, selectedProduct.version, mediaUploadIdempotencyKey);
      replaceProductInSearch(result.product);
      setMediaUpload(null);
      setMediaUploadProvenance(emptyMediaProvenance());
      setMediaUploadIdempotencyKey("");
      setMediaUploadAttempted(false);
    } catch (nextError) {
      reportError(nextError);
      if (nextError && typeof nextError === "object" && (nextError as { kind?: unknown; status?: unknown }).kind === "http" && typeof (nextError as { status?: unknown }).status === "number" && ((nextError as { status: number }).status < 500)) {
        setMediaUploadAttempted(false);
        setMediaUploadIdempotencyKey(Crypto.randomUUID());
      }
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
      const result = await dshClient().replaceStoreProductMedia(token, storeId, selectedProduct.id, { media: mediaDraft.map((item, ordinal) => ({ assetId: item.assetId, role: ordinal === 0 ? "primary" : "gallery", ordinal })) }, selectedProduct.version);
      replaceProductInSearch(result.product);
    } catch (nextError) {
      reportError(nextError);
      setError(errorText(nextError));
    } finally { endMediaMutation(); }
  }

  async function createProposal() {
    if (busy || !catalogReady || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim() || !proposalMeasurementKind || !proposalBaseUnit) return;
    if (proposalRuleState !== "ready") { setError("تعذر التحقق من خصائص التصنيف. أعد تحميل القواعد قبل إرسال المقترح."); return; }
    const attributes = buildAttributeInputs(proposalAttributeRules, proposalAttributeDrafts);
    if (!attributes) { setError("أكمل الخصائص المطلوبة وتحقق من أنواع القيم قبل إرسال المقترح."); return; }
    setBusy(true); setError("");
    try { const token = await getUsableIdentityAccessToken(); await dshClient().createCatalogProductProposal(token, { id: Crypto.randomUUID(), verticalId: proposalVerticalID, categoryId: proposalCategoryID, proposedName: proposalName, proposedVariantTitle: "الافتراضي", proposedMeasurementKind: proposalMeasurementKind, proposedBaseUnit: proposalBaseUnit, attributeValues: attributes.productValues, variantAttributeValues: attributes.variantValues }); setProposalName(""); await load(); }
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
    try {
      const token = await getUsableIdentityAccessToken();
      const normalizedSectionName = sectionName.trim().replace(/\s+/g, " ");
      const existing = sections.find((item) => item.nameAr.trim().replace(/\s+/g, " ") === normalizedSectionName);
      const created = existing ? { section: existing } : await dshClient().createCatalogStorefrontSection(token, storeId, { nameAr: sectionName, ordinal: 0, active: true });
      const section = extensionOfferID && !created.section.offerIds.includes(extensionOfferID) ? (await dshClient().attachCatalogOfferToSection(token, storeId, created.section.id, extensionOfferID)).section : created.section;
      setSections((current) => [...current.filter((item) => item.id !== section.id), section]);
      setSelectedSectionID(section.id);
      setSectionName("");
    }
    catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  async function attachToExistingSection() {
    const existing = sections.find((section) => section.id === selectedSectionID);
    if (busy || !existing || !extensionOfferID || existing.offerIds.includes(extensionOfferID)) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await dshClient().attachCatalogOfferToSection(token, storeId, existing.id, extensionOfferID);
      setSections((current) => current.map((section) => section.id === existing.id ? result.section : section));
    } catch (nextError) { reportError(nextError); setError(errorText(nextError)); } finally { setBusy(false); }
  }

  function renderAttributeFields(rules: ReadonlyArray<CatalogAttributeRule>, drafts: AttributeDrafts, enumOptions: Readonly<Record<string, ReadonlyArray<string>>>, update: (key: string, value: string) => void) {
    if (!rules.length) return null;
    const attributeFields = rules.map((rule) => {
      let valueInput: React.ReactNode;
      if (rule.valueKind === "BOOLEAN") {
        valueInput = <View style={styles.choiceRow}><BthwaniChip label="نعم" selected={drafts[rule.attributeId] === "true"} onPress={() => update(rule.attributeId, "true")} /><BthwaniChip label="لا" selected={drafts[rule.attributeId] === "false"} onPress={() => update(rule.attributeId, "false")} /></View>;
      } else if (rule.valueKind === "ENUM") {
        valueInput = <View style={styles.choiceRow}>{(enumOptions[rule.attributeId] ?? []).map((option) => <BthwaniChip key={option} label={option} selected={drafts[rule.attributeId] === option} onPress={() => update(rule.attributeId, option)} />)}</View>;
      } else {
        let keyboardType: React.ComponentProps<typeof TextInput>["keyboardType"] = "default";
        if (rule.valueKind === "INTEGER" || rule.valueKind === "DECIMAL" || rule.valueKind === "MEASUREMENT") {
          keyboardType = "decimal-pad";
        } else if (rule.valueKind === "DATE") {
          keyboardType = "numbers-and-punctuation";
        }
        valueInput = <TextInput accessibilityLabel={rule.nameAr} editable={!busy} keyboardType={keyboardType} onChangeText={(value) => update(rule.attributeId, value)} placeholder={rule.nameAr} value={drafts[rule.attributeId] ?? ""} style={[styles.input, busy && styles.disabledInput]} />;
      }

      return <View key={rule.attributeId} style={styles.form}>
        <Text style={styles.muted}>{rule.nameAr}{rule.required ? " · مطلوب" : " · اختياري"}{rule.variantAxis ? " · خاص بالنسخة" : ""}</Text>
        {valueInput}
        {rule.valueKind === "MEASUREMENT" ? <TextInput accessibilityLabel={`وحدة ${rule.nameAr}`} editable={!busy} onChangeText={(value) => update(rule.attributeId + ":unit", value)} placeholder="وحدة القياس" value={drafts[rule.attributeId + ":unit"] ?? ""} style={[styles.input, busy && styles.disabledInput]} /> : null}
      </View>;
    });

    return <View style={styles.form}><Text style={styles.fieldLabel}>خصائص التصنيف</Text>{attributeFields}</View>;
  }

  const matchingOffers = state.kind === "ready" ? state.offers.filter((offer) => {
    if (!offer.productName.toLocaleLowerCase().includes(listQuery.trim().toLocaleLowerCase())) return false;
    if (listFilter === "offers") return false;
    if (listFilter === "popular") return popularIDs?.includes(offer.offerId) ?? false;
    if (listFilter === "published") return offer.publicationState === "published" && offer.availability;
    if (listFilter === "unavailable") return !offer.availability;
    if (listFilter === "stockout") return isOfferStockout(offer);
    if (listFilter === "hidden") return offer.publicationState !== "published";
    return true;
  }).sort((a, b) => listFilter === "popular" ? (popularIDs?.indexOf(a.offerId) ?? 999) - (popularIDs?.indexOf(b.offerId) ?? 999) : 0) : [];
  const offersOnScreen = serverOfferQuery ? (remoteOffers.kind === "ready" ? remoteOffers.offers : []) : matchingOffers;
  const hasMoreOffers = serverOfferQuery ? (remoteOffers.kind === "ready" && Boolean(remoteOffers.nextCursor)) : Boolean(offerNextCursor);
  const loadingNextOffers = serverOfferQuery ? loadingMoreRemoteOffers : loadingMoreOffers;
  const parsedPrice = Number(priceMinor.trim());
  const parsedMin = Number(quantityMinBaseUnits.trim());
  const parsedMax = Number(quantityMaxBaseUnits.trim());
  const parsedStep = Number(quantityStepBaseUnits.trim());
  const parsedPricingUnit = Number(pricingUnitBaseUnits.trim());
  const parsedInventoryOnHand = Number(inventoryOnHandBaseUnits.trim());
  const expectedPricingBasis = expectedPricingBasisFor(selectedVariant?.measurementKind);
  const canAdd = selectedVariant !== null && selectedVariant.measurementKind !== "VARIABLE_MEASURE" && Boolean(quantityPolicy && pricingBasis) && pricingBasis === expectedPricingBasis && Number.isSafeInteger(parsedPrice) && parsedPrice > 0 && [parsedMin, parsedMax, parsedStep, parsedPricingUnit, parsedInventoryOnHand].every(Number.isSafeInteger) && parsedMin >= 1 && parsedMax >= parsedMin && parsedStep >= 1 && parsedPricingUnit >= 1 && parsedInventoryOnHand >= 0 && (inventoryPolicy === "QUANTITY_ON_HAND" || parsedInventoryOnHand === 0);
  function publicOfferLink(offer: CatalogStoreOffer) {
    return buildPartnerOfferShareURL(
      { id: storeId, serviceCityId, publicationState: storePublicationState },
      offer, process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN, __DEV__,
    );
  }

  async function copyOfferLink(offer: CatalogStoreOffer) {
    const link = publicOfferLink(offer);
    if (!link || sharingOfferID) return;
    setShareNotice(""); setSharingOfferID(offer.offerId);
    try {
      await Clipboard.setStringAsync(link.url);
      setShareNotice(link.previewOnly ? "تم نسخ معاينة المنتج المحلية؛ لا تُشاركها بوصفها رابطًا عامًا." : "تم نسخ رابط المنتج العام.");
    } catch {
      setShareNotice("تعذر نسخ رابط المنتج. تحقق من الصلاحيات ثم أعد المحاولة.");
    } finally {
      setSharingOfferID("");
    }
  }

  async function shareOfferWhatsApp(offer: CatalogStoreOffer) {
    const link = publicOfferLink(offer);
    const whatsapp = buildPartnerStoreWhatsAppURL(link, offer.productName);
    if (!whatsapp || sharingOfferID) return;
    setShareNotice(""); setSharingOfferID(offer.offerId);
    try {
      await Linking.openURL(whatsapp);
    } catch {
      setShareNotice("تعذر فتح واتساب. يمكنك نسخ رابط المنتج ومشاركته يدويًا.");
    } finally {
      setSharingOfferID("");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="إدارة عروض المتجر">
      {!catalogReady ? <Text accessibilityRole="alert" style={styles.warning}>قائمة المتجر غير جاهزة للإدارة بعد. تعذرت إضافة المنتجات أو نشر العروض حاليًا؛ تواصل مع الدعم لاستكمال التجهيز.</Text> : null}
      {!toolsView && panel === null && state.kind === "ready" ? <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} accessibilityLabel="تصنيف المنتجات">
          {([{ key: "all", label: "الكل" }, { key: "popular", label: "الأكثر رواجًا" }, { key: "offers", label: "العروض" }] as const).map((item) =>
            <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: listFilter === item.key }} onPress={() => setListFilter(item.key)} style={[styles.filterChip, listFilter === item.key && styles.filterChipActive]}>
              <Text style={[styles.filterText, listFilter === item.key && styles.filterTextActive]}>{item.label}</Text>
            </Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel="أدوات الكتالوج" onPress={() => setPanel("tools")} style={styles.filterChip}>
            <BthwaniIcon name="cart" color={theme.color} size={14} /><Text style={styles.filterText}>الأدوات</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="تصفية حسب حالة المنتج" accessibilityState={{ expanded: filterModalOpen }} onPress={() => setFilterModalOpen(true)} style={[styles.filterChip, ["published","unavailable","stockout","hidden"].includes(listFilter) && styles.filterChipActive]}>
            <BthwaniIcon name="categories" color={theme.color} size={14} />
            <Text style={[styles.filterText, ["published","unavailable","hidden","stockout"].includes(listFilter) && styles.filterTextActive]}>تصفية</Text>
          </Pressable>
        </ScrollView>
        {(listFilter === "all" || listFilter === "offers") ? <PartnerStorePromotionBanner key={storeId} storeId={storeId} serviceCityId={serviceCityId} canManage={canManagePromotions} offersOnly={listFilter === "offers"} /> : null}
        {listFilter === "popular" ? <Pressable accessibilityRole="button" accessibilityLabel="عرض تحليل أداء المنتجات" onPress={() => router.push("/insights?returnTo=products" as Href)} style={{ alignSelf: "flex-start", paddingVertical: 7 }}><Text style={styles.filterText}>عرض تحليل المنتجات ←</Text></Pressable> : null}
        {listFilter === "popular" && popularIDs === null ? <ActivityIndicator color={theme.brandAction} /> : null}
        {listFilter === "popular" && popularError ? <Text style={styles.muted}>تعذر قراءة ترتيب الطلبات لآخر 30 يومًا.</Text> : null}
      </> : null}
      {catalogReady && panel === "prices" ? <MobileStoreQuickPricesWorkspace
        client={dshClient()}
        scope={{ kind: "PARTNER", storeID: storeId }}
        verticalId={verticalId}
        getAccessToken={getUsableIdentityAccessToken}
        createUUID={() => Crypto.randomUUID()}
        onPricesCommitted={() => void load()}
      /> : null}
      {catalogReady && panel === "tools" ? <StoreCatalogExportCard storeId={storeId} /> : null}
      {catalogReady && panel === "tools" ? <MobileStoreCatalogImportWorkspace
        client={dshClient()}
        scope={{ kind: "PARTNER", storeID: storeId }}
        getAccessToken={getUsableIdentityAccessToken}
        createUUID={() => Crypto.randomUUID()}
        onCommitted={() => { void load(); }}
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
       {catalogReady && panel === "create" ? <View style={styles.searchRow}><TextInput accessibilityLabel="الباركود على العبوة أو رمز الصنف في هذا المتجر" autoCapitalize="characters" editable={!busy} onChangeText={(value) => { setIdentifier(value); setScanNotice(""); }} onSubmitEditing={() => void resolveIdentifier()} placeholder="امسح الباركود أو اكتب الرمز" returnKeyType="search" value={identifier} style={[styles.input, busy && styles.disabledInput]} /><BthwaniButton busy={busy} disabled={busy || !identifier.trim()} label="بحث عن المنتج" onPress={() => void resolveIdentifier()} variant="secondary" /><BthwaniButton disabled={busy} label={cameraOpen ? "إغلاق الكاميرا" : "مسح بالكاميرا"} onPress={async () => { if (cameraOpen) { setCameraOpen(false); return; } if (!cameraPermission?.granted) { const permission = await requestCameraPermission(); if (!permission.granted) { setError("يلزم السماح للكاميرا لمسح الباركود."); return; } } setCameraOpen(true); }} variant="secondary" /></View> : null}
      {cameraOpen && panel === "create" ? <><AwakeWhileBarcodeScanning /><CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128"] }} onBarcodeScanned={({ data }) => { setCameraOpen(false); void onBarcode(data); }} /></> : null}
      {scanNotice && panel === "create" ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{scanNotice}</Text> : null}
      {productSaveFeedback && panel === "create" && !selectedProduct ? <Text accessibilityRole="status" style={[styles.muted, { color: theme.success }]}>{productSaveFeedback}</Text> : null}
       {catalogReady && panel === "create" ? <View style={styles.searchRow}><TextInput accessibilityLabel="البحث في الكتالوج" editable={!busy} onChangeText={setQuery} onSubmitEditing={() => void searchProducts()} placeholder="ابحث باسم المنتج" returnKeyType="search" value={query} style={[styles.input, busy && styles.disabledInput]} />{query ? <BthwaniButton accessibilityLabel="مسح البحث" disabled={busy} label="مسح" onPress={() => { ++searchSequence.current; setQuery(""); setProducts([]); setProductNextCursor(""); setSearchSubmitted(false); setError(""); }} style={styles.clearSearch} variant="quiet" /> : null}<BthwaniButton busy={busy} disabled={busy} label="بحث" onPress={() => void searchProducts()} variant="secondary" /></View> : null}
      {panel === "create" && searchSubmitted && !products.length && !error ? <Text style={styles.muted}>لا توجد نتائج مطابقة. جرّب اسمًا آخر أو امسح البحث.</Text> : null}
       {catalogReady && panel === "create" && products.length ? <><View style={styles.productList}>{products.map((product) => { const primaryMedia = getPrimaryMedia(product.media); return <View key={product.id} style={styles.product}><View style={styles.productHeader}>{primaryMedia ? <ExpoImage cachePolicy="memory" accessibilityLabel={`صورة ${product.canonicalName}`} source={{ uri: primaryMedia.uri }} contentFit="cover" style={styles.productImage} /> : <View accessibilityLabel={`لا توجد صورة لـ ${product.canonicalName}`} style={styles.productImagePlaceholder}><Text style={styles.imagePlaceholderText}>لا توجد صورة</Text></View>}<View style={styles.productCopy}><Text style={styles.itemTitle}>{product.canonicalName}</Text><Text style={styles.muted}>{product.variants.length} نسخة متاحة للاختيار</Text></View></View>{product.variants.map((variant) => <BthwaniChip key={variant.id} label={`${variant.title} · ${measurementKindLabel(variant.measurementKind, variant.baseUnit)}`} disabled={busy} onPress={() => selectProduct(product, variant)} selected={selectedVariant?.id === variant.id} />)}</View>; })}</View>{productNextCursor ? <BthwaniButton busy={busy} disabled={busy} label="تحميل المزيد من المنتجات" onPress={() => void searchProducts(productNextCursor, true)} variant="secondary" /> : null}</> : null}
      {panel === "create" && selectedVariant && selectedProduct ? <View style={styles.form}><Text style={styles.selected}>المحدد: {selectedProduct.canonicalName} · {selectedVariant.title}</Text><Text style={styles.muted}>هوية القياس: {measurementKindLabel(selectedVariant.measurementKind, selectedVariant.baseUnit)}</Text>{selectedVariant.measurementKind === "VARIABLE_MEASURE" ? <Text style={styles.warning}>القياس المتغير غير متاح للطلب حتى يكتمل مسار الكمية الفعلية.</Text> : <><Text style={styles.fieldLabel}>سياسة الكمية</Text><View style={styles.choiceRow}>{([selectedVariant.measurementKind] as QuantityPolicy[]).map((value) => <BthwaniChip key={value} label={quantityPolicyLabel(value)} onPress={() => setQuantityPolicy(value)} selected={quantityPolicy === value} />)}</View><Text style={styles.fieldLabel}>أساس التسعير</Text><View style={styles.choiceRow}>{([expectedPricingBasis] as PricingBasis[]).map((value) => <BthwaniChip key={value} label={pricingBasisLabel(value)} onPress={() => setPricingBasis(value)} selected={pricingBasis === value} />)}</View><Text style={styles.fieldLabel}>سياسة المخزون</Text><View style={styles.choiceRow}><BthwaniChip label="التوافر فقط" onPress={() => { setInventoryPolicy("AVAILABILITY_ONLY"); setInventoryOnHandBaseUnits("0"); }} selected={inventoryPolicy === "AVAILABILITY_ONLY"} /><BthwaniChip label="كمية فعلية" onPress={() => setInventoryPolicy("QUANTITY_ON_HAND")} selected={inventoryPolicy === "QUANTITY_ON_HAND"} /></View><TextInput accessibilityLabel="الكمية المتاحة عند الإنشاء" editable={!busy && inventoryPolicy === "QUANTITY_ON_HAND"} keyboardType="number-pad" onChangeText={(value) => setInventoryOnHandBaseUnits(toAsciiDigits(value))} placeholder="الكمية المتاحة عند الإنشاء" value={inventoryOnHandBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="الحد الأدنى للكمية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantityMinBaseUnits(toAsciiDigits(value))} placeholder="الحد الأدنى للكمية" value={quantityMinBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="الحد الأعلى للكمية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantityMaxBaseUnits(toAsciiDigits(value))} placeholder="الحد الأعلى للكمية" value={quantityMaxBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="خطوة الكمية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantityStepBaseUnits(toAsciiDigits(value))} placeholder="خطوة الكمية" value={quantityStepBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="وحدة التسعير الأساسية" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setPricingUnitBaseUnits(toAsciiDigits(value))} placeholder="وحدة التسعير الأساسية" value={pricingUnitBaseUnits} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="السعر بالريال اليمني" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setPriceMinor(toAsciiDigits(value))} placeholder="السعر بالريال اليمني" value={priceMinor} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><BthwaniButton busy={busy} disabled={!canAdd} label="إضافة عرض للمتجر" onPress={() => void addOffer()} /></>}</View> : null}
      {catalogReady && panel === "create" ? <StoreProductTrash key={storeId} storeId={storeId} selectedProduct={selectedProduct} onTrashed={(productId) => { setProducts((current) => current.filter((product) => product.id !== productId)); setCurrentSelectedProduct(null); setSelectedVariant(null); void load(); }} onRestored={() => { setProducts([]); setSearchSubmitted(false); void load(); }} /> : null}
      {panel === "create" && selectedProduct?.scope === "STORE_SCOPED" && selectedProduct.storeId === storeId ? <View style={styles.mediaManager} accessibilityLabel={`إدارة صور ${selectedProduct.canonicalName}`}><Text style={styles.itemTitle}>صور المنتج: {selectedProduct.canonicalName}</Text><Text style={styles.muted}>عدّل بيانات منتج المتجر وصوره، ثم احفظ التغييرات.</Text><TextInput accessibilityLabel="اسم المنتج" editable={!busy} onChangeText={(value) => { setSelectedProductName(value); setProductSaveFeedback(""); }} value={selectedProductName} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="وصف المنتج" editable={!busy} maxLength={4000} multiline onChangeText={(value) => { setSelectedProductDescription(value); setProductSaveFeedback(""); }} value={selectedProductDescription} style={[styles.input, busy && styles.disabledInput]} /><Text style={styles.fieldLabel}>فئة المنتج</Text><View style={styles.choiceRow}><BthwaniChip label="دون فئة" selected={!selectedProductCategoryID} disabled={busy || selectedProduct.categoryIds.length > 1} onPress={() => { setSelectedProductCategoryID(""); setProductSaveFeedback(""); }} />{proposalCategories.map((category) => <BthwaniChip key={category.id} label={category.pathAr} disabled={busy || selectedProduct.categoryIds.length > 1} selected={selectedProductCategoryID === category.id} onPress={() => { setSelectedProductCategoryID(category.id); setProductSaveFeedback(""); }} />)}</View><TextInput accessibilityLabel="بحث عن فئة المنتج" editable={!busy} placeholder="ابحث عن فئة" value={proposalCategoryQuery} onChangeText={setProposalCategoryQuery} style={styles.input} />{proposalCategoryNextCursor ? <BthwaniButton busy={proposalCategoriesLoading} disabled={busy || proposalCategoriesLoading} label="المزيد من الفئات" onPress={() => void loadMoreProposalCategories()} variant="secondary" /> : null}<BthwaniButton busy={busy} disabled={busy || !selectedProductName.trim()} label="حفظ بيانات المنتج" onPress={() => void saveSelectedStoreProduct()} variant="secondary" />{productSaveFeedback ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={[styles.muted, { color: theme.success }]}>{productSaveFeedback}</Text> : null}{mediaDraft.length ? mediaDraft.map((item, index) => <View key={item.assetId} style={styles.mediaRow}><Image accessibilityLabel={`${item.role === "primary" ? "الصورة الأساسية" : "صورة المعرض"} ${index + 1}`} source={{ uri: item.uri }} resizeMode="cover" style={styles.mediaImage} /><View style={styles.mediaCopy}><Text style={styles.muted}>{item.role === "primary" ? "الصورة الأساسية" : `صورة المعرض ${index + 1}`}</Text></View><BthwaniButton disabled={mediaBusy || index === 0} label="أعلى" onPress={() => moveMedia(index, -1)} variant="quiet" /><BthwaniButton disabled={mediaBusy || index === mediaDraft.length - 1 || index === 0} label="أسفل" onPress={() => moveMedia(index, 1)} variant="quiet" /><BthwaniButton disabled={mediaBusy} label="حذف" onPress={() => removeMedia(index)} variant="danger" /></View>) : <Text style={styles.muted}>لا توجد صور لهذا المنتج.</Text>}<View style={styles.choiceRow}><BthwaniChip disabled={mediaUploadAttempted} label="صورة أساسية" selected={mediaUploadRole === "primary"} onPress={() => setMediaUploadRole("primary")} /><BthwaniChip disabled={mediaUploadAttempted} label="صورة معرض" selected={mediaUploadRole === "gallery"} onPress={() => setMediaUploadRole("gallery")} /></View><BthwaniButton busy={mediaBusy} disabled={mediaBusy || mediaUploadAttempted} label="اختيار صورة" onPress={() => void pickSelectedProductMedia()} variant="secondary" />{mediaUpload ? <View style={styles.mediaUploadPreview}><Image accessibilityLabel="معاينة الصورة الجديدة" source={{ uri: mediaUpload.uri }} resizeMode="cover" style={styles.mediaImage} /><BthwaniButton busy={mediaBusy} disabled={mediaBusy || !mediaUploadIdempotencyKey || !isMediaProvenanceInputValid(mediaUploadProvenance)} label={mediaUploadAttempted ? "إعادة محاولة الرفع" : "رفع الصورة"} onPress={() => void uploadSelectedProductMedia()} /></View> : null}{mediaUpload ? <MediaProvenanceFields value={mediaUploadProvenance} onChange={setMediaUploadProvenance} disabled={mediaBusy || mediaUploadAttempted} styles={styles} /> : null}<BthwaniButton busy={mediaBusy} disabled={mediaBusy} label="حفظ معرض الصور" onPress={() => void saveSelectedProductMedia()} variant="secondary" /></View> : null}
      {catalogReady && panel === "create" ? <View style={styles.managementBlock}><Text style={styles.itemTitle}>منتج جديد</Text><Text style={styles.muted}>الاسم والوصف والصورة والنسخة تخص هذا المتجر. أقسام القائمة تنظّم منتجاته للعميل.</Text><TextInput accessibilityLabel="اسم منتج المتجر" editable={!busy} onChangeText={setStoreProductName} placeholder="اسم المنتج" value={storeProductName} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="سعر المنتج الجديد بالريال اليمني" editable={!busy} keyboardType="number-pad" onChangeText={(value) => setStoreProductInitialPrice(toAsciiDigits(value))} placeholder="السعر (اختياري عند إنشاء مسودة)" value={storeProductInitialPrice} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} /><TextInput accessibilityLabel="وصف منتج المتجر" editable={!busy} maxLength={4000} multiline onChangeText={setStoreProductDescription} placeholder="وصف المنتج (اختياري)" value={storeProductDescription} style={[styles.input, busy && styles.disabledInput]} /><Text style={styles.fieldLabel}>فئة المنتج (اختياري)</Text><View style={styles.choiceRow}><BthwaniChip label="دون فئة" selected={!storeProductCategoryID} onPress={() => setStoreProductCategoryID("")} />{proposalCategories.map((category) => <BthwaniChip key={category.id} label={category.pathAr} selected={storeProductCategoryID === category.id} onPress={() => setStoreProductCategoryID(category.id)} />)}</View><TextInput accessibilityLabel="بحث عن فئة منتج المتجر" placeholder="ابحث عن فئة" value={proposalCategoryQuery} onChangeText={setProposalCategoryQuery} style={styles.input} />{proposalCategoryNextCursor ? <BthwaniButton busy={proposalCategoriesLoading} disabled={busy || proposalCategoriesLoading} label="المزيد من الفئات" onPress={() => void loadMoreProposalCategories()} variant="secondary" /> : null}<BthwaniButton busy={busy} disabled={busy || Boolean(pendingProductMedia)} label={storeProductImage ? "تغيير صورة المنتج" : "اختيار صورة من الجهاز"} onPress={() => void pickStoreProductImage()} variant="secondary" />{storeProductImage ? <Image accessibilityLabel={`معاينة صورة ${storeProductName || "المنتج"}`} source={{ uri: storeProductImage.uri }} resizeMode="cover" style={styles.productImage} /> : <Text style={styles.muted}>اختر صورة لرفعها مع المنتج أو اتركه دون صورة.</Text>}{storeProductImage ? <MediaProvenanceFields value={storeProductImageProvenance} onChange={setStoreProductImageProvenance} disabled={busy || Boolean(pendingProductMedia)} styles={styles} /> : null}{pendingProductMedia ? <BthwaniButton busy={busy} disabled={busy} label="إعادة رفع صورة المنتج" onPress={() => void retryProductMedia()} /> : null}<Text style={styles.fieldLabel}>هوية القياس</Text><View style={styles.choiceList}>{(["DISCRETE", "MEASURED", "VARIABLE_MEASURE"] as MeasurementKind[]).map((value) => <BthwaniChip key={value} label={measurementKindLabel(value)} onPress={() => { setStoreProductMeasurementKind(value); setStoreProductBaseUnit(value === "DISCRETE" ? "COUNT" : ""); }} selected={storeProductMeasurementKind === value} />)}</View><Text style={styles.fieldLabel}>الوحدة الأساسية</Text><View style={styles.choiceRow}>{baseUnitOptions(storeProductMeasurementKind).map((value) => <BthwaniChip key={value} label={baseUnitLabel(value)} onPress={() => setStoreProductBaseUnit(value)} selected={storeProductBaseUnit === value} />)}</View><BthwaniButton busy={busy} disabled={busy || Boolean(pendingProductMedia) || !storeProductName.trim() || !verticalId || !storeProductMeasurementKind || !storeProductBaseUnit || (Boolean(storeProductImage) && !isMediaProvenanceInputValid(storeProductImageProvenance))} label="إنشاء منتج المتجر" onPress={() => void createStoreProduct()} variant="secondary" /></View> : null}
       {catalogReady && panel === "tools" ? <><View style={styles.managementBlock}><Text style={styles.itemTitle}>اقتراح منتج</Text><Text style={styles.muted}>أرسل اسم المنتج وتصنيفه للمراجعة؛ لا يظهر قبل اعتماد المراجعة.</Text><TextInput accessibilityLabel="اسم المقترح" editable={!busy} onChangeText={setProposalName} placeholder="اسم المنتج المقترح" value={proposalName} style={[styles.input, busy && styles.disabledInput]} /><Text style={styles.muted}>{verticals.find((vertical) => vertical.id === verticalId)?.nameAr ?? ""}</Text><Text style={styles.fieldLabel}>التصنيف</Text><Text style={styles.muted}>يعرض كل خيار مساره من المجال التجاري إلى فئة المنتج المحددة، لتوضيح التفرّع قبل إرسال المقترح.</Text><View style={styles.choiceList}>{proposalCategories.map((category) => <BthwaniChip key={category.id} label={category.pathAr} onPress={() => { setProposalCategoryID(category.id); setProposalAttributeDrafts({}); }} selected={proposalCategoryID === category.id} />)}</View><TextInput accessibilityLabel="بحث في الفئات" placeholder="ابحث باسم الفئة" value={proposalCategoryQuery} onChangeText={setProposalCategoryQuery} style={styles.input} />{proposalCategoriesLoading ? <Text style={styles.muted}>جارٍ تحميل الفئات…</Text> : null}{!proposalCategoriesLoading && proposalCategories.length === 0 ? <Text style={styles.muted}>لا توجد فئات مطابقة.</Text> : null}{proposalCategoryNextCursor ? <BthwaniButton busy={proposalCategoriesLoading} disabled={proposalCategoriesLoading} label="تحميل المزيد من الفئات" onPress={() => void loadMoreProposalCategories()} variant="secondary" /> : null}<Text style={styles.fieldLabel}>هوية القياس</Text><View style={styles.choiceList}>{(["DISCRETE", "MEASURED", "VARIABLE_MEASURE"] as MeasurementKind[]).map((value) => <BthwaniChip key={value} label={measurementKindLabel(value)} onPress={() => { setProposalMeasurementKind(value); setProposalBaseUnit(""); }} selected={proposalMeasurementKind === value} />)}</View><Text style={styles.fieldLabel}>الوحدة الأساسية</Text><View style={styles.choiceRow}>{baseUnitOptions(proposalMeasurementKind).map((value) => <BthwaniChip key={value} label={baseUnitLabel(value)} onPress={() => setProposalBaseUnit(value)} selected={proposalBaseUnit === value} />)}</View>{proposalRuleState === "loading" ? <Text style={styles.muted}>جارٍ قراءة خصائص التصنيف…</Text> : null}{proposalRuleState === "error" ? <Text style={styles.warning}>تعذرت قراءة قواعد الخصائص. أعد المحاولة قبل إرسال المقترح.</Text> : null}{proposalRuleState !== "loading" && proposalRuleState !== "error" ? renderAttributeFields(proposalAttributeRules, proposalAttributeDrafts, proposalEnumOptions, (key, value) => setProposalAttributeDrafts((current) => ({ ...current, [key]: value }))) : null}<BthwaniButton busy={busy} disabled={proposalRuleState !== "ready" || !proposalName.trim() || !proposalVerticalID.trim() || !proposalCategoryID.trim() || !proposalMeasurementKind || !proposalBaseUnit} label="إرسال المقترح" onPress={() => void createProposal()} variant="secondary" />{proposalLoadError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.warning}>{proposalLoadError}</Text><BthwaniButton label="إعادة تحميل المقترحات" onPress={() => void load()} variant="secondary" /></View> : null}{state.kind === "ready" && state.proposals.length ? state.proposals.map((proposal) => <Text key={proposal.id} style={styles.muted}>{catalogProductProposalStateLabel(proposal.state)}{proposal.correctionReason ? ` · ${proposal.correctionReason}` : ""}</Text>) : null}{proposalNextCursor ? <BthwaniButton busy={busy} disabled={busy} label="تحميل المزيد من المقترحات" onPress={() => void loadMoreProposals()} variant="secondary" /> : null}</View>
       </> : null}
       {catalogReady && panel === "tools" ? <View style={styles.managementBlock}><Text style={styles.itemTitle}>الأقسام والإضافات</Text><Text style={styles.muted}>اختر عرضًا بالاسم ثم أنشئ مجموعة إضافات أو قسم عرض.</Text><View style={styles.offerPicker}>{state.kind === "ready" ? state.offers.map((offer) => <BthwaniChip key={offer.offerId} label={offer.productName} onPress={() => setExtensionOfferID(offer.offerId)} selected={extensionOfferID === offer.offerId} />) : null}</View><TextInput accessibilityLabel="اسم مجموعة الإضافات" editable={!busy} onChangeText={setModifierName} placeholder="اسم مجموعة الإضافات" value={modifierName} style={[styles.input, busy && styles.disabledInput]} /><TextInput accessibilityLabel="اسم خيار الإضافة" editable={!busy} onChangeText={setModifierOptionName} placeholder="اسم خيار اختياري" value={modifierOptionName} style={[styles.input, busy && styles.disabledInput]} /><BthwaniButton busy={busy} disabled={!modifierName.trim()} label="إنشاء مجموعة إضافات وربطها" onPress={() => void createModifiersAndAttach()} variant="secondary" />{sections.length ? <View style={styles.managementBlock}>
        <Text style={styles.fieldLabel}>الأقسام الحالية</Text>
        {sectionLoadError ? <View><Text style={styles.warning}>{sectionLoadError}</Text><BthwaniButton label="إعادة تحميل الأقسام" onPress={() => void load()} variant="secondary" /></View> : null}
        <View style={styles.choiceRow}>{sections.map((section) => <BthwaniChip key={section.id} label={section.nameAr} disabled={busy} selected={selectedSectionID === section.id} onPress={() => setSelectedSectionID(section.id)} />)}</View>
        <BthwaniButton busy={busy} disabled={busy || !extensionOfferID || !selectedSectionID || sections.some((section) => section.id === selectedSectionID && section.offerIds.includes(extensionOfferID))} label="ربط العرض بالقسم المحدد" onPress={() => void attachToExistingSection()} variant="secondary" />
      </View> : null}<TextInput accessibilityLabel="اسم القسم" editable={!busy} onChangeText={setSectionName} placeholder="اسم قسم المتجر" value={sectionName} style={[styles.input, busy && styles.disabledInput]} /><BthwaniButton busy={busy} disabled={!sectionName.trim()} label="إنشاء قسم وربطه" onPress={() => void createSectionAndAttach()} variant="secondary" /></View> : null}
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة عروض المتجر…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error || "تعذر قراءة عروض المتجر."}</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View> : null}
        {!toolsView && panel === null && state.kind === "ready" && !serverOfferQuery && state.offers.length === 0 ? <Text style={styles.muted}>لا توجد عروض مرتبطة بهذا المتجر بعد.</Text> : null}
        {!toolsView && panel === null && state.kind === "ready" && serverOfferQuery && remoteOffers.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ البحث في كتالوج المتجر بالكامل…</Text></View> : null}
        {!toolsView && panel === null && state.kind === "ready" && serverOfferQuery && remoteOffers.kind === "error" ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>تعذر تحميل نتائج التصفية من المتجر.</Text><BthwaniButton label="إعادة البحث" onPress={() => setRemoteOfferRefresh((value) => value + 1)} variant="secondary" /></View> : null}
        {shareNotice && !toolsView && panel === null ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{shareNotice}</Text> : null}
        {!toolsView && panel === null && state.kind === "ready" && listFilter !== "offers" ? <View style={styles.offerList}>
        {offersOnScreen.map((offer) => {
          const primaryMedia = getPrimaryMedia(offer.media);
          const inventoryDraft = inventoryDrafts[offer.offerId] ?? String(offer.inventoryOnHandBaseUnits);
          const stockExpanded = expandedInventoryId === offer.offerId;
          const publicLink = publicOfferLink(offer);
          const whatsappLink = buildPartnerStoreWhatsAppURL(publicLink, offer.productName);
          return <View key={offer.offerId} style={styles.item}>
            <View style={styles.offerIdentity}>
              {primaryMedia ? <ExpoImage cachePolicy="memory" accessibilityLabel={"صورة " + offer.productName} source={{ uri: primaryMedia.uri }} contentFit="cover" style={styles.offerImage} />
                : <View accessibilityLabel={"لا توجد صورة لـ " + offer.productName} style={styles.offerImagePlaceholder}><BthwaniIcon name="cart" color={theme.colorMuted} size={20} /></View>}
              <View style={styles.itemText}>
                <Text numberOfLines={2} style={styles.itemTitle}>{offer.productName}</Text>
                <Text style={styles.price}>{formatMoney(offer.priceMinor, offer.currency)}</Text>
                <Text style={[styles.muted, { color: offer.publicationState === "published" ? theme.success : theme.colorMuted }]}>{storeOfferPublicationStateLabel(offer.publicationState)}</Text>
              </View>
            </View>
            <View style={styles.offerActionRow}>
              <Switch accessibilityLabel={"توافر " + offer.productName} trackColor={{ false: theme.borderColor, true: theme.actionSoft }} thumbColor={offer.availability ? theme.brandAction : theme.colorMuted} disabled={busy} onValueChange={(available) => void updateOffer(offer, offer.publicationState, available)} value={offer.availability} />
              <Text style={styles.availabilityLabel}>{offer.availability ? "متاح" : "غير متاح"}</Text>
              {offer.inventoryPolicy === "QUANTITY_ON_HAND" ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => setExpandedInventoryId(stockExpanded ? null : offer.offerId)} style={styles.compactAction}><Text style={styles.compactActionLabel}>المخزون</Text></Pressable> : null}
              <View style={{ flex: 1 }} />
              <Pressable accessibilityRole="button" accessibilityLabel={"تعديل سعر " + offer.productName} onPress={() => setPanel("prices")} style={styles.compactAction}><BthwaniIcon name="edit" size={15} color={theme.color} /><Text style={styles.compactActionLabel}>تعديل</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={(offer.publicationState === "published" ? "إخفاء " : "نشر ") + offer.productName} disabled={busy} onPress={() => void updateOffer(offer, offer.publicationState === "published" ? "hidden" : "published", offer.availability)} style={styles.compactAction}><Text style={styles.compactActionLabel}>{offer.publicationState === "published" ? "إخفاء" : "نشر"}</Text></Pressable>
            </View>
            {publicLink ? <View style={[styles.offerActionRow, { flexWrap: "wrap" }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={"نسخ رابط المنتج " + offer.productName}
                disabled={Boolean(sharingOfferID)} onPress={() => void copyOfferLink(offer)} style={styles.compactAction}>
                <Text style={styles.compactActionLabel}>{publicLink.previewOnly ? "نسخ رابط المعاينة" : "نسخ رابط المنتج"}</Text>
              </Pressable>
              {whatsappLink ? <Pressable accessibilityRole="button" accessibilityLabel={"مشاركة " + offer.productName + " عبر واتساب"}
                disabled={Boolean(sharingOfferID)} onPress={() => void shareOfferWhatsApp(offer)} style={styles.compactAction}>
                <Text style={styles.compactActionLabel}>مشاركة عبر واتساب</Text>
              </Pressable> : null}
            </View> : null}
            {stockExpanded ? <View style={styles.inventoryBlock}>
              <Text style={styles.muted}>المحجوز: {offer.inventoryReservedBaseUnits} · المتاح: {Math.max(0, offer.inventoryOnHandBaseUnits - offer.inventoryReservedBaseUnits)}</Text>
              <TextInput accessibilityLabel={"مخزون " + offer.productName} editable={!busy} keyboardType="number-pad" onChangeText={(value) => setInventoryDrafts((current) => ({ ...current, [offer.offerId]: toAsciiDigits(value) }))} value={inventoryDraft} style={[styles.input, styles.numericInput, busy && styles.disabledInput]} />
              <BthwaniButton busy={busy} disabled={busy} label="حفظ المخزون" onPress={() => {
                const next = Number(inventoryDraft);
                if (!Number.isSafeInteger(next) || next < 0) { setError("أدخل كمية مخزون صحيحة."); return; }
                void updateOffer(offer, offer.publicationState, offer.availability, "QUANTITY_ON_HAND", next);
              }} variant="secondary" />
            </View> : null}
          </View>;
        })}
      </View> : null}
      {!toolsView && panel === null && state.kind === "ready" && listFilter !== "offers" && !popularError && (listFilter !== "popular" || popularIDs !== null) && (!serverOfferQuery || remoteOffers.kind === "ready") && (state.offers.length > 0 || Boolean(serverOfferQuery)) && offersOnScreen.length === 0 ? <Text style={styles.muted}>لا توجد منتجات تطابق البحث أو التصفية.</Text> : null}
            {!toolsView && panel === null && listFilter !== "offers" && hasMoreOffers ? <BthwaniButton busy={loadingNextOffers} disabled={loadingNextOffers || busy} label={loadingNextOffers ? "جارٍ تحميل العروض…" : "تحميل المزيد من العروض"} onPress={() => void (serverOfferQuery ? loadMoreRemoteOffers() : loadMoreOffers())} variant="secondary" /> : null}
      <Modal visible={filterModalOpen} transparent animationType="slide" onRequestClose={() => setFilterModalOpen(false)}>
        <View style={styles.filterModalBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="إغلاق التصفية" style={styles.filterBackdropFill} onPress={() => setFilterModalOpen(false)} />
          <View style={styles.filterModalPanel}>
            <View style={styles.filterModalTitle}><Text style={styles.itemTitle}>تصفية المنتجات</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="إغلاق" onPress={() => setFilterModalOpen(false)}><BthwaniIcon name="close" size={21} color={theme.color} /></Pressable>
            </View>
            {([{ key: "all", label: "كل المنتجات" }, { key: "published", label: "المنشورة والمتاحة" }, { key: "unavailable", label: "غير المتاحة" }, { key: "stockout", label: "نفاد المخزون" }, { key: "hidden", label: "المخفية" }] as const).map((item) =>
              <Pressable key={item.key} accessibilityRole="button" aria-selected={listFilter === item.key} accessibilityState={{ selected: listFilter === item.key }} onPress={() => { setListFilter(item.key); setFilterModalOpen(false); }} style={[styles.filterModalItem, listFilter === item.key && styles.filterChipActive]}>
                <Text style={styles.itemTitle}>{item.label}</Text>
                {listFilter === item.key ? <BthwaniIcon name="success" color={theme.brandAction} size={18} /> : null}
              </Pressable>)}
          </View>
        </View>
      </Modal>
      {error && state.kind !== "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
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
