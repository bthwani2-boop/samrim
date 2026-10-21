"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { formatMoney } from "@bthwani/dsh";
import { OfficialWalletDestinationManager } from "./official-wallet-destination-manager";
import { useReadOnReturn } from "../shared/use-read-on-return";

type Intake = Readonly<{
  id: string; actorType: "partner" | "captain" | "field"; actorId: string;
  resolvedAmountMinor: number; currency: "YER"; createdAt: string;
  storeAllocations: readonly Readonly<{ storeId: string; amountMinor: number }>[];
}>;
const actorLabels = { partner: "شريك", captain: "كابتن", field: "ميداني" } as const;

// First-class Finance inbox: admission is not a payout and never implies a transfer.
export function SettlementIntakeInbox() {
  const [items, setItems] = useState<readonly Intake[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [destinationIntakeId, setDestinationIntakeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/finance/settlement-intakes", { cache: "no-store" });
      if (!response.ok) throw new Error("تعذرت قراءة طلبات التسوية من المالية");
      const body = await response.json() as { intakes?: readonly Intake[] };
      if (!Array.isArray(body.intakes)) throw new Error("استجابة المالية غير صالحة");
      setItems(body.intakes);
      setDestinationIntakeId((selectedId) => body.intakes?.some((item) => item.id === selectedId) ? selectedId : null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل طلبات التسوية");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useReadOnReturn(() => { void load(); }, !loading && busyId === null && cancelId === null && destinationIntakeId === null);

  async function convert(id: string) {
    setBusyId(id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/finance/settlement-intakes/" + encodeURIComponent(id) + "/convert", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message || "الطلب يحتاج اعتماد وجهة الصرف أو مراجعة المستحقات أولًا");
      }
      setNotice("تم إنشاء طلب صرف معتمد وربطه بطلب التسوية. تابع الموافقة والتحويل والمطابقة من قائمة الدفعات.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إحالة الطلب للصرف");
    } finally { setBusyId(null); }
  }
  async function cancelIntake(id: string) {
    const reason=cancelReason.trim();
    if (!reason || reason.length > 512) { setError("حدد سبب إلغاء الطلب."); return; }
    setBusyId(id); setError(""); setNotice("");
    try {
      const response=await fetch("/api/finance/settlement-intakes/"+encodeURIComponent(id)+"/cancel", {
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason})
      });
      if (!response.ok) throw new Error("لم يتم إلغاء الطلب. حدّث حالته قبل المحاولة مجددًا.");
      setCancelId(null);setCancelReason("");
      setNotice("أُلغِي طلب التسوية لدى المالية دون أي خصم أو تحويل.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إلغاء الطلب"); }
    finally { setBusyId(null); }
  }
  return <section className="panel work-stack" aria-label="طلبات التسوية الواردة">
    <div className="finance-toolbar">
      <div><h2>طلبات التسوية الواردة</h2><p className="muted">الطلب لا يحجز رصيدًا. راجع الوجهة ثم أَحِل للصرف.</p></div>

    </div>
    {error ? <div role="alert" className="identity-error">{error} <button type="button" className="button button-secondary" disabled={loading || busyId !== null} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
    {notice ? <p role="status" className="managed-status managed-status-info">{notice}</p> : null}
    {!loading && items.length === 0 ? <p className="muted">لا توجد طلبات تسوية جديدة.</p> : null}
    {items.length > 0 ? <div className="finance-table-wrap"><table className="finance-table">
      <thead><tr><th>المستفيد</th><th>المبلغ</th><th>الحالة</th><th>الإجراء</th></tr></thead>
      <tbody>{items.map((item) => <Fragment key={item.id}><tr>
        <td>{actorLabels[item.actorType]}</td>
        <td>{formatMoney(item.resolvedAmountMinor, item.currency)}{item.actorType === "partner" ? <small> · {item.storeAllocations.length} متجر</small> : null}</td>
        <td>بانتظار مراجعة المالية</td>
        <td><div className="finance-toolbar">
          <button className="button button-secondary" type="button" aria-expanded={destinationIntakeId === item.id} disabled={busyId !== null} onClick={() => setDestinationIntakeId(destinationIntakeId === item.id ? null : item.id)}>{destinationIntakeId === item.id ? "إغلاق الوجهة" : "مراجعة وجهة الصرف"}</button>
          <button className="button button-primary" type="button" disabled={busyId !== null} onClick={() => void convert(item.id)}>{busyId === item.id ? "جارٍ التحقق" : "التحقق والإحالة للصرف"}</button>
          <details className="finance-intake-more"><summary>المزيد</summary>
            <button className="button button-quiet" type="button" disabled={busyId !== null} onClick={() => { setCancelId(cancelId === item.id ? null : item.id);setCancelReason(""); }}>إلغاء الطلب</button>
          </details>
        </div>{cancelId === item.id ? <div className="finance-toolbar"><input className="field-control" aria-label="سبب إلغاء طلب التسوية" placeholder="سبب الإلغاء" maxLength={512} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /><button className="button button-secondary" type="button" disabled={busyId !== null || !cancelReason.trim()} onClick={() => void cancelIntake(item.id)}>تأكيد الإلغاء</button></div> : null}</td>
      </tr>{destinationIntakeId === item.id ? <tr key={`destination-${item.id}`}>
        <td colSpan={4} id={`finance-intake-destination-${encodeURIComponent(item.id)}`}>
          <div className="form-section">
            <h3>وجهة الصرف · {actorLabels[item.actorType]} · {formatMoney(item.resolvedAmountMinor, item.currency)}</h3>
            <OfficialWalletDestinationManager key={item.id} actorType={item.actorType} actorId={item.actorId} initiallyExpanded />
          </div>
        </td>
      </tr> : null}</Fragment>)}
    </tbody>
    </table></div> : null}
  </section>;
}
