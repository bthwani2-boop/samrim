"use client";

import { useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";
import "./finance-command-center.css";
import { financeAmount } from "./finance-amount";

type ActorType = "customer" | "partner" | "captain" | "field";
type Statement = Readonly<{
  actorId: string; currentBalanceMinor: number; openingBalanceMinor: number; closingBalanceMinor: number;
  creditsMinor: number; debitsMinor: number; currency: "YER";
  entries: ReadonlyArray<Readonly<{ transactionId: string; transactionType: string; direction: "DEBIT" | "CREDIT"; amountMinor: number; createdAt: string; sourceId: string }>>;
  nextCursor?: string;
}>;
const format = (value: number) => financeAmount(value);
function currentRange() {
  const formatDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Aden", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 30);
  return { from: formatDay(from), to: formatDay(today) };
}
export function ActorWalletStatement({ actorType, actorId }: Readonly<{ actorType: ActorType; actorId: string }>) {
  const { state } = useSession();
  const allowed = state.kind === "authenticated" && state.identity.role === "operator" && Boolean(state.identity.permissions?.includes("finance"));
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!allowed || !actorId) return;
    let active = true;
    const controller = new AbortController();
    const range = currentRange();
    const params = new URLSearchParams(range);
    setLoading(true); setError(""); setStatement(null);
    void fetch("/api/finance/beneficiaries/" + encodeURIComponent(actorType) + "/" + encodeURIComponent(actorId) + "/financial-statement?" + params, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("تعذرت قراءة دفتر المحفظة (" + response.status + ")");
        return await response.json() as { statement: Statement };
      })
      .then((response) => { if (active) setStatement(response.statement); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "تعذرت قراءة المحفظة"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [allowed, actorType, actorId]);
  if (!allowed) return null;
  return <section className="fc-profile-wallet" aria-label="محفظة الطرف المالية">
    <div className="fc-profile-wallet-head"><div><small>محفظة بثواني</small><h3>الرصيد والكشف المالي</h3></div><span aria-hidden="true">▣</span></div>
    {loading ? <p className="fc-note" role="status">جارٍ قراءة الرصيد من WLT...</p> : null}
    {error ? <p className="fc-warning" role="alert">{error}</p> : null}
    {statement ? <>
      <div className="fc-balance-hero"><small>الرصيد الدفتري الحالي</small><strong dir="ltr">{format(statement.currentBalanceMinor)}</strong></div>
      <div className="fc-mini-metrics"><div><small>الإضافات خلال 30 يومًا</small><strong dir="ltr">{format(statement.creditsMinor)}</strong></div><div><small>الخصومات خلال 30 يومًا</small><strong dir="ltr">{format(statement.debitsMinor)}</strong></div></div>
      <div className="fc-profile-wallet-head"><h3>آخر الحركات</h3><button type="button" className="fc-inline-action" onClick={() => setShowAll((value) => !value)}>{showAll ? "عرض أقل" : "عرض المزيد"}</button></div>
      <div className="fc-statement-entries">{statement.entries.slice(0, showAll ? 20 : 4).map((entry) => <div className="fc-statement-entry" key={entry.transactionId}>
        <div><strong>{entry.transactionType.replaceAll("_", " ")}</strong><small dir="auto">{entry.sourceId}</small><small>{new Date(entry.createdAt).toLocaleString("ar-YE")}</small></div>
        <span className={entry.direction === "CREDIT" ? "is-credit" : "is-debit"} dir="ltr">{entry.direction === "CREDIT" ? "+" : "−"} {format(entry.amountMinor)}</span>
      </div>)}</div>
      {!statement.entries.length ? <p className="fc-note">لا توجد حركات ضمن الفترة المحددة.</p> : null}
      {statement.nextCursor ? <p className="fc-note">توجد حركات أقدم ضمن كشف الحساب الكامل في المركز المالي.</p> : null}
      <p className="fc-note">هذا رصيد دفتر WLT، ولا يعني وحده أن كامل المبلغ مؤهل للسحب.</p>
    </> : null}
  </section>;
}
