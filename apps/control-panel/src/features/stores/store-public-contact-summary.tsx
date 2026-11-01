"use client";

import type { StorePublicContactResponse } from "@bthwani/dsh";
import { useEffect, useState } from "react";

export function StorePublicContactSummary({ storeId }: Readonly<{ storeId: string }>) {
  const [contact, setContact] = useState<StorePublicContactResponse["contact"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    // A retry must trigger a new canonical read even when storeId is unchanged.
    void retry;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setContact(null);
    setError(false);
    void fetch("/api/stores/" + encodeURIComponent(storeId) + "/contact",
      { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("DSH_CONTACT_UNAVAILABLE");
      const value = await response.json() as StorePublicContactResponse;
      if (value.contact?.storeId !== storeId) throw new Error("DSH_CONTACT_SCOPE_MISMATCH");
      if (active) { setContact(value.contact); setLoading(false); }
    }).catch(() => { if (active) { setError(true); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [storeId, retry]);

  return <section className="store-profile-card" aria-label="بيانات التواصل العامة للمتجر">
    <header className="store-profile-card-header"><h3>بيانات التواصل العامة</h3></header>
    {loading ? <p role="status">جارٍ قراءة بيانات المتجر...</p> : null}
    {error ? <><p role="alert">تعذرت قراءة بيانات التواصل.</p>
      <button type="button" className="button button-secondary" onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></> : null}
    {contact && !loading && !error ? <dl className="store-profile-facts">
      <div className="store-profile-fact"><dt>هاتف المتجر</dt><dd><bdi dir="ltr">{contact.phoneE164 || "غير مضاف"}</bdi></dd></div>
      <div className="store-profile-fact"><dt>البريد العام</dt><dd><bdi dir="ltr">{contact.email || "غير مضاف"}</bdi></dd></div>
      <div className="store-profile-fact"><dt>واتساب للعملاء</dt><dd>{contact.whatsappEnabled ? <bdi dir="ltr">{contact.whatsappPhoneE164}</bdi> : "غير مفعّل"}</dd></div>
    </dl> : null}
    <p className="store-profile-muted">يحدّث مالك المتجر هذه القنوات من إعدادات الشريك. لا تُستنسخ أرقام الهوية أو الانضمام الشخصية تلقائيًا.</p>
  </section>;
}
