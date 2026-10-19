"use client";

import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@bthwani/dsh";

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
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل طلبات التسوية");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
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
      <div><h2>طلبات التسوية الواردة</h2><p className="muted">طلبات الشركاء والكباتن والميدانيين تصل هنا قبل التحقق من وجهة التحويل. لا تُخصم أموال أو تُنفذ تحويلات بمجرد تقديم الطلب.</p></div>
      <button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading || busyId !== null}>{loading ? "جارٍ التحميل" : "تحديث الطلبات"}</button>
    </div>
    {error ? <p role="alert" className="identity-error">{error}</p> : null}
    {notice ? <p role="status" className="managed-status managed-status-info">{notice}</p> : null}
    {!loading && items.length === 0 ? <p className="muted">لا توجد طلبات تسوية جديدة.</p> : null}
    {items.length > 0 ? <div className="finance-table-wrap"><table className="finance-table">
      <thead><tr><th>المستفيد</th><th>المبلغ</th><th>الحالة</th><th>الإجراء</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}>
        <td>{actorLabels[item.actorType]} <small dir="auto">{item.actorId}</small></td>
        <td>{formatMoney(item.resolvedAmountMinor, item.currency)}{item.actorType === "partner" ? <small> · {item.storeAllocations.length} متجر</small> : null}</td>
        <td>بانتظار مراجعة المالية ووجهة التحويل</td>
        <td><div className="finance-toolbar">
          <button className="button button-secondary" type="button" disabled={busyId !== null} onClick={() => void convert(item.id)}>{busyId === item.id ? "جارٍ التحقق" : "التحقق والإحالة للصرف"}</button>
          <button className="button button-quiet" type="button" disabled={busyId !== null} onClick={() => { setCancelId(cancelId === item.id ? null : item.id);setCancelReason(""); }}>إلغاء الطلب</button>
        </div>{cancelId === item.id ? <div className="finance-toolbar"><input className="field-control" aria-label="سبب إلغاء طلب التسوية" placeholder="سبب الإلغاء" maxLength={512} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /><button className="button button-secondary" type="button" disabled={busyId !== null || !cancelReason.trim()} onClick={() => void cancelIntake(item.id)}>تأكيد الإلغاء</button></div> : null}</td>
      </tr>)}</tbody>
    </table></div> : null}
  </section>;
}
