"use client";

import { formatMoney } from "@bthwani/dsh";
import { useState } from "react";

type Intake = Readonly<{ id: string; customerActorId: string; providerKey: string; walletIdentifierMasked: string; beneficiaryName: string; beneficiaryIdentityVersion: number; requestReason: string; requestEvidenceDocumentId: string; status: string; destinationId?: string | null; payoutId?: string | null; payoutStatus?: string | null; payoutAmountMinor?: number | null; payoutCurrency?: "YER" | null; requestedBy: string; requestedAt: string; financeActorId?: string | null; resolutionReason?: string | null; currency: "YER"; eligibleAvailableMinor: number; heldMinor: number }>;
type SettlementBatch = Readonly<{ batch: Readonly<{ id: string; rowCount: number; totalAmountMinor: number; currency: "YER" }> }>;
type CustomerWithdrawalQueueProps = Readonly<{ onBatchCreated?: (batchId: string) => void }>;
type Destination = Readonly<{ destination: Readonly<{ id: string; status: string; verificationStatus: string; walletIdentifierMasked: string; beneficiaryName: string; version: number }> }>;

function message(body: unknown, fallback: string) {
  return body && typeof body === "object" && typeof (body as { error?: { message?: unknown } }).error?.message === "string" ? (body as { error: { message: string } }).error.message : fallback;
}

async function json<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(message(body, fallback));
  return body as T;
}

export function CustomerWithdrawalQueue({ onBatchCreated }: CustomerWithdrawalQueueProps) {
  const [items, setItems] = useState<ReadonlyArray<Intake>>([]);
  const [destinations, setDestinations] = useState<Readonly<Record<string, Destination["destination"]>>>({});
  const [reason, setReason] = useState("");
  const [verificationEvidence, setVerificationEvidence] = useState("");
  const [payoutEvidenceReference, setPayoutEvidenceReference] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const read = async () => {
    setLoading(true); setError(""); setNotice("");
    try {
      const query = new URLSearchParams({ limit: "100" }); if (filter) query.set("status", filter);
      const result = await json<{ intakes: ReadonlyArray<Intake> }>(await fetch(`/api/finance/customer-withdrawal-intakes?${query}`, { cache: "no-store" }), "تعذر قراءة طابور سحوبات العملاء");
      setItems(result.intakes);
      const destinationsRead = await Promise.all(result.intakes.filter((item) => item.destinationId).map(async (item) => {
        try { const response = await json<Destination>(await fetch(`/api/finance/actor-destination?actorType=customer&actorId=${encodeURIComponent(item.customerActorId)}`, { cache: "no-store" }), "تعذر قراءة الوجهة"); return [item.id, response.destination] as const; }
        catch { return [item.id, null] as const; }
      }));
      setDestinations(Object.fromEntries(destinationsRead.filter((entry): entry is readonly [string, Destination["destination"]] => entry[1] !== null)));
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة طابور سحوبات العملاء"); }
    finally { setLoading(false); }
  };

  const act = async (item: Intake, action: string) => {
    if (reason.trim().length < 3) { setError("أدخل سبباً واضحاً قبل تنفيذ الإجراء."); return; }
    setLoading(true); setError(""); setNotice("");
    try {
      const payload = action === "verify-destination" ? { evidenceReference: verificationEvidence.trim() } : action === "activate-destination" ? {} : { reason: reason.trim() };
      if (action === "verify-destination" && !verificationEvidence.trim()) throw new Error("أدخل مرجع دليل التحقق من رقم المحفظة.");
      await json(await fetch(`/api/finance/customer-withdrawal-intakes/${encodeURIComponent(item.id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Correlation-ID": crypto.randomUUID() }, body: JSON.stringify(payload) }), "تعذر تنفيذ إجراء طلب السحب");
      setNotice("حُفظ الإجراء في WLT وسجل التدقيق."); setReason(""); setVerificationEvidence(""); await read();
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تنفيذ الإجراء"); }
    finally { setLoading(false); }
  };

  const transitionPayout = async (item: Intake, action: "prepare" | "approve") => {
    if (!item.payoutId || reason.trim().length < 3) { setError("أدخل سبباً واضحاً قبل تنفيذ الإجراء."); return; }
    if (action === "prepare" && !payoutEvidenceReference.trim()) { setError("أدخل مرجع دليل تهيئة واعتماد المستحق."); return; }
    setLoading(true); setError(""); setNotice("");
    try {
      const payload = action === "prepare" ? { reason: reason.trim(), evidenceReference: payoutEvidenceReference.trim() } : { reason: reason.trim() };
      await json(await fetch(`/api/finance/payout-requests/${encodeURIComponent(item.payoutId)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Correlation-ID": crypto.randomUUID() }, body: JSON.stringify(payload) }), "تعذر تغيير حالة طلب الصرف في WLT");
      setNotice(action === "prepare" ? "أُعد طلب الصرف في WLT؛ يلزم اعتماد مستقل." : "اعتمد الطلب في WLT؛ أصبح جاهزاً لدفعة التحويل اليدوي.");
      setReason(""); setPayoutEvidenceReference(""); await read();
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تغيير حالة طلب الصرف"); }
    finally { setLoading(false); }
  };

  const createPayoutBatch = async (item: Intake) => {
    if (!item.payoutId || item.payoutStatus !== "APPROVED") return;
    setLoading(true); setError(""); setNotice("");
    try {
      const result = await json<SettlementBatch>(await fetch("/api/finance/settlement-batches", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Correlation-ID": crypto.randomUUID() }, body: JSON.stringify({ payoutIds: [item.payoutId] }) }), "تعذر إنشاء دفعة الصرف اليدوي");
      setNotice(`أنشأ WLT الدفعة ${result.batch.id} بعدد ${result.batch.rowCount} وبإجمالي محسوب ${formatMoney(result.batch.totalAmountMinor, result.batch.currency)}؛ فتحناها في مكتب التنفيذ والمطابقة.`);
      onBatchCreated?.(result.batch.id); await read();
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر إنشاء دفعة الصرف اليدوي"); }
    finally { setLoading(false); }
  };

  return <section className="access-card" aria-labelledby="customer-withdrawals-title">
    <div className="finance-toolbar"><div><p className="eyebrow">استثناء تشغيلي · بلا سحب ذاتي للعميل</p><h2 id="customer-withdrawals-title">طلبات سحب العملاء النادرة</h2></div><div className="finance-toolbar">
      <label className="field-label" htmlFor="customer-withdrawal-status">الحالة<select id="customer-withdrawal-status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">كل الحالات</option>{["REQUESTED", "DESTINATION_PENDING", "PAYOUT_HELD", "REJECTED", "COMPLETED"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <button className="button button-secondary" type="button" onClick={() => void read()} disabled={loading}>تحديث الطابور</button>
    </div></div>
    <p className="muted">العمليات تسجل الطلب وإثبات التفويض. المالية تتحقق من الوجهة وتقبل الطلب؛ القبول يحسب الرصيد المؤهل وقت التنفيذ ويحجزه في WLT. التنفيذ الخارجي والإيصال ومطابقة الكشف تجري عبر مكتب الدفعات المشترك.</p>
    <div className="finance-toolbar"><label className="field-label" htmlFor="customer-withdrawal-reason">سبب الإجراء<input id="customer-withdrawal-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} /></label><label className="field-label" htmlFor="customer-withdrawal-verification-evidence">مرجع دليل تحقق المحفظة<input id="customer-withdrawal-verification-evidence" value={verificationEvidence} onChange={(event) => setVerificationEvidence(event.target.value)} maxLength={512} /></label><label className="field-label" htmlFor="customer-withdrawal-payout-evidence">مرجع دليل تهيئة الصرف<input id="customer-withdrawal-payout-evidence" value={payoutEvidenceReference} onChange={(event) => setPayoutEvidenceReference(event.target.value)} maxLength={512} /></label></div>
    {error ? <p className="state-error" role="alert">{error}</p> : null}{notice ? <p className="state-success" role="status">{notice}</p> : null}
    <div className="finance-table-wrap"><table className="finance-table"><caption className="sr-only">طلبات سحب العملاء الاستثنائية من WLT</caption><thead><tr><th>العميل</th><th>المحفظة الخارجية</th><th>سبب الطلب والتفويض</th><th>حالة الوجهة / الطلب</th><th>الإجراء النظامي</th></tr></thead><tbody>{items.map((item) => { const destination = destinations[item.id]; return <tr key={item.id}>
      <td><bdi>{item.customerActorId}</bdi><br />{item.beneficiaryName}<br /><small>هوية موثقة v{item.beneficiaryIdentityVersion}</small><br /><small>{new Date(item.requestedAt).toLocaleString("ar-YE")}</small><br /><strong>المتاح الآن: {formatMoney(item.eligibleAvailableMinor, item.currency)}</strong><br /><small>المحجوز: {formatMoney(item.heldMinor, item.currency)}</small></td>
      <td>{item.providerKey}<br /><bdi>{item.walletIdentifierMasked}</bdi></td>
      <td>{item.requestReason}<br /><small>مستند التفويض: <bdi>{item.requestEvidenceDocumentId}</bdi></small></td>
      <td>{item.status}{destination ? <><br />{destination.status} · {destination.verificationStatus}<br /><bdi>{destination.walletIdentifierMasked}</bdi></> : null}{item.payoutId ? <><br />طلب WLT: <bdi>{item.payoutId}</bdi><br />حالة الصرف: {item.payoutStatus ?? "—"}{item.payoutAmountMinor && item.payoutCurrency ? <><br />مبلغ الصرف المحجوز: {formatMoney(item.payoutAmountMinor, item.payoutCurrency)}</> : null}</> : null}{item.resolutionReason ? <><br />{item.resolutionReason}</> : null}</td>
      <td className="finance-actions">
        {item.status === "REQUESTED" ? <><button className="button button-secondary" type="button" disabled={loading || reason.trim().length < 3} onClick={() => void act(item, "prepare-destination")}>تهيئة الوجهة</button><button className="button button-quiet" type="button" disabled={loading || reason.trim().length < 3} onClick={() => void act(item, "reject")}>رفض الطلب</button></> : null}
        {item.status === "DESTINATION_PENDING" && destination?.verificationStatus === "PENDING_VERIFICATION" ? <button className="button button-secondary" type="button" disabled={loading || !verificationEvidence.trim()} onClick={() => void act(item, "verify-destination")}>تحقق مستقل</button> : null}
        {item.status === "DESTINATION_PENDING" && destination?.verificationStatus === "VERIFIED" ? <button className="button button-secondary" type="button" disabled={loading} onClick={() => void act(item, "activate-destination")}>تفعيل الوجهة</button> : null}
        {item.status === "DESTINATION_PENDING" && destination?.status === "ACTIVE_FOR_PAYOUT" ? <button className="button button-secondary" type="button" disabled={loading || reason.trim().length < 3} onClick={() => void act(item, "accept")}>قبول وحجز الرصيد المؤهل</button> : null}
        {item.status === "PAYOUT_HELD" && item.payoutStatus === "HELD" ? <button className="button button-secondary" type="button" disabled={loading || reason.trim().length < 3 || !payoutEvidenceReference.trim()} onClick={() => void transitionPayout(item, "prepare")}>تهيئة طلب الصرف</button> : null}
        {item.status === "PAYOUT_HELD" && item.payoutStatus === "PREPARED" ? <button className="button button-secondary" type="button" disabled={loading || reason.trim().length < 3} onClick={() => void transitionPayout(item, "approve")}>اعتماد مستقل للصرف</button> : null}
        {item.status === "PAYOUT_HELD" && item.payoutStatus === "APPROVED" ? <button className="button button-primary" type="button" disabled={loading} onClick={() => void createPayoutBatch(item)}>إنشاء دفعة وفتح مكتب التنفيذ</button> : null}
        {item.status === "PAYOUT_HELD" && ["FROZEN", "EXECUTED", "COMPLETED", "EXCEPTION", "CANCELLED"].includes(item.payoutStatus ?? "") ? <span>طلب الصرف في المسار المشترك · {item.payoutStatus}</span> : null}
        {item.status === "PAYOUT_HELD" && !item.payoutStatus ? <span>تعذر قراءة حالة طلب الصرف من WLT؛ حدّث الطابور قبل المتابعة.</span> : null}
        {item.status === "COMPLETED" || item.status === "REJECTED" ? <span>مغلق · {item.status}</span> : null}
      </td>
    </tr>; })}</tbody></table></div>
    {!items.length && !loading ? <p className="muted">لا توجد طلبات محملة؛ اضغط «تحديث الطابور» لقراءة WLT.</p> : null}
  </section>;
}
