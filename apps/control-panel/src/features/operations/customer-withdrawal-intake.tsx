"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWalletProviders } from "../wallet-provider/use-wallet-providers";

type PendingRequest = {
  fingerprint: string;
  evidenceDocumentId?: string;
  evidenceIdempotencyKey: string;
  evidenceCorrelationId: string;
  intakeIdempotencyKey: string;
  intakeCorrelationId: string;
};

export function CustomerWithdrawalIntake() {
  const { walletProviders, walletProvidersLoading, walletProvidersError } = useWalletProviders();
  const [customerSearch, setCustomerSearch] = useState("");
  const [clients, setClients] = useState<ReadonlyArray<{ id: string; phone: string }>>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [customerActorId, setCustomerActorId] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createdIntakeId, setCreatedIntakeId] = useState("");
  const pendingRequest = useRef<PendingRequest | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setClients([]);
    if (customerSearch.trim().length < 3) { setClientsLoading(false); return; }
    setClientsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/operations/clients?q=${encodeURIComponent(customerSearch.trim())}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("تعذر البحث عن العميل. أعد المحاولة.");
        const result = await response.json() as { clients: ReadonlyArray<{ id: string; phone: string }> };
        if (!controller.signal.aborted) setClients(result.clients);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "تعذر البحث عن العميل.");
      } finally { if (!controller.signal.aborted) setClientsLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [customerSearch]);

  const submit = async () => {
    setBusy(true); setError(""); setNotice(""); setCreatedIntakeId("");
    try {
      if (!clients.some((client) => client.id === customerActorId) || !walletProviders.some((provider) => provider.key === providerKey) || requestReason.trim().length < 3 || !file) throw new Error("اختر العميل والمحفظة الرسمية وأكمل السبب ومستند التفويض.");
      const fingerprint = JSON.stringify([customerActorId.trim(), providerKey.trim(), requestReason.trim(), file.name, file.size, file.lastModified]);
      let pending = pendingRequest.current;
      if (!pending || pending.fingerprint !== fingerprint) {
        pending = {
          fingerprint,
          evidenceIdempotencyKey: crypto.randomUUID(),
          evidenceCorrelationId: crypto.randomUUID(),
          intakeIdempotencyKey: crypto.randomUUID(),
          intakeCorrelationId: crypto.randomUUID(),
        };
        pendingRequest.current = pending;
      }
      if (!pending.evidenceDocumentId) {
        const form = new FormData(); form.set("file", file);
        const uploaded = await fetch("/api/operations/customer-withdrawal-request-evidence", { method: "POST", headers: { "Idempotency-Key": pending.evidenceIdempotencyKey, "X-Correlation-ID": pending.evidenceCorrelationId }, body: form });
        const evidence = await uploaded.json().catch(() => null) as { document?: { id?: string }; error?: { message?: string } } | null;
        if (!uploaded.ok || !evidence?.document?.id) throw new Error(evidence?.error?.message || "تعذر رفع مستند التفويض.");
        pending.evidenceDocumentId = evidence.document.id;
      }
      const created = await fetch("/api/operations/customer-withdrawal-intakes", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.intakeIdempotencyKey, "X-Correlation-ID": pending.intakeCorrelationId }, body: JSON.stringify({ customerActorId: customerActorId.trim(), providerKey: providerKey.trim(), requestReason: requestReason.trim(), requestEvidenceDocumentId: pending.evidenceDocumentId }) });
      const result = await created.json().catch(() => null) as { intake?: { id?: string }; error?: { message?: string } } | null;
      if (!created.ok || !result?.intake?.id) throw new Error(result?.error?.message || "تعذر تسجيل طلب السحب.");
      pendingRequest.current = null;
      setNotice(`سُجل الطلب ${result.intake.id}. لم يتغير رصيد العميل؛ ينتظر مراجعة المالية.`);
      setCreatedIntakeId(result.intake.id);
      setCustomerActorId(""); setCustomerSearch(""); setProviderKey(""); setRequestReason(""); setFile(null);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر حفظ طلب السحب"); }
    finally { setBusy(false); }
  };

  return <section className="access-card" aria-labelledby="customer-withdrawal-intake-title"><p className="eyebrow">طلب داخلي موثق · لا يوجد سحب ذاتي</p><h2 id="customer-withdrawal-intake-title">تسجيل طلب سحب عميل نادر</h2><p className="muted">تستقبل العمليات تفويض العميل وتوثقه. الاسم ورقم المحفظة الرسميان يُقرآن من بيانات الحسابات الموثقة ولا يُدخلان هنا. لا ينشأ أي حجز قبل قبول المالية.</p>
    <div className="finance-toolbar"><label className="field-label" htmlFor="withdrawal-client-search">البحث برقم جوال العميل<input id="withdrawal-client-search" type="search" value={customerSearch} onChange={(event) => { pendingRequest.current = null; setCustomerActorId(""); setError(""); setCustomerSearch(event.target.value); }} maxLength={30} disabled={busy} /></label>{customerSearch ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => { pendingRequest.current = null; setCustomerSearch(""); setCustomerActorId(""); document.getElementById("withdrawal-client-search")?.focus(); }}>مسح البحث</button> : null}<label className="field-label" htmlFor="withdrawal-client">العميل<select id="withdrawal-client" value={customerActorId} disabled={busy || clientsLoading || clients.length === 0} onChange={(event) => { pendingRequest.current = null; setCustomerActorId(event.target.value); }}><option value="">{clientsLoading ? "جارٍ البحث…" : "اختر العميل من نتائج البحث"}</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.phone}</option>)}</select></label>{!clientsLoading && customerSearch.trim().length >= 3 && clients.length === 0 ? <p role="status">لا يوجد عميل مطابق. تحقق من رقم الجوال.</p> : null}<label className="field-label" htmlFor="withdrawal-provider">مزوّد المحفظة الرسمية<select id="withdrawal-provider" value={providerKey} onChange={(event) => { pendingRequest.current = null; setProviderKey(event.target.value); }} disabled={busy || walletProvidersLoading || Boolean(walletProvidersError)}><option value="">اختر محفظة رسمية</option>{walletProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.displayNameAr}</option>)}</select></label>{walletProvidersError ? <p className="identity-error" role="alert">{walletProvidersError}</p> : null}<label className="field-label">سبب الطلب<textarea value={requestReason} onChange={(event) => { pendingRequest.current = null; setRequestReason(event.target.value); }} maxLength={512} disabled={busy} /></label><label className="field-label">مستند تفويض العميل (إلزامي)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => { pendingRequest.current = null; setFile(event.target.files?.[0] ?? null); }} disabled={busy} /></label></div>
    {error ? <p className="state-error" role="alert">{error}</p> : null}{notice ? <p className="state-success" role="status">{notice}</p> : null}{createdIntakeId ? <Link className="button button-secondary" href={`/finance/customer-withdrawals?intakeId=${encodeURIComponent(createdIntakeId)}`}>فتح الطلب في طابور المالية</Link> : null}<button className="button button-primary" type="button" disabled={busy || clientsLoading || !customerActorId} onClick={() => void submit()}>{busy ? "جارٍ التسجيل…" : "رفع التفويض وتسجيل الطلب"}</button>
  </section>;
}
