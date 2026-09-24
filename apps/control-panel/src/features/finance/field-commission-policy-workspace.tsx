"use client";

import { fieldCommissionScopeLabel, financialPolicyStateLabel, formatMoney } from "@bthwani/dsh";
import type { CommerceVertical } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";

type ScopeType = "DEFAULT" | "VERTICAL" | "STORE";
type Policy = Readonly<{ id: string; scopeType: ScopeType; scopeId: string; rewardMinor: number; roundingUnitMinor: 50; state: "ACTIVE" | "RETIRED"; version: number }>;
type StoreOption = Readonly<{ id: string; name: string; serviceCityName: string }>;
type ReadState = "unselected" | "loading" | "ready" | "missing" | "error";

export function FieldCommissionPolicyWorkspace() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [scopeType, setScopeType] = useState<ScopeType | "">("");
  const [scopeId, setScopeId] = useState("");
  const [verticals, setVerticals] = useState<CommerceVertical[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [scopeLoadError, setScopeLoadError] = useState("");
  const [rewardMinor, setRewardMinor] = useState("");
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [readState, setReadState] = useState<ReadState>("unselected");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const readSequence = useRef(0);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      fetch("/api/catalog/verticals?includeInactive=true", { cache: "no-store" }).then(async (response) => {
        const body = await response.json() as { verticals?: CommerceVertical[]; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || "تعذرت قراءة المجالات من DSH.");
        return body.verticals ?? [];
      }),
      fetch("/api/policies/stores", { cache: "no-store" }).then(async (response) => {
        const body = await response.json() as { stores?: StoreOption[]; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || "تعذرت قراءة المتاجر المنشورة من DSH.");
        return body.stores ?? [];
      }),
    ]).then(([nextVerticals, nextStores]) => {
      if (!mounted) return;
      setVerticals(nextVerticals);
      setStores(nextStores);
    }).catch((value: unknown) => {
      if (mounted) setScopeLoadError(value instanceof Error ? value.message : "تعذر تحميل نطاقات السياسة.");
    });
    return () => { mounted = false; readSequence.current += 1; };
  }, []);

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
    <p className="muted">تُستحق المكافأة مرة واحدة عند نشر المتجر. تُقرأ السياسة الدقيقة للنطاق؛ ويظل اختيار سياسة المجال أو المتجر صريحًا، والتقريب ثابت عند 50 ريال.</p>
    <div className="form-grid">
      <label className="field-label" htmlFor="field-commission-scope">نطاق السياسة<select id="field-commission-scope" value={scopeType} onChange={(event) => chooseScopeType(event.target.value as ScopeType | "")} disabled={busy}><option value="">اختر النطاق</option><option value="DEFAULT">افتراضي</option><option value="VERTICAL">مجال تجاري</option><option value="STORE">متجر منشور</option></select></label>
      {scopeType === "VERTICAL" ? <label className="field-label" htmlFor="field-commission-vertical">المجال التجاري<select id="field-commission-vertical" value={scopeId} onChange={(event) => chooseScopeId(event.target.value)} disabled={busy}><option value="">اختر مجالًا</option>{verticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}{vertical.active ? "" : " · غير نشط"}</option>)}</select></label> : null}
      {scopeType === "STORE" ? <label className="field-label" htmlFor="field-commission-store">المتجر<select id="field-commission-store" value={scopeId} onChange={(event) => chooseScopeId(event.target.value)} disabled={busy}><option value="">اختر متجرًا منشورًا</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.serviceCityName}</option>)}</select></label> : null}
      {scopeType === "STORE" && stores.length === 0 && !scopeLoadError ? <p className="muted">لا توجد متاجر منشورة لاختيارها حاليًا.</p> : null}
      <label className="field-label" htmlFor="field-commission-reward">المكافأة (ريال)<input id="field-commission-reward" type="number" min="50" step="50" value={rewardMinor} onChange={(event) => setRewardMinor(event.target.value)} disabled={busy || !canEdit || (readState !== "ready" && readState !== "missing")} /></label>
      <p className="muted">وحدة التقريب: 50 ريال — لا يمكن تغييرها من الواجهة.</p>
    </div>
    {scopeLoadError ? <p className="validation-error" role="alert">{scopeLoadError}</p> : null}
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
