"use client";

import type { CommerceVertical, CommercialStoreType } from "@bthwani/dsh";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";

type CancellationMode = "OPERATIONS_ONLY" | "CLIENT_BEFORE_ACCEPTANCE";
const labels: Record<CancellationMode, string> = {
  OPERATIONS_ONLY: "الإلغاء عن طريق العمليات فقط",
  CLIENT_BEFORE_ACCEPTANCE: "العميل قبل قبول المتجر فقط",
};

async function readJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) });
  const value = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(value.error?.message || "تعذرت قراءة سياسة الإلغاء");
  return value;
}

export function StoreTypeCancellationPolicyWorkspace() {
  const { state: session } = useSession();
  const canManage = session.kind === "authenticated" && session.identity.role === "operator" &&
    session.identity.permissions?.includes("platform_policies") === true &&
    Boolean(session.identity.subject && session.identity.sessionId);
  if (!canManage || session.kind !== "authenticated") return <p role="alert" className="validation-error">
    تتطلب إدارة سياسة الإلغاء جلسة مشغّل فعّالة وصلاحية سياسات المنصة.
  </p>;
  // A new session for the same actor is not the same editor authority.
  const sessionKey = JSON.stringify([session.identity.subject, session.identity.sessionId]);
  return <StoreTypeCancellationEditor key={sessionKey} />;
}

function StoreTypeCancellationEditor() {
  const [verticals, setVerticals] = useState<readonly CommerceVertical[]>([]);
  const [verticalId, setVerticalId] = useState("");
  const [types, setTypes] = useState<readonly CommercialStoreType[]>([]);
  const [typeId, setTypeId] = useState("");
  const [mode, setMode] = useState<CancellationMode>("OPERATIONS_ONLY");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [verticalsLoading, setVerticalsLoading] = useState(true);
  const [typesLoading, setTypesLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const inFlightSave = useRef<AbortController | null>(null);
  const current = types.find(type => type.id === typeId);
  const loading = verticalsLoading || typesLoading;

  useEffect(() => () => {
    // The PATCH may already have committed. Abort old UI completion, never replay.
    inFlightSave.current?.abort();
    inFlightSave.current = null;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is the explicit GET-only retry after an uncertain Store Type mutation.
  useEffect(() => {
    const controller = new AbortController();
    setVerticalsLoading(true);
    setError("");
    void readJson<{ verticals: CommerceVertical[] }>("/api/catalog/verticals", controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        setVerticals(value.verticals);
        setVerticalId(value.verticals[0]?.id ?? "");
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "تعذر تحميل المجالات");
      })
      .finally(() => { if (!controller.signal.aborted) setVerticalsLoading(false); });
    return () => controller.abort();
  }, [reload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload must re-read the selected vertical even when its ID has not changed.
  useEffect(() => {
    const controller = new AbortController();
    setTypes([]);
    setTypeId("");
    if (!verticalId) {
      setTypesLoading(false);
      return () => controller.abort();
    }
    setTypesLoading(true);
    setError("");
    void readJson<{ storeTypes: CommercialStoreType[] }>(
      `/api/catalog/commercial-store-types?verticalId=${encodeURIComponent(verticalId)}`, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        setTypes(value.storeTypes);
        setTypeId(value.storeTypes[0]?.id ?? "");
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "تعذر تحميل أنواع المتاجر");
      })
      .finally(() => { if (!controller.signal.aborted) setTypesLoading(false); });
    return () => controller.abort();
  }, [verticalId, reload]);

  useEffect(() => { setMode(current?.cancellationMode ?? "OPERATIONS_ONLY"); setReason(""); }, [current]);

  async function save() {
    if (!current || busy || inFlightSave.current || loading || error ||
      mode === current.cancellationMode || reason.trim().length < 5) return;
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    inFlightSave.current = controller;
    const storeTypeId = current.id;
    const expectedVersion = current.version;
    const requestedMode = mode;
    const selectedVertical = verticalId;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/policies/store-type-cancellations/${encodeURIComponent(storeTypeId)}`, {
        method: "PATCH", signal: requestSignal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ mode: requestedMode, expectedVersion, reason: reason.trim() }),
      });
      const payload = await response.json() as { storeType?: CommercialStoreType; error?: { message?: string } };
      if (controller.signal.aborted) return;
      if (!response.ok || !payload.storeType || payload.storeType.id !== storeTypeId ||
        payload.storeType.cancellationMode !== requestedMode ||
        !Number.isSafeInteger(payload.storeType.version) || payload.storeType.version !== expectedVersion + 1) {
        throw new Error("POLICY_WRITE_UNCONFIRMED");
      }
      // A PATCH response alone is not durable proof. Re-read the DSH-owned Store Type.
      const readback = await readJson<{ storeTypes: CommercialStoreType[] }>(
        `/api/catalog/commercial-store-types?verticalId=${encodeURIComponent(selectedVertical)}`,
        requestSignal,
      );
      if (controller.signal.aborted) return;
      const confirmed = Array.isArray(readback.storeTypes)
        ? readback.storeTypes.find(item => item.id === storeTypeId)
        : undefined;
      if (!confirmed || !Number.isSafeInteger(confirmed.version) ||
        confirmed.version !== payload.storeType.version ||
        confirmed.verticalId !== selectedVertical ||
        confirmed.cancellationMode !== requestedMode) throw new Error("POLICY_READBACK_MISMATCH");
      setTypes(readback.storeTypes);
      setTypeId(storeTypeId);
      setNotice("تم تأكيد سياسة الإلغاء الجديدة من DSH للطلبات القادمة. لن تتغير الطلبات السابقة.");
      setReason("");
    } catch {
      if (controller.signal.aborted) return;
      // The PATCH may have succeeded despite a timeout. Require a fresh read,
      // never reuse the old optimistic version or dispatch a hidden retry.
      setTypes([]);
      setTypeId("");
      setError("تعذر تأكيد نتيجة الحفظ. أعد قراءة أنواع المتاجر من DSH قبل محاولة جديدة.");
    } finally {
      if (inFlightSave.current === controller) inFlightSave.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="access-form" aria-labelledby="cancellation-policy-heading">
    <h3 id="cancellation-policy-heading">سياسة إلغاء الطلبات حسب نوع النشاط</h3>
    <p className="muted">خياران فقط لكل نوع نشاط. يُحسم تنفيذ الإلغاء من الخادم وفق حالة الطلب، وتحتفظ الطلبات القديمة بسياستها.</p>
    <label className="field-label" htmlFor="cancellation-vertical">المجال
      <select id="cancellation-vertical" value={verticalId}
        onChange={event => { setVerticalId(event.target.value); setNotice(""); setError(""); }}
        disabled={busy || loading}>
        {verticals.map(item => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
      </select>
    </label>
    <label className="field-label" htmlFor="cancellation-store-type">نوع النشاط
      <select id="cancellation-store-type" value={typeId}
        onChange={event => { setTypeId(event.target.value); setNotice(""); setError(""); }}
        disabled={busy || loading}>
        {types.map(item => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
      </select>
    </label>
    {current ? <>
      <p className="muted">السياسة الحالية: {labels[current.cancellationMode]} · النسخة {current.version}</p>
      <label className="field-label" htmlFor="cancellation-policy-mode">طريقة الإلغاء
        <select id="cancellation-policy-mode" value={mode}
          onChange={event => { setMode(event.target.value as CancellationMode); setNotice(""); }} disabled={busy}>
          <option value="OPERATIONS_ONLY">{labels.OPERATIONS_ONLY}</option>
          <option value="CLIENT_BEFORE_ACCEPTANCE">{labels.CLIENT_BEFORE_ACCEPTANCE}</option>
        </select>
      </label>
      <label className="field-label" htmlFor="cancellation-policy-reason">سبب تعديل السياسة
        <textarea id="cancellation-policy-reason" value={reason}
          onChange={event => setReason(event.target.value)}
          minLength={5} maxLength={500} rows={2} disabled={busy} />
      </label>
      <button type="button" className="button button-primary"
        disabled={busy || loading || Boolean(error) || reason.trim().length < 5 || mode === current.cancellationMode}
        onClick={() => void save()}>
        {busy ? "جارٍ حفظ السياسة…" : "اعتماد السياسة"}
      </button>
    </> : <p className="muted">{loading ? "جارٍ تحميل السياسة…" : "لا توجد أنواع متاجر متاحة أو يجب إعادة قراءة السياسة."}</p>}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <div role="alert"><p className="identity-error">{error}</p>
      <button type="button" className="button button-secondary" disabled={busy || loading}
        onClick={() => { setReload(value => value + 1); setError(""); setNotice(""); }}>
        إعادة قراءة السياسة من DSH
      </button>
    </div> : null}
  </section>;
}
