"use client";

import { useState } from "react";

type Destination = Readonly<{ id: string; walletIdentifierMasked: string; beneficiaryName: string; verificationStatus: string; status: string; version: number }>;
type PayoutState = Readonly<{ state: { eligibleAvailableMinor: number; heldMinor: number; destination: Destination | null; latestPayout: { resolvedAmountMinor: number; status: string } | null } }>;

export function PartnerSettlementWorkspace() {
  const [partnerActorId, setPartnerActorId] = useState("");
  const [destination, setDestination] = useState<Destination | null>(null);
  const [payoutState, setPayoutState] = useState<PayoutState["state"] | null>(null);
  const [walletIdentifier, setWalletIdentifier] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [changeEvidenceReference, setChangeEvidenceReference] = useState("");
  const [verificationEvidenceReference, setVerificationEvidenceReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const read = async () => {
    setBusy(true); setError("");
    try {
      const query = `partnerActorId=${encodeURIComponent(partnerActorId.trim())}`;
      const [destinationResponse, payoutResponse] = await Promise.all([fetch(`/api/finance/partner-destination?${query}`, { cache: "no-store" }), fetch(`/api/finance/partner-payout-state?${query}`, { cache: "no-store" })]);
      const destinationBody = await destinationResponse.json() as { destination?: Destination; error?: { message?: string } };
      const payoutBody = await payoutResponse.json() as PayoutState & { error?: { message?: string } };
      if (!destinationResponse.ok && destinationResponse.status !== 404) throw new Error(destinationBody.error?.message || "تعذر قراءة وجهة الشريك");
      if (!payoutResponse.ok) throw new Error(payoutBody.error?.message || "تعذر قراءة حالة التسوية");
      setDestination(destinationBody.destination ?? null); setPayoutState(payoutBody.state);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة حالة التسوية"); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/finance/partner-destination?partnerActorId=${encodeURIComponent(partnerActorId.trim())}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerKey: "official_wallet", walletIdentifier, beneficiaryName, changeReason, verificationEvidenceReference, changeEvidenceReference }) });
      const body = await response.json() as { destination?: Destination; error?: { message?: string } };
      if (!response.ok || !body.destination) throw new Error(body.error?.message || "تعذر إنشاء وجهة الشريك");
      setDestination(body.destination); setWalletIdentifier(""); setChangeReason(""); setChangeEvidenceReference("");
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر إنشاء وجهة الشريك"); } finally { setBusy(false); }
  };
  const transition = async (action: "verify" | "activate") => {
    if (!destination) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/finance/partner-destination/${action}?partnerActorId=${encodeURIComponent(partnerActorId.trim())}&destinationId=${encodeURIComponent(destination.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "verify" ? { evidenceReference: verificationEvidenceReference } : {}) });
      const body = await response.json() as { destination?: Destination; error?: { message?: string } };
      if (!response.ok || !body.destination) throw new Error(body.error?.message || "تعذر تغيير حالة الوجهة");
      setDestination(body.destination);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تغيير حالة الوجهة"); } finally { setBusy(false); }
  };
  return <section className="access-card" aria-labelledby="partner-settlement-title"><div className="finance-toolbar"><div><p className="eyebrow">WLT · وجهة وحجز</p><h2 id="partner-settlement-title">وجهة وتسوية الشريك</h2></div></div><p className="muted">إدارة الوجهة الرسمية تتم من المالية فقط. طلب الشريك لا يرسل رقم المحفظة ولا يحسب المبلغ؛ WLT يثبت الوجهة والمبلغ ويحجزه.</p><label className="field-label" htmlFor="partner-settlement-actor">معرّف الشريك<input id="partner-settlement-actor" value={partnerActorId} onChange={(event) => setPartnerActorId(event.target.value)} placeholder="partner_…" /></label><button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy || !partnerActorId.trim()}>{busy ? "جارٍ القراءة…" : "قراءة الحالة"}</button>{!destination ? <><label className="field-label" htmlFor="partner-wallet-identifier">رقم المحفظة الرسمية<input id="partner-wallet-identifier" value={walletIdentifier} onChange={(event) => setWalletIdentifier(event.target.value)} placeholder="يظهر مشفرًا ومقنعًا بعد الحفظ" /></label><label className="field-label" htmlFor="partner-beneficiary-name">اسم المستفيد<input id="partner-beneficiary-name" value={beneficiaryName} onChange={(event) => setBeneficiaryName(event.target.value)} /></label><label className="field-label" htmlFor="partner-destination-reason">سبب التهيئة<input id="partner-destination-reason" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} /></label><label className="field-label" htmlFor="partner-destination-evidence">مرجع دليل التهيئة<input id="partner-destination-evidence" value={changeEvidenceReference} onChange={(event) => setChangeEvidenceReference(event.target.value)} /></label><label className="field-label" htmlFor="partner-destination-verification">مرجع دليل التحقق<input id="partner-destination-verification" value={verificationEvidenceReference} onChange={(event) => setVerificationEvidenceReference(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => void create()} disabled={busy || !partnerActorId.trim() || !walletIdentifier.trim() || !beneficiaryName.trim() || !changeReason.trim() || !changeEvidenceReference.trim() || !verificationEvidenceReference.trim()}>إنشاء وجهة مرشحة</button></> : <section className="finance-summary-grid" aria-label="حالة وجهة الشريك"><article className="finance-summary-card"><span>الوجهة</span><strong>{destination.walletIdentifierMasked}</strong></article><article className="finance-summary-card"><span>الحالة</span><strong>{destination.verificationStatus} · {destination.status}</strong></article>{destination.status === "CANDIDATE" ? <><label className="field-label" htmlFor="partner-destination-verification-existing">مرجع دليل التحقق<input id="partner-destination-verification-existing" value={verificationEvidenceReference} onChange={(event) => setVerificationEvidenceReference(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => void transition("verify")} disabled={busy || !verificationEvidenceReference.trim()}>تسجيل التحقق</button></> : null}{destination.status === "PENDING_APPROVAL" ? <button className="button button-secondary" type="button" onClick={() => void transition("activate")} disabled={busy}>اعتماد للتسوية</button> : null}</section>}{payoutState ? <p className="muted">المتاح: {payoutState.eligibleAvailableMinor.toLocaleString("ar-YE")} YER · المحجوز: {payoutState.heldMinor.toLocaleString("ar-YE")} YER</p> : null}{error ? <p className="validation-error" role="alert">{error}</p> : null}</section>;
}
