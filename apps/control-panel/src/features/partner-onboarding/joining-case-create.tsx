"use client";

import { toAsciiDigits } from "@bthwani/design-system";
import type { CommerceVertical, JoiningCaseResponse, ServiceCity } from "@bthwani/dsh";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import { partnerMutationHeaders } from "./partner-request";

const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;

export function JoiningCaseCreate() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [serviceCityId, setServiceCityId] = useState("");
  const [verticalId, setVerticalId] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [fulfillmentModes, setFulfillmentModes] = useState<ReadonlyArray<"BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP">>([]);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [optionsBusy, setOptionsBusy] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  async function createCase() {
    const input = {
      contactPhoneE164: phone.replace(/\s+/g, ""),
      businessName: businessName.trim(),
      firstStoreName: storeName.trim(),
      serviceCityId,
      firstStoreVerticalId: verticalId,
      firstStoreLatitude: Number(latitude),
      firstStoreLongitude: Number(longitude),
      firstStoreFulfillmentModes: fulfillmentModes,
    };
    if (!phoneE164Pattern.test(input.contactPhoneE164) || input.businessName.length < 2 || input.firstStoreName.length < 2 || !input.serviceCityId || !input.firstStoreVerticalId || input.firstStoreFulfillmentModes.length === 0 || !Number.isFinite(input.firstStoreLatitude) || !Number.isFinite(input.firstStoreLongitude) || input.firstStoreLatitude < -90 || input.firstStoreLatitude > 90 || input.firstStoreLongitude < -180 || input.firstStoreLongitude > 180) {
      setError("أدخل بيانات النشاط والمتجر والمدينة والفئة الرئيسية وإحداثيات موقع المتجر الثابت.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/partners/joining-cases", {
        method: "POST",
        headers: partnerMutationHeaders(),
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        setError(await partnerErrorMessage(response));
        return;
      }
      const payload = await response.json() as JoiningCaseResponse;
      router.push(`/partners/${encodeURIComponent(payload.case.id)}`);
    } catch {
      setError("تعذر إنشاء حالة الانضمام. أعد المحاولة بعد التحقق من الاتصال.");
    } finally {
      setBusy(false);
    }
  }

  const activeCities = cities.filter((city) => city.active);
  const activeVerticals = verticals.filter((vertical) => vertical.active);
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
      <div className="access-form">
        <label className="field-label" htmlFor="joining-phone">رقم هاتف الشريك (E.164)<input id="joining-phone" autoComplete="tel" disabled={busy || optionsBusy} inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} placeholder="مثال: +96777000100" /></label>
        <label className="field-label" htmlFor="joining-business">الاسم القانوني للنشاط<input id="joining-business" disabled={busy || optionsBusy} value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></label>
        <label className="field-label" htmlFor="joining-store">اسم المتجر الأول<input id="joining-store" disabled={busy || optionsBusy} value={storeName} onChange={(event) => setStoreName(event.target.value)} /></label>
        <label className="field-label" htmlFor="joining-city">مدينة المتجر الأول<select id="joining-city" disabled={busy || optionsBusy || Boolean(optionsError)} value={serviceCityId} onChange={(event) => setServiceCityId(event.target.value)}><option value="">اختر مدينة نشطة</option>{activeCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="joining-vertical">الفئة الرئيسية<select id="joining-vertical" disabled={busy || optionsBusy || Boolean(optionsError)} value={verticalId} onChange={(event) => setVerticalId(event.target.value)}><option value="">اختر الفئة الرئيسية</option>{activeVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="joining-latitude">خط عرض موقع المتجر<input id="joining-latitude" disabled={busy || optionsBusy} inputMode="decimal" value={latitude} onChange={(event) => setLatitude(toAsciiDigits(event.target.value))} placeholder="مثال: 15.369445" /></label>
        <label className="field-label" htmlFor="joining-longitude">خط طول موقع المتجر<input id="joining-longitude" disabled={busy || optionsBusy} inputMode="decimal" value={longitude} onChange={(event) => setLongitude(toAsciiDigits(event.target.value))} placeholder="مثال: 44.191006" /></label>
        <fieldset className="field-label" disabled={busy || optionsBusy}>
          <legend>أوضاع الطلب التي اختارها الشريك عند الانضمام</legend>
          <label><input type="checkbox" checked={fulfillmentModes.includes("BTHWANI_CAPTAIN")} onChange={(event) => setFulfillmentModes((current) => event.target.checked ? current.includes("BTHWANI_CAPTAIN") ? current : [...current, "BTHWANI_CAPTAIN"] : current.filter((mode) => mode !== "BTHWANI_CAPTAIN"))} /> توصيل بثواني · مسؤولية المنصة</label>
          <label><input type="checkbox" checked={fulfillmentModes.includes("PARTNER_CAPTAIN")} onChange={(event) => setFulfillmentModes((current) => event.target.checked ? current.includes("PARTNER_CAPTAIN") ? current : [...current, "PARTNER_CAPTAIN"] : current.filter((mode) => mode !== "PARTNER_CAPTAIN"))} /> توصيل المتجر · يختار المتجر أحد كباتنه</label>
          <label><input type="checkbox" checked={fulfillmentModes.includes("CUSTOMER_PICKUP")} onChange={(event) => setFulfillmentModes((current) => event.target.checked ? current.includes("CUSTOMER_PICKUP") ? current : [...current, "CUSTOMER_PICKUP"] : current.filter((mode) => mode !== "CUSTOMER_PICKUP"))} /> استلم بنفسك من المتجر</label>
          <span className="muted">تُثبت هذه الإتاحة عند الانضمام، وتظهر للعميل الخيارات المفعّلة فقط. تغييرها بعد إنشاء المتجر متاح للمشغّل في لوحة التحكم.</span>
        </fieldset>
        <button type="button" className="button button-primary" disabled={busy || optionsBusy || Boolean(optionsError) || activeCities.length === 0 || activeVerticals.length === 0} onClick={() => void createCase()}>{busy ? "جارٍ إنشاء الحالة…" : "إنشاء حالة انضمام"}</button>
      </div>
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
      <Link className="button button-secondary" href="/partners">العودة إلى الطابور</Link>
    </section>
  );
}
