"use client";

import type { CommerceVertical, ServiceCity } from "@bthwani/dsh";
import { fieldCommissionScopeLabel, financialPolicyStateLabel, formatMoney } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";

type ScopeType = "DEFAULT" | "VERTICAL" | "STORE";
type Policy = Readonly<{ id: string; scopeType: ScopeType; scopeId: string; rewardMinor: number; roundingUnitMinor: 50; state: "ACTIVE" | "RETIRED"; version: number }>;
type StoreOption = Readonly<{ id: string; name: string; serviceCityId: string }>;
type ReadState = "unselected" | "loading" | "ready" | "missing" | "error";

export function FieldCommissionPolicyWorkspace() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [scopeType, setScopeType] = useState<ScopeType | "">("");
  const [scopeId, setScopeId] = useState("");
  const [verticals, setVerticals] = useState<CommerceVertical[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [cities, setCities] = useState<ServiceCity[]>([]);
  const [storeSearch, setStoreSearch] = useState("");
  const [storeCityId, setStoreCityId] = useState("");
  const [storeCursor, setStoreCursor] = useState("");
  const [storeNextCursor, setStoreNextCursor] = useState("");
  const [storesLoading, setStoresLoading] = useState(false);
  const [scopeOptionsError, setScopeOptionsError] = useState("");
  const [storeSearchError, setStoreSearchError] = useState("");
  const [rewardMinor, setRewardMinor] = useState("");
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [readState, setReadState] = useState<ReadState>("unselected");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const readSequence = useRef(0);
  const scopeOptionsController = useRef<AbortController | null>(null);
  const storeSearchController = useRef<AbortController | null>(null);

  const loadScopeOptions = useCallback(async () => {
    scopeOptionsController.current?.abort();
    const controller = new AbortController();
    scopeOptionsController.current = controller;
    setScopeOptionsError("");
    try {
      const [nextVerticals, nextCities] = await Promise.all([
        fetch("/api/catalog/verticals?includeInactive=true", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await response.json() as { verticals?: CommerceVertical[]; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || "تعذرت قراءة الفئات الرئيسية من DSH.");
        return body.verticals ?? [];
      }),
        fetch("/api/service-cities", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await response.json() as { cities?: ServiceCity[]; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || "تعذرت قراءة مدن الخدمة.");
        return (body.cities ?? []).filter((city) => city.active);
      }),
      ]);
      if (controller.signal.aborted) return;
      setVerticals(nextVerticals);
      setCities(nextCities);
    } catch (value) {
      if (!controller.signal.aborted) setScopeOptionsError(value instanceof Error ? value.message : "تعذر تحميل نطاقات السياسة.");
    }
  }, []);

  useEffect(() => {
    void loadScopeOptions();
    return () => scopeOptionsController.current?.abort();
  }, [loadScopeOptions]);

  const loadStores = useCallback(async () => {
    storeSearchController.current?.abort();
    const controller = new AbortController();
    storeSearchController.current = controller;
    const query = storeSearch.trim();
    if (scopeType !== "STORE" || Array.from(query).length < 2 || !storeCityId) {
      setStores([]);
      setStoreNextCursor("");
      setStoresLoading(false);
      setStoreSearchError("");
      return;
    }
    const params = new URLSearchParams({ q: query, limit: "25" });
    params.set("serviceCityId", storeCityId);
    if (storeCursor) params.set("cursor", storeCursor);
    setStoresLoading(true);
    setStoreSearchError("");
    try {
      const response = await fetch(`/api/policies/stores?${params}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json() as { stores?: StoreOption[]; nextCursor?: string; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || "تعذرت قراءة المتاجر المنشورة من DSH.");
      if (controller.signal.aborted) return;
      setStores((current) => storeCursor ? [...current, ...(body.stores ?? []).filter((item) => !current.some((existing) => existing.id === item.id))] : body.stores ?? []);
      setStoreNextCursor(body.nextCursor ?? "");
    } catch (value) {
      if (!controller.signal.aborted) setStoreSearchError(value instanceof Error ? value.message : "تعذرت قراءة المتاجر المنشورة من DSH.");
    } finally {
      if (!controller.signal.aborted) setStoresLoading(false);
    }
  }, [scopeType, storeCityId, storeCursor, storeSearch]);

  useEffect(() => {
    void loadStores();
    return () => storeSearchController.current?.abort();
  }, [loadStores]);

  const read = useCallback(async (type: ScopeType, id: string): Promise<boolean> => {
    const sequence = ++readSequence.current;
    setReadState("loading");
    setPolicy(null);
    setRewardMinor("");
    setError("");
    setMessage("");
    try {
      const query = new URLSearchParams({ scopeType: type, scopeId: id });
      const response = await fetch(`/api/finance/field-commission-policy?${query}`, { cache: "no-store" });
      const body = await response.json() as { policy?: Policy; error?: { message?: string } };
      if (sequence !== readSequence.current) return false;
      if (response.status === 404) {
        setReadState("missing");
        return false;
      }
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذرت قراءة السياسة لهذا النطاق.");
      setPolicy(body.policy);
      setRewardMinor(String(body.policy.rewardMinor));
      setReadState("ready");
      return true;
    } catch (value) {
      if (sequence === readSequence.current) {
        setReadState("error");
        setError(value instanceof Error ? value.message : "تعذرت قراءة السياسة لهذا النطاق.");
      }
      return false;
    }
  }, []);

  const chooseScopeType = (value: ScopeType | "") => {
    readSequence.current += 1;
    setScopeType(value);
    setScopeId("");
    setPolicy(null);
    setRewardMinor("");
    setReason("");
    setError("");
    setMessage("");
    if (value === "DEFAULT") void read(value, "");
    else setReadState("unselected");
  };

  const chooseScopeId = (value: string) => {
    setScopeId(value);
    if (scopeType === "VERTICAL" || scopeType === "STORE") {
      if (value) void read(scopeType, value);
      else {
        readSequence.current += 1;
        setReadState("unselected");
        setPolicy(null);
        setRewardMinor("");
      }
    }
  };

  const save = async () => {
    if (!scopeType || (readState !== "ready" && readState !== "missing") || !canEdit || !Number.isInteger(Number(rewardMinor)) || Number(rewardMinor) < 50 || reason.trim().length < 5 || reason.trim().length > 500) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/finance/field-commission-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ scopeType, scopeId: scopeType === "DEFAULT" ? "" : scopeId, rewardMinor: Number(rewardMinor), roundingUnitMinor: 50, expectedVersion: policy?.version ?? 0, reason: reason.trim() }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "تعذر تفعيل سياسة مكافأة الميدان.");
      const confirmed = await read(scopeType, scopeType === "DEFAULT" ? "" : scopeId);
      if (!confirmed) throw new Error("تعذرت مطابقة القراءة الكانونية بعد الحفظ. أعد القراءة قبل أي تغيير آخر.");
      setMessage("تم تفعيل السياسة والتحقق من قراءتها من WLT.");
      setReason("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر تفعيل سياسة مكافأة الميدان.");
    } finally {
      setBusy(false);
    }
  };

  const scopeSelected = scopeType === "DEFAULT" || ((scopeType === "VERTICAL" || scopeType === "STORE") && Boolean(scopeId));

  return <section className="access-card" aria-labelledby="field-commission-policy-title">
    <div className="finance-toolbar"><div><p className="eyebrow">مركز السياسات · WLT</p><h2 id="field-commission-policy-title">مكافأة الميدان</h2></div><button className="button button-secondary" type="button" onClick={() => { if (scopeType && scopeSelected) void read(scopeType, scopeType === "DEFAULT" ? "" : scopeId); }} disabled={!scopeSelected || busy || readState === "loading"}>إعادة القراءة</button></div>
    <p className="muted">تُستحق المكافأة مرة واحدة عند نشر المتجر. تُقرأ السياسة الدقيقة للنطاق؛ ويظل اختيار سياسة الفئة الرئيسية أو المتجر صريحًا، والتقريب ثابت عند 50 ريال.</p>
    <div className="form-grid">
      <label className="field-label" htmlFor="field-commission-scope">نطاق السياسة<select id="field-commission-scope" value={scopeType} onChange={(event) => chooseScopeType(event.target.value as ScopeType | "")} disabled={busy}><option value="">اختر النطاق</option><option value="DEFAULT">افتراضي</option><option value="VERTICAL">فئة رئيسية</option><option value="STORE">متجر منشور</option></select></label>
      {scopeType === "VERTICAL" ? <label className="field-label" htmlFor="field-commission-vertical">الفئة الرئيسية<select id="field-commission-vertical" value={scopeId} onChange={(event) => chooseScopeId(event.target.value)} disabled={busy}><option value="">اختر فئة رئيسية</option>{verticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}{vertical.active ? "" : " · غير نشط"}</option>)}</select></label> : null}
      {scopeType === "STORE" ? <>
        <label className="field-label" htmlFor="field-commission-store-city">مدينة الخدمة<select id="field-commission-store-city" value={storeCityId} onChange={(event) => { setStoreCityId(event.target.value); setStoreCursor(""); setStores([]); setStoreNextCursor(""); chooseScopeId(""); }} disabled={busy}><option value="">اختر مدينة الخدمة</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="field-commission-store-search">بحث المتاجر<input id="field-commission-store-search" type="search" minLength={2} maxLength={256} value={storeSearch} onChange={(event) => { setStoreSearch(Array.from(event.target.value).slice(0, 128).join("")); setStoreCursor(""); setStores([]); setStoreNextCursor(""); chooseScopeId(""); }} disabled={busy} /></label>
        <label className="field-label" htmlFor="field-commission-store">المتجر<select id="field-commission-store" value={scopeId} onChange={(event) => chooseScopeId(event.target.value)} disabled={busy || !storeCityId || storesLoading || stores.length === 0}><option value="">{storesLoading ? "جارٍ البحث…" : "اختر متجرًا منشورًا"}</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        {cities.length === 0 ? <p className="muted">لا توجد مدينة خدمة نشطة لاختيار متاجرها.</p> : !storeCityId ? <p className="muted">اختر مدينة الخدمة أولًا لتضييق البحث إلى متاجرها.</p> : Array.from(storeSearch.trim()).length < 2 ? <p className="muted">اكتب حرفين على الأقل للبحث في المتاجر المنشورة.</p> : stores.length === 0 && !storesLoading && !storeSearchError ? <p className="muted">لا توجد متاجر منشورة مطابقة.</p> : null}
        {storeNextCursor ? <button className="button button-quiet" type="button" onClick={() => setStoreCursor(storeNextCursor)} disabled={storesLoading || busy}>تحميل متاجر أخرى</button> : null}
      </> : null}
      <label className="field-label" htmlFor="field-commission-reward">المكافأة (ريال)<input id="field-commission-reward" type="number" min="50" step="50" value={rewardMinor} onChange={(event) => setRewardMinor(event.target.value)} disabled={busy || !canEdit || (readState !== "ready" && readState !== "missing")} /></label>
      <p className="muted">وحدة التقريب: 50 ريال — لا يمكن تغييرها من الواجهة.</p>
    </div>
    {scopeOptionsError ? <p className="validation-error" role="alert">{scopeOptionsError} <button className="button button-quiet" type="button" onClick={() => void loadScopeOptions()} disabled={busy}>إعادة تحميل خيارات النطاق</button></p> : null}
    {scopeType === "STORE" && storeSearchError ? <p className="validation-error" role="alert">{storeSearchError} <button className="button button-quiet" type="button" onClick={() => void loadStores()} disabled={busy || storesLoading || !storeCityId || Array.from(storeSearch.trim()).length < 2}>إعادة البحث</button></p> : null}
    {readState === "loading" ? <p role="status">جارٍ قراءة السياسة من WLT…</p> : null}
    {readState === "unselected" && scopeType ? <p className="muted">اختر نطاقًا من قوائم DSH المعتمدة لقراءة سياسته.</p> : null}
    {readState === "missing" ? <p className="managed-status managed-status-warning" role="status">لا توجد سياسة نشطة لهذا النطاق. أدخل المكافأة صراحةً لإنشاء أول إصدار.</p> : null}
    {readState === "error" ? <p className="validation-error" role="alert">{error || "تعذرت القراءة؛ الحفظ معطل حتى نجاحها."}</p> : null}
    {message ? <p className="success" role="status">{message}</p> : null}
    {policy ? <p className="muted">الحالة: {financialPolicyStateLabel(policy.state)} · الإصدار: {policy.version} · النطاق: {fieldCommissionScopeLabel(policy.scopeType)} · المكافأة: {formatMoney(policy.rewardMinor, "YER")}</p> : null}
    {scopeSelected && (readState === "ready" || readState === "missing") ? <>
      <label className="field-label" htmlFor="field-reward-reason">سبب التغيير<textarea id="field-reward-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} disabled={busy || !canEdit} /></label>
      {error ? <p className="validation-error" role="alert">{error}</p> : null}
      <button className="button button-primary" type="button" onClick={() => void save()} disabled={busy || !canEdit || !Number.isInteger(Number(rewardMinor)) || Number(rewardMinor) < 50 || reason.trim().length < 5 || reason.trim().length > 500}>{busy ? "جارٍ التفعيل والتحقق…" : policy ? "تفعيل نسخة معدلة" : "إنشاء السياسة الأولى"}</button>
    </> : null}
  </section>;
}
