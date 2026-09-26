"use client";

import { useRef, useState } from "react";
import Link from "next/link";

type PendingRequest = {
  fingerprint: string;
  evidenceDocumentId?: string;
  evidenceIdempotencyKey: string;
  evidenceCorrelationId: string;
  intakeIdempotencyKey: string;
  intakeCorrelationId: string;
};

export function CustomerWithdrawalIntake() {
  const [customerActorId, setCustomerActorId] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [walletIdentifier, setWalletIdentifier] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createdIntakeId, setCreatedIntakeId] = useState("");
  const pendingRequest = useRef<PendingRequest | null>(null);

  const submit = async () => {
    setBusy(true); setError(""); setNotice(""); setCreatedIntakeId("");
    try {
      if (!customerActorId.trim() || !providerKey.trim() || !/^\+[1-9][0-9]{7,14}$/.test(walletIdentifier.trim()) || requestReason.trim().length < 3 || !file) throw new Error("أكمل معرّف العميل، المزوّد، رقم المحفظة بصيغة دولية، السبب، ومستند التفويض.");
      const fingerprint = JSON.stringify([customerActorId.trim(), providerKey.trim(), walletIdentifier.trim(), requestReason.trim(), file.name, file.size, file.lastModified]);
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
      const created = await fetch("/api/operations/customer-withdrawal-intakes", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.intakeIdempotencyKey, "X-Correlation-ID": pending.intakeCorrelationId }, body: JSON.stringify({ customerActorId: customerActorId.trim(), providerKey: providerKey.trim(), walletIdentifier: walletIdentifier.trim(), requestReason: requestReason.trim(), requestEvidenceDocumentId: pending.evidenceDocumentId }) });
      const result = await created.json().catch(() => null) as { intake?: { id?: string }; error?: { message?: string } } | null;
      if (!created.ok || !result?.intake?.id) throw new Error(result?.error?.message || "تعذر تسجيل طلب السحب.");
      pendingRequest.current = null;
      setNotice(`سُجل الطلب ${result.intake.id}. لم يتغير رصيد العميل؛ ينتظر مراجعة المالية.`);
      setCreatedIntakeId(result.intake.id);
      setCustomerActorId(""); setProviderKey(""); setWalletIdentifier(""); setRequestReason(""); setFile(null);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر حفظ طلب السحب"); }
    finally { setBusy(false); }
  };

  return <section className="access-card" aria-labelledby="customer-withdrawal-intake-title"><p className="eyebrow">طلب داخلي موثق · لا يوجد سحب ذاتي</p><h2 id="customer-withdrawal-intake-title">تسجيل طلب سحب عميل نادر</h2><p className="muted">تستقبل العمليات تفويض العميل وتوثقه. الاسم الرباعي يُقرأ من Identity ولا يُدخل هنا. رقم المحفظة يظل مشفراً ومقنعاً بعد الحفظ، ولا ينشأ أي حجز قبل قبول المالية.</p>
    <div className="finance-toolbar"><label className="field-label">معرّف العميل<input value={customerActorId} onChange={(event) => { pendingRequest.current = null; setCustomerActorId(event.target.value); }} maxLength={128} disabled={busy} /></label><label className="field-label">مزوّد المحفظة الرسمية<input value={providerKey} onChange={(event) => { pendingRequest.current = null; setProviderKey(event.target.value); }} maxLength={64} disabled={busy} /></label><label className="field-label">رقم المحفظة بصيغة دولية<input value={walletIdentifier} onChange={(event) => { pendingRequest.current = null; setWalletIdentifier(event.target.value); }} placeholder="+967…" inputMode="tel" disabled={busy} /></label><label className="field-label">سبب الطلب<textarea value={requestReason} onChange={(event) => { pendingRequest.current = null; setRequestReason(event.target.value); }} maxLength={512} disabled={busy} /></label><label className="field-label">مستند تفويض العميل (إلزامي)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => { pendingRequest.current = null; setFile(event.target.files?.[0] ?? null); }} disabled={busy} /></label></div>
    {error ? <p className="state-error" role="alert">{error}</p> : null}{notice ? <p className="state-success" role="status">{notice}</p> : null}{createdIntakeId ? <Link className="button button-secondary" href={`/finance/customer-withdrawals?intakeId=${encodeURIComponent(createdIntakeId)}`}>فتح الطلب في طابور المالية</Link> : null}<button className="button button-primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? "جارٍ التسجيل…" : "رفع التفويض وتسجيل الطلب"}</button>
  </section>;
}
