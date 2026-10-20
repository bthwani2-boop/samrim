"use client";

import type { CommerceVertical, CommercialStoreType } from "@bthwani/dsh";
import { useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";

type CancellationMode = "OPERATIONS_ONLY" | "CLIENT_BEFORE_ACCEPTANCE";
const labels: Record<CancellationMode, string> = {
  OPERATIONS_ONLY: "الإلغاء عن طريق العمليات فقط",
  CLIENT_BEFORE_ACCEPTANCE: "العميل قبل قبول المتجر فقط",
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const value = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(value.error?.message || "تعذر قراءة سياسة الإلغاء");
  return value;
}

export function StoreTypeCancellationPolicyWorkspace() {
  const { state: session } = useSession();
  const canManage = session.kind === "authenticated" && session.identity.role === "operator" &&
    session.identity.permissions?.includes("platform_policies") === true;
  const [verticals, setVerticals] = useState<readonly CommerceVertical[]>([]);
  const [verticalId, setVerticalId] = useState("");
  const [types, setTypes] = useState<readonly CommercialStoreType[]>([]);
  const [typeId, setTypeId] = useState("");
  const [mode, setMode] = useState<CancellationMode>("OPERATIONS_ONLY");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const current = types.find(type => type.id === typeId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void readJson<{ verticals: CommerceVertical[] }>("/api/catalog/verticals")
      .then(value => { if (active) { setVerticals(value.verticals); setVerticalId(value.verticals[0]?.id ?? ""); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "تعذر تحميل المجالات"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setTypes([]);
    setTypeId("");
    if (!verticalId) return;
    setLoading(true);
    void readJson<{ storeTypes: CommercialStoreType[] }>(
      `/api/catalog/commercial-store-types?verticalId=${encodeURIComponent(verticalId)}`)
      .then(value => { if (active) { setTypes(value.storeTypes); setTypeId(value.storeTypes[0]?.id ?? ""); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "تعذر تحميل أنواع المتاجر"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [verticalId]);
  useEffect(() => { setMode(current?.cancellationMode ?? "OPERATIONS_ONLY"); setReason(""); }, [current]);

  async function save() {
    if (!current || !canManage || busy || loading || reason.trim().length < 5) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/policies/store-type-cancellations/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ mode, expectedVersion: current.version, reason: reason.trim() }),
      });
      const payload = await response.json() as { storeType?: CommercialStoreType; error?: { message?: string } };
      if (!response.ok || !payload.storeType) throw new Error(payload.error?.message || "تعذر اعتماد السياسة");
      setTypes(previous => previous.map(item => item.id === payload.storeType?.id ? payload.storeType : item));
      setNotice("تم اعتماد سياسة الإلغاء الجديدة للطلبات القادمة. لن تتغير الطلبات السابقة.");
      setReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ السياسة. أعد قراءة النسخة الحالية.");
    } finally { setBusy(false); }
  }

  return <section className="access-form" aria-labelledby="cancellation-policy-heading">
    <h3 id="cancellation-policy-heading">سياسة إلغاء الطلبات حسب نوع المتجر</h3>
    <p className="muted">خياران فقط لكل نوع متجر. يُحسم تنفيذ الإلغاء من الخادم وفق حالة الطلب، وتحتفظ الطلبات القديمة بسياستها.</p>
    <label className="field-label" htmlFor="cancellation-vertical">المجال
      <select id="cancellation-vertical" value={verticalId} onChange={event => setVerticalId(event.target.value)} disabled={busy || loading}>
        {verticals.map(item => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
      </select>
    </label>
    <label className="field-label" htmlFor="cancellation-store-type">نوع المتجر
      <select id="cancellation-store-type" value={typeId} onChange={event => setTypeId(event.target.value)} disabled={busy || loading}>
        {types.map(item => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
      </select>
    </label>
    {current ? <>
      <p className="muted">السياسة الحالية: {labels[current.cancellationMode]} · النسخة {current.version}</p>
      <label className="field-label" htmlFor="cancellation-policy-mode">طريقة الإلغاء
        <select id="cancellation-policy-mode" value={mode} onChange={event => setMode(event.target.value as CancellationMode)} disabled={!canManage || busy}>
          <option value="OPERATIONS_ONLY">{labels.OPERATIONS_ONLY}</option>
          <option value="CLIENT_BEFORE_ACCEPTANCE">{labels.CLIENT_BEFORE_ACCEPTANCE}</option>
        </select>
      </label>
      <label className="field-label" htmlFor="cancellation-policy-reason">سبب تعديل السياسة
        <textarea id="cancellation-policy-reason" value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={500} rows={2} disabled={!canManage || busy} />
      </label>
      <button type="button" className="button button-primary" disabled={!canManage || busy || loading || reason.trim().length < 5 || mode === current.cancellationMode} onClick={() => void save()}>
        {busy ? "جارٍ حفظ السياسة…" : "اعتماد السياسة"}
      </button>
    </> : <p className="muted">{loading ? "جارٍ تحميل السياسة…" : "لا توجد أنواع متاجر نشطة في هذا المجال."}</p>}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert" className="identity-error">{error}</p> : null}
  </section>;
}
