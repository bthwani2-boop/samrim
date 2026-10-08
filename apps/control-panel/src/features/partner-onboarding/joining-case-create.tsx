"use client";

import { normalizeYemenPhoneE164, toAsciiDigits } from "@bthwani/design-system";
import { isValidStoreWorkingHours, type CommerceVertical, type CommercialStoreType, type CreateJoiningCaseRequest, type JoiningCaseProofType, type JoiningCaseResponse, type ServiceCity, type StoreWorkingHoursInterval } from "@bthwani/dsh";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../session/session-provider";
import { partnerErrorMessage } from "./partner-error-message";
import type { WalletProviderOption } from "../wallet-provider/use-wallet-providers";

const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;
type JoiningCaseCreateInput = CreateJoiningCaseRequest;
type PendingJoiningCaseCreate = Readonly<{
  input: JoiningCaseCreateInput | null;
  idempotencyKey: string;
  correlationId: string;
}>;
type PendingJoiningCaseMetadata = Readonly<Pick<PendingJoiningCaseCreate, "idempotencyKey" | "correlationId">>;

function parsePendingJoiningCaseMetadata(raw: string): PendingJoiningCaseMetadata | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const idempotencyKey = candidate.idempotencyKey;
  const correlationId = candidate.correlationId;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  if (typeof idempotencyKey !== "string" || !new RegExp(`^partner_joining_case_create_${uuid}$`, "i").test(idempotencyKey)) return null;
  if (typeof correlationId !== "string" || !new RegExp(`^partner_joining_case_create_corr_${uuid}$`, "i").test(correlationId)) return null;
  return { idempotencyKey, correlationId };
}

function clearPendingJoiningCaseMetadata(storageKey: string): void {
  try { window.sessionStorage.removeItem(storageKey); } catch { /* Replaying the same key remains safe. */ }
}

function commercialTypePrompt(verticalId: string, loading: boolean): string {
  if (!verticalId) return "اختر النشاط الرئيسي أولاً";
  if (loading) return "جارٍ تحميل الأنواع…";
  return "اختر نوع المتجر";
}

function toggleFulfillmentMode(current: JoiningCaseCreateInput["firstStoreFulfillmentModes"], mode: JoiningCaseCreateInput["firstStoreFulfillmentModes"][number], checked: boolean) {
  if (checked) return current.includes(mode) ? current : [...current, mode];
  return current.filter((item) => item !== mode);
}

function createButtonLabel(busy: boolean, hasPendingAttempt: boolean): string {
  if (busy) return "جارٍ إنشاء الحالة…";
  if (hasPendingAttempt) return "إعادة محاولة إنشاء الحالة";
  return "إنشاء حالة انضمام";
}

const proofTypeOptions: ReadonlyArray<{ value: JoiningCaseProofType; label: string }> = [
  { value: "COMMERCIAL_REGISTRATION", label: "سجل تجاري" },
  { value: "IDENTITY_DOCUMENT", label: "هوية" },
  { value: "FREELANCE_WORK_DOCUMENT", label: "وثيقة عمل حر" },
];
const weekdays = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"] as const;

function emptyWorkingHours(): StoreWorkingHoursInterval[] {
  return [];
}

export function JoiningCaseCreate() {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const operatorActorId = sessionState.kind === "authenticated" ? sessionState.identity.subject : "";
  const pendingStorageKey = useMemo(() => operatorActorId ? `bthwani.control.partner.joining-case-create.v1.${encodeURIComponent(operatorActorId)}` : "", [operatorActorId]);
  const [phone, setPhone] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [walletProviderKey, setWalletProviderKey] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [proofType, setProofType] = useState<JoiningCaseProofType>("COMMERCIAL_REGISTRATION");
  const [proofNumber, setProofNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [serviceCityId, setServiceCityId] = useState("");
  const [verticalId, setVerticalId] = useState("");
  const [commercialTypeId, setCommercialTypeId] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [fulfillmentModes, setFulfillmentModes] = useState<ReadonlyArray<"BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP">>([]);
  const [workingDays, setWorkingDays] = useState<ReadonlyArray<number>>([]);
  const [workingHours, setWorkingHours] = useState<ReadonlyArray<StoreWorkingHoursInterval>>(emptyWorkingHours);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [walletProviders, setWalletProviders] = useState<ReadonlyArray<WalletProviderOption>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [commercialTypes, setCommercialTypes] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const [commercialTypesBusy, setCommercialTypesBusy] = useState(false);
  const [commercialTypesError, setCommercialTypesError] = useState("");
  const [optionsBusy, setOptionsBusy] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [hydratedPendingStorageKey, setHydratedPendingStorageKey] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PendingJoiningCaseCreate | null>(null);
  const [createdCaseId, setCreatedCaseId] = useState("");
  const attemptReady = sessionState.kind !== "loading" && hydratedPendingStorageKey === pendingStorageKey && !storageError;

  useEffect(() => {
    setPendingAttempt(null);
    setHydratedPendingStorageKey("");
    setStorageError("");
    setError("");
    if (!pendingStorageKey) return;
    try {
      const raw = window.sessionStorage.getItem(pendingStorageKey);
      if (raw) {
        const metadata = parsePendingJoiningCaseMetadata(raw);
        if (!metadata) {
          setStorageError("تعذر التحقق من محاولة سابقة. أوقفنا الإرسال لمنع إنشاء حالة مكررة؛ افتح طابور الانضمام وتحقق من الحالة قبل المتابعة.");
          return;
        }
        // Replace legacy entries without restoring their private request payload into form state.
        const safeMetadata = JSON.stringify(metadata);
        if (raw !== safeMetadata) window.sessionStorage.setItem(pendingStorageKey, safeMetadata);
        setPendingAttempt({ input: null, ...metadata });
      }
      setHydratedPendingStorageKey(pendingStorageKey);
    } catch {
      setStorageError("تعذر قراءة محاولة الإنشاء أو حصرها بالبيانات غير الحساسة. لم يُرسل أي طلب جديد.");
    }
  }, [pendingStorageKey]);

  const loadOptions = useCallback(async () => {
    setOptionsBusy(true);
    setOptionsError("");
    try {
      const [citiesResponse, verticalsResponse, providersResponse] = await Promise.all([
        fetch("/api/service-cities", { cache: "no-store" }),
        fetch("/api/catalog/verticals", { cache: "no-store" }),
        fetch("/api/wallet-providers", { cache: "no-store" }),
      ]);
      if (!citiesResponse.ok || !verticalsResponse.ok || !providersResponse.ok) {
        setOptionsError("تعذر قراءة المدن أو الفئات الرئيسية أو المحافظ الرسمية.");
        return;
      }
      setCities((await citiesResponse.json() as { cities: ReadonlyArray<ServiceCity> }).cities);
      setVerticals((await verticalsResponse.json() as { verticals: ReadonlyArray<CommerceVertical> }).verticals);
      setWalletProviders((await providersResponse.json() as { walletProviders: ReadonlyArray<WalletProviderOption> }).walletProviders);
    } catch {
      setOptionsError("تعذر قراءة المدن أو الفئات الرئيسية أو المحافظ الرسمية.");
    } finally {
      setOptionsBusy(false);
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  useEffect(() => {
    setCommercialTypes([]);
    setCommercialTypeId("");
    setCommercialTypesError("");
    if (!verticalId) return;
    const controller = new AbortController();
    setCommercialTypesBusy(true);
    void fetch(`/api/catalog/commercial-store-types?verticalId=${encodeURIComponent(verticalId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("COMMERCIAL_STORE_TYPES_UNAVAILABLE");
        const payload = await response.json() as { storeTypes?: ReadonlyArray<CommercialStoreType> };
        setCommercialTypes(payload.storeTypes ?? []);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setCommercialTypesError("تعذر تحميل أنواع المتاجر لهذه الفئة.");
      })
      .finally(() => setCommercialTypesBusy(false));
    return () => controller.abort();
  }, [verticalId]);

  async function createCase() {
    const currentInput: JoiningCaseCreateInput = {
      contactPhoneE164: normalizeYemenPhoneE164(phone),
      ownerFullName: ownerFullName.trim(),
      walletProviderKey: walletProviderKey.trim(),
      businessName: businessName.trim(),
      firstStoreName: storeName.trim(),
      firstStoreAddress: storeAddress.trim(),
      serviceCityId,
      firstStoreVerticalId: verticalId,
      firstStoreCommercialTypeId: commercialTypeId,
      firstStoreLatitude: Number(latitude),
      firstStoreLongitude: Number(longitude),
      firstStoreWorkingHours: { intervals: [...workingHours] },
      firstStoreProofType: proofType,
      firstStoreProofNumber: proofNumber.trim(),
      ...(notes.trim() ? { firstStoreNotes: notes.trim() } : {}),
      firstStoreFulfillmentModes: fulfillmentModes,
    };
    const metadata = pendingAttempt ?? {
      idempotencyKey: `partner_joining_case_create_${crypto.randomUUID()}`,
      correlationId: `partner_joining_case_create_corr_${crypto.randomUUID()}`,
    };
    const input = pendingAttempt?.input ?? currentInput;
    const isResumedAttempt = pendingAttempt !== null && pendingAttempt.input === null;
    const attempt: PendingJoiningCaseCreate = { ...metadata, input };
    if (!phoneE164Pattern.test(input.contactPhoneE164) || input.ownerFullName.trim().length < 2 || Array.from(input.walletProviderKey.trim()).length < 1 || Array.from(input.walletProviderKey.trim()).length > 64 || /\p{Cc}/u.test(input.walletProviderKey) || input.businessName.length < 2 || input.firstStoreName.length < 2 || input.firstStoreAddress.trim().length < 4 || !input.serviceCityId || !input.firstStoreVerticalId || !input.firstStoreCommercialTypeId || input.firstStoreProofNumber.length < 1 || !isValidStoreWorkingHours(input.firstStoreWorkingHours.intervals) || input.firstStoreFulfillmentModes.length === 0 || !latitude.trim() || !longitude.trim() || !Number.isFinite(input.firstStoreLatitude) || !Number.isFinite(input.firstStoreLongitude) || input.firstStoreLatitude < -90 || input.firstStoreLatitude > 90 || input.firstStoreLongitude < -180 || input.firstStoreLongitude > 180) {
      setError("أكمل مزوّد المحفظة الذي حدده المالك، واسمه ورقم جواله وبيانات المتجر والموقع وساعات العمل والإثبات وطريقة التوصيل.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!pendingStorageKey) {
        setError("تعذر تحديد جلسة المشغّل لحفظ محاولة الإنشاء. لم يُرسل أي طلب.");
        return;
      }
      try {
        // Store only replay identifiers; proof numbers and the rest of the request stay out of browser storage.
        window.sessionStorage.setItem(pendingStorageKey, JSON.stringify({ idempotencyKey: attempt.idempotencyKey, correlationId: attempt.correlationId }));
      } catch {
        setError("تعذر حفظ محاولة الإنشاء في جلسة المتصفح. لم يُرسل أي طلب.");
        return;
      }
      setPendingAttempt(attempt);
      const response = await fetch("/api/partners/joining-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.clone().json().catch(() => null) as { error?: { code?: unknown } } | null;
        const idempotencyConflict = body?.error?.code === "IDEMPOTENCY_CONFLICT";
        const message = await partnerErrorMessage(response);
        if (idempotencyConflict) {
          setPendingAttempt({ ...attempt, input: null });
          setError("لم تطابق البيانات المحاولة المحفوظة. أعد إدخال بيانات الطلب الأصلية كما أُرسلت أول مرة لمنع إنشاء حالة مكررة.");
        } else if (isResumedAttempt) {
          setPendingAttempt({ ...attempt, input: null });
          setError(`${message} أعد إدخال بيانات المحاولة الأصلية ثم أعد المحاولة؛ لا تبدأ طلباً جديداً قبل تأكيد النتيجة.`);
        } else if (response.status < 500 && response.status !== 408) {
          clearPendingJoiningCaseMetadata(pendingStorageKey);
          setPendingAttempt(null);
          setError(message);
        } else {
          setError(`${message} أعد المحاولة بالبيانات نفسها للتحقق. بعد إعادة التحميل أعد إدخالها؛ لا يحفظ المتصفح بيانات الإثبات.`);
        }
        return;
      }
      const payload = await response.json() as JoiningCaseResponse;
      if (typeof payload?.case?.id !== "string" || !payload.case.id.trim() || payload.case.walletProviderKey !== input.walletProviderKey) throw new Error("JOINING_CASE_READBACK_REQUIRED");
      clearPendingJoiningCaseMetadata(pendingStorageKey);
      setCreatedCaseId(payload.case.id);
      setPendingAttempt(null);
      router.push(`/partners/${encodeURIComponent(payload.case.id)}`);
    } catch {
      setPendingAttempt(isResumedAttempt ? { ...attempt, input: null } : attempt);
      setError("تعذر تأكيد إنشاء حالة الانضمام. أعد المحاولة بالبيانات الأصلية؛ بعد إعادة التحميل أعد إدخالها، ولا يحفظ المتصفح بيانات الإثبات.");
    } finally {
      setBusy(false);
    }
  }

  const activeCities = cities.filter((city) => city.active);
  const activeVerticals = verticals.filter((vertical) => vertical.active);
  const activeCommercialTypes = commercialTypes.filter((item) => item.active && item.verticalId === verticalId);
  const commercialTypePlaceholder = commercialTypePrompt(verticalId, commercialTypesBusy);
  const hasNoActiveCommercialTypes = Boolean(verticalId && !commercialTypesBusy && !commercialTypesError && activeCommercialTypes.length === 0);
  const pendingRequestLocked = Boolean(pendingAttempt?.input);
  function setWorkingDayOpen(dayOfWeek: number, open: boolean) {
    setWorkingDays((current) => open ? [...new Set([...current, dayOfWeek])] : current.filter((day) => day !== dayOfWeek));
    setWorkingHours((current) => open
      ? current.some((interval) => interval.dayOfWeek === dayOfWeek) ? current : [...current, { dayOfWeek, opensAt: "09:00", closesAt: "17:00", closesNextDay: false }]
      : current.filter((interval) => interval.dayOfWeek !== dayOfWeek));
  }
  function updateWorkingInterval(dayOfWeek: number, patch: Partial<StoreWorkingHoursInterval>) {
    setWorkingHours((current) => current.map((interval) => interval.dayOfWeek === dayOfWeek ? { ...interval, ...patch } : interval));
  }
  return (
    <section className="access-card" aria-labelledby="joining-case-create-title">
      <div className="access-card-heading">
        <span className="step-chip">المورد: حالة انضمام</span>
        <p className="eyebrow">بيانات البداية</p>
        <h2 id="joining-case-create-title">إنشاء حالة انضمام جديدة</h2>
        <p className="muted">أدخل معلومات المالك والمتجر. بعد حفظ المسودة تُرفع صورة الإثبات الخاصة وصورة واجهة المتجر في شاشة الحالة عبر المسارات المخصصة لكل منهما.</p>
      </div>
      {storageError ? <p className="identity-error" role="alert">{storageError} <Link href="/partners">افتح طابور الانضمام</Link></p> : null}
      {optionsError ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر تحميل الخيارات</strong><p>{optionsError}</p><button type="button" className="button button-secondary" disabled={optionsBusy || busy} onClick={() => void loadOptions()}>إعادة قراءة الخيارات</button></div> : null}
      {!optionsBusy && !optionsError && (activeCities.length === 0 || activeVerticals.length === 0) ? <div className="managed-status managed-status-warning" role="alert"><strong>لا يمكن إنشاء الحالة بعد</strong><p>تحتاج الحالة إلى مدينة خدمة نشطة وفئة رئيسية نشطة.</p><Link className="button button-secondary" href="/policies/service-cities">فتح مدن الخدمة</Link></div> : null}
      {pendingAttempt ? <p className="managed-status managed-status-warning" role="status">{pendingRequestLocked ? "المحاولة السابقة لم تصل إلى نتيجة مؤكدة. بياناتها مقفلة في هذه الصفحة وستُعاد كما هي." : "وجدنا محاولة سابقة غير محسومة. أعد إدخال بياناتها الأصلية تماماً لإعادة المحاولة دون تكرار العملية؛ يحفظ المتصفح بيانات المتابعة فقط ولا يحفظ بيانات المالك أو الإثبات."}</p> : null}
      {createdCaseId ? <p className="managed-status managed-status-info" role="status">قُرئت الحالة المعتمدة بعد الإنشاء. <Link href={`/partners/${encodeURIComponent(createdCaseId)}`}>افتح حالة الانضمام</Link></p> : null}
      <div className="access-form">
        <label className="field-label" htmlFor="joining-owner">اسم المالك الكامل<input id="joining-owner" autoComplete="name" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} value={ownerFullName} onChange={(event) => setOwnerFullName(event.target.value)} /></label>
        <label className="field-label" htmlFor="joining-phone">رقم جوال المالك<input id="joining-phone" autoComplete="tel" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} placeholder="مثال: 777000100 أو +967777000100" /></label>
        <label className="field-label" htmlFor="joining-wallet-provider">مزوّد المحفظة الذي حدده المالك<select id="joining-wallet-provider" aria-required="true" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} value={walletProviderKey} onChange={(event) => setWalletProviderKey(event.target.value)}><option value="">اختر محفظة رسمية</option>{walletProviderKey && !walletProviders.some((provider) => provider.key === walletProviderKey) ? <option value={walletProviderKey}>{walletProviderKey} · قيمة سابقة محفوظة</option> : null}{walletProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.displayNameAr}</option>)}</select><small>سجّل المزوّد فقط. لا تدخل رقم المحفظة أو الاسم القانوني هنا.</small></label>
        <label className="field-label" htmlFor="joining-business">الاسم القانوني للنشاط<input id="joining-business" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></label>
        <label className="field-label" htmlFor="joining-store">اسم المتجر الأول<input id="joining-store" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} value={storeName} onChange={(event) => setStoreName(event.target.value)} /></label>
        <label className="field-label" htmlFor="joining-address">عنوان المتجر<textarea id="joining-address" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} value={storeAddress} onChange={(event) => setStoreAddress(event.target.value)} placeholder="الحي والشارع وأقرب معلم" rows={3} /></label>
        <label className="field-label" htmlFor="joining-city">مدينة المتجر الأول<select id="joining-city" disabled={busy || optionsBusy || Boolean(optionsError) || pendingRequestLocked || !attemptReady} value={serviceCityId} onChange={(event) => setServiceCityId(event.target.value)}><option value="">اختر مدينة نشطة</option>{activeCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="joining-vertical">النشاط الرئيسي<select id="joining-vertical" disabled={busy || optionsBusy || Boolean(optionsError) || pendingRequestLocked || !attemptReady} value={verticalId} onChange={(event) => setVerticalId(event.target.value)}><option value="">اختر النشاط الرئيسي</option>{activeVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}</select></label>
         <label className="field-label" htmlFor="joining-commercial-type">نوع المتجر التجاري<select id="joining-commercial-type" disabled={busy || optionsBusy || commercialTypesBusy || !verticalId || Boolean(commercialTypesError) || pendingRequestLocked || !attemptReady} value={commercialTypeId} onChange={(event) => setCommercialTypeId(event.target.value)}><option value="">{commercialTypePlaceholder}</option>{activeCommercialTypes.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select>{commercialTypesError ? <span className="identity-error" role="alert">{commercialTypesError}</span> : null}{hasNoActiveCommercialTypes ? <span className="muted">لا توجد أنواع نشطة لهذه الفئة. أضف النوع من سجل أنواع المتاجر قبل إنشاء الحالة.</span> : null}</label>
        <fieldset className="field-label" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady}>
          <legend>ساعات العمل الأسبوعية · توقيت المدينة</legend>
          {weekdays.map((label, index) => {
            const dayOfWeek = index + 1;
            const interval = workingHours.find((item) => item.dayOfWeek === dayOfWeek);
            return <div key={dayOfWeek} className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-2">
              <label className="flex min-w-24 items-center gap-2"><input type="checkbox" checked={workingDays.includes(dayOfWeek)} onChange={(event) => setWorkingDayOpen(dayOfWeek, event.target.checked)} />{label}</label>
              {interval ? <>
                <label className="field-label">من<input type="time" value={interval.opensAt} onChange={(event) => updateWorkingInterval(dayOfWeek, { opensAt: event.target.value })} /></label>
                <label className="field-label">إلى<input type="time" value={interval.closesAt} onChange={(event) => updateWorkingInterval(dayOfWeek, { closesAt: event.target.value })} /></label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={interval.closesNextDay} onChange={(event) => updateWorkingInterval(dayOfWeek, { closesNextDay: event.target.checked })} />ينتهي في اليوم التالي</label>
              </> : <span className="muted">مغلق</span>}
            </div>;
          })}
        </fieldset>
        <label className="field-label" htmlFor="joining-proof-type">نوع الإثبات<select id="joining-proof-type" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} value={proofType} onChange={(event) => setProofType(event.target.value as JoiningCaseProofType)}>{proofTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="field-label" htmlFor="joining-proof-number">رقم الإثبات<input id="joining-proof-number" autoComplete="off" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} value={proofNumber} onChange={(event) => setProofNumber(event.target.value)} /></label>
        <label className="field-label" htmlFor="joining-notes">ملاحظات (اختياري)<textarea id="joining-notes" maxLength={1000} disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label>
        <p className="muted">حدّد الموقع من تطبيق الميدان أو من خريطة خارجية ثم أدخل الإحداثيات هنا. سترتبط النقطة بحالة الانضمام والمتجر عند الاعتماد.</p>
        <label className="field-label" htmlFor="joining-latitude">خط عرض موقع المتجر<input id="joining-latitude" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} inputMode="decimal" value={latitude} onChange={(event) => setLatitude(toAsciiDigits(event.target.value))} placeholder="مثال: 15.369445" /></label>
        <label className="field-label" htmlFor="joining-longitude">خط طول موقع المتجر<input id="joining-longitude" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady} inputMode="decimal" value={longitude} onChange={(event) => setLongitude(toAsciiDigits(event.target.value))} placeholder="مثال: 44.191006" /></label>
        {Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && latitude.trim() && longitude.trim() ? <a className="button button-secondary" href={`https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}&mlon=${encodeURIComponent(longitude)}#map=18/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`} target="_blank" rel="noreferrer">معاينة موقع المتجر على الخريطة</a> : null}
        <fieldset className="field-label" disabled={busy || optionsBusy || pendingRequestLocked || !attemptReady}>
          <legend>أوضاع الطلب التي اختارها الشريك عند الانضمام</legend>
          <label><input type="checkbox" checked={fulfillmentModes.includes("BTHWANI_CAPTAIN")} onChange={(event) => setFulfillmentModes((current) => toggleFulfillmentMode(current, "BTHWANI_CAPTAIN", event.target.checked))} /> توصيل بثواني · مسؤولية المنصة</label>
          <label><input type="checkbox" checked={fulfillmentModes.includes("PARTNER_CAPTAIN")} onChange={(event) => setFulfillmentModes((current) => toggleFulfillmentMode(current, "PARTNER_CAPTAIN", event.target.checked))} /> توصيل المتجر · يختار المتجر أحد كباتنه</label>
          <label><input type="checkbox" checked={fulfillmentModes.includes("CUSTOMER_PICKUP")} onChange={(event) => setFulfillmentModes((current) => toggleFulfillmentMode(current, "CUSTOMER_PICKUP", event.target.checked))} /> استلم بنفسك من المتجر</label>
          <span className="muted">تُثبت هذه الإتاحة عند الانضمام، وتظهر للعميل الخيارات المفعّلة فقط. تغييرها بعد إنشاء المتجر متاح للمشغّل في لوحة التحكم.</span>
        </fieldset>
        <button type="button" className="button button-primary" disabled={busy || Boolean(createdCaseId) || !attemptReady || optionsBusy || Boolean(optionsError) || commercialTypesBusy || Boolean(commercialTypesError) || activeCities.length === 0 || activeVerticals.length === 0 || activeCommercialTypes.length === 0} onClick={() => void createCase()}>{createButtonLabel(busy, Boolean(pendingAttempt))}</button>
      </div>
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
      <Link className="button button-secondary" href="/partners">العودة إلى الطابور</Link>
    </section>
  );
}
