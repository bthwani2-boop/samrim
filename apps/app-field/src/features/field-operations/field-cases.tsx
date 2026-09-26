import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type DshImageUploadInput, type JoiningCaseResponse, type JoiningCaseSummary, joiningCaseStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Text, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient, isMissingFieldAdmission } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";

const FIELD_CASE_PAGE_SIZE = 25;

type PendingStoreImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: DshImageUploadInput; idempotencyKey: string; correlationID: string }>;
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
  const [storeImage, setStoreImage] = useState<DshImageUploadInput | null>(null);
  const [pendingImageAttempt, setPendingImageAttempt] = useState<PendingStoreImageAttempt | null>(null);
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
      console.error("DSH Field cases readback failed", cause);
      setError("تعذر قراءة ملفات الانضمام. أعد المحاولة.");
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
      console.error("DSH Field cases continuation readback failed", cause);
      setPaginationError("تعذر تحميل بقية الملفات. أعد المحاولة.");
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
        setNotice("أُعيدت قراءة الحالة الكانونية: " + joiningCaseStateLabel(current.case.state) + ".");
        return;
      }
      const identity = await fieldCaseSubmitIdentity(item.id, current.case.version);
      await fieldClient().submitFieldJoiningCase(token, item.id, current.case.version, identity.idempotencyKey, identity.correlationID);
      await load();
      setNotice("وصل طلب الانضمام إلى طابور قبول المشغّل.");
    } catch (cause) {
      console.error("DSH Field joining-case submission failed", cause);
      try {
        const token = await getUsableIdentityAccessToken();
        const latest = await fieldClient().readOwnFieldJoiningCase(token, item.id);
        await load();
        if (latest.case.state === "draft") setError("لم يتأكد الإرسال. أعد المحاولة؛ سيستخدم DSH هوية العملية نفسها لهذه النسخة.");
        else setNotice("وصل الطلب إلى DSH. الحالة الحالية: " + joiningCaseStateLabel(latest.case.state) + ".");
      } catch (readError) {
        console.error("DSH Field joining-case submit recovery readback failed", readError);
        setError("تعذر تأكيد الإرسال وإعادة القراءة. أعد قراءة الملفات؛ إعادة المحاولة للنسخة نفسها تستخدم هوية العملية نفسها.");
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
      console.error("DSH Field joining-case media readback failed", cause);
      setError("تعذر قراءة صورة الملف من DSH. أعد المحاولة.");
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
      setStoreImage({ uri: asset.uri, name: asset.fileName ?? "store-image.jpg", type: asset.mimeType ?? "image/jpeg", blob: await response.blob() });
      setError("");
    } catch (cause) {
      console.error("Field store image preparation failed", cause);
      setError("تعذر تجهيز صورة المتجر. اختر الصورة مرة أخرى.");
    }
  }

  async function uploadStoreImage() {
    if (!mediaCase || !storeImage || busy) return;
    const attempt = pendingImageAttempt ?? { caseID: mediaCase.case.id, expectedVersion: mediaCase.case.version, image: storeImage, idempotencyKey: `field_store_image_${Crypto.randomUUID()}`, correlationID: `field_store_image_corr_${Crypto.randomUUID()}` };
    setPendingImageAttempt(attempt);
    setBusy(attempt.caseID);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const saved = await fieldClient().uploadJoiningCaseStoreImage(token, attempt.caseID, attempt.image, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setMediaCase(saved);
      setStoreImage(null);
      setPendingImageAttempt(null);
      await load();
    } catch (cause) {
      console.error("DSH Field store image upload failed", cause);
      if (dshErrorCode(cause) === "MEDIA_STORAGE_UNAVAILABLE") {
        setPendingImageAttempt(null);
        setError("تعذر تخزين الصورة. أعد رفع الملف المختار أو اختر صورة أخرى.");
      } else if (isOutcomeUncertain(cause)) {
        setError("لم تتأكد نتيجة رفع الصورة. أعد المحاولة بالمفتاح نفسه لإعادة قراءتها من DSH.");
      } else {
        setPendingImageAttempt(null);
        try {
          const token = await getUsableIdentityAccessToken();
          setMediaCase(await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID));
        } catch (readError) {
          console.error("DSH Field store image recovery readback failed", readError);
        }
        setError("لم تُعتمد الصورة بهذه النسخة. أُعيدت قراءة الحالة الكانونية؛ تحقق منها ثم أعد المحاولة.");
      }
    } finally {
      setBusy("");
    }
  }

  const renderCase = ({ item }: { item: JoiningCaseSummary }) => (
    <View style={styles.card}>
      <View style={styles.orderHeader}><Text style={styles.cardTitle}>{item.businessName} · {item.firstStoreName}</Text><BthwaniStatusBadge icon={item.state === "draft" ? "edit" : item.state === "needs_correction" ? "warning" : "cases"} label={joiningCaseStateLabel(item.state)} tone={item.state === "draft" ? "info" : item.state === "needs_correction" ? "warning" : "neutral"} /></View>
      {item.correctionReason ? <Text style={styles.error}>التصحيح المطلوب: {item.correctionReason}</Text> : null}
      <Text style={styles.muted}>{item.state === "draft" ? "الخطوة التالية: راجع البيانات ثم أرسل الملف للمراجعة." : item.state === "admission_requested" ? "وصل الملف إلى طابور المشغّل لإنشاء دور الشريك بعد القبول." : item.state === "submitted" ? "قُبلت الإحالة؛ أصبحت الحالة لدى الشريك والمشغّل للمراجعة." : item.state === "needs_correction" ? "الخطوة التالية: يصحح الشريك المرتبط البيانات ويعيد الإرسال." : "اعتمد المشغّل الحالة؛ يظهر المتجر للعميل بعد اكتمال النشر والكتالوج."}</Text>
      {item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || Boolean(storeImage) || Boolean(pendingImageAttempt)} label="قراءة صورة المتجر أو استكمالها" onPress={() => void openStoreImage(item)} variant="secondary" /> : null}
      {item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy) || Boolean(pendingImageAttempt) || (Boolean(storeImage) && mediaCase?.case.id !== item.id)} label="إرسال للمراجعة" onPress={() => void submitCase(item)} /> : null}
      {mediaCase?.case.id === item.id ? <View style={styles.card}>
        <Text style={styles.cardTitle}>الصورة الكانونية للمتجر</Text>
        {mediaCase.case.storeProfileImage ? <Image accessibilityLabel="صورة المتجر المحفوظة في DSH" source={{ uri: mediaCase.case.storeProfileImage.uri }} style={{ borderRadius: 12, height: 150, width: "100%" }} resizeMode="cover" /> : <Text style={styles.muted}>لا توجد صورة محفوظة للملف بعد.</Text>}
        {storeImage ? <Image accessibilityLabel="معاينة صورة المتجر الجديدة" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 120, width: "100%" }} resizeMode="cover" /> : null}
        <BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label={storeImage ? "اختيار صورة أخرى" : mediaCase.case.storeProfileImage ? "تغيير صورة المتجر" : "اختيار صورة المتجر"} onPress={() => void pickStoreImage()} variant="secondary" />
        {storeImage ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy)} label={pendingImageAttempt ? "إعادة التحقق من رفع الصورة" : "حفظ صورة المتجر"} onPress={() => void uploadStoreImage()} /> : null}
        <BthwaniButton disabled={Boolean(busy) || Boolean(pendingImageAttempt)} label="إغلاق تفاصيل الصورة" onPress={() => { setMediaCase(null); setStoreImage(null); }} variant="secondary" />
      </View> : null}
    </View>
  );

  const emptyMessage = missingAdmission
    ? "لا يوجد حساب ميداني مؤهل لقراءة الملفات."
    : appliedQuery
      ? "لا توجد ملفات مطابقة للبحث."
      : "لا توجد ملفات انضمام من هذا الميدان بعد.";

  return <FlatList
    accessibilityLabel="ملفات الانضمام"
    data={cases}
    keyExtractor={(item) => item.id}
    keyboardDismissMode="on-drag"
    keyboardShouldPersistTaps="handled"
    ListEmptyComponent={loading
      ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View>
      : <View style={styles.state}><Text style={styles.muted}>{error || emptyMessage}</Text>{error ? <BthwaniButton disabled={Boolean(busy)} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}</View>}
    ListFooterComponent={loadingMore
      ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ تحميل بقية الملفات…</Text></View>
      : paginationError
        ? <View style={styles.caseListFooter}><Text accessibilityRole="alert" style={styles.error}>{paginationError}</Text><BthwaniButton disabled={Boolean(busy)} label="إعادة تحميل بقية الملفات" onPress={() => void loadMore()} variant="secondary" /></View>
        : nextCursor
          ? <View style={styles.caseListFooter}><BthwaniButton disabled={Boolean(busy) || loading} label="تحميل المزيد من الملفات" onPress={() => void loadMore()} variant="secondary" /></View>
          : cases.length > 0
            ? <View style={styles.caseListFooter}><Text style={styles.muted}>تم تحميل كل الملفات المطابقة.</Text></View>
            : null}
    ListFooterComponentStyle={styles.caseListFooter}
    ListHeaderComponent={<View style={styles.container}>
      <Text style={styles.title}>ملفات الانضمام</Text>
      <Text style={styles.muted}>تابع حالة ملفات الانضمام وأرسل الملف للمراجعة عندما تكتمل بياناته.</Text>
      {cases.length > 0 ? <Text style={styles.sectionTitle}>ملفات محمّلة: {cases.length}{nextCursor ? " · توجد ملفات أخرى" : ""}</Text> : null}
      {error && cases.length > 0 ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
      {cases.length > 0 ? <BthwaniButton disabled={Boolean(busy) || loading} label="تحديث الملفات" onPress={() => void load()} variant="secondary" /> : null}
    </View>}
    onRefresh={() => void load()}
    refreshing={loading && cases.length > 0}
    renderItem={renderCase}
    showsVerticalScrollIndicator={false}
    style={styles.caseList}
    contentContainerStyle={styles.caseListContent}
  />;
}
