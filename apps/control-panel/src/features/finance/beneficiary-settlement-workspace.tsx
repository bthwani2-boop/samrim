"use client";

import { formatMoney, officialWalletDestinationStatusLabel, officialWalletVerificationStatusLabel, payoutStatusLabel, type BeneficiaryPayoutState, type OfficialWalletDestination } from "@bthwani/dsh";
import { useState } from "react";

type ActorType = "partner" | "captain" | "field";
type Destination = OfficialWalletDestination;
type PayoutState = Readonly<{ state: BeneficiaryPayoutState }>;
const actorLabels: Record<ActorType, string> = { partner: "الشريك", captain: "الكابتن", field: "الميداني" };

export function BeneficiarySettlementWorkspace() {
  const [actorType, setActorType] = useState<ActorType>("partner");
  const [actorId, setActorId] = useState("");
  const [destination, setDestination] = useState<Destination | null>(null);
  const [payoutState, setPayoutState] = useState<PayoutState["state"] | null>(null);
  const [walletIdentifier, setWalletIdentifier] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [changeEvidenceReference, setChangeEvidenceReference] = useState("");
  const [verificationEvidenceReference, setVerificationEvidenceReference] = useState("");
  const [settlementReason, setSettlementReason] = useState("");
  const [settlementEvidence, setSettlementEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = `actorType=${encodeURIComponent(actorType)}&actorId=${encodeURIComponent(actorId.trim())}`;
  const read = async () => {
    setBusy(true); setError("");
    try {
      const [destinationResponse, payoutResponse] = await Promise.all([fetch(`/api/finance/actor-destination?${query}`, { cache: "no-store" }), fetch(`/api/finance/actor-payout-state?${query}`, { cache: "no-store" })]);
      const destinationBody = await destinationResponse.json() as { destination?: Destination; error?: { message?: string } };
      const payoutBody = await payoutResponse.json() as PayoutState & { error?: { message?: string } };
      if (!destinationResponse.ok && destinationResponse.status !== 404) throw new Error(destinationBody.error?.message || "تعذر قراءة وجهة المستفيد");
      if (!payoutResponse.ok) throw new Error(payoutBody.error?.message || "تعذر قراءة حالة التسوية");
      setDestination(destinationBody.destination ?? null); setPayoutState(payoutBody.state);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة حالة التسوية"); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/finance/actor-destination?${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerKey: "official_wallet", walletIdentifier, beneficiaryName, changeReason, verificationEvidenceReference, changeEvidenceReference }) });
      const body = await response.json() as { destination?: Destination; error?: { message?: string } };
      if (!response.ok || !body.destination) throw new Error(body.error?.message || "تعذر إنشاء وجهة المستفيد");
      setDestination(body.destination); setWalletIdentifier(""); setChangeReason(""); setChangeEvidenceReference("");
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر إنشاء وجهة المستفيد"); } finally { setBusy(false); }
  };
  const transition = async (action: "verify" | "activate") => {
    if (!destination) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/finance/actor-destination/${action}?${query}&destinationId=${encodeURIComponent(destination.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "verify" ? { evidenceReference: verificationEvidenceReference } : {}) });
      const body = await response.json() as { destination?: Destination; error?: { message?: string } };
      if (!response.ok || !body.destination) throw new Error(body.error?.message || "تعذر تغيير حالة الوجهة");
      setDestination(body.destination);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تغيير حالة الوجهة"); } finally { setBusy(false); }
  };
  const payoutAction = async (action: "prepare" | "approve" | "cancel") => {
    if (!payoutState?.latestPayout) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/finance/payout-requests/${encodeURIComponent(payoutState.latestPayout.id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: settlementReason, evidenceReference: settlementEvidence }) });
      const body = await response.json() as { payout?: PayoutState["state"]["latestPayout"]; error?: { message?: string } };
      if (!response.ok || !body.payout) throw new Error(body.error?.message || "تعذر تنفيذ إجراء التسوية");
      setPayoutState((current) => current ? { ...current, latestPayout: body.payout ?? null } : current);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تنفيذ إجراء التسوية"); } finally { setBusy(false); }
  };
  const label = actorLabels[actorType];
  return <section className="access-card" aria-labelledby="beneficiary-settlement-title"><div className="finance-toolbar"><div><p className="eyebrow">المالية · وجهة وحجز وتسوية</p><h2 id="beneficiary-settlement-title">وجهة وتسوية المستفيد</h2></div></div><p className="muted">إدارة الوجهة الرسمية تتم من المالية فقط. السجل المالي يثبت المبلغ والوجهة ويحجزهما؛ التنفيذ الخارجي لا يكتمل إلا بالدليل والتحقق والمطابقة.</p><label className="field-label" htmlFor="beneficiary-settlement-type">نوع المستفيد<select id="beneficiary-settlement-type" value={actorType} onChange={(event) => { setActorType(event.target.value as ActorType); setActorId(""); setDestination(null); setPayoutState(null); }}><option value="partner">الشريك</option><option value="captain">الكابتن</option><option value="field">الميداني</option></select></label><label className="field-label" htmlFor="beneficiary-settlement-actor">معرّف {label}<input id="beneficiary-settlement-actor" value={actorId} onChange={(event) => setActorId(event.target.value)} placeholder={`${actorType}_…`} /></label><button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy || !actorId.trim()}>{busy ? "جارٍ القراءة…" : "قراءة الحالة"}</button>{!destination ? <><label className="field-label" htmlFor="beneficiary-wallet-identifier">رقم المحفظة الرسمية<input id="beneficiary-wallet-identifier" value={walletIdentifier} onChange={(event) => setWalletIdentifier(event.target.value)} placeholder="يظهر مشفرًا ومقنعًا بعد الحفظ" /></label><label className="field-label" htmlFor="beneficiary-name">اسم المستفيد<input id="beneficiary-name" value={beneficiaryName} onChange={(event) => setBeneficiaryName(event.target.value)} /></label><label className="field-label" htmlFor="beneficiary-destination-reason">سبب التهيئة<input id="beneficiary-destination-reason" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} /></label><label className="field-label" htmlFor="beneficiary-destination-evidence">مرجع دليل التهيئة<input id="beneficiary-destination-evidence" value={changeEvidenceReference} onChange={(event) => setChangeEvidenceReference(event.target.value)} /></label><label className="field-label" htmlFor="beneficiary-destination-verification">مرجع دليل التحقق<input id="beneficiary-destination-verification" value={verificationEvidenceReference} onChange={(event) => setVerificationEvidenceReference(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => void create()} disabled={busy || !actorId.trim() || !walletIdentifier.trim() || !beneficiaryName.trim() || !changeReason.trim() || !changeEvidenceReference.trim() || !verificationEvidenceReference.trim()}>إنشاء وجهة مرشحة</button></> : <section className="finance-summary-grid" aria-label={`حالة وجهة ${label}`}><article className="finance-summary-card"><span>الوجهة</span><strong>{destination.walletIdentifierMasked}</strong></article><article className="finance-summary-card"><span>الحالة</span><strong>{officialWalletVerificationStatusLabel(destination.verificationStatus)} · {officialWalletDestinationStatusLabel(destination.status)}</strong></article>{destination.status === "CANDIDATE" ? <><label className="field-label" htmlFor="beneficiary-destination-verification-existing">مرجع دليل التحقق<input id="beneficiary-destination-verification-existing" value={verificationEvidenceReference} onChange={(event) => setVerificationEvidenceReference(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => void transition("verify")} disabled={busy || !verificationEvidenceReference.trim()}>تسجيل التحقق</button></> : null}{destination.status === "PENDING_APPROVAL" ? <button className="button button-secondary" type="button" onClick={() => void transition("activate")} disabled={busy}>اعتماد للتسوية</button> : null}</section>}{payoutState ? <><p className="muted">المتاح: {formatMoney(payoutState.eligibleAvailableMinor, payoutState.currency)} · المحجوز: {formatMoney(payoutState.heldMinor, payoutState.currency)}</p>{payoutState.latestPayout ? <section className="finance-summary-grid" aria-label="حالة طلب التسوية"><article className="finance-summary-card"><span>طلب التسوية</span><strong>{payoutStatusLabel(payoutState.latestPayout.status)}</strong></article><article className="finance-summary-card"><span>المبلغ المثبت</span><strong>{formatMoney(payoutState.latestPayout.resolvedAmountMinor, payoutState.currency)}</strong></article><label className="field-label" htmlFor="settlement-action-reason">سبب إجراء التسوية<input id="settlement-action-reason" value={settlementReason} onChange={(event) => setSettlementReason(event.target.value)} /></label>{payoutState.latestPayout.status === "HELD" ? <><label className="field-label" htmlFor="settlement-action-evidence">مرجع الدليل<input id="settlement-action-evidence" value={settlementEvidence} onChange={(event) => setSettlementEvidence(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => void payoutAction("prepare")} disabled={busy || !settlementReason.trim() || !settlementEvidence.trim()}>تهيئة اللقطة</button><button className="button button-secondary" type="button" onClick={() => void payoutAction("cancel")} disabled={busy || !settlementReason.trim()}>إلغاء وإطلاق الحجز</button></> : null}{payoutState.latestPayout.status === "PREPARED" ? <button className="button button-secondary" type="button" onClick={() => void payoutAction("approve")} disabled={busy || !settlementReason.trim()}>اعتماد مستقل</button> : null}</section> : null}</> : null}{error ? <p className="validation-error" role="alert">{error}</p> : null}</section>;
}
