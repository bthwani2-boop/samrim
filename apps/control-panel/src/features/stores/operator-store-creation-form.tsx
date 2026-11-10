"use client";

import type { CommerceVertical, CommercialStoreType, ServiceCity, StoreFulfillmentMode } from "@bthwani/dsh";
import { useEffect, useRef, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { partnerErrorMessage } from "../partners/partner-error-message";

type OptionPage = { cities?: ServiceCity[]; verticals?: CommerceVertical[]; storeTypes?: CommercialStoreType[] };
type Attempt = { body: string; key: string; correlation: string };

export function OperatorStoreCreationForm({ actorId, onCreated }: Readonly<{ actorId: string; onCreated: () => void }>) {
  const [expanded, setExpanded] = useState(false);
  const [cities, setCities] = useState<readonly ServiceCity[]>([]);
  const [verticals, setVerticals] = useState<readonly CommerceVertical[]>([]);
  const [types, setTypes] = useState<readonly CommercialStoreType[]>([]);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<"BTHWANI_PARTNER" | "INDEPENDENT_STORE">("BTHWANI_PARTNER");
  const [city, setCity] = useState("");
  const [vertical, setVertical] = useState("");
  const [storeType, setStoreType] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [mode, setMode] = useState<StoreFulfillmentMode>("CUSTOMER_PICKUP");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const attempt = useRef<Attempt | null>(null);
  const saveInFlight = useRef(false);
  const generation = useRef(0);
  // The parent keys this form by actorId; unmount invalidates stale writes.
  useEffect(() => {
    generation.current++;
    return () => { generation.current++; };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const abort = new AbortController();
    setReady(false); setLoading(true); setError("");
    async function load() {
      try {
        const [citiesResponse, verticalsResponse] = await Promise.all([
          identityFetch("/api/service-cities", { cache: "no-store", signal: abort.signal }),
          identityFetch("/api/catalog/verticals", { cache: "no-store", signal: abort.signal }),
        ]);
        if (!citiesResponse.ok || !verticalsResponse.ok) throw Error("تعذرت قراءة مدن الخدمة أو الأنشطة المعتمدة.");
        const [citiesData, verticalsData] = await Promise.all([citiesResponse.json(), verticalsResponse.json()]) as [OptionPage, OptionPage];
        if (!Array.isArray(citiesData.cities) || !Array.isArray(verticalsData.verticals)) throw Error("استجابة الخيارات غير صالحة.");
        if (!abort.signal.aborted) {
          setCities(citiesData.cities.filter((item) => item.active));
          setVerticals(verticalsData.verticals.filter((item) => item.active));
          setReady(true);
        }
      } catch {
        if (!abort.signal.aborted) setError("تعذرت قراءة خيارات إنشاء المتجر من الملاك الأصليين؛ أعد فتح النموذج.");
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => abort.abort();
  }, [expanded]);

  useEffect(() => {
    setTypes([]); setStoreType("");
    if (!expanded || !vertical) return;
    const abort = new AbortController();
    setLoading(true); setError("");
    void identityFetch("/api/catalog/commercial-store-types?verticalId=" + encodeURIComponent(vertical), { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw Error("DSH commercial types unavailable");
        const body = await response.json() as OptionPage;
        if (!Array.isArray(body.storeTypes)) throw Error("Invalid store types");
        if (!abort.signal.aborted) setTypes(body.storeTypes.filter((item) => item.active && item.verticalId === vertical));
      }).catch(() => { if (!abort.signal.aborted) setError("تعذر قراءة أنواع المتاجر لهذا النشاط.") })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) });
    return () => abort.abort();
  }, [expanded, vertical]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || saveInFlight.current || !ready || loading || success) return;
    const lat = Number(latitude), lon = Number(longitude);
    if (name.trim().length < 2 || address.trim().length < 4 ||
      !cities.some((item) => item.id === city) || !verticals.some((item) => item.id === vertical) ||
      !types.some((item) => item.id === storeType && item.verticalId === vertical) ||
      !latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      (relation === "INDEPENDENT_STORE" && mode === "BTHWANI_CAPTAIN")) {
      setError("راجع اسم المتجر والمدينة والنشاط والنوع والموقع وطريقة التسليم."); return;
    }
    const body = JSON.stringify({
      name: name.trim(), relationModel: relation, serviceCityId: city,
      primaryVerticalId: vertical, commercialStoreTypeId: storeType, addressText: address.trim(),
      latitude: lat, longitude: lon, fulfillmentModes: [mode],
    });
    if (attempt.current && attempt.current.body !== body) {
      setError("توجد محاولة سابقة غير مؤكدة. أعد قراءة متاجر الشريك قبل تغيير بيانات المحاولة."); return;
    }
    const current = attempt.current ?? {
      body, key: "operator_store_" + crypto.randomUUID(), correlation: "operator_store_corr_" + crypto.randomUUID(),
    };
    attempt.current = current;
    saveInFlight.current = true;
    const pendingGeneration = generation.current;
    setBusy(true); setError("");
    try {
      const response = await identityFetch("/api/partners/roster/" + encodeURIComponent(actorId) + "/stores", {
        method: "POST", headers: { "Content-Type": "application/json",
          "Idempotency-Key": current.key, "X-Correlation-ID": current.correlation },
        body: current.body,
      });
      if (!response.ok) {
        const message = await partnerErrorMessage(response);
        // Definitive 4xx responses did not commit; permit a corrected fresh
        // request. Timeout/rate-limit and network failures remain ambiguous.
        if (response.status >= 400 && response.status < 500 &&
          response.status !== 408 && response.status !== 429) attempt.current = null;
        throw Error(message);
      }
      const result = await response.json() as { storeId?: string; relationModel?: string; publicationState?: string };
      if (!result.storeId || result.relationModel !== relation || result.publicationState !== "unpublished") {
        throw Error("استجابة الإنشاء غير متطابقة مع الطلب. راجع بيانات المتجر.");
      }
      let cursor = "";
      let found = false;
      const visited = new Set<string>();
      for (let n = 0; n < 20; n++) {
        const pageResponse = await identityFetch("/api/partners/roster/" + encodeURIComponent(actorId) +
          "/stores?limit=50" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { cache: "no-store" });
        if (!pageResponse.ok) break;
        const page = await pageResponse.json() as { stores?: { id: string }[]; nextCursor?: string };
        if (page.stores?.some((item) => item.id === result.storeId)) { found = true; break; }
        if (!page.nextCursor || visited.has(page.nextCursor)) break;
        visited.add(page.nextCursor); cursor = page.nextCursor;
      }
      if (!found) throw Error("استقبلنا نتيجة الإنشاء لكن تعذرت مطابقتها مع سجل DSH؛ لا تُنشئ طلبًا آخر قبل التحقق.");
      if (generation.current !== pendingGeneration) return;
      attempt.current = null;
      setSuccess("تم إنشاء متجر غير منشور، وثبتت ملكيته بقراءة DSH. يلزم إعداد المحتوى والاتفاق والمراجعة قبل النشر.");
      onCreated();
    } catch (cause) {
      if (generation.current === pendingGeneration) {
        setError(cause instanceof Error ? cause.message : "تعذر تأكيد نتيجة إنشاء المتجر؛ راجع سجل الشريك قبل إعادة المحاولة.");
      }
    } finally {
      saveInFlight.current = false;
      if (generation.current === pendingGeneration) setBusy(false);
    }
  }

  return <div className="work-stack">
    <button type="button" className="button button-secondary" aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}>إضافة متجر لهذا الشريك</button>
    {expanded ? <form className="work-stack" onSubmit={(event) => void submit(event)} aria-label="إنشاء متجر مرتبط بالشريك">
      <p className="muted">سيُنشئ DSH متجرًا غير منشور لهذا الشريك الموثق. لا ينشئ النموذج حسابًا أو اتفاقًا ماليًا.</p>
      {loading ? <p role="status">جارٍ قراءة الخيارات المعتمدة…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
      <label>اسم المتجر<input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required disabled={busy || Boolean(success)} /></label>
      <label>طريقة عمل المتجر<select value={relation} onChange={(event) => {
        const next = event.target.value as typeof relation;
        setRelation(next);
        if (next === "INDEPENDENT_STORE" && mode === "BTHWANI_CAPTAIN") setMode("CUSTOMER_PICKUP");
      }} disabled={busy || Boolean(success)}>
        <option value="BTHWANI_PARTNER">شريك بثواني</option><option value="INDEPENDENT_STORE">متجر مستقل</option>
      </select></label>
      <label>مدينة الخدمة<select required value={city} onChange={(event) => setCity(event.target.value)} disabled={busy || Boolean(success)}>
        <option value="">اختر مدينة</option>{cities.map((item) => <option key={item.id} value={item.id}>{item.displayNameAr}</option>)}
      </select></label>
      <label>المجال التجاري<select required value={vertical} onChange={(event) => setVertical(event.target.value)} disabled={busy || Boolean(success)}>
        <option value="">اختر مجالًا</option>{verticals.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
      </select></label>
      <label>نوع النشاط<select required value={storeType} onChange={(event) => setStoreType(event.target.value)} disabled={busy || loading || Boolean(success)}>
        <option value="">اختر نوعًا</option>{types.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
      </select></label>
      <label>عنوان المتجر<input value={address} maxLength={500} onChange={(event) => setAddress(event.target.value)} required disabled={busy || Boolean(success)} /></label>
      <label>خط العرض<input inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} required disabled={busy || Boolean(success)} /></label>
      <label>خط الطول<input inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} required disabled={busy || Boolean(success)} /></label>
      <label>طريقة تسليم أولية<select value={mode} onChange={(event) => setMode(event.target.value as StoreFulfillmentMode)} disabled={busy || Boolean(success)}>
        <option value="CUSTOMER_PICKUP">استلام العميل من المتجر</option>
        <option value="PARTNER_CAPTAIN">توصيل المتجر</option>
        {relation === "BTHWANI_PARTNER" ? <option value="BTHWANI_CAPTAIN">كابتن بثواني (بعد استيفاء الأهلية)</option> : null}
      </select></label>
      <button type="submit" className="button button-primary" disabled={!ready || loading || busy || Boolean(success)}>
        {busy ? "جارٍ الإنشاء والتحقق…" : "إنشاء متجر غير منشور"}
      </button>
    </form> : null}
  </div>;
}
