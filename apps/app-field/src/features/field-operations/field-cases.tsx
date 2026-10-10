import { BthwaniButton, BthwaniConfirmDialog, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type DshImageUploadInput, isMediaProvenanceInputValid, type JoiningCaseResponse, type JoiningCaseSummary, type JoiningCaseView, joiningCaseStateLabel, type MediaProvenanceInput, resolveJoiningCaseImageContentType } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Text, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient, isMissingFieldAdmission } from "./field-client";
import { FieldCommercialAgreement } from "./field-commercial-agreement";
import { fieldDraftMediaUploadConfirmed, markFieldMediaReadbackUncertain } from "./field-draft-readback";
import { fieldJoiningImageDimensionsSupported } from "./field-image-dimensions";
import { getFieldJoiningRequirements } from "./field-joining-readiness";
import { FieldMediaProvenanceEditor } from "./field-media-provenance-editor";
import { createFieldOperationStyles } from "./field-operation-styles";
import { fieldStoreImageProvenance } from "./field-store-image-provenance";

const FIELD_CASE_PAGE_SIZE = 25;

function missingFieldIntake(caseData: JoiningCaseView): string[] {
  return getFieldJoiningRequirements(caseData).filter((item) => !item.saved).map((item) => item.label);
}

type StoreImageDraft = DshImageUploadInput & Readonly<{ provenance: MediaProvenanceInput }>;
type WalletProvider = Awaited<ReturnType<ReturnType<typeof fieldClient>["listWalletProviders"]>>["walletProviders"][number];
type PendingStoreImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: StoreImageDraft; idempotencyKey: string; correlationID: string }>;
type FieldCasePagination = { sequence: number; query: string; cursor: string; loadingMore: boolean };

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
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `field-case-submit\u0000${caseID}\u0000${expectedVersion}`);
  return { idempotencyKey: `field_submit_${digest}`, correlationID: `field_submit_corr_${digest}` };
}

export function FieldCases() {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { q: rawQuery, caseId: rawCaseId } = useLocalSearchParams<{ q?: string | string[]; caseId?: string | string[] }>();
  const routeQuery = (Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "").slice(0, 128);
  const routeCaseId = (Array.isArray(rawCaseId) ? rawCaseId[0] ?? "" : rawCaseId ?? "").trim().slice(0, 128);
  const [appliedQuery, setAppliedQuery] = useState(routeQuery.trim());
  const [cases, setCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [walletProviders, setWalletProviders] = useState<ReadonlyArray<WalletProvider>>([]);
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
  const [pendingImageAttempt, setPendingImageAttempt] = useState<PendingStoreImageAttempt | null>(null);
  const [caseToSubmit, setCaseToSubmit] = useState<JoiningCaseSummary | null>(null);
  const pagination = useRef<FieldCasePagination>({ sequence: 0, query: routeQuery.trim(), cursor: "", loadingMore: false });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await getUsableIdentityAccessToken();
        const response = await fieldClient().listWalletProviders(token);
        if (active) setWalletProviders(response.walletProviders);
      } catch (cause) {
        console.warn("DSH Field wallet provider labels read failed", cause);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(routeQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [routeQuery]);

  const load = useCallback(async () => {
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
      if (pagination.current.sequence !== sequence) return;
      setCases(response.cases);
      pagination.current.cursor = response.nextCursor ?? "";
      setNextCursor(pagination.current.cursor);
      setMissingAdmission(false);
    } catch (cause) {
      if (pagination.current.sequence !== sequence) return;
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
      if (pagination.current.sequence === sequence) setLoading(false);
    }
  }, [appliedQuery]);

  useEffect(() => {
    setCases([]);
    pagination.current.cursor = "";
    setNextCursor("");
    void load();
  }, [load]);

  useEffect(() => {
    if (!routeCaseId) {
      setSelectedCase(null);
      setCaseSelectionError("");
      return;
    }
    let active = true;
    setSelectedCase(null);
    setCaseSelectionError("");
    if (selectionRetry > 0) setNotice("");
    void (async () => {
      try {
        const token = await getUsableIdentityAccessToken();
        const response = await fieldClient().readOwnFieldJoiningCase(token, routeCaseId);
        if (!active) return;
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
        if (!active) return;
        console.warn("DSH Field notification case readback failed", cause);
        setCaseSelectionError("تعذر فتح الطلب المرتبط بالتنبيه. أعد المحاولة أو حدّث القائمة.");
      }
    })();
    return () => { active = false; };
  }, [routeCaseId, selectionRetry]);

  const loadMore = useCallback(async () => {
    const current = pagination.current;
    if (loading || !current.cursor || current.loadingMore || current.query !== appliedQuery) return;
    const sequence = current.sequence;
    const requestedCursor = current.cursor;
    current.loadingMore = true;
    setLoadingMore(true);
    setPaginationError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().listOwnFieldJoiningCases(token, FIELD_CASE_PAGE_SIZE, appliedQuery, requestedCursor);
      if (pagination.current.sequence !== sequence || pagination.current.cursor !== requestedCursor) return;
      setCases((previous) => {
        const knownIDs = new Set(previous.map((item) => item.id));
        return [...previous, ...response.cases.filter((item) => !knownIDs.has(item.id))];
      });
      pagination.current.cursor = response.nextCursor ?? "";
      setNextCursor(pagination.current.cursor);
    } catch (cause) {
      if (pagination.current.sequence !== sequence) return;
      console.warn("DSH Field cases continuation readback failed", cause);
      setPaginationError("تعذر تحميل بقية الشركاء. أعد المحاولة.");
    } finally {
      if (pagination.current.sequence === sequence) {
        pagination.current.loadingMore = false;
        setLoadingMore(false);
      }
    }
  }, [appliedQuery, loading]);

  async function submitCase(item: JoiningCaseSummary) {
    if (busy || item.state !== "draft" || storeImage || pendingImageAttempt) return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const current = await fieldClient().readOwnFieldJoiningCase(token, item.id);
      if (current.case.state !== "draft") {
        await load();
        setNotice("الحالة الحالية للشريك: " + joiningCaseStateLabel(current.case.state) + ".");
        return;
      }
      const missing = missingFieldIntake(current.case);
      if (missing.length > 0) {
        setError(`لا يمكن إرسال المسودة. استكمل: ${missing.join("، ")}. افتح تعديل المسودة لإكمال البيانات.`);
        return;
      }
      const identity = await fieldCaseSubmitIdentity(item.id, current.case.version);
      await fieldClient().submitFieldJoiningCase(token, item.id, current.case.version, identity.idempotencyKey, identity.correlationID);
      const canonical = await fieldClient().readOwnFieldJoiningCase(token, item.id);
      await load();
      if (canonical.case.state === "draft") {
        setError("تم إرسال الطلب لكن القراءة المعتمدة ما تزال مسودة. أعد القراءة قبل المحاولة مجددًا.");
        return;
      }
      setNotice("وصل طلب الانضمام إلى طابور قبول المشغّل وتم تأكيد حالته من القراءة المعتمدة.");
    } catch (cause) {
      console.warn("DSH Field joining-case submission failed", cause);
      try {
        const token = await getUsableIdentityAccessToken();
        const latest = await fieldClient().readOwnFieldJoiningCase(token, item.id);
        await load();
        if (latest.case.state === "draft") setError("لم يتأكد الإرسال. أعد المحاولة؛ سنحدّث الحالة قبل الإرسال.");
        else setNotice("أُرسل الطلب للمراجعة. الحالة الحالية: " + joiningCaseStateLabel(latest.case.state) + ".");
      } catch (readError) {
        console.warn("DSH Field joining-case submit recovery readback failed", readError);
        setError("تعذر تأكيد الإرسال. حدّث قائمة الشركاء قبل المحاولة مجددًا.");
      }
    } finally {
      setBusy("");
    }
  }

  async function openStoreImage(item: JoiningCaseSummary) {
    if (busy || storeImage || pendingImageAttempt || item.state !== "draft") return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const current = await fieldClient().readOwnFieldJoiningCase(token, item.id);
      setMediaCase(current);
      setStoreImage(null);
    } catch (cause) {
      console.warn("DSH Field joining-case media readback failed", cause);
      setError("تعذر قراءة صورة المتجر الآن. أعد المحاولة.");
    } finally {
      setBusy("");
    }
  }

  async function pickStoreImage(source: "camera" | "library" = "library") {
    if (!mediaCase || busy || pendingImageAttempt) return;
    const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(source === "camera" ? "يلزم السماح باستخدام الكاميرا لالتقاط صورة المتجر." : "يلزم السماح بالوصول إلى الصور لاختيار شعار المتجر."); return; }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    try {
      if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) throw new Error("STORE_IMAGE_SIZE_INVALID");
      if (!fieldJoiningImageDimensionsSupported(asset.width, asset.height)) throw new Error("STORE_IMAGE_DIMENSIONS_INVALID");
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("STORE_IMAGE_READ_FAILED");
      const blob = await response.blob();
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("STORE_IMAGE_SIZE_INVALID");
      const type = resolveJoiningCaseImageContentType(asset.mimeType, blob.type, asset.fileName, asset.uri);
      if (!type) throw new Error("STORE_IMAGE_TYPE_INVALID");
      setStoreImage({ uri: asset.uri, name: asset.fileName ?? (type === "image/png" ? "store-image.png" : "store-image.jpg"), type, blob, provenance: fieldStoreImageProvenance(source, mediaCase.case.ownerFullName ?? "") });
      setError("");
    } catch (cause) {
      console.warn("Field store image preparation failed", cause);
      setError(cause instanceof Error && cause.message === "STORE_IMAGE_SIZE_INVALID" ? "يجب ألا يتجاوز حجم صورة المتجر 10 ميغابايت." : cause instanceof Error && cause.message === "STORE_IMAGE_DIMENSIONS_INVALID" ? "يجب أن تكون أبعاد صورة المتجر بين 1 و6000 بكسل للعرض والارتفاع." : cause instanceof Error && cause.message === "STORE_IMAGE_TYPE_INVALID" ? "صيغة صورة المتجر غير مدعومة. اختر صورة بصيغة JPG أو PNG." : "تعذر تجهيز صورة المتجر. اختر الصورة مرة أخرى.");
    }
  }

  async function uploadStoreImage() {
    if (!mediaCase || !storeImage || busy) return;
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
      const saved = await fieldClient().uploadJoiningCaseStoreImage(token, attempt.caseID, attempt.image, attempt.image.provenance, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      const canonical = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID).catch((cause: unknown) => { throw markFieldMediaReadbackUncertain(cause); });
      if (!fieldDraftMediaUploadConfirmed(saved.case, canonical.case, "store", attempt.expectedVersion)) throw new Error("FIELD_MEDIA_UPLOAD_CANONICAL_READBACK_MISMATCH");
      setMediaCase(canonical);
      setStoreImage(null);
      setPendingImageAttempt(null);
      await load();
    } catch (cause) {
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
          setMediaCase(await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID));
        } catch (readError) {
          console.warn("DSH Field store image recovery readback failed", readError);
        }
        setError("لم تُحفظ الصورة. حدّث بيانات الشريك ثم أعد المحاولة.");
      }
    } finally {
      setBusy("");
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

    let nextStepText: string;
    if (item.state === "draft") {
      nextStepText = "الخطوة التالية: راجع بيانات الشريك وأرسل الطلب للمراجعة.";
    } else if (item.state === "admission_requested") {
      nextStepText = "استلم فريق التشغيل الطلب؛ سيظهر للشريك بعد مراجعة الانضمام.";
    } else if (item.state === "submitted") {
      nextStepText = "أُرسل طلب الانضمام إلى الشريك وفريق التشغيل للمراجعة.";
    } else if (item.state === "needs_correction") {
      nextStepText = "الخطوة التالية: يصحح الشريك المرتبط البيانات ويعيد الإرسال.";
    } else {
      nextStepText = "اعتمد فريق التشغيل الطلب؛ يتابع المتجر التفعيل قبل ظهوره للعملاء.";
    }
    const walletProviderName = walletProviders.find((provider) => provider.key === item.walletProviderKey)?.displayNameAr ?? item.walletProviderKey;

    let storeImageButtonLabel: string;
    if (storeImage) {
      storeImageButtonLabel = "اختيار صورة أخرى";
    } else if (mediaCase?.case.storeProfileImage) {
      storeImageButtonLabel = "تغيير شعار المتجر";
    } else {
      storeImageButtonLabel = "اختيار شعار المتجر";
    }

    return (
    <View style={selectedByRoute ? styles.summaryCard : styles.card}>
      {selectedByRoute ? <Text accessibilityLiveRegion="polite" style={styles.cardTitle}>الطلب المحدد من التنبيه</Text> : null}
      <View style={styles.orderHeader}><Text style={styles.cardTitle}>{item.businessName} · {item.firstStoreName}</Text><BthwaniStatusBadge icon={badgeIcon} label={joiningCaseStateLabel(item.state)} tone={badgeTone} /></View>
      <Text style={styles.muted}>المحفظة الرسمية: {walletProviderName || "غير محددة"}</Text>
      {item.correctionReason ? <Text style={styles.error}>التصحيح المطلوب: {item.correctionReason}</Text> : null}
      <Text style={styles.muted}>{nextStepText}</Text>
      {item.state === "approved" ? <>
        <FieldCommercialAgreement caseID={item.id} />
        <BthwaniButton disabled={Boolean(busy)} label="إعداد كتالوج المتجر الأولي" onPress={() => router.push(`/(app)/catalog/${encodeURIComponent(item.id)}` as Href)} variant="secondary" />
      </> : null}
      {item.state === "draft" ? <View style={styles.optionList}>
        <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || Boolean(storeImage) || Boolean(pendingImageAttempt)} label="تعديل بيانات المسودة" onPress={() => router.push({ pathname: "/new-case", params: { caseId: item.id } } as Href)} variant="secondary" />
        <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || Boolean(storeImage) || Boolean(pendingImageAttempt)} label="شعار المتجر" onPress={() => void openStoreImage(item)} variant="secondary" />
      </View> : null}
      {item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || Boolean(pendingImageAttempt) || Boolean(storeImage)} label="إرسال للمراجعة" onPress={() => setCaseToSubmit(item)} /> : null}
      {mediaCase?.case.id === item.id ? <View style={styles.card}>
        <Text style={styles.cardTitle}>شعار المتجر</Text>
        {mediaCase.case.storeProfileImage ? <Image accessibilityLabel="شعار المتجر المحفوظ" source={{ uri: mediaCase.case.storeProfileImage.uri }} style={{ borderRadius: 12, height: 150, width: "100%" }} resizeMode="cover" /> : <Text style={styles.muted}>لم يُحفظ شعار المتجر بعد.</Text>}
        {storeImage ? <Image accessibilityLabel="معاينة شعار المتجر الجديد" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 120, width: "100%" }} resizeMode="cover" /> : null}
        {storeImage ? <View style={styles.card}>
          <FieldMediaProvenanceEditor key={storeImage.uri} disabled={Boolean(busy) || Boolean(pendingImageAttempt)} onChange={(provenance) => setStoreImage((current) => current ? { ...current, provenance } : null)} value={storeImage.provenance} />
        </View> : null}
        <View style={styles.optionList}>
          <BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label={storeImageButtonLabel} onPress={() => void pickStoreImage("library")} variant="secondary" />
          <BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label="التقاط صورة بالكاميرا" onPress={() => void pickStoreImage("camera")} variant="secondary" />
        </View>
        {storeImage ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || (!pendingImageAttempt && !isMediaProvenanceInputValid(storeImage.provenance))} label={pendingImageAttempt ? "إعادة التحقق من رفع الصورة" : "حفظ شعار المتجر"} onPress={() => void uploadStoreImage()} /> : null}
        {storeImage ? <Text style={styles.muted}>احفظ صورة الواجهة أو أغلق التفاصيل لإلغاء الاختيار.</Text> : null}
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
  } else if (cases.length > 0) {
    paginationFooter = <View style={styles.caseListFooter}><Text style={styles.muted}>عُرضت كل النتائج المطابقة.</Text></View>;
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
    ListFooterComponent={paginationFooter}
    ListFooterComponentStyle={styles.caseListFooter}
    ListHeaderComponent={<View style={styles.container}>
      <Text style={styles.muted}>تابع الشركاء الذين تعمل على ضمهم، وأرسل بياناتهم للمراجعة عند اكتمالها.</Text>
      {cases.length > 0 ? <Text style={styles.sectionTitle}>عدد الشركاء: {cases.length}{nextCursor ? " · توجد نتائج أخرى" : ""}</Text> : null}
      {error && cases.length > 0 ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {caseSelectionError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{caseSelectionError}</Text><BthwaniButton label="إعادة فتح الطلب" onPress={() => setSelectionRetry((value) => value + 1)} variant="secondary" /></View> : null}
      {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
      {cases.length > 0 ? <BthwaniButton disabled={Boolean(busy) || loading} label="تحديث القائمة" onPress={() => void load()} variant="secondary" /> : null}
    </View>}
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
    description={caseToSubmit ? `سيُغلق تحرير مسودة «${caseToSubmit.businessName} · ${caseToSubmit.firstStoreName}» لدى الميدان ويُنقل الطلب إلى مراجعة التشغيل والشريك. تأكد من اكتمال البيانات وشعار المتجر قبل الإرسال.` : ""}
    onCancel={() => setCaseToSubmit(null)}
    onConfirm={() => {
      const item = caseToSubmit;
      setCaseToSubmit(null);
      if (item) void submitCase(item);
    }}
    title="مراجعة إرسال طلب الانضمام"
    visible={Boolean(caseToSubmit)}
  /></>;
}
