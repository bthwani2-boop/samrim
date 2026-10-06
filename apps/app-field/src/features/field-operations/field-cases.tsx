import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { isMediaProvenanceInputValid, resolveJoiningCaseImageContentType, type DshImageUploadInput, type JoiningCaseResponse, type JoiningCaseSummary, joiningCaseStateLabel, type MediaProvenanceInput } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Switch, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient, isMissingFieldAdmission } from "./field-client";
import { FieldCommercialAgreement } from "./field-commercial-agreement";
import { createFieldOperationStyles } from "./field-operation-styles";

const FIELD_CASE_PAGE_SIZE = 25;

type StoreImageDraft = DshImageUploadInput & Readonly<{ provenance: MediaProvenanceInput }>;
type PendingStoreImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: StoreImageDraft; idempotencyKey: string; correlationID: string }>;
type PendingProofImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: DshImageUploadInput; idempotencyKey: string; correlationID: string }>;
type FieldCasePagination = { sequence: number; query: string; cursor: string; loadingMore: boolean };

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

async function fieldCaseSubmitIdentity(caseID: string, expectedVersion: number) {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `field-case-submit\u0000${caseID}\u0000${expectedVersion}`);
  return { idempotencyKey: `field_submit_${digest}`, correlationID: `field_submit_corr_${digest}` };
}

export function FieldCases() {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { q: rawQuery } = useLocalSearchParams<{ q?: string | string[] }>();
  const routeQuery = (Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "").slice(0, 128);
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
  const [mediaCase, setMediaCase] = useState<JoiningCaseResponse | null>(null);
  const [storeImage, setStoreImage] = useState<StoreImageDraft | null>(null);
  const [pendingImageAttempt, setPendingImageAttempt] = useState<PendingStoreImageAttempt | null>(null);
  const [proofImage, setProofImage] = useState<DshImageUploadInput | null>(null);
  const [pendingProofImageAttempt, setPendingProofImageAttempt] = useState<PendingProofImageAttempt | null>(null);
  const pagination = useRef<FieldCasePagination>({ sequence: 0, query: routeQuery.trim(), cursor: "", loadingMore: false });

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
    if (busy || item.state !== "draft") return;
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
      setProofImage(null);
      setPendingProofImageAttempt(null);
    } catch (cause) {
      console.warn("DSH Field joining-case media readback failed", cause);
      setError("تعذر قراءة صورة المتجر الآن. أعد المحاولة.");
    } finally {
      setBusy("");
    }
  }

  async function pickStoreImage() {
    if (!mediaCase || busy || pendingImageAttempt) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("يلزم السماح بالوصول إلى الصور لاختيار صورة المتجر."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
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

  async function uploadStoreImage() {
    if (!mediaCase || !storeImage || busy) return;
    if (!isMediaProvenanceInputValid(storeImage.provenance)) {
      setError("أكمل منشئ الصورة ومصدرها وبيان حق استخدامها، ثم أكّد صحة التصريح.");
      return;
    }
    const attempt = pendingImageAttempt ?? { caseID: mediaCase.case.id, expectedVersion: mediaCase.case.version, image: storeImage, idempotencyKey: `field_store_image_${Crypto.randomUUID()}`, correlationID: `field_store_image_corr_${Crypto.randomUUID()}` };
    setPendingImageAttempt(attempt);
    setBusy(attempt.caseID);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const saved = await fieldClient().uploadJoiningCaseStoreImage(token, attempt.caseID, attempt.image, attempt.image.provenance, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setMediaCase(saved);
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

  async function pickProofImage() {
    if (!mediaCase || mediaCase.case.state !== "draft" || busy || pendingProofImageAttempt) return;
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
      console.warn("Field draft proof image preparation failed", cause);
      setError(cause instanceof Error && cause.message === "PROOF_IMAGE_SIZE_INVALID" ? "يجب ألا يتجاوز حجم صورة الإثبات 10 ميغابايت." : cause instanceof Error && cause.message === "PROOF_IMAGE_TYPE_INVALID" ? "صيغة صورة الإثبات غير مدعومة. اختر صورة بصيغة JPG أو PNG." : "تعذر تجهيز صورة الإثبات. اختر الصورة مرة أخرى.");
    }
  }

  async function uploadProofImage() {
    if (!mediaCase || !proofImage || busy) return;
    const attempt = pendingProofImageAttempt ?? { caseID: mediaCase.case.id, expectedVersion: mediaCase.case.version, image: proofImage, idempotencyKey: `field_proof_image_${Crypto.randomUUID()}`, correlationID: `field_proof_image_corr_${Crypto.randomUUID()}` };
    setPendingProofImageAttempt(attempt);
    setBusy(attempt.caseID);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const saved = await fieldClient().uploadFieldJoiningCaseProofImage(token, attempt.caseID, attempt.image, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setMediaCase(saved);
      setProofImage(null);
      setPendingProofImageAttempt(null);
      await load();
    } catch (cause) {
      console.warn("DSH Field draft proof image upload failed", cause);
      if (isOutcomeUncertain(cause)) {
        setError("لم نتأكد من رفع صورة الإثبات بعد. أعد المحاولة بالصورة نفسها للتحقق من النتيجة.");
      } else {
        setPendingProofImageAttempt(null);
        try {
          const token = await getUsableIdentityAccessToken();
          const latest = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID);
          setMediaCase(latest);
          if (latest.case.firstStoreProofImageUploaded) setProofImage(null);
        } catch (readError) {
          console.warn("Field draft proof image recovery readback failed", readError);
        }
        setError("تعذر تأكيد رفع صورة الإثبات. أُعيدت قراءة المسودة؛ أعد اختيار الصورة إذا لم تكن قد رُفعت.");
      }
    } finally {
      setBusy("");
    }
  }

  const renderCase = ({ item }: { item: JoiningCaseSummary }) => {
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

    let storeImageButtonLabel: string;
    if (storeImage) {
      storeImageButtonLabel = "اختيار صورة أخرى";
    } else if (mediaCase?.case.storeProfileImage) {
      storeImageButtonLabel = "تغيير صورة المتجر";
    } else {
      storeImageButtonLabel = "اختيار صورة المتجر";
    }

    return (
    <View style={styles.card}>
      <View style={styles.orderHeader}><Text style={styles.cardTitle}>{item.businessName} · {item.firstStoreName}</Text><BthwaniStatusBadge icon={badgeIcon} label={joiningCaseStateLabel(item.state)} tone={badgeTone} /></View>
      {item.correctionReason ? <Text style={styles.error}>التصحيح المطلوب: {item.correctionReason}</Text> : null}
      <Text style={styles.muted}>{nextStepText}</Text>
      {item.state === "approved" ? <>
        <FieldCommercialAgreement caseID={item.id} />
        <BthwaniButton disabled={Boolean(busy)} label="إعداد كتالوج المتجر الأولي" onPress={() => router.push(`/(app)/catalog/${encodeURIComponent(item.id)}` as Href)} variant="secondary" />
      </> : null}
      {item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || Boolean(storeImage) || Boolean(pendingImageAttempt) || Boolean(pendingProofImageAttempt)} label="استكمال صور المسودة" onPress={() => void openStoreImage(item)} variant="secondary" /> : null}
      {item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || Boolean(pendingImageAttempt) || Boolean(pendingProofImageAttempt) || (Boolean(storeImage) && mediaCase?.case.id !== item.id)} label="إرسال للمراجعة" onPress={() => void submitCase(item)} /> : null}
      {mediaCase?.case.id === item.id ? <View style={styles.card}>
        <Text style={styles.cardTitle}>صورة واجهة المتجر</Text>
        {mediaCase.case.storeProfileImage ? <Image accessibilityLabel="صورة المتجر المحفوظة" source={{ uri: mediaCase.case.storeProfileImage.uri }} style={{ borderRadius: 12, height: 150, width: "100%" }} resizeMode="cover" /> : <Text style={styles.muted}>لا توجد صورة محفوظة للشريك بعد.</Text>}
        {storeImage ? <Image accessibilityLabel="معاينة صورة المتجر الجديدة" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 120, width: "100%" }} resizeMode="cover" /> : null}
        {storeImage ? <View style={styles.card}>
          <Text style={styles.cardTitle}>مصدر الصورة وحق استخدامها</Text>
          <TextInput accessibilityLabel="منشئ الصورة" editable={!busy && !pendingImageAttempt} placeholder="منشئ الصورة أو المصور" style={styles.input} value={storeImage.provenance.creator} onChangeText={(creator) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, creator } } : null)} />
          <TextInput accessibilityLabel="مصدر الصورة" editable={!busy && !pendingImageAttempt} placeholder="كيف حصلت على الصورة؟" style={styles.input} value={storeImage.provenance.sourceDescription} onChangeText={(sourceDescription) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, sourceDescription } } : null)} />
          <TextInput accessibilityLabel="رابط مصدر الصورة اختياري" editable={!busy && !pendingImageAttempt} autoCapitalize="none" keyboardType="url" placeholder="رابط المصدر، اختياري" style={styles.input} value={storeImage.provenance.sourceUri} onChangeText={(sourceUri) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, sourceUri } } : null)} />
          <TextInput accessibilityLabel="بيان حق استخدام الصورة" editable={!busy && !pendingImageAttempt} multiline placeholder="بيان الحق أو الترخيص الذي يسمح بعرض الصورة" style={styles.input} value={storeImage.provenance.rightsStatement} onChangeText={(rightsStatement) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, rightsStatement } } : null)} />
          <TextInput accessibilityLabel="رابط شروط الترخيص اختياري" editable={!busy && !pendingImageAttempt} autoCapitalize="none" keyboardType="url" placeholder="رابط شروط الترخيص، اختياري" style={styles.input} value={storeImage.provenance.rightsUri} onChangeText={(rightsUri) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, rightsUri } } : null)} />
          <View style={styles.caseListFooter}><Switch disabled={Boolean(busy) || Boolean(pendingImageAttempt)} value={storeImage.provenance.rightsAttested} onValueChange={(rightsAttested) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, rightsAttested } } : null)} /><Text style={styles.muted}>أؤكد صحة بيانات المصدر وحق الاستخدام.</Text></View>
        </View> : null}
        <BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label={storeImageButtonLabel} onPress={() => void pickStoreImage()} variant="secondary" />
        {storeImage ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || (!pendingImageAttempt && !isMediaProvenanceInputValid(storeImage.provenance))} label={pendingImageAttempt ? "إعادة التحقق من رفع الصورة" : "حفظ صورة المتجر"} onPress={() => void uploadStoreImage()} /> : null}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>صورة الإثبات الخاصة</Text>
          <Text style={mediaCase.case.firstStoreProofImageUploaded ? styles.muted : styles.error}>{mediaCase.case.firstStoreProofImageUploaded ? "صورة الإثبات مسجلة للمسودة." : "ارفع صورة الإثبات من هذه القائمة لإكمال المسودة بعد مغادرة شاشة الإنشاء."}</Text>
          {proofImage ? <Image accessibilityLabel="معاينة صورة الإثبات" source={{ uri: proofImage.uri }} style={{ borderRadius: 12, height: 120, width: "100%" }} resizeMode="contain" /> : null}
          {!mediaCase.case.firstStoreProofImageUploaded ? <>
            <BthwaniButton disabled={Boolean(busy) || Boolean(pendingProofImageAttempt)} label={proofImage ? "اختيار صورة إثبات أخرى" : "اختيار صورة الإثبات"} onPress={() => void pickProofImage()} variant="secondary" />
            {proofImage ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy)} label={pendingProofImageAttempt ? "إعادة التحقق من رفع الإثبات" : "رفع صورة الإثبات المشفّرة"} onPress={() => void uploadProofImage()} /> : null}
          </> : null}
        </View>
        <BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt) || Boolean(pendingProofImageAttempt)} label="إغلاق تفاصيل الصورة" onPress={() => { setMediaCase(null); setStoreImage(null); }} variant="secondary" />
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

  return <FlatList
    accessibilityLabel="الشركاء"
    data={cases}
    keyExtractor={(item) => item.id}
    keyboardDismissMode="on-drag"
    keyboardShouldPersistTaps="handled"
    ListEmptyComponent={loading
      ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View>
      : <View style={styles.state}><Text style={styles.muted}>{error || emptyMessage}</Text>{error ? <BthwaniButton disabled={Boolean(busy)} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}</View>}
    ListFooterComponent={paginationFooter}
    ListFooterComponentStyle={styles.caseListFooter}
    ListHeaderComponent={<View style={styles.container}>
      <Text style={styles.title}>الشركاء</Text>
      <Text style={styles.muted}>تابع الشركاء الذين تعمل على ضمهم، وأرسل بياناتهم للمراجعة عند اكتمالها.</Text>
      {cases.length > 0 ? <Text style={styles.sectionTitle}>عدد الشركاء: {cases.length}{nextCursor ? " · توجد نتائج أخرى" : ""}</Text> : null}
      {error && cases.length > 0 ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
      {cases.length > 0 ? <BthwaniButton disabled={Boolean(busy) || loading} label="تحديث القائمة" onPress={() => void load()} variant="secondary" /> : null}
    </View>}
    onRefresh={() => void load()}
    refreshing={loading && cases.length > 0}
    renderItem={renderCase}
    showsVerticalScrollIndicator={false}
    style={styles.caseList}
    contentContainerStyle={styles.caseListContent}
  />;
}
