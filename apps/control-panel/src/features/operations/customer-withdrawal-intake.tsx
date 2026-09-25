"use client";

import { useState } from "react";

export function CustomerWithdrawalIntake() {
  const [customerActorId, setCustomerActorId] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [walletIdentifier, setWalletIdentifier] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      if (!customerActorId.trim() || !providerKey.trim() || !/^\+[1-9][0-9]{7,14}$/.test(walletIdentifier.trim()) || requestReason.trim().length < 3 || !file) throw new Error("أكمل معرّف العميل، المزوّد، رقم المحفظة بصيغة دولية، السبب، ومستند التفويض.");
      const uploadKey = crypto.randomUUID();
      const form = new FormData(); form.set("file", file);
      const uploaded = await fetch("/api/operations/customer-withdrawal-request-evidence", { method: "POST", headers: { "Idempotency-Key": uploadKey, "X-Correlation-ID": crypto.randomUUID() }, body: form });
      const evidence = await uploaded.json().catch(() => null) as { document?: { id?: string }; error?: { message?: string } } | null;
      if (!uploaded.ok || !evidence?.document?.id) throw new Error(evidence?.error?.message || "تعذر رفع مستند التفويض.");
      const created = await fetch("/api/operations/customer-withdrawal-intakes", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Correlation-ID": crypto.randomUUID() }, body: JSON.stringify({ customerActorId: customerActorId.trim(), providerKey: providerKey.trim(), walletIdentifier: walletIdentifier.trim(), requestReason: requestReason.trim(), requestEvidenceDocumentId: evidence.document.id }) });
      const result = await created.json().catch(() => null) as { intake?: { id?: string }; error?: { message?: string } } | null;
      if (!created.ok || !result?.intake?.id) throw new Error(result?.error?.message || "تعذر تسجيل طلب السحب.");
      setNotice(`سُجل الطلب ${result.intake.id}. لم يتغير رصيد العميل؛ ينتظر مراجعة المالية.`);
      setCustomerActorId(""); setProviderKey(""); setWalletIdentifier(""); setRequestReason(""); setFile(null);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر حفظ طلب السحب"); }
    finally { setBusy(false); }
  };

  return <section className="access-card" aria-labelledby="customer-withdrawal-intake-title"><p className="eyebrow">طلب داخلي موثق · لا يوجد سحب ذاتي</p><h2 id="customer-withdrawal-intake-title">تسجيل طلب سحب عميل نادر</h2><p className="muted">تستقبل العمليات تفويض العميل وتوثقه. الاسم الرباعي يُقرأ من Identity ولا يُدخل هنا. رقم المحفظة يظل مشفراً ومقنعاً بعد الحفظ، ولا ينشأ أي حجز قبل قبول المالية.</p>
    <div className="finance-toolbar"><label className="field-label">معرّف العميل<input value={customerActorId} onChange={(event) => setCustomerActorId(event.target.value)} maxLength={128} /></label><label className="field-label">مزوّد المحفظة الرسمية<input value={providerKey} onChange={(event) => setProviderKey(event.target.value)} maxLength={64} /></label><label className="field-label">رقم المحفظة بصيغة دولية<input value={walletIdentifier} onChange={(event) => setWalletIdentifier(event.target.value)} placeholder="+967…" inputMode="tel" /></label><label className="field-label">سبب الطلب<textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} maxLength={512} /></label><label className="field-label">مستند تفويض العميل (إلزامي)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label></div>
    {error ? <p className="state-error" role="alert">{error}</p> : null}{notice ? <p className="state-success" role="status">{notice}</p> : null}<button className="button button-primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? "جارٍ التسجيل…" : "رفع التفويض وتسجيل الطلب"}</button>
  </section>;
}
