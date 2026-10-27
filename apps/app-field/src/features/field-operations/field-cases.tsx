import { BthwaniButton, BthwaniConfirmDialog, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type DshImageUploadInput, isMediaProvenanceInputValid, type JoiningCaseResponse, type JoiningCaseSummary, type JoiningCaseView, joiningCaseStateLabel, type MediaProvenanceInput, resolveJoiningCaseImageContentType } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Text, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { fieldClient, isMissingFieldAdmission } from "./field-client";
import { FieldCommercialAgreement } from "./field-commercial-agreement";
import { fieldDraftMediaUploadConfirmed, fieldSubmitIdempotencyPayload, markFieldMediaReadbackUncertain, submitFieldCaseWithReadback } from "./field-draft-readback";
import { fieldJoiningImageDimensionsSupported } from "./field-image-dimensions";
import { getFieldJoiningRequirements } from "./field-joining-readiness";
import { FieldMediaProvenanceEditor } from "./field-media-provenance-editor";
import { createFieldOperationStyles } from "./field-operation-styles";
import { prepareFieldPublicStoreImage } from "./field-store-image-preparation";
import { fieldStoreImageProvenance } from "./field-store-image-provenance";

const FIELD_CASE_PAGE_SIZE = 25;

function missingFieldIntake(caseData: JoiningCaseView): string[] {
  return getFieldJoiningRequirements(caseData).filter((item) => !item.saved).map((item) => item.label);
}

type StoreImageDraft = DshImageUploadInput & Readonly<{ provenance: MediaProvenanceInput; source: "camera" | "library" }>;
type PendingStoreImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: StoreImageDraft; idempotencyKey: string; correlationID: string }>;
type PendingInternalPhotoAttempt = Readonly<{ caseID: string; expectedVersion: number; image: DshImageUploadInput; idempotencyKey: string; correlationID: string }>;
type FieldCasePagination = { sequence: number; query: string; cursor: string; loadingMore: boolean };

function fieldCaseDisplayName(item: Pick<JoiningCaseSummary, "businessName" | "firstStoreName">): string {
  const businessName = item.businessName.trim();
  const firstStoreName = item.firstStoreName.trim();
  if (!businessName) return firstStoreName;
  if (!firstStoreName || businessName.toLocaleLowerCase("ar") === firstStoreName.toLocaleLowerCase("ar")) return businessName;
  return `${businessName} · ${firstStoreName}`;
}

function isOutcomeUncertain(cause: unknown): boolean {
  if (cause instanceof Error && (cause.message === "FIELD_MEDIA_UPLOAD_CANONICAL_READBACK_MISMATCH" || cause.message === "FIELD_MEDIA_UPLOAD_CANONICAL_READBACK_UNAVAILABLE")) return true;
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { kind?: unknown; status?: unknown };
  return error.kind === "network" || (error.kind === "http" && typeof error.status === "number" && error.status >= 500);
}

function dshErrorCode(cause: unknown): string {
  if (!cause || typeof cause !== "object") return "";
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

async function fieldCaseSubmitIdentity(caseID: string, expectedVersion: number) {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, fieldSubmitIdempotencyPayload(caseID, expectedVersion));
  return { idempotencyKey: `field_submit_${digest}`, correlationID: `field_submit_corr_${digest}` };
}

export function FieldCases() {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { q: rawQuery, caseId: rawCaseId, mediaWarning: rawMediaWarning } = useLocalSearchParams<{ q?: string | string[]; caseId?: string | string[]; mediaWarning?: string | string[] }>();
  const routeQuery = (Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "").slice(0, 128);
  const routeCaseId = (Array.isArray(rawCaseId) ? rawCaseId[0] ?? "" : rawCaseId ?? "").trim().slice(0, 128);
  const optionalMediaWarning = Boolean(routeCaseId) && (Array.isArray(rawMediaWarning) ? rawMediaWarning[0] : rawMediaWarning) === "1";
  const [appliedQuery, setAppliedQuery] = useState(routeQuery.trim());
  const [cases, setCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [missingAdmission, setMissingAdmission] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [paginationError, setPaginationError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedCase, setSelectedCase] = useState<JoiningCaseSummary | null>(null);
  const [caseSelectionError, setCaseSelectionError] = useState("");
  const [selectionRetry, setSelectionRetry] = useState(0);
  const [mediaCase, setMediaCase] = useState<JoiningCaseResponse | null>(null);
  const [storeImage, setStoreImage] = useState<StoreImageDraft | null>(null);
  const [storeImageRole, setStoreImageRole] = useState<"primary" | "cover">("primary");
  const [pendingImageAttempt, setPendingImageAttempt] = useState<PendingStoreImageAttempt | null>(null);
  const [internalPhotoDraft, setInternalPhotoDraft] = useState<DshImageUploadInput | null>(null);
  const [pendingInternalPhoto, setPendingInternalPhoto] = useState<PendingInternalPhotoAttempt | null>(null);
  const [caseToSubmit, setCaseToSubmit] = useState<JoiningCaseSummary | null>(null);
  const [agreementCaseID, setAgreementCaseID] = useState<string | null>(null);
  const pagination = useRef<FieldCasePagination>({ sequence: 0, query: routeQuery.trim(), cursor: "", loadingMore: false });
  const initialIdentity = currentIdentityState();
  const actorScope = useRef({ subject: initialIdentity.kind === "authenticated" ? initialIdentity.identity.subject : "", revision: 0 });
  const [actorRevision, setActorRevision] = useState(0);

  useEffect(() => subscribeIdentitySession((state) => {
    const subject = state.kind === "authenticated" ? state.identity.subject : "";
    if (actorScope.current.subject === subject) return;
    actorScope.current = { subject, revision: actorScope.current.revision + 1 };
    setActorRevision((current) => current + 1);
    pagination.current.sequence += 1;
    pagination.current.cursor = "";
    pagination.current.loadingMore = false;
    setCases([]);
    setNextCursor("");
    setSelectedCase(null);
    setMediaCase(null);
    setStoreImage(null);
    setInternalPhotoDraft(null);
    setPendingImageAttempt(null);
    setPendingInternalPhoto(null);
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setPaginationError("");
    setCaseSelectionError("");
    setCaseToSubmit(null);
    setAgreementCaseID(null);
    setBusy("");
    setNotice("");
  }), []);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(routeQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [routeQuery]);

  const load = useCallback(async () => {
    const revision = actorRevision;
    const sequence = pagination.current.sequence + 1;
    const retainedCursor = pagination.current.query === appliedQuery ? pagination.current.cursor : "";
    pagination.current = { sequence, query: appliedQuery, cursor: retainedCursor, loadingMore: false };
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setPaginationError("");
    setNotice("");
    setMissingAdmission(false);
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().listOwnFieldJoiningCases(token, FIELD_CASE_PAGE_SIZE, appliedQuery);
      if (pagination.current.sequence !== sequence || actorScope.current.revision !== revision) return;
      setCases(response.cases);
      pagination.current.cursor = response.nextCursor ?? "";
      setNextCursor(pagination.current.cursor);
      setMissingAdmission(false);
    } catch (cause) {
      if (pagination.current.sequence !== sequence || actorScope.current.revision !== revision) return;
      if (isMissingFieldAdmission(cause)) {
        setCases([]);
        pagination.current.cursor = "";
        setNextCursor("");
        setMissingAdmission(true);
        return;
      }
      console.warn("DSH Field cases readback failed", cause);
      setError("تعذر قراءة قائمة الشركاء. أعد المحاولة.");
    } finally {
      if (pagination.current.sequence === sequence && actorScope.current.revision === revision) setLoading(false);
    }
  }, [appliedQuery, actorRevision]);

  // Returning from the draft editor or another actor handoff must re-read the
  // canonical queue without requiring Field to press a routine refresh button.
  useFocusEffect(useCallback(() => {
    if (pagination.current.query !== appliedQuery) {
      setCases([]);
      pagination.current.cursor = "";
      setNextCursor("");
    }
    void load();
    return () => { pagination.current.sequence += 1; };
  }, [appliedQuery, load]));

  useEffect(() => {
    if (!routeCaseId) {
      setSelectedCase(null);
      setCaseSelectionError("");
      return;
    }
    let active = true;
    const revision = actorRevision;
    const subject = actorScope.current.subject;
    setSelectedCase(null);
    setCaseSelectionError("");
    if (selectionRetry > 0) setNotice("");
    void (async () => {
      try {
        const token = await getUsableIdentityAccessToken();
        const response = await fieldClient().readOwnFieldJoiningCase(token, routeCaseId);
        if (!active || actorScope.current.revision !== revision || actorScope.current.subject !== subject || !subject) return;
        const item = response.case;
        setSelectedCase({
          id: item.id,
          contactPhoneE164: item.contactPhoneE164,
          businessName: item.businessName,
          firstStoreName: item.firstStoreName,
          walletProviderKey: item.walletProviderKey,
          serviceCityId: item.serviceCityId,
          firstStoreVerticalId: item.firstStoreVerticalId,
          ...(item.firstStoreCommercialTypeId !== undefined ? { firstStoreCommercialTypeId: item.firstStoreCommercialTypeId } : {}),
          firstStoreLatitude: item.firstStoreLatitude,
          firstStoreLongitude: item.firstStoreLongitude,
          origin: item.origin,
          ...(item.partnerActorId !== undefined ? { partnerActorId: item.partnerActorId } : {}),
          state: item.state,
          ...(item.correctionReason !== undefined ? { correctionReason: item.correctionReason } : {}),
          ...(item.reviewedBy !== undefined ? { reviewedBy: item.reviewedBy } : {}),
          version: item.version,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        });
      } catch (cause) {
        if (!active || actorScope.current.revision !== revision || actorScope.current.subject !== subject || !subject) return;
        console.warn("DSH Field notification case readback failed", cause);
        setCaseSelectionError("تعذر فتح الطلب المرتبط بالتنبيه. أعد المحاولة أو حدّث القائمة.");
      }
    })();
    return () => { active = false; };
  }, [routeCaseId, selectionRetry, actorRevision]);

  const loadMore = useCallback(async () => {
    const current = pagination.current;
    if (loading || !current.cursor || current.loadingMore || current.query !== appliedQuery) return;
    const sequence = current.sequence;
    const revision = actorScope.current.revision;
    const requestedCursor = current.cursor;
    current.loadingMore = true;
    setLoadingMore(true);
    setPaginationError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().listOwnFieldJoiningCases(token, FIELD_CASE_PAGE_SIZE, appliedQuery, requestedCursor);
      if (pagination.current.sequence !== sequence || pagination.current.cursor !== requestedCursor || actorScope.current.revision !== revision) return;
      setCases((previous) => {
        const knownIDs = new Set(previous.map((item) => item.id));
        return [...previous, ...response.cases.filter((item) => !knownIDs.has(item.id))];
      });
      pagination.current.cursor = response.nextCursor ?? "";
      setNextCursor(pagination.current.cursor);
    } catch (cause) {
      if (pagination.current.sequence !== sequence || actorScope.current.revision !== revision) return;
      console.warn("DSH Field cases continuation readback failed", cause);
      setPaginationError("تعذر تحميل بقية الشركاء. أعد المحاولة.");
    } finally {
      if (pagination.current.sequence === sequence) {
        pagination.current.loadingMore = false;
        setLoadingMore(false);
      }
    }
  }, [appliedQuery, loading]);

  const isActiveActor = (snapshot: { subject: string; revision: number }) =>
    Boolean(snapshot.subject) && actorScope.current === snapshot;

  async function submitCase(item: JoiningCaseSummary) {
    if (busy || item.state !== "draft") return;
    const actor = actorScope.current;
    const stillCurrent = () => isActiveActor(actor);
    if (!stillCurrent()) return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const current = await fieldClient().readOwnFieldJoiningCase(token, item.id);
      if (!stillCurrent()) return;
      if (current.case.state !== "draft") {
        await load();
        if (!stillCurrent()) return;
        setNotice("الحالة الحالية للشريك: " + joiningCaseStateLabel(current.case.state) + ".");
        return;
      }
      const missing = missingFieldIntake(current.case);
      if (missing.length > 0) {
        setError(`لا يمكن إرسال المسودة. استكمل: ${missing.join("، ")}. افتح تعديل المسودة لإكمال البيانات.`);
        return;
      }
      const identity = await fieldCaseSubmitIdentity(item.id, current.case.version);
      if (!stillCurrent()) return;
      const outcome = await submitFieldCaseWithReadback(
        item.id,
        () => fieldClient().submitFieldJoiningCase(token, item.id, current.case.version, identity.idempotencyKey, identity.correlationID),
        () => fieldClient().readOwnFieldJoiningCase(token, item.id),
        isOutcomeUncertain,
      );
      if (!stillCurrent()) return;
      await load();
      if (!stillCurrent()) return;
      if (outcome.kind === "confirmed") {
        setNotice("تأكدت حالة طلب الانضمام من المنصة: " + joiningCaseStateLabel(outcome.canonical.case.state) + ".");
      } else if (outcome.kind === "draft") {
        setError("ما تزال حالة الطلب مسودة. تحقق من البيانات قبل إعادة الإرسال بنفس الإصدار.");
      } else {
        setError("تعذر تأكيد إرسال الطلب. أعد قراءة المسودة وحالتها قبل المحاولة مجددًا.");
      }
    } catch (cause) {
      if (!stillCurrent()) return;
      console.warn("DSH Field joining-case submission failed", cause);
      try {
        const token = await getUsableIdentityAccessToken();
        if (!stillCurrent()) return;
        const latest = await fieldClient().readOwnFieldJoiningCase(token, item.id);
        if (!stillCurrent()) return;
        await load();
        if (!stillCurrent()) return;
        if (latest.case.state === "draft") setError("لم يتأكد الإرسال. أعد المحاولة؛ سنحدّث الحالة قبل الإرسال.");
        else setError("تغيّرت حالة الطلب؛ لا يمكن اعتماد فشل الإرسال كدليل على نجاحه. الحالة الحالية: " + joiningCaseStateLabel(latest.case.state) + ".");
      } catch (readError) {
        if (!stillCurrent()) return;
        console.warn("DSH Field joining-case submit recovery readback failed", readError);
        setError("تعذر تأكيد الإرسال. حدّث قائمة الشركاء قبل المحاولة مجددًا.");
      }
    } finally {
      if (stillCurrent()) setBusy("");
    }
  }

  async function openStoreImage(item: JoiningCaseSummary) {
    if (busy || storeImage || pendingImageAttempt || pendingInternalPhoto || item.state !== "draft") return;
    const revision = actorScope.current.revision;
    const subject = actorScope.current.subject;
    if (!subject) return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const current = await fieldClient().readOwnFieldJoiningCase(token, item.id);
      if (actorScope.current.revision !== revision || actorScope.current.subject !== subject) return;
      setMediaCase(current);
      setStoreImage(null);
      setInternalPhotoDraft(null);
    } catch (cause) {
      if (actorScope.current.revision !== revision || actorScope.current.subject !== subject) return;
      console.warn("DSH Field joining-case media readback failed", cause);
      setError("تعذر قراءة صورة المتجر الآن. أعد المحاولة.");
    } finally {
      if (actorScope.current.revision === revision && actorScope.current.subject === subject) setBusy("");
    }
  }

  async function pickStoreImage(source: "camera" | "library" = "library") {
    if (!mediaCase || busy || pendingImageAttempt) return;
    const actor = actorScope.current;
    const stillCurrent = () => isActiveActor(actor);
    if (!stillCurrent()) return;
    const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!stillCurrent()) return;
    if (!permission.granted) { setError(source === "camera" ? "يلزم السماح باستخدام الكاميرا لالتقاط صورة المتجر." : "يلزم السماح بالوصول إلى الصور لاختيار شعار المتجر."); return; }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!stillCurrent() || result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    try {
      const image = await prepareFieldPublicStoreImage(asset);
      if (!stillCurrent()) return;
      setStoreImage({ ...image, source, provenance: fieldStoreImageProvenance(source, mediaCase.case.ownerFullName ?? "") });
      setError("");
    } catch (cause) {
      if (!stillCurrent()) return;
      console.warn("Field store image preparation failed", cause);
      setError(cause instanceof Error && cause.message === "STORE_IMAGE_SIZE_INVALID" ? "يجب ألا يتجاوز حجم صورة المتجر 10 ميغابايت." : cause instanceof Error && cause.message === "STORE_IMAGE_DIMENSIONS_INVALID" ? "يجب أن تكون أبعاد صورة المتجر بين 1 و6000 بكسل للعرض والارتفاع." : cause instanceof Error && cause.message === "STORE_IMAGE_TYPE_INVALID" ? "صيغة صورة المتجر غير مدعومة. اختر صورة بصيغة JPG أو PNG." : "تعذر تجهيز صورة المتجر. اختر الصورة مرة أخرى.");
    }
  }

  async function pickInternalStorePhoto() {
    if (!mediaCase || busy || pendingInternalPhoto) return;
    const actor = actorScope.current;
    const stillCurrent = () => isActiveActor(actor);
    if (!stillCurrent()) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!stillCurrent()) return;
    if (!permission.granted) { setError("يلزم السماح بالوصول إلى الصور لاختيار صورة ميدانية."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!stillCurrent() || result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    try {
      if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) throw new Error("STORE_IMAGE_SIZE_INVALID");
      if (!fieldJoiningImageDimensionsSupported(asset.width, asset.height)) throw new Error("STORE_IMAGE_DIMENSIONS_INVALID");
      const response = await fetch(asset.uri);
      if (!stillCurrent()) return;
      if (!response.ok) throw new Error("STORE_IMAGE_READ_FAILED");
      const blob = await response.blob();
      if (!stillCurrent()) return;
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("STORE_IMAGE_SIZE_INVALID");
      const type = resolveJoiningCaseImageContentType(asset.mimeType, blob.type, asset.fileName, asset.uri);
      if (!type) throw new Error("STORE_IMAGE_TYPE_INVALID");
      setInternalPhotoDraft({ uri: asset.uri, name: asset.fileName ?? (type === "image/png" ? "premises-photo.png" : "premises-photo.jpg"), type, blob });
      setError("");
    } catch {
      if (!stillCurrent()) return;
      setError("تعذر تجهيز الصورة الميدانية. اختر صورة JPG أو PNG لا تتجاوز 10 ميغابايت.");
    }
  }

  async function uploadInternalStorePhoto() {
    if (!mediaCase || !internalPhotoDraft || busy) return;
    const actor = actorScope.current;
    const stillCurrent = () => isActiveActor(actor);
    if (!stillCurrent()) return;
    const attempt = pendingInternalPhoto ?? { caseID: mediaCase.case.id, expectedVersion: mediaCase.case.version, image: internalPhotoDraft, idempotencyKey: `field_store_private_photo_${Crypto.randomUUID()}`, correlationID: `field_store_private_photo_corr_${Crypto.randomUUID()}` };
    setPendingInternalPhoto(attempt);
    setBusy(attempt.caseID);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const saved = await fieldClient().uploadJoiningCaseStoreInternalPhoto(token, attempt.caseID, attempt.image, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      if (!stillCurrent()) return;
      const canonical = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID).catch((cause: unknown) => { throw markFieldMediaReadbackUncertain(cause); });
      if (!stillCurrent()) return;
      if (saved.case.id !== attempt.caseID || canonical.case.id !== attempt.caseID || canonical.case.version < saved.case.version || saved.case.version <= attempt.expectedVersion) throw new Error("FIELD_INTERNAL_PHOTO_READBACK_MISMATCH");
      setMediaCase(canonical);
      setInternalPhotoDraft(null);
      setPendingInternalPhoto(null);
      setNotice("حُفظت الصورة ضمن ملف المتجر الداخلي. يمكنك إضافة صورة أخرى.");
    } catch (cause) {
      if (!stillCurrent()) return;
      console.warn("Field private store photo upload failed", cause);
      if (isOutcomeUncertain(cause)) setError("لم نتأكد من حفظ الصورة الميدانية بعد. أعد المحاولة للتحقق من حالتها.");
      else { setPendingInternalPhoto(null); setError("تعذر حفظ الصورة الميدانية. أعد المحاولة أو اختر صورة أخرى."); }
    } finally { if (stillCurrent()) setBusy(""); }
  }

  async function uploadStoreImage() {
    if (!mediaCase || !storeImage || busy) return;
    const actor = actorScope.current;
    const stillCurrent = () => isActiveActor(actor);
    if (!stillCurrent()) return;
    if (!isMediaProvenanceInputValid(storeImage.provenance)) {
      setError("أكّد حق عرض صورة الواجهة قبل حفظها.");
      return;
    }
    const attempt = pendingImageAttempt ?? { caseID: mediaCase.case.id, expectedVersion: mediaCase.case.version, image: storeImage, idempotencyKey: `field_store_image_${Crypto.randomUUID()}`, correlationID: `field_store_image_corr_${Crypto.randomUUID()}` };
    setPendingImageAttempt(attempt);
    setBusy(attempt.caseID);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const saved = await fieldClient().uploadJoiningCaseStoreImage(token, attempt.caseID, attempt.image, attempt.image.provenance, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID, storeImageRole);
      if (!stillCurrent()) return;
      const canonical = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID).catch((cause: unknown) => { throw markFieldMediaReadbackUncertain(cause); });
      if (!stillCurrent()) return;
      if (!fieldDraftMediaUploadConfirmed(saved.case, canonical.case, storeImageRole === "cover" ? "cover" : "store", attempt.expectedVersion, attempt.caseID, attempt.image.provenance)) throw new Error("FIELD_MEDIA_UPLOAD_CANONICAL_READBACK_MISMATCH");
      setMediaCase(canonical);
      setStoreImage(null);
      setPendingImageAttempt(null);
      await load();
    } catch (cause) {
      if (!stillCurrent()) return;
      console.warn("DSH Field store image upload failed", cause);
      if (dshErrorCode(cause) === "MEDIA_STORAGE_UNAVAILABLE") {
        setPendingImageAttempt(null);
        setError("تعذر تخزين الصورة. أعد رفع الملف المختار أو اختر صورة أخرى.");
      } else if (isOutcomeUncertain(cause)) {
        setError("لم نتأكد من رفع الصورة بعد. أعد المحاولة للتحقق من حالتها.");
      } else {
        setPendingImageAttempt(null);
        try {
          const token = await getUsableIdentityAccessToken();
          if (!stillCurrent()) return;
          const latest = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID);
          if (!stillCurrent()) return;
          setMediaCase(latest);
        } catch (readError) {
          if (!stillCurrent()) return;
          console.warn("DSH Field store image recovery readback failed", readError);
        }
        setError("لم تُحفظ الصورة. حدّث بيانات الشريك ثم أعد المحاولة.");
      }
    } finally {
      if (stillCurrent()) setBusy("");
    }
  }

  const renderCase = ({ item }: { item: JoiningCaseSummary }) => {
    const selectedByRoute = item.id === routeCaseId;
    let badgeIcon: "edit" | "warning" | "cases";
    let badgeTone: "info" | "warning" | "neutral";
    if (item.state === "draft") {
      badgeIcon = "edit";
      badgeTone = "info";
    } else if (item.state === "needs_correction") {
      badgeIcon = "warning";
      badgeTone = "warning";
    } else {
      badgeIcon = "cases";
      badgeTone = "neutral";
    }

    let storeImageButtonLabel: string;
    if (storeImage) {
      storeImageButtonLabel = "اختيار صورة أخرى";
    } else if (storeImageRole === "cover" ? mediaCase?.case.storeCoverImage : mediaCase?.case.storeProfileImage) {
      storeImageButtonLabel = storeImageRole === "cover" ? "تغيير غلاف المتجر" : "تغيير شعار المتجر";
    } else {
      storeImageButtonLabel = storeImageRole === "cover" ? "اختيار غلاف المتجر" : "اختيار شعار المتجر";
    }

    return (
    <View style={selectedByRoute ? styles.summaryCard : styles.card}>
      {selectedByRoute ? <Text accessibilityLiveRegion="polite" style={styles.cardTitle}>من الإشعار</Text> : null}
      <View style={styles.orderHeader}><Text style={styles.cardTitle}>{fieldCaseDisplayName(item)}</Text><BthwaniStatusBadge icon={badgeIcon} label={joiningCaseStateLabel(item.state)} tone={badgeTone} /></View>
      {item.state === "needs_correction" && item.correctionReason ? <Text style={styles.error}>التصحيح المطلوب: {item.correctionReason}</Text> : null}
      {item.state === "approved" ? <>
        <BthwaniButton disabled={Boolean(busy)} label={agreementCaseID === item.id ? "إخفاء اتفاقية العمولة" : "متابعة اتفاقية العمولة"} onPress={() => setAgreementCaseID((current) => current === item.id ? null : item.id)} variant="secondary" />
        {agreementCaseID === item.id ? <FieldCommercialAgreement caseID={item.id} /> : null}
      </> : null}
      {(item.state === "draft" || item.state === "needs_correction") ? <View style={styles.optionList}>
        <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || Boolean(storeImage) || Boolean(pendingImageAttempt)} label={item.state === "needs_correction" ? "تصحيح وإعادة إرسال" : "تعديل البيانات"} onPress={() => router.push({ pathname: "/new-case", params: { caseId: item.id } } as Href)} variant="secondary" />
        {item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || Boolean(storeImage) || Boolean(pendingImageAttempt)} label="صور المتجر" onPress={() => void openStoreImage(item)} variant="secondary" /> : null}
      </View> : null}
      {item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy)} label="إرسال للمراجعة" onPress={() => setCaseToSubmit(item)} /> : null}
      {mediaCase?.case.id === item.id ? <View style={styles.card}>
        <Text style={styles.cardTitle}>صور واجهة المتجر</Text>
        <View style={styles.optionList}><BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label="الشعار" onPress={() => { setStoreImageRole("primary"); setStoreImage(null); setPendingImageAttempt(null); }} variant={storeImageRole === "primary" ? "primary" : "secondary"} /><BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label="الغلاف" onPress={() => { setStoreImageRole("cover"); setStoreImage(null); setPendingImageAttempt(null); }} variant={storeImageRole === "cover" ? "primary" : "secondary"} /></View>
        {(storeImageRole === "cover" ? mediaCase.case.storeCoverImage : mediaCase.case.storeProfileImage) ? <Image accessibilityLabel={storeImageRole === "cover" ? "غلاف المتجر المحفوظ" : "شعار المتجر المحفوظ"} source={{ uri: (storeImageRole === "cover" ? mediaCase.case.storeCoverImage : mediaCase.case.storeProfileImage)?.uri ?? "" }} style={{ borderRadius: 12, height: storeImageRole === "cover" ? 150 : 100, width: "100%" }} resizeMode="cover" /> : <Text style={styles.muted}>{storeImageRole === "cover" ? "لم يُحفظ غلاف المتجر بعد؛ وهو مطلوب قبل النشر." : "لم يُحفظ شعار المتجر بعد."}</Text>}
        {storeImage ? <Image accessibilityLabel={storeImageRole === "cover" ? "معاينة غلاف المتجر الجديد" : "معاينة شعار المتجر الجديد"} source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 120, width: "100%" }} resizeMode="cover" /> : null}
        {storeImage ? <View style={styles.card}>
          <FieldMediaProvenanceEditor key={storeImage.uri} disabled={Boolean(busy) || Boolean(pendingImageAttempt)} onChange={(provenance) => setStoreImage((current) => current ? { ...current, provenance } : null)} source={storeImage.source} value={storeImage.provenance} />
        </View> : null}
        <View style={styles.optionList}>
          <BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label={storeImageButtonLabel} onPress={() => void pickStoreImage("library")} variant="secondary" />
          <BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label="التقاط صورة بالكاميرا" onPress={() => void pickStoreImage("camera")} variant="secondary" />
        </View>
        {storeImage ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || (!pendingImageAttempt && !isMediaProvenanceInputValid(storeImage.provenance))} label={pendingImageAttempt ? "إعادة التحقق من رفع الصورة" : storeImageRole === "cover" ? "حفظ غلاف المتجر" : "حفظ شعار المتجر"} onPress={() => void uploadStoreImage()} /> : null}
        {storeImage ? <Text style={styles.muted}>يمكن إرسال طلب الانضمام دون حفظ الصور؛ يلزم حفظ الشعار والغلاف قبل نشر المتجر للعملاء.</Text> : null}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>صور ميدانية داخلية (اختيارية)</Text>
          <Text style={styles.muted}>تُحفظ في ملف المتجر للمراجعة الداخلية فقط، ولا تظهر للعملاء أو في واجهة المتجر.</Text>
          {internalPhotoDraft ? <Image accessibilityLabel="معاينة صورة ميدانية داخلية" source={{ uri: internalPhotoDraft.uri }} style={{ borderRadius: 12, height: 120, width: "100%" }} resizeMode="cover" /> : null}
          <View style={styles.optionList}><BthwaniButton disabled={Boolean(busy) || Boolean(pendingInternalPhoto)} label={internalPhotoDraft ? "اختيار صورة أخرى" : "اختيار صورة ميدانية"} onPress={() => void pickInternalStorePhoto()} variant="secondary" />{internalPhotoDraft ? <BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label={pendingInternalPhoto ? "إعادة التحقق من الحفظ" : "حفظ الصورة الداخلية"} onPress={() => void uploadInternalStorePhoto()} /> : null}</View>
        </View>
          <BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label="إغلاق تفاصيل الصورة" onPress={() => { setMediaCase(null); setStoreImage(null); }} variant="secondary" />
      </View> : null}
    </View>
    );
  };

  let emptyMessage: string;
  if (missingAdmission) {
    emptyMessage = "لم يكتمل تفعيل حسابك للميدان بعد. تواصل مع فريق التشغيل.";
  } else if (appliedQuery) {
    emptyMessage = "لا توجد نتائج مطابقة للبحث.";
  } else {
    emptyMessage = "لم تضف شركاء بعد.";
  }

  let paginationFooter = null;
  if (loadingMore) {
    paginationFooter = <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ تحميل بقية الشركاء…</Text></View>;
  } else if (paginationError) {
    paginationFooter = <View style={styles.caseListFooter}><Text accessibilityRole="alert" style={styles.error}>{paginationError}</Text><BthwaniButton disabled={Boolean(busy)} label="تحميل بقية الشركاء مجددًا" onPress={() => void loadMore()} variant="secondary" /></View>;
  } else if (nextCursor) {
    paginationFooter = <View style={styles.caseListFooter}><BthwaniButton disabled={Boolean(busy) || loading} label="تحميل المزيد من الشركاء" onPress={() => void loadMore()} variant="secondary" /></View>;
  }

  return <><FlatList
    accessibilityLabel="الشركاء"
    data={selectedCase ? [selectedCase, ...cases.filter((item) => item.id !== selectedCase.id)] : cases}
    keyExtractor={(item) => item.id}
    keyboardDismissMode="on-drag"
    keyboardShouldPersistTaps="handled"
    ListEmptyComponent={loading
      ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View>
      : <View style={styles.state}><Text style={styles.muted}>{error || emptyMessage}</Text>{error ? <BthwaniButton disabled={Boolean(busy)} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}</View>}
    ListFooterComponent={paginationFooter ?? undefined}
    ListFooterComponentStyle={styles.caseListFooter}
    ListHeaderComponent={Boolean((error && cases.length > 0) || caseSelectionError || optionalMediaWarning || notice) ? <View style={styles.container}>
      {error && cases.length > 0 ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {caseSelectionError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{caseSelectionError}</Text><BthwaniButton label="إعادة فتح الطلب" onPress={() => setSelectionRetry((value) => value + 1)} variant="secondary" /></View> : null}
      {optionalMediaWarning ? <Text accessibilityRole="alert" style={styles.error}>تم إرسال طلب الانضمام وحفظ حالته، لكن لم يُؤكّد رفع بعض الصور الاختيارية. لا تعتبرها محفوظة؛ يمكن استكمال الشعار قبل نشر المتجر بالتنسيق مع فريق التشغيل.</Text> : null}
      {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
    </View> : undefined}
    onRefresh={() => void load()}
    refreshing={loading && cases.length > 0}
    renderItem={renderCase}
    showsVerticalScrollIndicator={false}
    style={styles.caseList}
    contentContainerStyle={styles.caseListContent}
  />
  <BthwaniConfirmDialog
    busy={Boolean(caseToSubmit && busy === caseToSubmit.id)}
    confirmLabel="إرسال للمراجعة"
    description={caseToSubmit ? `سيُرسل طلب «${fieldCaseDisplayName(caseToSubmit)}» للمراجعة ويتوقف تعديله مؤقتًا. الصور اختيارية الآن، ويلزم الشعار والغلاف قبل النشر.` : ""}
    onCancel={() => setCaseToSubmit(null)}
    onConfirm={() => {
      const item = caseToSubmit;
      setCaseToSubmit(null);
      if (item) void submitCase(item);
    }}
    title="إرسال الطلب؟"
    visible={Boolean(caseToSubmit)}
  /></>;
}
