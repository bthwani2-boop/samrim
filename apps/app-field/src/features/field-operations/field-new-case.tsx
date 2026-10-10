import { normalizeYemenPhoneE164 } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniMap, type BthwaniMapCoordinate, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CommerceVertical, type CommercialStoreType, type CreateFieldJoiningCaseDraftRequest, type CreateJoiningCaseRequest, type DshImageUploadInput, fieldAdmissionStateLabel, isMediaProvenanceInputValid, type JoiningCaseProofType, type JoiningCaseResponse, joiningCaseStateLabel, type MediaProvenanceInput, resolveJoiningCaseImageContentType, type ServiceCity } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { type Href, Link, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, TextInput, useWindowDimensions, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { fieldAdmissionActionability } from "./field-eligibility";
import { FieldMediaProvenanceEditor } from "./field-media-provenance-editor";
import { createFieldOperationStyles } from "./field-operation-styles";
import { type EditableWorkingHours, type EditableWorkingHoursInterval, FieldWorkingHoursEditor, toStoreWorkingHoursIntervals } from "./field-working-hours-editor";
import { useOwnFieldAdmission } from "./use-field-admission";

type PendingDraftAttempt =
  | Readonly<{ kind: "create"; request: CreateFieldJoiningCaseDraftRequest; idempotencyKey: string; correlationID: string }>
  | Readonly<{ kind: "update"; caseID: string; expectedVersion: number; request: CreateFieldJoiningCaseDraftRequest; idempotencyKey: string; correlationID: string }>;
type StoreImageDraft = DshImageUploadInput & Readonly<{ provenance: MediaProvenanceInput }>;
type WalletProvider = Awaited<ReturnType<ReturnType<typeof fieldClient>["listWalletProviders"]>>["walletProviders"][number];
type PendingImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: StoreImageDraft; idempotencyKey: string; correlationID: string }>;
type PendingProofImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: DshImageUploadInput; idempotencyKey: string; correlationID: string }>;
const proofTypeOptions: ReadonlyArray<{ value: JoiningCaseProofType; label: string }> = [
  { value: "COMMERCIAL_REGISTRATION", label: "سجل تجاري" },
  { value: "IDENTITY_DOCUMENT", label: "هوية" },
  { value: "FREELANCE_WORK_DOCUMENT", label: "وثيقة عمل حر" },
];

function initialJoiningCaseInput(): CreateJoiningCaseRequest {
  return {
    contactPhoneE164: "",
    ownerFullName: "",
    businessName: "",
    firstStoreName: "",
    walletProviderKey: "",
    firstStoreAddress: "",
    serviceCityId: "",
    firstStoreVerticalId: "",
    firstStoreCommercialTypeId: "",
    firstStoreLatitude: 0,
    firstStoreLongitude: 0,
    firstStoreWorkingHours: { intervals: [] },
    firstStoreProofType: "COMMERCIAL_REGISTRATION",
    firstStoreProofNumber: "",
    firstStoreFulfillmentModes: [],
  };
}

function isOutcomeUncertain(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { kind?: unknown; status?: unknown };
  return error.kind === "network" || (error.kind === "http" && typeof error.status === "number" && error.status >= 500);
}

function dshErrorCode(cause: unknown): string {
  if (!cause || typeof cause !== "object") return "";
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

export function FieldNewCase() {
const theme = useAppearanceTheme();
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const wideLayout = width >= 768;
  const { caseId: rawCaseId } = useLocalSearchParams<{ caseId?: string | string[] }>();
  const caseId = Array.isArray(rawCaseId) ? rawCaseId[0] ?? "" : rawCaseId ?? "";
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { state: admissionState, refresh: refreshAdmission } = useOwnFieldAdmission();
  const admissionActionability = admissionState.kind === "ready" ? fieldAdmissionActionability(admissionState.admission) : null;
  const [input, setInput] = useState<CreateJoiningCaseRequest>(initialJoiningCaseInput);
  const [workingHoursByDay, setWorkingHoursByDay] = useState<EditableWorkingHours>({});
  const [sameBusinessAndStore, setSameBusinessAndStore] = useState(false);
  const [selectedProofType, setSelectedProofType] = useState<JoiningCaseProofType | null>(null);
  const [draftConflict, setDraftConflict] = useState(false);
  const [draftConflictNeedsRead, setDraftConflictNeedsRead] = useState(false);
  const [selectedStoreOrigin, setSelectedStoreOrigin] = useState<BthwaniMapCoordinate | null>(null);
  const [createdCase, setCreatedCase] = useState<JoiningCaseResponse | null>(null);
  const headerTitle = caseId || createdCase ? "تعديل مسودة الشريك" : "إضافة شريك";
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [commercialTypes, setCommercialTypes] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const [walletProviders, setWalletProviders] = useState<ReadonlyArray<WalletProvider>>([]);
  const [walletProvidersLoading, setWalletProvidersLoading] = useState(true);
  const [walletProvidersError, setWalletProvidersError] = useState("");
  const [commercialTypesLoading, setCommercialTypesLoading] = useState(false);
  const [commercialTypesError, setCommercialTypesError] = useState("");
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [caseLoading, setCaseLoading] = useState(Boolean(caseId));
  const [caseLoadRetry, setCaseLoadRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [locationError, setLocationError] = useState("");
  const [storeImage, setStoreImage] = useState<StoreImageDraft | null>(null);
  const [proofImage, setProofImage] = useState<DshImageUploadInput | null>(null);
  const [pendingDraftAttempt, setPendingDraftAttempt] = useState<PendingDraftAttempt | null>(null);
  const [pendingImageAttempt, setPendingImageAttempt] = useState<PendingImageAttempt | null>(null);
  const [pendingProofImageAttempt, setPendingProofImageAttempt] = useState<PendingProofImageAttempt | null>(null);
  const preloadedVerticalID = useRef("");
  const formLocked = busy || caseLoading || Boolean(pendingDraftAttempt) || Boolean(pendingImageAttempt) || Boolean(pendingProofImageAttempt);

  useEffect(() => { navigation.setOptions({ headerTitle }); }, [headerTitle, navigation]);

  const loadAdmission = useCallback(async () => {
    setError("");
    await refreshAdmission();
  }, [refreshAdmission]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError("");
    try {
      const [nextCities, nextVerticals] = await Promise.all([fieldClient().listActiveServiceCities(), fieldClient().listCatalogVerticals()]);
      setCities(nextCities);
      setVerticals(nextVerticals);
    } catch (cause) {
      console.warn("DSH Field canonical options read failed", cause);
      setOptionsError("تعذر قراءة المدن والأنشطة المتاحة. أعد المحاولة.");
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const loadWalletProviders = useCallback(async () => {
    setWalletProvidersLoading(true);
    setWalletProvidersError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().listWalletProviders(token);
      setWalletProviders(response.walletProviders);
    } catch (cause) {
      console.warn("DSH Field wallet provider options read failed", cause);
      setWalletProvidersError("تعذر قراءة المحافظ الرسمية. أعد المحاولة لاختيار محفظة معتمدة.");
    } finally {
      setWalletProvidersLoading(false);
    }
  }, []);

  useEffect(() => { void loadWalletProviders(); }, [loadWalletProviders]);

  useEffect(() => {
    if (!caseId) {
      setCaseLoading(false);
      return;
    }
    let active = true;
    setCaseLoading(true);
    setError("");
    if (caseLoadRetry > 0) {
      setLocationMessage("");
      setLocationError("");
    }
    void (async () => {
      try {
        const token = await getUsableIdentityAccessToken();
        const response = await fieldClient().readOwnFieldJoiningCase(token, caseId);
        if (!active) return;
        const current = response.case;
        if (current.state !== "draft") {
          setError("يمكن تعديل المسودات فقط. اقرأ الحالة الحالية من قائمة الشركاء.");
          return;
        }
        const hoursByDay: Record<number, Array<EditableWorkingHoursInterval>> = {};
        for (const interval of current.firstStoreWorkingHours?.intervals ?? []) {
          hoursByDay[interval.dayOfWeek] ??= [];
          hoursByDay[interval.dayOfWeek]?.push({ ...interval, id: Crypto.randomUUID() });
        }
        setInput({
          contactPhoneE164: current.contactPhoneE164,
          ownerFullName: current.ownerFullName ?? "",
          businessName: current.businessName,
          firstStoreName: current.firstStoreName,
          walletProviderKey: current.walletProviderKey,
          firstStoreAddress: current.firstStoreAddress ?? "",
          serviceCityId: current.serviceCityId ?? "",
          firstStoreVerticalId: current.firstStoreVerticalId,
          firstStoreCommercialTypeId: current.firstStoreCommercialTypeId ?? "",
          firstStoreLatitude: current.firstStoreLatitude ?? 0,
          firstStoreLongitude: current.firstStoreLongitude ?? 0,
          firstStoreWorkingHours: current.firstStoreWorkingHours ?? { intervals: [] },
          firstStoreProofType: current.firstStoreProofType ?? "COMMERCIAL_REGISTRATION",
          firstStoreProofNumber: "",
          ...(current.firstStoreNotes ? { firstStoreNotes: current.firstStoreNotes } : {}),
          firstStoreFulfillmentModes: current.firstStoreFulfillmentModes,
        });
        setSelectedProofType(current.firstStoreProofType);
        preloadedVerticalID.current = current.firstStoreVerticalId;
        setWorkingHoursByDay(hoursByDay);
        if (current.firstStoreLatitude !== null && current.firstStoreLongitude !== null) {
          setSelectedStoreOrigin({ latitude: current.firstStoreLatitude, longitude: current.firstStoreLongitude });
        } else setSelectedStoreOrigin(null);
        setCreatedCase(response);
      } catch (cause) {
        if (!active) return;
        console.warn("DSH Field draft reopen failed", cause);
        setError("تعذر قراءة المسودة. أعد المحاولة من قائمة الشركاء حتى تبقى البيانات السابقة محفوظة.");
      } finally {
        if (active) setCaseLoading(false);
      }
    })();
    return () => { active = false; };
  }, [caseId, caseLoadRetry]);

  useEffect(() => {
    const verticalId = input.firstStoreVerticalId;
    const isPreloadedDraft = Boolean(verticalId && preloadedVerticalID.current === verticalId);
    if (isPreloadedDraft) preloadedVerticalID.current = "";
    setCommercialTypes([]);
    setCommercialTypesError("");
    if (!isPreloadedDraft) setInput((current) => current.firstStoreCommercialTypeId ? { ...current, firstStoreCommercialTypeId: "" } : current);
    if (!verticalId) return;
    let active = true;
    setCommercialTypesLoading(true);
    void fieldClient().listCommercialStoreTypes(verticalId)
      .then((items) => { if (active) setCommercialTypes(items.filter((item) => item.active)); })
      .catch((cause: unknown) => {
        console.warn("DSH Field commercial store type read failed", cause);
        if (active) setCommercialTypesError("تعذر قراءة أنواع المتاجر لهذه الفئة.");
      })
      .finally(() => { if (active) setCommercialTypesLoading(false); });
    return () => { active = false; };
  }, [input.firstStoreVerticalId]);

  async function createCase() {
    if (busy || draftConflictNeedsRead) return;
    if (!pendingDraftAttempt && !walletProviders.some((provider) => provider.active && provider.key === input.walletProviderKey)) {
      setError("اختر محفظة رسمية نشطة من القائمة قبل حفظ المسودة.");
      return;
    }
    let attempt: PendingDraftAttempt;
    if (pendingDraftAttempt) {
      attempt = pendingDraftAttempt;
    } else {
      const contactPhoneE164 = normalizeYemenPhoneE164(input.contactPhoneE164);
      if (!/^\+[1-9]\d{7,14}$/.test(contactPhoneE164)) {
        setError("أدخل رقم جوال المالك بصيغة صحيحة مثل 777123456 أو +967777123456 لحفظ المسودة.");
        return;
      }
      const proofNumber = input.firstStoreProofNumber.trim();
      const notes = input.firstStoreNotes?.trim();
      const request: CreateFieldJoiningCaseDraftRequest = {
        contactPhoneE164,
        ownerFullName: input.ownerFullName.trim(),
        businessName: input.businessName.trim(),
        firstStoreName: input.firstStoreName.trim(),
        walletProviderKey: input.walletProviderKey.trim(),
        firstStoreAddress: input.firstStoreAddress.trim(),
        serviceCityId: input.serviceCityId.trim(),
        firstStoreVerticalId: input.firstStoreVerticalId.trim(),
        firstStoreCommercialTypeId: input.firstStoreCommercialTypeId.trim(),
        firstStoreWorkingHours: { intervals: toStoreWorkingHoursIntervals(workingHoursByDay) },
        ...(selectedProofType ? { firstStoreProofType: selectedProofType } : {}),
        ...(proofNumber ? { firstStoreProofNumber: proofNumber } : {}),
        ...(notes ? { firstStoreNotes: notes } : {}),
        firstStoreFulfillmentModes: input.firstStoreFulfillmentModes,
        ...(selectedStoreOrigin ? { firstStoreLatitude: selectedStoreOrigin.latitude, firstStoreLongitude: selectedStoreOrigin.longitude } : {}),
      };
      attempt = createdCase
        ? { kind: "update", caseID: createdCase.case.id, expectedVersion: createdCase.case.version, request, idempotencyKey: `field_joining_case_draft_update_${Crypto.randomUUID()}`, correlationID: `field_joining_case_draft_corr_${Crypto.randomUUID()}` }
        : { kind: "create", request, idempotencyKey: `field_joining_case_create_${Crypto.randomUUID()}`, correlationID: `field_joining_case_corr_${Crypto.randomUUID()}` };
    }
    setPendingDraftAttempt(attempt);
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = attempt.kind === "update"
        ? await fieldClient().updateFieldJoiningCaseDraft(token, attempt.caseID, attempt.request, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID)
        : await fieldClient().createFieldJoiningCase(token, attempt.request, attempt.idempotencyKey, attempt.correlationID);
      const canonical = await fieldClient().readOwnFieldJoiningCase(token, response.case.id);
      if (canonical.case.id !== response.case.id ||
        (attempt.request.businessName && canonical.case.businessName !== attempt.request.businessName) ||
        (attempt.request.firstStoreName && canonical.case.firstStoreName !== attempt.request.firstStoreName) ||
        canonical.case.contactPhoneE164 !== attempt.request.contactPhoneE164 ||
        canonical.case.version < response.case.version) {
        throw new Error("FIELD_JOINING_CASE_CANONICAL_READBACK_MISMATCH");
      }
      setCreatedCase(canonical);
      setDraftConflict(false);
      setDraftConflictNeedsRead(false);
      setPendingDraftAttempt(null);
      if (storeImage && isMediaProvenanceInputValid(storeImage.provenance)) {
        await uploadStoreImage(canonical, storeImage);
      }
      if (storeImage && !isMediaProvenanceInputValid(storeImage.provenance)) setError("حُفظت المسودة. أكمل مصدر الصورة وحق عرضها قبل رفع الصورة.");
    } catch (cause) {
      console.warn("DSH Field joining-case draft save failed", cause);
      if (isOutcomeUncertain(cause)) {
        setError("تعذر تأكيد الحفظ. أعد المحاولة بالبيانات نفسها للتحقق من النتيجة قبل بدء طلب آخر.");
      } else {
        setPendingDraftAttempt(null);
        const code = dshErrorCode(cause);
        if (attempt.kind === "update" && code === "VERSION_CONFLICT") {
          try {
            const token = await getUsableIdentityAccessToken();
            setCreatedCase(await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID));
            setDraftConflict(true);
            setDraftConflictNeedsRead(false);
            setError("تغيرت المسودة على جهاز آخر. احتفظنا بمدخلاتك؛ حفظها الآن سيستبدل النسخة الأحدث.");
          } catch (readError) {
            console.warn("DSH Field draft conflict readback failed", readError);
            setDraftConflictNeedsRead(true);
            setError("تغيرت المسودة على جهاز آخر وتعذر قراءة نسختها الأحدث. مدخلاتك ما تزال محفوظة هنا؛ أعد قراءة المسودة قبل الحفظ.");
          }
          return;
        }
        setError(code === "JOINING_CASE_EXISTS"
          ? "يوجد طلب نشط لهذا الهاتف. افتح قائمة الشركاء للتحقق منه قبل إنشاء طلب آخر."
          : code === "SERVICE_CITY_UNAVAILABLE"
            ? "مدينة الخدمة لم تعد نشطة. أعد قراءة المدن واختر مدينة أخرى."
            : code === "VERTICAL_UNAVAILABLE"
              ? "الفئة الرئيسية لم تعد نشطة. أعد قراءة الأنشطة واختر فئة أخرى."
              : "تعذر حفظ المسودة. تحقق من رقم الهاتف والاتصال ثم أعد المحاولة.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function rereadAfterDraftConflict() {
    if (busy || !createdCase) return;
    setBusy(true);
    try {
      const token = await getUsableIdentityAccessToken();
      setCreatedCase(await fieldClient().readOwnFieldJoiningCase(token, createdCase.case.id));
      setDraftConflictNeedsRead(false);
      setDraftConflict(true);
      setError("احتفظنا بمدخلاتك. حفظها الآن سيستبدل النسخة الأحدث من المسودة.");
    } catch (cause) {
      console.warn("DSH Field draft conflict retry failed", cause);
      setError("تعذر قراءة النسخة الأحدث. مدخلاتك ما تزال محفوظة هنا؛ أعد المحاولة عند توفر الاتصال.");
    } finally {
      setBusy(false);
    }
  }

  async function requestCurrentLocation() {
    if (formLocked || locationBusy) return;
    setLocationBusy(true);
    setLocationMessage("");
    setLocationError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationError("لم نتمكن من استخدام موقعك. اختر موقع المتجر يدويًا على الخريطة.");
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        setLocationError("خدمة الموقع غير مفعّلة. فعّلها أو اختر موقع المتجر يدويًا على الخريطة.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinate = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude) || coordinate.latitude < -90 || coordinate.latitude > 90 || coordinate.longitude < -180 || coordinate.longitude > 180) {
        setLocationError("تعذر تحديد موقع صالح. اختر موقع المتجر يدويًا على الخريطة.");
        return;
      }
      setSelectedStoreOrigin(coordinate);
      setLocationMessage("حددنا موقعك كنقطة بداية. اسحب المؤشر أو المس الخريطة لضبط موقع المتجر.");
    } catch {
      setLocationError("تعذر تحديد موقعك الآن. يمكنك اختيار موقع المتجر يدويًا على الخريطة.");
    } finally {
      setLocationBusy(false);
    }
  }

  function toggleFulfillmentMode(mode: "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP") {
    setInput((current) => {
      const selected = current.firstStoreFulfillmentModes.includes(mode);
      return { ...current, firstStoreFulfillmentModes: selected ? current.firstStoreFulfillmentModes.filter((value) => value !== mode) : [...current.firstStoreFulfillmentModes, mode] };
    });
  }

  async function pickStoreImage(source: "camera" | "library" = "library") {
    if (busy || pendingImageAttempt) return;
    const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(source === "camera" ? "يلزم السماح باستخدام الكاميرا لالتقاط صورة المتجر." : "يلزم السماح بالوصول إلى الصور لاختيار صورة المتجر."); return; }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    try {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("STORE_IMAGE_READ_FAILED");
      const blob = await response.blob();
      const type = resolveJoiningCaseImageContentType(asset.mimeType, blob.type, asset.fileName, asset.uri);
      if (!type) throw new Error("STORE_IMAGE_TYPE_INVALID");
      setStoreImage({ uri: asset.uri, name: asset.fileName ?? (type === "image/png" ? "store-image.png" : "store-image.jpg"), type, blob, provenance: { creator: "", sourceDescription: "", sourceUri: "", rightsStatement: "", rightsUri: "", rightsAttested: false } });
      setError("");
    } catch (cause) {
      console.warn("Field store image preparation failed", cause);
      setError("تعذر تجهيز صورة المتجر. اختر الصورة مرة أخرى.");
    }
  }

  async function pickProofImage() {
    if (busy || pendingProofImageAttempt) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("يلزم السماح بالوصول إلى الصور لاختيار صورة الإثبات."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    try {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("PROOF_IMAGE_READ_FAILED");
      const blob = await response.blob();
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("PROOF_IMAGE_SIZE_INVALID");
      const type = resolveJoiningCaseImageContentType(asset.mimeType, blob.type, asset.fileName, asset.uri);
      if (!type) throw new Error("PROOF_IMAGE_TYPE_INVALID");
      setProofImage({ uri: asset.uri, name: asset.fileName ?? (type === "image/png" ? "joining-case-proof.png" : "joining-case-proof.jpg"), type, blob });
      setError("");
    } catch (cause) {
      console.warn("Field proof image preparation failed", cause);
      setError(cause instanceof Error && cause.message === "PROOF_IMAGE_SIZE_INVALID" ? "يجب ألا يتجاوز حجم صورة الإثبات 10 ميغابايت." : cause instanceof Error && cause.message === "PROOF_IMAGE_TYPE_INVALID" ? "صيغة صورة الإثبات غير مدعومة. اختر صورة بصيغة JPG أو PNG." : "تعذر تجهيز صورة الإثبات. اختر الصورة مرة أخرى.");
    }
  }

  async function retryStoreImage() {
    if (!createdCase || !storeImage || busy) return;
    setBusy(true);
    setError("");
    try {
      await uploadStoreImage(createdCase, storeImage, pendingImageAttempt ?? undefined);
    } finally {
      setBusy(false);
    }
  }

  async function uploadStoreImage(current: JoiningCaseResponse, image: StoreImageDraft, existingAttempt?: PendingImageAttempt) {
    const attempt = existingAttempt ?? { caseID: current.case.id, expectedVersion: current.case.version, image, idempotencyKey: `field_store_image_${Crypto.randomUUID()}`, correlationID: `field_store_image_corr_${Crypto.randomUUID()}` };
    setPendingImageAttempt(attempt);
    try {
      const token = await getUsableIdentityAccessToken();
      const uploaded = await fieldClient().uploadJoiningCaseStoreImage(token, attempt.caseID, attempt.image, attempt.image.provenance, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setCreatedCase(uploaded);
      setStoreImage(null);
      setPendingImageAttempt(null);
    } catch (cause) {
      console.warn("DSH Field store image upload failed", cause);
      if (dshErrorCode(cause) === "MEDIA_STORAGE_UNAVAILABLE") {
        setPendingImageAttempt(null);
        setError("تعذر تخزين الصورة. أعد رفع الملف المختار أو اختر صورة أخرى.");
        return;
      }
      if (isOutcomeUncertain(cause)) {
        setError("حُفظت المسودة، لكن لم نتأكد من رفع الصورة بعد. أعد المحاولة للتحقق من حالتها.");
        return;
      }
      setPendingImageAttempt(null);
      try {
        const token = await getUsableIdentityAccessToken();
        const latest = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID);
        setCreatedCase(latest);
      } catch (readError) {
        console.warn("DSH Field case reconciliation after image upload failed", readError);
      }
      setError("حُفظ الطلب، لكن تعذر تأكيد رفع الصورة. حدّث الحالة قبل المحاولة مجددًا.");
    }
  }

  async function retryProofImage() {
    if (!createdCase || !proofImage || busy) return;
    setBusy(true);
    setError("");
    try {
      await uploadProofImage(createdCase, proofImage, pendingProofImageAttempt ?? undefined);
    } finally {
      setBusy(false);
    }
  }

  async function uploadProofImage(current: JoiningCaseResponse, image: DshImageUploadInput, existingAttempt?: PendingProofImageAttempt) {
    const attempt = existingAttempt ?? { caseID: current.case.id, expectedVersion: current.case.version, image, idempotencyKey: `field_proof_image_${Crypto.randomUUID()}`, correlationID: `field_proof_image_corr_${Crypto.randomUUID()}` };
    setPendingProofImageAttempt(attempt);
    try {
      const token = await getUsableIdentityAccessToken();
      const uploaded = await fieldClient().uploadFieldJoiningCaseProofImage(token, attempt.caseID, attempt.image, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setCreatedCase(uploaded);
      setProofImage(null);
      setPendingProofImageAttempt(null);
    } catch (cause) {
      console.warn("DSH Field proof image upload failed", cause);
      if (isOutcomeUncertain(cause)) {
        setError("لم نتأكد من رفع صورة الإثبات بعد. أعد المحاولة للتحقق من حالتها.");
        return;
      }
      setPendingProofImageAttempt(null);
      try {
        const token = await getUsableIdentityAccessToken();
        const latest = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID);
        setCreatedCase(latest);
      } catch (readError) {
        console.warn("DSH Field case reconciliation after proof image upload failed", readError);
      }
      setError("تعذر تأكيد صورة الإثبات. حدّث المسودة قبل إعادة الرفع.");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="إضافة شريك">
      <Text style={styles.muted}>{caseId || createdCase ? "حدّث بيانات المسودة واحفظ التغييرات. سيبقى رقم الإثبات الخاص مخفيًا ما لم تدخل رقمًا بديلًا." : "أدخل رقم جوال المالك لحفظ مسودة جزئية، ثم أكمل بيانات المتجر والصور قبل إرسالها للمراجعة."}</Text>
      {caseLoading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المسودة…</Text></View> : null}
      {caseId && !caseLoading && error.startsWith("تعذر قراءة المسودة") ? <BthwaniButton label="إعادة قراءة المسودة" onPress={() => setCaseLoadRetry((value) => value + 1)} variant="secondary" /> : null}
      {admissionState.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة حالة التفعيل…</Text></View> : null}
      {admissionState.kind === "missing" ? <View style={styles.card}><Text style={styles.cardTitle}>لم يكتمل تفعيل الحساب</Text><Text style={styles.muted}>تواصل مع فريق التشغيل لإكمال تسجيلك للميدان.</Text></View> : null}
      {admissionState.kind === "ready" && admissionActionability !== "available" ? <View style={styles.card}><Text style={styles.cardTitle}>لا يمكن إضافة شريك الآن</Text><Text style={styles.muted}>{admissionActionability === "profile_review" ? "ملفك يحتاج مراجعة قبل إضافة شريك. تواصل مع فريق التشغيل لاستكمالها." : `حالة التفعيل الحالية: ${fieldAdmissionStateLabel(admissionState.admission.state)}. تابع الحالة أو تواصل مع فريق التشغيل.`}</Text></View> : null}
      {admissionState.kind === "error" ? <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة حالة تفعيلك الآن. أعد المحاولة عند توفر الاتصال.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void loadAdmission()} variant="secondary" /></View> : null}
      {admissionActionability === "available" && (!caseId || Boolean(createdCase)) ? <>
        <View style={styles.card}>
        <Text style={styles.sectionTitle}>بيانات المالك</Text>
        <Text style={styles.label}>الاسم الكامل للمالك حسب الهوية</Text>
        <TextInput accessibilityLabel="الاسم الكامل للمالك حسب الهوية" editable={!formLocked} autoComplete="name" placeholder="كما يظهر في الهوية" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.ownerFullName} onChangeText={(value) => setInput((current) => ({ ...current, ownerFullName: value }))} />
        <Text style={styles.label}>المحفظة الرسمية</Text>
        <Text style={styles.muted}>اختر المحفظة التي يستخدمها المالك. لا تُدخل رقم المحفظة هنا.</Text>
        {walletProvidersLoading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المحافظ الرسمية…</Text></View> : null}
        {walletProvidersError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{walletProvidersError}</Text><BthwaniButton disabled={formLocked} label="إعادة قراءة المحافظ" onPress={() => void loadWalletProviders()} variant="secondary" /></View> : null}
        {!walletProvidersLoading && !walletProvidersError && walletProviders.filter((provider) => provider.active).length === 0 ? <Text style={styles.muted}>لا توجد محافظ رسمية نشطة للاختيار الآن.</Text> : null}
        {!walletProvidersLoading && !walletProvidersError && walletProviders.filter((provider) => provider.active).length > 0 ? <View accessibilityLabel="اختيار المحفظة الرسمية" accessibilityRole="radiogroup" style={styles.optionList}>
          {walletProviders.filter((provider) => provider.active).map((provider) => <BthwaniChip key={provider.key} accessibilityRole="radio" accessibilityState={{ selected: input.walletProviderKey === provider.key, disabled: formLocked }} disabled={formLocked} label={provider.displayNameAr} onPress={() => { setInput((current) => ({ ...current, walletProviderKey: provider.key })); setError(""); }} selected={input.walletProviderKey === provider.key} />)}
        </View> : null}
        {input.walletProviderKey && !walletProviders.some((provider) => provider.key === input.walletProviderKey) ? <Text style={styles.muted}>القيمة المحفوظة سابقًا: {input.walletProviderKey}. اختر محفظة نشطة لتحديث المسودة.</Text> : null}
        <Text style={styles.label}>رقم جوال المالك</Text>
        <TextInput accessibilityLabel="رقم جوال المالك" editable={!formLocked} autoCapitalize="none" keyboardType="phone-pad" placeholder="مثال: 777123456 أو +967777123456" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={input.contactPhoneE164} onChangeText={(value) => setInput((current) => ({ ...current, contactPhoneE164: value }))} />
        </View>
        <View style={styles.card}>
        <Text style={styles.sectionTitle}>النشاط والمتجر الأول</Text>
        <Text style={styles.label}>{sameBusinessAndStore ? "الاسم التجاري واسم المتجر" : "الاسم التجاري"}</Text>
        <Text style={styles.muted}>الاسم التجاري هو اسم المنشأة أو النشاط كما يستخدمه المالك، وليس اسمًا عامًا للشريك.</Text>
        <TextInput accessibilityLabel={sameBusinessAndStore ? "الاسم التجاري واسم المتجر" : "الاسم التجاري"} editable={!formLocked} placeholder={sameBusinessAndStore ? "الاسم الذي يستخدمه المتجر" : "اسم المنشأة أو النشاط"} placeholderTextColor={theme.colorMuted} style={styles.input} value={sameBusinessAndStore ? input.firstStoreName : input.businessName} onChangeText={(value) => setInput((current) => sameBusinessAndStore ? ({ ...current, businessName: value, firstStoreName: value }) : ({ ...current, businessName: value }))} />
        <View style={styles.optionList}>
          <BthwaniChip disabled={formLocked} label="الاسم التجاري مختلف عن اسم المتجر" onPress={() => setSameBusinessAndStore(false)} selected={!sameBusinessAndStore} />
          <BthwaniChip disabled={formLocked} label="الاسم التجاري هو اسم المتجر نفسه" onPress={() => {
            setSameBusinessAndStore(true);
            setInput((current) => {
              const storeName = current.firstStoreName.trim() || current.businessName;
              return { ...current, businessName: storeName, firstStoreName: storeName };
            });
          }} selected={sameBusinessAndStore} />
        </View>
        {!sameBusinessAndStore ? <>
          <Text style={styles.label}>اسم المتجر الأول</Text>
          <TextInput accessibilityLabel="اسم المتجر الأول" editable={!formLocked} placeholder="الاسم الظاهر على واجهة المتجر" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreName} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreName: value }))} />
        </> : null}
        </View>
        <View style={styles.card}>
        <Text style={styles.sectionTitle}>مدينة الخدمة وموقع المتجر</Text>
        <Text style={styles.label}>مدينة الخدمة</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة المدن المتاحة…</Text> : null}
        {optionsError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{optionsError}</Text><BthwaniButton label="إعادة قراءة الخيارات" onPress={() => void loadOptions()} variant="secondary" /></View> : null}
        {!optionsLoading && !optionsError && cities.length === 0 ? <Text style={styles.error}>لا توجد مدينة خدمة متاحة حاليًا.</Text> : null}
        <View style={styles.optionList}>{cities.map((city) => <BthwaniChip key={city.id} label={city.displayNameAr} onPress={() => { if (!formLocked) setInput((current) => ({ ...current, serviceCityId: city.id })); }} selected={input.serviceCityId === city.id} />)}</View>
        <Text style={styles.label}>النشاط التجاري</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
        {!optionsLoading && !optionsError && verticals.length === 0 ? <Text style={styles.error}>لا يوجد نشاط تجاري متاح حاليًا.</Text> : null}
        <View style={styles.optionList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} label={vertical.nameAr} onPress={() => { if (!formLocked) setInput((current) => ({ ...current, firstStoreVerticalId: vertical.id })); }} selected={input.firstStoreVerticalId === vertical.id} />)}</View>
        <Text style={styles.label}>نوع المتجر التجاري</Text>
        {commercialTypesLoading ? <Text style={styles.muted}>جارٍ قراءة أنواع المتاجر لهذه الفئة…</Text> : null}
        {commercialTypesError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{commercialTypesError}</Text><BthwaniButton label="إعادة قراءة أنواع المتاجر" onPress={() => { const verticalId = input.firstStoreVerticalId; if (verticalId) { setCommercialTypesError(""); setCommercialTypesLoading(true); void fieldClient().listCommercialStoreTypes(verticalId).then((items) => setCommercialTypes(items.filter((item) => item.active))).catch(() => setCommercialTypesError("تعذر قراءة أنواع المتاجر لهذه الفئة.")).finally(() => setCommercialTypesLoading(false)); } }} variant="secondary" /></View> : null}
        {!commercialTypesLoading && !commercialTypesError && input.firstStoreVerticalId && commercialTypes.length === 0 ? <Text style={styles.muted}>لا توجد أنواع متاجر مفعّلة لهذه الفئة. اطلب من المشغّل إعداد النوع التجاري أولًا.</Text> : null}
        <View style={styles.optionList}>{commercialTypes.map((item) => <BthwaniChip key={item.id} disabled={formLocked} label={item.nameAr} onPress={() => setInput((current) => ({ ...current, firstStoreCommercialTypeId: item.id }))} selected={input.firstStoreCommercialTypeId === item.id} />)}</View>
        </View>
        <View style={styles.card}>
        <Text style={styles.sectionTitle}>بيانات الإثبات</Text>
        <Text style={styles.label}>نوع الإثبات</Text>
        <View style={styles.optionList}>{proofTypeOptions.map((option) => <BthwaniChip key={option.value} disabled={formLocked} label={option.label} onPress={() => setSelectedProofType(option.value)} selected={selectedProofType === option.value} />)}</View>
        <Text style={styles.label}>{createdCase?.case.firstStoreProofType ? "رقم الإثبات · اختياري عند التعديل" : "رقم الإثبات"}</Text>
        {createdCase?.case.firstStoreProofType ? <Text style={styles.muted}>الرقم المسجل خاص ولا يظهر هنا. أدخل رقمًا جديدًا عند الحاجة إلى تصحيحه، أو اترك الحقل فارغًا للاحتفاظ به.</Text> : null}
        <TextInput accessibilityLabel="رقم الإثبات، اتركه فارغًا للاحتفاظ بالرقم المسجل عند التعديل" editable={!formLocked} autoCapitalize="characters" placeholder={createdCase?.case.firstStoreProofType ? "رقم جديد فقط عند التصحيح" : "أدخل رقم السجل أو الوثيقة"} placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreProofNumber} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreProofNumber: value }))} />
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>صورة الإثبات الخاصة · مطلوبة قبل الإرسال</Text>
          <Text style={styles.muted}>{createdCase?.case.firstStoreProofImageUploaded ? "صورة الإثبات الخاصة مسجلة ومشفّرة ولا تظهر كصورة واجهة للمتجر." : "تُخزّن مشفّرة في السجل الخاص ولا تظهر كصورة واجهة للمتجر. يُسمح بحفظ المسودة قبل الرفع، لكن الإرسال للمراجعة يتطلب تأكيد ربط الصورة."}</Text>
          {proofImage ? <Image accessibilityLabel="معاينة صورة الإثبات الخاصة" source={{ uri: proofImage.uri }} style={{ borderRadius: 12, height: 160, width: "100%" }} resizeMode="contain" /> : null}
          <BthwaniButton disabled={formLocked} label={proofImage ? "تغيير صورة الإثبات" : "اختيار صورة الإثبات"} onPress={() => void pickProofImage()} variant="secondary" />
        </View>
        <View style={styles.card}>
        <Text style={styles.sectionTitle}>التوصيل المتاح</Text>
        <Text style={styles.label}>أوضاع الطلب التي اختارها الشريك عند الانضمام</Text>
        <Text style={styles.muted}>سجّل الأوضاع المتاحة في المتجر لأول مرة. بعد إنشاء المتجر لا يغيّرها الشريك من التطبيق؛ يديرها المشغّل من لوحة التحكم.</Text>
        <View style={styles.optionList}>
          <BthwaniChip label="توصيل بثواني · مسؤولية المنصة" onPress={() => { if (!formLocked) toggleFulfillmentMode("BTHWANI_CAPTAIN"); }} selected={input.firstStoreFulfillmentModes.includes("BTHWANI_CAPTAIN")} />
          <BthwaniChip label="توصيل المتجر · كابتن المتجر" onPress={() => { if (!formLocked) toggleFulfillmentMode("PARTNER_CAPTAIN"); }} selected={input.firstStoreFulfillmentModes.includes("PARTNER_CAPTAIN")} />
          <BthwaniChip label="استلم بنفسك من المتجر" onPress={() => { if (!formLocked) toggleFulfillmentMode("CUSTOMER_PICKUP"); }} selected={input.firstStoreFulfillmentModes.includes("CUSTOMER_PICKUP")} />
        </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>عنوان المتجر وموقعه</Text>
          <Text style={styles.muted}>حدد موقع المتجر على الخريطة أو استخدم موقعك الحالي كنقطة بداية، ثم اضبط المؤشر على المتجر.</Text>
          <BthwaniButton busy={locationBusy} disabled={formLocked} label="استخدام موقعي الحالي" onPress={() => void requestCurrentLocation()} variant="secondary" />
          {locationMessage ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{locationMessage}</Text> : null}
          {locationError ? <Text accessibilityRole="alert" style={styles.error}>{locationError}</Text> : null}
          <View style={{ flexDirection: wideLayout ? "row" : "column", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}><BthwaniMap accessibilityLabel="تحديد موقع المتجر على الخريطة" selection={selectedStoreOrigin} selectionTitle="موقع المتجر" onSelectCoordinate={(coordinate) => { if (!formLocked) { setSelectedStoreOrigin(coordinate); setLocationMessage(""); setLocationError(""); setError(""); } }} /></View>
            <View style={{ flex: 1, gap: 8, minWidth: 0 }}><Text style={styles.label}>العنوان النصي</Text><TextInput accessibilityLabel="عنوان المتجر" editable={!formLocked} multiline placeholder="الحي، الشارع، وأقرب معلم" placeholderTextColor={theme.colorMuted} style={[styles.input, { minHeight: 120, paddingTop: 12, textAlignVertical: "top" }]} value={input.firstStoreAddress} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreAddress: value }))} /><Text style={styles.muted}>{selectedStoreOrigin ? `الإحداثيات المحددة: ${selectedStoreOrigin.latitude.toFixed(5)}, ${selectedStoreOrigin.longitude.toFixed(5)}` : "لم يُحدد موقع على الخريطة بعد."}</Text></View>
          </View>
        </View>
        <Text style={styles.sectionTitle}>ساعات العمل الأسبوعية</Text>
        <FieldWorkingHoursEditor disabled={formLocked} onChange={setWorkingHoursByDay} value={workingHoursByDay} />
        <View style={styles.card}>
        <Text style={styles.sectionTitle}>ملاحظات</Text>
        <Text style={styles.label}>ملاحظات · اختياري</Text>
        <TextInput accessibilityLabel="ملاحظات اختيارية" editable={!formLocked} multiline maxLength={1000} placeholder="أي تفاصيل إضافية للمراجعة" placeholderTextColor={theme.colorMuted} style={[styles.input, { minHeight: 88, paddingTop: 12, textAlignVertical: "top" }]} value={input.firstStoreNotes ?? ""} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreNotes: value }))} />
        </View>
        <View style={styles.card}>
        <Text style={styles.sectionTitle}>صورة الواجهة وحق استخدامها</Text>
        <Text style={styles.label}>صورة واجهة المتجر · مطلوبة قبل الإرسال</Text>
        <Text style={styles.muted}>اختر صورة واضحة للواجهة. تُرفع مركزيًا وتظهر بعد اعتماد المتجر؛ حفظ المسودة ممكن قبل رفعها، لكن لا تُرسل للمراجعة حتى تكتمل.</Text>
        {storeImage ? <Image accessibilityLabel="معاينة صورة المتجر" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 160, width: "100%" }} resizeMode="cover" /> : null}
        {storeImage ? <FieldMediaProvenanceEditor disabled={formLocked} onChange={(provenance) => setStoreImage((current) => current ? { ...current, provenance } : null)} value={storeImage.provenance} /> : null}
        <View style={styles.optionList}>
          <BthwaniButton disabled={formLocked} label={storeImage ? "اختيار صورة أخرى من الجهاز" : "اختيار صورة من الجهاز"} onPress={() => void pickStoreImage("library")} variant="secondary" />
          <BthwaniButton disabled={formLocked} label="التقاط صورة بالكاميرا" onPress={() => void pickStoreImage("camera")} variant="secondary" />
        </View>
        <Text style={styles.muted}>حفظ المسودة لا يرسلها للمراجعة. أكمِل صورتي الواجهة والإثبات أولًا.</Text>
        {draftConflictNeedsRead ? <BthwaniButton busy={busy} disabled={busy} label="إعادة قراءة النسخة الأحدث قبل الحفظ" onPress={() => void rereadAfterDraftConflict()} variant="secondary" /> : null}
        <BthwaniButton busy={busy} disabled={busy || draftConflictNeedsRead || (!pendingDraftAttempt && formLocked)} label={pendingDraftAttempt ? "إعادة التحقق من حفظ المسودة" : draftConflict ? "حفظ مدخلاتي واستبدال النسخة الأحدث" : createdCase ? "حفظ التعديلات" : "حفظ المسودة"} onPress={() => void createCase()} />
        </View>
      </> : null}
      {createdCase ? <View accessibilityLiveRegion="polite" style={styles.successCard}>
        <Text style={styles.cardTitle}>حُفظت مسودة الشريك</Text>
        <Text style={styles.muted}>{createdCase.case.businessName} · {createdCase.case.firstStoreName}</Text>
        <Text style={styles.successText}>الحالة: {joiningCaseStateLabel(createdCase.case.state)} · لم يُرسل للمراجعة</Text>
        <Text style={createdCase.case.storeProfileImage ? styles.successText : styles.error}>{createdCase.case.storeProfileImage ? "صورة واجهة المتجر مرفوعة." : "مطلوب قبل الإرسال: اختيار صورة واجهة المتجر ورفعها."}</Text>
        <Text style={createdCase.case.firstStoreProofImageUploaded ? styles.successText : styles.error}>{createdCase.case.firstStoreProofImageUploaded ? "صورة الإثبات الخاصة مسجلة." : "مطلوب قبل الإرسال: رفع صورة الإثبات الخاصة عبر المسار الآمن."}</Text>
        {!createdCase.case.firstStoreProofImageUploaded ? <>
          {proofImage ? <Image accessibilityLabel="معاينة صورة الإثبات المختارة" source={{ uri: proofImage.uri }} style={{ borderRadius: 12, height: 160, width: "100%" }} resizeMode="contain" /> : null}
          <BthwaniButton disabled={busy || Boolean(pendingProofImageAttempt)} label={proofImage ? "تغيير صورة الإثبات" : "اختيار صورة الإثبات"} onPress={() => void pickProofImage()} variant="secondary" />
          {proofImage ? <BthwaniButton busy={busy} disabled={busy} label={pendingProofImageAttempt ? "إعادة التحقق من رفع صورة الإثبات" : "رفع صورة الإثبات المشفّرة"} onPress={() => void retryProofImage()} variant="primary" /> : null}
        </> : null}
        {storeImage ? <>
          <Image accessibilityLabel="معاينة صورة المتجر التي لم يكتمل رفعها" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 120, width: "100%" }} resizeMode="cover" />
          <BthwaniButton disabled={busy || Boolean(pendingImageAttempt)} label="اختيار صورة أخرى" onPress={() => void pickStoreImage()} variant="secondary" />
          <BthwaniButton busy={busy} disabled={busy} label={pendingImageAttempt ? "إعادة التحقق من رفع الصورة" : "إعادة رفع صورة المتجر"} onPress={() => void retryStoreImage()} variant="secondary" />
        </> : null}
        <Link href={"/cases" as Href} asChild><BthwaniButton label="فتح قائمة الشركاء" variant="secondary" /></Link>
      </View> : null}
      {error ? <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text>{pendingDraftAttempt || error.startsWith("يوجد طلب نشط") ? <Link href={"/cases" as Href} asChild><BthwaniButton label="فتح قائمة الشركاء" variant="secondary" /></Link> : null}</View> : null}
      <BthwaniButton busy={busy} disabled={busy || admissionState.kind === "loading"} label="تحديث حالة التفعيل" onPress={() => void loadAdmission()} variant="secondary" />
    </View>
  );
}
