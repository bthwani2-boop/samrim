import { borders, radius, toAsciiDigits, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import type { CommercialStoreType, CommerceVertical, DshImageUploadInput, JoiningCaseProofType, JoiningCaseResponse, ServiceCity, StoreFulfillmentMode, StoreWeeklyWorkingHours, StoreWorkingHoursInterval } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { correctAndResubmitOwnJoiningCase, listCatalogVerticals, listCommercialStoreTypes, readOwnJoiningCase, uploadOwnJoiningCaseProofImage } from "./store-readback-client";
import { StoreProfileImageEditor } from "./store-profile-image-editor";

const WEEKDAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"] as const;
const DEFAULT_OPEN = "09:00";
const DEFAULT_CLOSE = "17:00";
const WEEK_MINUTES = 7 * 24 * 60;
const PROOF_TYPES: ReadonlyArray<{ value: JoiningCaseProofType; label: string }> = [
  { value: "COMMERCIAL_REGISTRATION", label: "سجل تجاري" },
  { value: "IDENTITY_DOCUMENT", label: "هوية" },
  { value: "FREELANCE_WORK_DOCUMENT", label: "وثيقة عمل حر" },
];
type ProofImageDraft = Readonly<{ image: DshImageUploadInput; contentSha256: string }>;
type WorkingIntervalDraft = StoreWorkingHoursInterval & Readonly<{ draftKey: string }>;

function workingIntervalDrafts(intervals: ReadonlyArray<StoreWorkingHoursInterval>): WorkingIntervalDraft[] {
  return intervals.map((interval) => ({ ...interval, draftKey: Crypto.randomUUID() }));
}

function storeWorkingHours(intervals: ReadonlyArray<WorkingIntervalDraft>): StoreWeeklyWorkingHours {
  return { intervals: sortedIntervals(intervals).map((interval) => ({ dayOfWeek: interval.dayOfWeek, opensAt: interval.opensAt, closesAt: interval.closesAt, closesNextDay: interval.closesNextDay })) };
}
const FULFILLMENT_MODES: ReadonlyArray<{ value: StoreFulfillmentMode; label: string }> = [
  { value: "BTHWANI_CAPTAIN", label: "كباتن بثواني" },
  { value: "PARTNER_CAPTAIN", label: "توصيل الشريك" },
  { value: "CUSTOMER_PICKUP", label: "استلام من المتجر" },
];

function dshErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function parseClock(value: string): number | null {
  const match = /^(\\d{2}):(\\d{2})$/.exec(toAsciiDigits(value.trim()));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function workingHoursIssue(intervals: ReadonlyArray<StoreWorkingHoursInterval>): string {
  if (intervals.length === 0) return "أضف ساعات عمل ليوم واحد على الأقل؛ الأيام بلا فترات تُعد مغلقة.";
  if (intervals.length > 28) return "الحد الأعلى 28 فترة عمل في الأسبوع.";
  const ranges: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const open = parseClock(interval.opensAt);
    const close = parseClock(interval.closesAt);
    if (!Number.isInteger(interval.dayOfWeek) || interval.dayOfWeek < 1 || interval.dayOfWeek > 7 || open === null || close === null) {
      return "أدخل وقتًا صحيحًا لكل فترة بصيغة ساعة:دقيقة من 00:00 إلى 23:59.";
    }
    const duration = close - open + (interval.closesNextDay ? 1440 : 0);
    if (duration <= 0 || duration > 1440) return "يجب أن تنتهي كل فترة بعد بدايتها، وبحد أقصى 24 ساعة.";
    const start = (interval.dayOfWeek - 1) * 1440 + open;
    ranges.push({ start, end: start + duration });
  }
  for (let leftIndex = 0; leftIndex < ranges.length; leftIndex += 1) {
    const left = ranges[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex; rightIndex < ranges.length; rightIndex += 1) {
      const right = ranges[rightIndex];
      if (!right) continue;
      for (const offset of [-WEEK_MINUTES, 0, WEEK_MINUTES]) {
        if (leftIndex === rightIndex && offset === 0) continue;
        if (left.start < right.end + offset && right.start + offset < left.end) return "تتداخل فترتان في جدول الأسبوع. عدّل الأوقات قبل الحفظ.";
      }
    }
  }
  return "";
}

function sortedIntervals(intervals: ReadonlyArray<StoreWorkingHoursInterval>): StoreWorkingHoursInterval[] {
  return [...intervals].sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.opensAt.localeCompare(right.opensAt) || left.closesAt.localeCompare(right.closesAt));
}

function weeklyHoursFingerprint(value: StoreWeeklyWorkingHours | null | undefined): string {
  return sortedIntervals(value?.intervals ?? [])
    .map((interval) => [interval.dayOfWeek, interval.opensAt, interval.closesAt, interval.closesNextDay ? "1" : "0"].join("|"))
    .join(",");
}

function sameValues(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return [...left].sort((a, b) => a.localeCompare(b)).join("|") === [...right].sort((a, b) => a.localeCompare(b)).join("|");
}

export function JoiningCaseCorrection({ value, cities, onUpdated }: { value: JoiningCaseResponse; cities: ReadonlyArray<ServiceCity>; onUpdated: (next: JoiningCaseResponse) => void }) {
  const current = value.case;
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [ownerFullName, setOwnerFullName] = useState(current.ownerFullName ?? "");
  const [businessName, setBusinessName] = useState(current.businessName);
  const [firstStoreName, setFirstStoreName] = useState(current.firstStoreName);
  const [firstStoreAddress, setFirstStoreAddress] = useState(current.firstStoreAddress ?? "");
  const [serviceCityId, setServiceCityId] = useState(current.serviceCityId || "");
  const [verticalId, setVerticalId] = useState(current.firstStoreVerticalId || "");
  const [commercialTypeId, setCommercialTypeId] = useState(current.firstStoreCommercialTypeId || "");
  const [latitude, setLatitude] = useState<number | null>(current.firstStoreLatitude);
  const [longitude, setLongitude] = useState<number | null>(current.firstStoreLongitude);
  const [workingIntervals, setWorkingIntervals] = useState<ReadonlyArray<WorkingIntervalDraft>>(() => workingIntervalDrafts(current.firstStoreWorkingHours?.intervals ?? []));
  const [proofType, setProofType] = useState<JoiningCaseProofType | "">(current.firstStoreProofType ?? "");
  const [proofNumber, setProofNumber] = useState("");
  const [notes, setNotes] = useState(current.firstStoreNotes ?? "");
  const [fulfillmentModes, setFulfillmentModes] = useState<ReadonlyArray<StoreFulfillmentMode>>(current.firstStoreFulfillmentModes);
  const [proofImage, setProofImage] = useState<ProofImageDraft | null>(null);
  const [uploadedProofFingerprint, setUploadedProofFingerprint] = useState("");
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [commercialTypes, setCommercialTypes] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const [commercialTypesLoading, setCommercialTypesLoading] = useState(false);
  const [commercialTypesError, setCommercialTypesError] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [proofUploadBusy, setProofUploadBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preserveCorrectionDraftAtVersion = useRef<number | null>(null);

  useEffect(() => {
    if (preserveCorrectionDraftAtVersion.current === current.version) {
      preserveCorrectionDraftAtVersion.current = null;
      return;
    }
    setOwnerFullName(current.ownerFullName ?? "");
    setBusinessName(current.businessName);
    setFirstStoreName(current.firstStoreName);
    setFirstStoreAddress(current.firstStoreAddress ?? "");
    setServiceCityId(current.serviceCityId || "");
    setVerticalId(current.firstStoreVerticalId || "");
    setCommercialTypeId(current.firstStoreCommercialTypeId || "");
    setLatitude(current.firstStoreLatitude);
    setLongitude(current.firstStoreLongitude);
    setWorkingIntervals(workingIntervalDrafts(current.firstStoreWorkingHours?.intervals ?? []));
    setProofType(current.firstStoreProofType ?? "");
    setProofNumber("");
    setNotes(current.firstStoreNotes ?? "");
    setFulfillmentModes(current.firstStoreFulfillmentModes);
    setProofImage(null);
    setUploadedProofFingerprint("");
  }, [current.businessName, current.firstStoreAddress, current.firstStoreCommercialTypeId, current.firstStoreFulfillmentModes, current.firstStoreLatitude, current.firstStoreLongitude, current.firstStoreName, current.firstStoreNotes, current.firstStoreProofType, current.firstStoreVerticalId, current.firstStoreWorkingHours, current.ownerFullName, current.serviceCityId, current.version]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError(false);
    try {
      setVerticals(await listCatalogVerticals());
    } catch (cause) {
      console.warn("DSH Partner correction options read failed", cause);
      setVerticals([]);
      setOptionsError(true);
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (current.state === "needs_correction") void loadOptions();
  }, [current.state, loadOptions]);

  useEffect(() => {
    setCommercialTypes([]);
    if (current.firstStoreVerticalId !== verticalId) setCommercialTypeId("");
    setCommercialTypesError(false);
    if (!verticalId || current.state !== "needs_correction") return;
    let active = true;
    setCommercialTypesLoading(true);
    void listCommercialStoreTypes(verticalId)
      .then((items) => { if (active) setCommercialTypes(items.filter((item) => item.active)); })
      .catch((cause) => {
        console.warn("DSH Partner commercial store type read failed", cause);
        if (active) setCommercialTypesError(true);
      })
      .finally(() => { if (active) setCommercialTypesLoading(false); });
    return () => { active = false; };
  }, [current.firstStoreVerticalId, current.state, verticalId]);

  if (current.state !== "needs_correction") return null;

  function updateInterval(draftKey: string, patch: Partial<StoreWorkingHoursInterval>) {
    setWorkingIntervals((items) => items.map((item) => item.draftKey === draftKey ? { ...item, ...patch } : item));
  }

  function setDayOpen(dayOfWeek: number, open: boolean) {
    setWorkingIntervals((items) => {
      const dayIntervals = items.filter((item) => item.dayOfWeek === dayOfWeek);
      if (open && dayIntervals.length === 0) return [...items, { draftKey: Crypto.randomUUID(), dayOfWeek, opensAt: DEFAULT_OPEN, closesAt: DEFAULT_CLOSE, closesNextDay: false }];
      if (!open) return items.filter((item) => item.dayOfWeek !== dayOfWeek);
      return items;
    });
  }

  function addDayInterval(dayOfWeek: number) {
    setWorkingIntervals((items) => items.length >= 28 ? items : [...items, { draftKey: Crypto.randomUUID(), dayOfWeek, opensAt: DEFAULT_OPEN, closesAt: DEFAULT_CLOSE, closesNextDay: false }]);
  }

  async function refreshEvidenceStatus() {
    setEvidenceLoading(true);
    try {
      const latest = await readOwnJoiningCase();
      if (latest.case.id === current.id && latest.case.state === "needs_correction") preserveCorrectionDraftAtVersion.current = latest.case.version;
      onUpdated(latest);
    } catch (cause) {
      console.warn("DSH Partner joining-case evidence status read failed", cause);
      setError("تعذر تحديث حالة صورة الإثبات. تحقق من الاتصال ثم أعد المحاولة.");
    } finally {
      setEvidenceLoading(false);
    }
  }

  async function chooseProofImage() {
    if (proofUploadBusy || busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("يلزم السماح بالوصول إلى الصور لاختيار صورة الإثبات النظامي.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (!asset?.uri) return;
    try {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("JOINING_CASE_PROOF_IMAGE_READ_FAILED");
      const blob = await response.blob();
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("JOINING_CASE_PROOF_IMAGE_SIZE_INVALID");
      const mimeType = asset.mimeType ?? "image/jpeg";
      if (mimeType !== "image/jpeg" && mimeType !== "image/png") throw new Error("JOINING_CASE_PROOF_IMAGE_TYPE_INVALID");
      const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await blob.arrayBuffer()));
      const contentSha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
      setProofImage({ contentSha256, image: { uri: asset.uri, name: asset.fileName ?? "joining-case-proof.jpg", type: mimeType, blob } });
      setUploadedProofFingerprint("");
      setError("");
    } catch (cause) {
      console.warn("DSH Partner joining-case proof image preparation failed", cause);
      setError(cause instanceof Error && cause.message === "JOINING_CASE_PROOF_IMAGE_TYPE_INVALID" ? "صيغة صورة الإثبات غير مدعومة. اختر صورة JPG أو PNG." : "تعذر تجهيز صورة الإثبات أو تجاوزت 10 ميغابايت. اختر صورة أخرى.");
    }
  }

  async function uploadProofImage() {
    if (!proofImage || proofUploadBusy || busy) return;
    const fingerprint = `${proofType}|${toAsciiDigits(proofNumber.trim())}`;
    if (!proofType || !toAsciiDigits(proofNumber.trim())) {
      setError("أدخل نوع الإثبات ورقمه قبل رفع الصورة الخاصة حتى يرتبط الإثبات الصحيح بالملف.");
      return;
    }
    setProofUploadBusy(true);
    setError("");
    try {
      const identity = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${current.id}:${current.version}:${proofImage.contentSha256}`);
      const updated = await uploadOwnJoiningCaseProofImage(current.id, proofImage.image, current.version, `partner_case_proof_${identity}`, `partner_case_proof_corr_${identity}`);
      preserveCorrectionDraftAtVersion.current = updated.case.version;
      onUpdated(updated);
      setProofImage(null);
      setUploadedProofFingerprint(fingerprint);
      if (!updated.case.firstStoreProofImageUploaded) setError("استجاب الخادم لكن لم تظهر صورة الإثبات كمرتبطة بالطلب. أعد قراءة الحالة قبل إعادة الإرسال.");
    } catch (cause) {
      console.warn("DSH Partner joining-case proof image upload failed", cause);
      try {
        const latest = await readOwnJoiningCase();
        if (latest.case.id === current.id && latest.case.state === "needs_correction") preserveCorrectionDraftAtVersion.current = latest.case.version;
        onUpdated(latest);
        if (latest.case.id === current.id && latest.case.firstStoreProofImageUploaded) {
          preserveCorrectionDraftAtVersion.current = latest.case.version;
          setUploadedProofFingerprint(fingerprint);
          setProofImage(null);
          setError("");
          return;
        }
      } catch (readError) {
        console.warn("DSH Partner joining-case proof image readback failed", readError);
      }
      setError("تعذر تأكيد رفع صورة الإثبات. أُعيدت قراءة الحالة؛ أعد المحاولة بالصورة نفسها لإتمام التسوية.");
    } finally {
      setProofUploadBusy(false);
    }
  }

  async function correctAndResubmit() {
    const nextOwnerName = ownerFullName.trim();
    const nextBusinessName = businessName.trim();
    const nextStoreName = firstStoreName.trim();
    const nextAddress = firstStoreAddress.trim();
    const nextProofNumber = toAsciiDigits(proofNumber.trim());
    const nextNotes = notes.trim();
    const nextWorkingHours = storeWorkingHours(workingIntervals);
    const hoursError = workingHoursIssue(nextWorkingHours.intervals);
    if (nextOwnerName.length < 2 || nextOwnerName.length > 160 || nextBusinessName.length < 2 || nextBusinessName.length > 160 || nextStoreName.length < 2 || nextStoreName.length > 160 || nextAddress.length < 4 || nextAddress.length > 500 || nextProofNumber.length < 1 || nextProofNumber.length > 128 || nextNotes.length > 1000 || !proofType || !serviceCityId || !verticalId || !commercialTypeId || latitude === null || longitude === null || fulfillmentModes.length === 0 || hoursError) {
      setError(hoursError || "أكمل اسم المالك والمتجر والنشاط والعنوان والمدينة والتصنيف والإثبات وطريقة توصيل واحدة على الأقل ضمن الحدود الموضحة.");
      return;
    }
    const requiredProofFingerprint = `${proofType}|${nextProofNumber}`;
    if (uploadedProofFingerprint !== requiredProofFingerprint) {
      setError("ارفع صورة حديثة للإثبات بعد إدخال نوعه ورقمه. لن يُعاد الإرسال بصورة قديمة مرتبطة ببيانات سابقة.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const resubmitted = await correctAndResubmitOwnJoiningCase({
        caseID: current.id,
        input: {
          ownerFullName: nextOwnerName,
          businessName: nextBusinessName,
          firstStoreName: nextStoreName,
          firstStoreAddress: nextAddress,
          serviceCityId,
          firstStoreVerticalId: verticalId,
          firstStoreCommercialTypeId: commercialTypeId,
          firstStoreLatitude: latitude,
          firstStoreLongitude: longitude,
          firstStoreWorkingHours: nextWorkingHours,
          firstStoreProofType: proofType,
          firstStoreProofNumber: nextProofNumber,
          ...(nextNotes ? { firstStoreNotes: nextNotes } : {}),
          firstStoreFulfillmentModes: [...fulfillmentModes],
        },
        expectedVersion: current.version,
      });
      onUpdated(resubmitted);
      if (!resubmitted.case.firstStoreProofImageUploaded) setError("تم تحديث حالة الطلب، لكن صورة الإثبات غير موجودة؛ لا تعتبر بيانات الانضمام مكتملة. أعد رفع الصورة بالطريقة المعتمدة ثم اقرأ الحالة من جديد.");
    } catch (nextError) {
      try {
        const latest = await readOwnJoiningCase();
        onUpdated(latest);
        const latestCase = latest.case;
        const submittedMatches = latestCase.state === "submitted"
          && latestCase.ownerFullName === nextOwnerName
          && latestCase.businessName === nextBusinessName
          && latestCase.firstStoreName === nextStoreName
          && latestCase.firstStoreAddress === nextAddress
          && latestCase.serviceCityId === serviceCityId
          && latestCase.firstStoreVerticalId === verticalId
          && latestCase.firstStoreCommercialTypeId === commercialTypeId
          && latestCase.firstStoreLatitude === latitude
          && latestCase.firstStoreLongitude === longitude
          && weeklyHoursFingerprint(latestCase.firstStoreWorkingHours) === weeklyHoursFingerprint(nextWorkingHours)
          && latestCase.firstStoreProofType === proofType
          && (latestCase.firstStoreNotes ?? "") === nextNotes
          && sameValues(latestCase.firstStoreFulfillmentModes, fulfillmentModes);
        if (submittedMatches && latestCase.firstStoreProofImageUploaded) {
          setError("");
          return;
        }
        if (submittedMatches && !latestCase.firstStoreProofImageUploaded) {
          setError("أُعيدت قراءة الطلب وهو مرسل، لكن صورة الإثبات غير موجودة؛ لا تعتبر بيانات الانضمام مكتملة. أعد رفع الصورة بالطريقة المعتمدة ثم اقرأ الحالة من جديد.");
          return;
        }
      } catch (readError) {
        console.warn("DSH Partner correction recovery read failed", readError);
      }
      const code = dshErrorCode(nextError);
      if (code === "SERVICE_CITY_UNAVAILABLE") {
        setError("مدينة الخدمة لم تعد نشطة. أعد قراءة المدن واختر مدينة أخرى قبل إعادة الإرسال.");
      } else if (code === "VERTICAL_UNAVAILABLE") {
        setError("الفئة الرئيسية لم تعد نشطة. أعد قراءة الأنشطة واختر فئة أخرى قبل إعادة الإرسال.");
      } else if (code === "COMMERCIAL_STORE_TYPE_UNAVAILABLE") {
        setError("نوع المتجر لم يعد نشطًا لهذه الفئة. أعد قراءة الأنواع واختر نوعًا متاحًا.");
      } else if (code === "VERSION_CONFLICT" || code === "STATE_CONFLICT") {
        setError("تغيّرت الحالة أثناء التصحيح. أعد قراءة حالة الانضمام ثم حاول مجددًا.");
      } else if (code === "PROOF_IMAGE_REQUIRED") {
        setError("ارفع صورة إثبات جديدة بعد إدخال الرقم والنوع الحاليين ثم أعد الإرسال.");
      } else {
        setError("تعذر حفظ التصحيح وإعادة الإرسال. تحقق من الاتصال ثم أعد المحاولة.");
      }
    } finally {
      setBusy(false);
    }
  }

  const imageUploaded = current.firstStoreProofImageUploaded;
  const proofReadyForThisCorrection = uploadedProofFingerprint === `${proofType}|${toAsciiDigits(proofNumber.trim())}` && Boolean(proofType) && Boolean(toAsciiDigits(proofNumber.trim()));
  const sortedWorkingIntervals = [...workingIntervals].sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.opensAt.localeCompare(right.opensAt) || left.closesAt.localeCompare(right.closesAt));

  return (
    <View style={styles.container} accessibilityLabel="تصحيح حالة الانضمام">
      <Text style={styles.title}>التصحيح مطلوب قبل إعادة الإرسال</Text>
      <Text style={styles.reason}>{current.correctionReason || "طلب المشغّل تصحيح البيانات."}</Text>
      <Text style={styles.phone}>رقم الهاتف المعتمد: <Text style={styles.phoneValue}>{current.contactPhoneE164}</Text></Text>
      <StoreProfileImageEditor value={value} onUpdated={onUpdated} />
      <View style={styles.evidenceBox} accessibilityLabel="حالة صورة الإثبات النظامي">
        <Text style={styles.label}>صورة الإثبات النظامي المطلوبة</Text>
        <Text accessibilityRole="alert" style={proofReadyForThisCorrection ? styles.success : styles.error}>{proofReadyForThisCorrection ? "رُفعت صورة إثبات جديدة ومطابقة لنوع الإثبات ورقمه الحاليين." : imageUploaded ? "الصورة الموجودة مرتبطة ببيانات سابقة. ارفع صورة حديثة بعد إدخال نوع الإثبات ورقمه قبل إعادة الإرسال." : "لم تُرفع صورة الإثبات بعد. لن يمكن إعادة الإرسال قبل رفعها وربطها بالطلب."}</Text>
        {!proofReadyForThisCorrection ? <>
          <Text style={styles.muted}>ستُرسل الصورة إلى مساحة إثبات خاصة بالطلب، ولا تعرض هذه الشاشة الصورة أو رابطها. صورة واجهة المتجر لا تُعد إثباتًا نظاميًا.</Text>
          <Text style={styles.muted}>أدخل نوع الإثبات ورقمه في الحقول أدناه أولًا؛ إن غيّرت أيًا منهما بعد الرفع، أعد رفع الصورة المطابقة.</Text>
          {proofImage ? <Text style={styles.muted}>تم اختيار صورة للإثبات. ارفعها لتأكيد ربطها بهذا الطلب.</Text> : null}
          <BthwaniButton disabled={proofUploadBusy || busy} label={proofImage ? "اختيار صورة إثبات أخرى" : "اختيار صورة الإثبات"} onPress={() => void chooseProofImage()} variant="secondary" />
          {proofImage ? <BthwaniButton busy={proofUploadBusy} disabled={busy} label="رفع صورة الإثبات الخاصة" onPress={() => void uploadProofImage()} variant="secondary" /> : null}
        </> : null}
        <BthwaniButton busy={evidenceLoading} disabled={busy} label="إعادة قراءة حالة الإثبات" onPress={() => void refreshEvidenceStatus()} variant="secondary" />
      </View>
      <View style={styles.locationBox}><Text style={styles.label}>موقع المتجر الثابت</Text><Text selectable style={styles.muted}>{latitude !== null && longitude !== null ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : "لم يُسجل الموقع ضمن ملف الانضمام"}</Text><Text style={styles.muted}>يُجمع الموقع مع ملف الانضمام ولا يُعدّل من شاشة إدارة المتجر.</Text></View>
      <Text style={styles.label}>اسم المالك</Text>
      <TextInput accessibilityLabel="اسم المالك" editable={!busy} maxLength={160} onChangeText={setOwnerFullName} placeholder="الاسم الكامل للمالك" value={ownerFullName} style={styles.input} />
      <Text style={styles.label}>اسم النشاط</Text>
      <TextInput accessibilityLabel="اسم النشاط" editable={!busy} maxLength={160} onChangeText={setBusinessName} placeholder="اسم النشاط" value={businessName} style={styles.input} />
      <Text style={styles.label}>اسم المتجر</Text>
      <TextInput accessibilityLabel="اسم المتجر الأول" editable={!busy} maxLength={160} onChangeText={setFirstStoreName} placeholder="اسم المتجر" value={firstStoreName} style={styles.input} />
      <Text style={styles.label}>عنوان المتجر</Text>
      <TextInput accessibilityLabel="عنوان المتجر" editable={!busy} maxLength={500} multiline onChangeText={setFirstStoreAddress} placeholder="الحي والشارع والعلامة القريبة" value={firstStoreAddress} style={[styles.input, styles.multiline]} />
      <Text style={styles.label}>مدينة المتجر الأول</Text>
      {cities.length === 0 ? <Text style={styles.muted}>لا توجد مدن خدمة مقروءة حاليًا. أعد قراءة بيانات الشريك.</Text> : null}
      <View style={styles.cityList}>{cities.map((city) => <BthwaniChip key={city.id} disabled={busy} label={city.displayNameAr} onPress={() => setServiceCityId(city.id)} selected={serviceCityId === city.id} />)}</View>
      <Text style={styles.label}>النشاط التجاري</Text>
      {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
      {optionsError ? <View style={styles.optionError}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة الأنشطة التجارية.</Text><BthwaniButton label="إعادة قراءة الأنشطة" onPress={() => void loadOptions()} variant="secondary" /></View> : null}
      <View style={styles.cityList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} disabled={busy} label={vertical.nameAr} onPress={() => { setVerticalId(vertical.id); setCommercialTypeId(""); }} selected={verticalId === vertical.id} />)}</View>
      <Text style={styles.label}>نوع المتجر التجاري</Text>
      {commercialTypesLoading ? <Text style={styles.muted}>جارٍ قراءة الأنواع لهذه الفئة…</Text> : null}
      {commercialTypesError ? <View style={styles.optionError}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة أنواع المتاجر.</Text><BthwaniButton label="إعادة قراءة الأنواع" onPress={() => { const selectedVertical = verticalId; if (selectedVertical) { setCommercialTypesError(false); setCommercialTypesLoading(true); void listCommercialStoreTypes(selectedVertical).then((items) => setCommercialTypes(items.filter((item) => item.active))).catch(() => setCommercialTypesError(true)).finally(() => setCommercialTypesLoading(false)); } }} variant="secondary" /></View> : null}
      {!commercialTypesLoading && !commercialTypesError && verticalId && commercialTypes.length === 0 ? <Text style={styles.muted}>لا توجد أنواع متاجر مفعّلة لهذه الفئة. اطلب من المشغّل إعداد النوع التجاري.</Text> : null}
      <View style={styles.cityList}>{commercialTypes.map((item) => <BthwaniChip key={item.id} disabled={busy} label={item.nameAr} onPress={() => setCommercialTypeId(item.id)} selected={commercialTypeId === item.id} />)}</View>
      <View style={styles.scheduleBox}>
        <Text style={styles.label}>ساعات العمل الأسبوعية</Text>
        <Text style={styles.muted}>الأيام بلا فترات مغلقة. أضف أكثر من فترة لليوم عند وجود استراحة، والأوقات بالتوقيت المحلي لمدينة الخدمة.</Text>
        {WEEKDAYS.map((day, index) => {
          const dayOfWeek = index + 1;
          const dayIntervals = sortedWorkingIntervals.filter((interval) => interval.dayOfWeek === dayOfWeek);
          return <View key={day} style={styles.dayCard}>
            <View style={styles.dayHeader}>
              <Text style={styles.label}>{day}</Text>
              <View style={styles.switchRow}><Text style={styles.muted}>{dayIntervals.length > 0 ? "مفتوح" : "مغلق"}</Text><Switch disabled={busy} onValueChange={(open) => setDayOpen(dayOfWeek, open)} value={dayIntervals.length > 0} /></View>
            </View>
            {dayIntervals.map((interval, intervalNumber) => {
              return <View key={interval.draftKey} style={styles.intervalCard}>
                <View style={styles.intervalInputs}>
                  <View style={styles.timeField}><Text style={styles.muted}>من</Text><TextInput accessibilityLabel={`${day} الفترة ${intervalNumber + 1} من`} editable={!busy} keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(opensAt) => updateInterval(interval.draftKey, { opensAt: toAsciiDigits(opensAt) })} placeholder="09:00" value={interval.opensAt} style={styles.timeInput} /></View>
                  <View style={styles.timeField}><Text style={styles.muted}>إلى</Text><TextInput accessibilityLabel={`${day} الفترة ${intervalNumber + 1} إلى`} editable={!busy} keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(closesAt) => updateInterval(interval.draftKey, { closesAt: toAsciiDigits(closesAt) })} placeholder="17:00" value={interval.closesAt} style={styles.timeInput} /></View>
                </View>
                <View style={styles.switchRow}><Text style={styles.muted}>ينتهي في اليوم التالي</Text><Switch disabled={busy} onValueChange={(closesNextDay) => updateInterval(interval.draftKey, { closesNextDay })} value={interval.closesNextDay} /></View>
                <BthwaniButton disabled={busy} label="حذف الفترة" onPress={() => setWorkingIntervals((items) => items.filter((candidate) => candidate.draftKey !== interval.draftKey))} variant="secondary" />
              </View>;
            })}
            {dayIntervals.length > 0 ? <BthwaniButton disabled={busy || workingIntervals.length >= 28} label="إضافة فترة أخرى" onPress={() => addDayInterval(dayOfWeek)} variant="secondary" /> : null}
          </View>;
        })}
      </View>
      <View style={styles.scheduleBox}>
        <Text style={styles.label}>نوع الإثبات</Text>
        <View style={styles.cityList}>{PROOF_TYPES.map((item) => <BthwaniChip key={item.value} disabled={busy} label={item.label} onPress={() => setProofType(item.value)} selected={proofType === item.value} />)}</View>
        <Text style={styles.label}>رقم الإثبات</Text>
        <TextInput accessibilityLabel="رقم الإثبات النظامي" editable={!busy} maxLength={128} onChangeText={(nextValue) => setProofNumber(toAsciiDigits(nextValue))} placeholder="رقم السجل أو الوثيقة" value={proofNumber} style={styles.input} />
      </View>
      <View style={styles.scheduleBox}>
        <Text style={styles.label}>طريقة التوصيل والاستلام</Text>
        <Text style={styles.muted}>اختر طريقة واحدة على الأقل، ويمكن اختيار أكثر من طريقة.</Text>
        <View style={styles.cityList}>{FULFILLMENT_MODES.map((item) => <BthwaniChip key={item.value} disabled={busy} label={item.label} onPress={() => setFulfillmentModes((selected) => selected.includes(item.value) ? selected.filter((mode) => mode !== item.value) : [...selected, item.value])} selected={fulfillmentModes.includes(item.value)} />)}</View>
      </View>
      <Text style={styles.label}>ملاحظات (اختياري)</Text>
      <TextInput accessibilityLabel="ملاحظات طلب الانضمام" editable={!busy} maxLength={1000} multiline onChangeText={setNotes} placeholder="أي تفاصيل إضافية تساعد في مراجعة الطلب" value={notes} style={[styles.input, styles.multiline]} />
      <View style={styles.locationBox}><Text style={styles.label}>أوضاع الطلب المثبتة عند الانضمام</Text><Text style={styles.muted}>{current.firstStoreFulfillmentModes.map(fulfillmentModeLabel).join(" · ") || "لم تُحدد طريقة توصيل بعد"}</Text><Text style={styles.muted}>اختيارك أعلاه سيُحفظ مع التصحيح ذريًا. بعد إنشاء المتجر يديره المشغّل من لوحة التحكم.</Text></View>
      <BthwaniButton busy={busy} disabled={optionsLoading || evidenceLoading || proofUploadBusy || !proofReadyForThisCorrection} label="حفظ التصحيح وإعادة الإرسال" onPress={() => void correctAndResubmit()} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function fulfillmentModeLabel(mode: StoreFulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "توصيل بثواني";
  if (mode === "CUSTOMER_PICKUP") return "استلم بنفسك من المتجر";
  return "توصيل الشريك";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.warningSoft, borderColor: theme.warning, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], marginTop: spacing[3], padding: spacing[3] },
    title: { ...typography.bodyStrong, color: theme.warning },
    reason: { ...typography.bodySm, color: theme.color },
    phone: { ...typography.label, color: theme.colorSecondary },
    phoneValue: { writingDirection: "ltr" },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[2] },
    multiline: { minHeight: sizing.controlLg, paddingVertical: spacing[2], textAlignVertical: "top" },
    timeInput: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[2], textAlign: "center", writingDirection: "ltr" },
    timeField: { flex: 1, gap: spacing[1] },
    label: { ...typography.label, color: theme.color },
    cityList: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    error: { ...typography.label, color: theme.danger },
    success: { ...typography.label, color: theme.success },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    optionError: { gap: spacing[2] },
    locationBox: { backgroundColor: theme.structureSoft, borderRadius: radius.sm, gap: spacing[1], padding: spacing[2] },
    evidenceBox: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2] },
    scheduleBox: { backgroundColor: theme.structureSoft, borderRadius: radius.sm, gap: spacing[2], padding: spacing[2] },
    dayCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2] },
    dayHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
    intervalCard: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2] },
    intervalInputs: { flexDirection: "row", gap: spacing[2] },
    switchRow: { alignItems: "center", flexDirection: "row", gap: spacing[1] },
  });
}
