"use client";

import { toAsciiDigits } from "@bthwani/design-system";
import type { CommercialStoreType, CommerceVertical, JoiningCaseResponse, ServiceCity } from "@bthwani/dsh";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import { useSession } from "../../session/session-provider";

const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;
const fulfillmentModeValues = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] as const;
type JoiningCaseCreateInput = Readonly<{
  contactPhoneE164: string;
  businessName: string;
  firstStoreName: string;
  serviceCityId: string;
  firstStoreVerticalId: string;
  firstStoreCommercialTypeId: string;
  firstStoreLatitude: number;
  firstStoreLongitude: number;
  firstStoreFulfillmentModes: ReadonlyArray<(typeof fulfillmentModeValues)[number]>;
}>;
type PendingJoiningCaseCreate = Readonly<{
  input: JoiningCaseCreateInput;
  idempotencyKey: string;
  correlationId: string;
}>;

function toggleFulfillmentMode(current: JoiningCaseCreateInput["firstStoreFulfillmentModes"], mode: JoiningCaseCreateInput["firstStoreFulfillmentModes"][number], checked: boolean) {
  if (checked) return current.includes(mode) ? current : [...current, mode];
  return current.filter((item) => item !== mode);
}

function createButtonLabel(busy: boolean, hasPendingAttempt: boolean): string {
  if (busy) return "جارٍ إنشاء الحالة…";
  if (hasPendingAttempt) return "إعادة محاولة إنشاء الحالة";
  return "إنشاء حالة انضمام";
}

function readPendingCreate(raw: string | null): PendingJoiningCaseCreate | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingJoiningCaseCreate>;
    const input = value.input as Partial<JoiningCaseCreateInput> | undefined;
    if (!input || typeof input.contactPhoneE164 !== "string" || typeof input.businessName !== "string" || typeof input.firstStoreName !== "string" || typeof input.serviceCityId !== "string" || typeof input.firstStoreVerticalId !== "string" || typeof input.firstStoreCommercialTypeId !== "string" || !input.firstStoreCommercialTypeId || typeof input.firstStoreLatitude !== "number" || !Number.isFinite(input.firstStoreLatitude) || typeof input.firstStoreLongitude !== "number" || !Number.isFinite(input.firstStoreLongitude) || !Array.isArray(input.firstStoreFulfillmentModes) || input.firstStoreFulfillmentModes.length < 1 || input.firstStoreFulfillmentModes.some((mode) => typeof mode !== "string" || !fulfillmentModeValues.includes(mode as (typeof fulfillmentModeValues)[number])) || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 8 || value.idempotencyKey.length > 128 || typeof value.correlationId !== "string" || value.correlationId.length < 8 || value.correlationId.length > 128) return null;
    return {
      input: { ...input, firstStoreFulfillmentModes: input.firstStoreFulfillmentModes as JoiningCaseCreateInput["firstStoreFulfillmentModes"] } as JoiningCaseCreateInput,
      idempotencyKey: value.idempotencyKey,
      correlationId: value.correlationId,
    };
  } catch {
    return null;
  }
}

function clearPendingCreate(storageKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // A stale value can only replay this exact idempotent request.
  }
}

export function JoiningCaseCreate() {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const operatorActorId = sessionState.kind === "authenticated" ? sessionState.identity.subject : "";
  const pendingStorageKey = useMemo(() => operatorActorId ? `bthwani.control.partner.joining-case-create.v1.${encodeURIComponent(operatorActorId)}` : "", [operatorActorId]);
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [serviceCityId, setServiceCityId] = useState("");
  const [verticalId, setVerticalId] = useState("");
  const [commercialTypeId, setCommercialTypeId] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [fulfillmentModes, setFulfillmentModes] = useState<ReadonlyArray<"BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP">>([]);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [commercialTypes, setCommercialTypes] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const [commercialTypesBusy, setCommercialTypesBusy] = useState(false);
  const [commercialTypesError, setCommercialTypesError] = useState("");
  const [optionsBusy, setOptionsBusy] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PendingJoiningCaseCreate | null>(null);
  const [createdCaseId, setCreatedCaseId] = useState("");
  const [loadedStorageKey, setLoadedStorageKey] = useState("");
  const attemptReady = pendingStorageKey ? loadedStorageKey === pendingStorageKey : sessionState.kind !== "loading";

  useEffect(() => {
    setPendingAttempt(null);
    setLoadedStorageKey("");
    if (!pendingStorageKey) {
      return;
    }
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(pendingStorageKey);
    } catch {
      setError("تعذر قراءة المحاولة السابقة من تخزين الجلسة. لم يُرسل أي طلب جديد بعد.");
      setLoadedStorageKey(pendingStorageKey);
      return;
    }
    const restored = readPendingCreate(raw);
    if (restored) {
      setPendingAttempt(restored);
      setPhone(restored.input.contactPhoneE164);
      setBusinessName(restored.input.businessName);
      setStoreName(restored.input.firstStoreName);
      setServiceCityId(restored.input.serviceCityId);
      setVerticalId(restored.input.firstStoreVerticalId);
      setCommercialTypeId(restored.input.firstStoreCommercialTypeId);
      setLatitude(String(restored.input.firstStoreLatitude));
      setLongitude(String(restored.input.firstStoreLongitude));
      setFulfillmentModes(restored.input.firstStoreFulfillmentModes);
      setError("توجد محاولة حفظ لم تُحسم بعد؛ ستعيد المحاولة قراءة النتيجة بالمفتاح نفسه.");
    } else if (raw) {
      clearPendingCreate(pendingStorageKey);
    }
    setLoadedStorageKey(pendingStorageKey);
  }, [pendingStorageKey]);

  const loadOptions = useCallback(async () => {
    setOptionsBusy(true);
    setOptionsError("");
    try {
      const [citiesResponse, verticalsResponse] = await Promise.all([
        fetch("/api/service-cities", { cache: "no-store" }),
        fetch("/api/catalog/verticals", { cache: "no-store" }),
      ]);
      if (!citiesResponse.ok || !verticalsResponse.ok) {
        setOptionsError("تعذر قراءة المدن أو الفئات الرئيسية.");
        return;
      }
      setCities((await citiesResponse.json() as { cities: ReadonlyArray<ServiceCity> }).cities);
      setVerticals((await verticalsResponse.json() as { verticals: ReadonlyArray<CommerceVertical> }).verticals);
    } catch {
      setOptionsError("تعذر قراءة المدن أو الفئات الرئيسية.");
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
    const input: JoiningCaseCreateInput = {
      contactPhoneE164: phone.replace(/\s+/g, ""),
      businessName: businessName.trim(),
      firstStoreName: storeName.trim(),
      serviceCityId,
      firstStoreVerticalId: verticalId,
      firstStoreCommercialTypeId: commercialTypeId,
      firstStoreLatitude: Number(latitude),
      firstStoreLongitude: Number(longitude),
      firstStoreFulfillmentModes: fulfillmentModes,
    };
    if (!phoneE164Pattern.test(input.contactPhoneE164) || input.businessName.length < 2 || input.firstStoreName.length < 2 || !input.serviceCityId || !input.firstStoreVerticalId || !input.firstStoreCommercialTypeId || input.firstStoreFulfillmentModes.length === 0 || !Number.isFinite(input.firstStoreLatitude) || !Number.isFinite(input.firstStoreLongitude) || input.firstStoreLatitude < -90 || input.firstStoreLatitude > 90 || input.firstStoreLongitude < -180 || input.firstStoreLongitude > 180) {
      setError("أدخل بيانات النشاط والمتجر ومدينة الخدمة والفئة الرئيسية ونوع المتجر وإحداثيات الموقع.");
      return;
    }
    setBusy(true);
    setError("");
    const attempt = pendingAttempt ?? {
      input,
      idempotencyKey: `partner_joining_case_create_${crypto.randomUUID()}`,
      correlationId: `partner_joining_case_create_corr_${crypto.randomUUID()}`,
    };
    if (!pendingAttempt) {
      setPendingAttempt(attempt);
      try {
        window.sessionStorage.setItem(pendingStorageKey, JSON.stringify(attempt));
      } catch {
        setPendingAttempt(null);
        setBusy(false);
        setError("تعذر حفظ مفتاح المحاولة بأمان في هذه الجلسة؛ لم يُرسل طلب الإنشاء. فعّل تخزين الجلسة ثم أعد المحاولة.");
        return;
      }
    }
    try {
      const response = await fetch("/api/partners/joining-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId },
        body: JSON.stringify(attempt.input),
      });
      if (!response.ok) {
        const message = await partnerErrorMessage(response);
        if (response.status < 500 && response.status !== 408) {
          setPendingAttempt(null);
          clearPendingCreate(pendingStorageKey);
          setError(message);
        } else {
          setError(`${message} أعد المحاولة بالبيانات نفسها للتحقق بالمفتاح المحفوظ.`);
        }
        return;
      }
      const payload = await response.json() as JoiningCaseResponse;
      if (typeof payload?.case?.id !== "string" || !payload.case.id.trim()) throw new Error("JOINING_CASE_READBACK_REQUIRED");
      setCreatedCaseId(payload.case.id);
      setPendingAttempt(null);
      clearPendingCreate(pendingStorageKey);
      router.push(`/partners/${encodeURIComponent(payload.case.id)}`);
    } catch {
      setError("تعذر تأكيد إنشاء حالة الانضمام. أعد المحاولة بالبيانات نفسها للتحقق بالمفتاح المحفوظ.");
    } finally {
      setBusy(false);
    }
  }

  const activeCities = cities.filter((city) => city.active);
  const activeVerticals = verticals.filter((vertical) => vertical.active);
  const activeCommercialTypes = commercialTypes.filter((item) => item.active && item.verticalId === verticalId);
  return (
    <section className="access-card" aria-labelledby="joining-case-create-title">
      <div className="access-card-heading">
        <span className="step-chip">المورد: حالة انضمام</span>
        <p className="eyebrow">بيانات البداية</p>
        <h2 id="joining-case-create-title">إنشاء حالة انضمام جديدة</h2>
        <p className="muted">بعد الإنشاء ستنتقل إلى قراءة الحالة الكانونية وتنفذ فقط العملية المتاحة بحسب حالتها.</p>
      </div>
      {optionsError ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر تحميل الخيارات</strong><p>{optionsError}</p><button type="button" className="button button-secondary" disabled={optionsBusy || busy} onClick={() => void loadOptions()}>إعادة قراءة الخيارات</button></div> : null}
      {!optionsBusy && !optionsError && (activeCities.length === 0 || activeVerticals.length === 0) ? <div className="managed-status managed-status-warning" role="alert"><strong>لا يمكن إنشاء الحالة بعد</strong><p>تحتاج الحالة إلى مدينة خدمة نشطة وفئة رئيسية نشطة.</p><Link className="button button-secondary" href="/policies/service-cities">فتح مدن الخدمة</Link></div> : null}
      {pendingAttempt ? <p className="managed-status managed-status-warning" role="status">المحاولة السابقة لم تصل إلى نتيجة مؤكدة. البيانات مقفلة وستعيد المحاولة الطلب نفسه بالمفتاح المحفوظ حتى لا تُنشأ حالة ثانية.</p> : null}
      {createdCaseId ? <p className="managed-status managed-status-info" role="status">قُرئت الحالة الكانونية بعد الإنشاء. <Link href={`/partners/${encodeURIComponent(createdCaseId)}`}>افتح حالة الانضمام</Link></p> : null}
      <div className="access-form">
        <label className="field-label" htmlFor="joining-phone">رقم هاتف الشريك (E.164)<input id="joining-phone" autoComplete="tel" disabled={busy || optionsBusy || Boolean(pendingAttempt) || !attemptReady} inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} placeholder="مثال: +96777000100" /></label>
        <label className="field-label" htmlFor="joining-business">الاسم القانوني للنشاط<input id="joining-business" disabled={busy || optionsBusy || Boolean(pendingAttempt) || !attemptReady} value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></label>
        <label className="field-label" htmlFor="joining-store">اسم المتجر الأول<input id="joining-store" disabled={busy || optionsBusy || Boolean(pendingAttempt) || !attemptReady} value={storeName} onChange={(event) => setStoreName(event.target.value)} /></label>
        <label className="field-label" htmlFor="joining-city">مدينة المتجر الأول<select id="joining-city" disabled={busy || optionsBusy || Boolean(optionsError) || Boolean(pendingAttempt) || !attemptReady} value={serviceCityId} onChange={(event) => setServiceCityId(event.target.value)}><option value="">اختر مدينة نشطة</option>{activeCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="joining-vertical">الفئة الرئيسية<select id="joining-vertical" disabled={busy || optionsBusy || Boolean(optionsError) || Boolean(pendingAttempt) || !attemptReady} value={verticalId} onChange={(event) => setVerticalId(event.target.value)}><option value="">اختر الفئة الرئيسية</option>{activeVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="joining-commercial-type">نوع المتجر التجاري<select id="joining-commercial-type" disabled={busy || optionsBusy || commercialTypesBusy || !verticalId || Boolean(commercialTypesError) || Boolean(pendingAttempt) || !attemptReady} value={commercialTypeId} onChange={(event) => setCommercialTypeId(event.target.value)}><option value="">{!verticalId ? "اختر الفئة الرئيسية أولاً" : commercialTypesBusy ? "جارٍ تحميل الأنواع…" : "اختر نوع المتجر"}</option>{activeCommercialTypes.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select>{commercialTypesError ? <span className="identity-error" role="alert">{commercialTypesError}</span> : verticalId && !commercialTypesBusy && !commercialTypesError && activeCommercialTypes.length === 0 ? <span className="muted">لا توجد أنواع نشطة لهذه الفئة. أضف النوع من سجل أنواع المتاجر قبل إنشاء الحالة.</span> : null}</label>
        <label className="field-label" htmlFor="joining-latitude">خط عرض موقع المتجر<input id="joining-latitude" disabled={busy || optionsBusy || Boolean(pendingAttempt) || !attemptReady} inputMode="decimal" value={latitude} onChange={(event) => setLatitude(toAsciiDigits(event.target.value))} placeholder="مثال: 15.369445" /></label>
        <label className="field-label" htmlFor="joining-longitude">خط طول موقع المتجر<input id="joining-longitude" disabled={busy || optionsBusy || Boolean(pendingAttempt) || !attemptReady} inputMode="decimal" value={longitude} onChange={(event) => setLongitude(toAsciiDigits(event.target.value))} placeholder="مثال: 44.191006" /></label>
        <fieldset className="field-label" disabled={busy || optionsBusy || Boolean(pendingAttempt) || !attemptReady}>
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
