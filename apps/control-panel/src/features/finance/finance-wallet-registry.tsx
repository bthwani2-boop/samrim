"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ActorType = "customer" | "partner" | "captain" | "field";
type WalletRow = Readonly<{
  actorType: string; actorId: string; displayName?: string; beneficiaryName?: string;
  phoneMasked?: string; walletIdentifierMasked?: string; currency: "YER";
  openingBalanceMinor: number; creditsMinor: number; debitsMinor: number;
  closingBalanceMinor: number; currentBalanceMinor: number; heldMinor: number; availableMinor: number;
}>;
type WalletPage = Readonly<{ summaries: readonly WalletRow[]; nextCursor?: string }>;
type StatementEntry = Readonly<{
  transactionId: string; transactionType: string; sourceType: string; sourceId: string;
  direction: "CREDIT" | "DEBIT"; amountMinor: number; balanceAfterMinor: number; createdAt: string;
  order?: Readonly<{ orderId: string; storeName: string }>;
}>;
type Statement = Readonly<{
  openingBalanceMinor: number; closingBalanceMinor: number; currentBalanceMinor: number;
  creditsMinor: number; debitsMinor: number; entries: readonly StatementEntry[]; nextCursor?: string;
}>;
const actors: ReadonlyArray<Readonly<{ key: ActorType; label: string; icon: string }>> = [
  { key: "customer", label: "العملاء", icon: "◉" }, { key: "partner", label: "الشركاء", icon: "▣" },
  { key: "captain", label: "الكباتن", icon: "◈" }, { key: "field", label: "الميدانيون", icon: "✧" },
];

export function money(minor: number): string {
  return new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(minor / 100) + " ر.ي";
}
function periodDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Aden", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function period() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return { from: periodDate(start), to: periodDate(end) };
}
const periodRange = period();
async function getJSON<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("تعذرت قراءة سجل المالية (" + response.status + ")");
  return await response.json() as T;
}
function labelFor(row: WalletRow): string {
  return row.displayName?.trim() || row.beneficiaryName?.trim() || row.actorId;
}
export function FinanceWalletRegistry({ initialActorType = "customer", onClose }: Readonly<{ initialActorType?: ActorType; onClose?: () => void }>) {
  const [actorType, setActorType] = useState<ActorType>(initialActorType);
  const [items, setItems] = useState<readonly WalletRow[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WalletRow | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [statementError, setStatementError] = useState("");
  const [statementLoading, setStatementLoading] = useState(false);
  const [entries, setEntries] = useState<readonly StatementEntry[]>([]);
  const [statementCursor, setStatementCursor] = useState("");
  const requestID = useRef(0);
  const detailID = useRef(0);

  const load = useCallback(async (type: ActorType, after = "") => {
    const request = ++requestID.current;
    if (after) setLoadingMore(true); else { setLoading(true); setItems([]); setCursor(""); }
    setError("");
    try {
      const params = new URLSearchParams({ actorType: type, from: periodRange.from, to: periodRange.to });
      if (after) params.set("cursor", after);
      const result = await getJSON<WalletPage>("/api/finance/financial-statements?" + params);
      if (request !== requestID.current) return;
      setItems((old) => after ? [...old, ...result.summaries] : result.summaries);
      setCursor(result.nextCursor ?? "");
    } catch (cause) {
      if (request === requestID.current) setError(cause instanceof Error ? cause.message : "تعذرت قراءة المحافظ");
    } finally {
      if (request === requestID.current) { setLoading(false); setLoadingMore(false); }
    }
  }, []);
  useEffect(() => {
    void load(actorType);
    return () => { requestID.current++; };
  }, [actorType, load]);

  const loadStatement = useCallback(async (row: WalletRow, after = "") => {
    const request = ++detailID.current;
    setStatementLoading(true);
    setStatementError("");
    try {
      const params = new URLSearchParams({ from: periodRange.from, to: periodRange.to });
      if (after) params.set("cursor", after);
      const result = await getJSON<{ statement: Statement }>("/api/finance/beneficiaries/" + encodeURIComponent(row.actorType) + "/" + encodeURIComponent(row.actorId) + "/financial-statement?" + params);
      if (request !== detailID.current) return;
      setStatement(result.statement);
      setEntries((old) => after ? [...old, ...result.statement.entries] : result.statement.entries);
      setStatementCursor(result.statement.nextCursor ?? "");
    } catch (cause) {
      if (request === detailID.current) setStatementError(cause instanceof Error ? cause.message : "تعذر فتح الكشف");
    } finally {
      if (request === detailID.current) setStatementLoading(false);
    }
  }, []);
  useEffect(() => {
    setStatement(null);
    setEntries([]);
    setStatementCursor("");
    if (selected) void loadStatement(selected);
    return () => { detailID.current++; };
  }, [selected, loadStatement]);
  const filtered = useMemo(() => items.filter((row) => [labelFor(row), row.actorId, row.phoneMasked ?? "", row.walletIdentifierMasked ?? ""].some((value) => value.toLocaleLowerCase("ar").includes(search.trim().toLocaleLowerCase("ar")))), [items, search]);

  return <section className="fc-wallets" aria-label="محافظ أصحاب المصلحة">
    <div className="fc-section-heading">
      <div><h2>المحافظ وأصحابها</h2><p>أرصدة فعلية من دفتر WLT · آخر 30 يومًا للحركات · لا تشمل أرصدة مزودي الدفع الخارجيين</p></div>
      {onClose ? <button type="button" className="fc-btn" onClick={onClose}>العودة إلى القيادة</button> : null}
    </div>
    <div className="fc-actor-types" role="group" aria-label="صاحب المحفظة">
      {actors.map((actor) => <button type="button" key={actor.key} aria-pressed={actorType === actor.key} onClick={() => { setSelected(null); setSearch(""); setActorType(actor.key); }}>
        <span aria-hidden="true">{actor.icon}</span>{actor.label}
      </button>)}
    </div>
    <div className="fc-wallets-layout" data-detail={Boolean(selected)}>
      <div className="fc-register">
        <div className="fc-toolbar"><label className="fc-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في المحافظ المحمّلة بالاسم أو الرقم" aria-label="البحث في المحافظ المحمّلة" /></label><span className="fc-count">{items.length.toLocaleString("ar-YE")} سجل محمّل{cursor ? " · توجد صفحات أخرى" : ""}</span></div>
        {loading ? <p className="fc-placeholder" role="status">جارٍ قراءة المحافظ...</p> : null}
        {error ? <div className="fc-warning" role="alert">{error} <button type="button" onClick={() => void load(actorType)}>إعادة المحاولة</button></div> : null}
        {!loading && !error && filtered.length === 0 ? <p className="fc-placeholder">{search ? "لا توجد محافظ مطابقة ضمن السجلات المحمّلة." : "لا توجد محافظ مسجلة ضمن هذه الفئة في الفترة المحددة."}</p> : null}
        {filtered.length > 0 ? <div className="fc-table-scroll"><table className="fc-table"><thead><tr><th>صاحب المحفظة</th><th>الرصيد الدفتري</th><th>المحجوز</th><th>المتاح</th><th>التفاصيل</th></tr></thead><tbody>
          {filtered.map((row) => <tr key={row.actorId} aria-selected={selected?.actorId === row.actorId} ><td><button className="fc-person" type="button" onClick={() => setSelected(row)}><strong>{labelFor(row)}</strong><small dir="auto">{row.actorId}</small></button></td><td dir="ltr">{money(row.currentBalanceMinor)}</td><td dir="ltr">{money(row.heldMinor)}</td><td dir="ltr"><strong>{money(row.availableMinor)}</strong></td><td><button className="fc-inline-action" type="button" onClick={() => setSelected(row)}>فتح الكشف ←</button></td></tr>)}
        </tbody></table></div> : null}
        {cursor ? <div className="fc-register-footer"><span>استعرض الصفحات لاستكمال القائمة قبل استخلاص الإجماليات.</span><button type="button" className="fc-btn" disabled={loadingMore} onClick={() => void load(actorType, cursor)}>{loadingMore ? "جارٍ التحميل…" : "المزيد من المحافظ"}</button></div> : null}
      </div>
      {selected ? <aside className="fc-wallet-inspector" aria-label="كشف محفظة محددة">
        <div className="fc-inspector-header"><div><small>كشف محفظة معتمد</small><h3>{labelFor(selected)}</h3><span dir="auto">{selected.actorId}</span></div><button type="button" onClick={() => setSelected(null)} aria-label="إغلاق الكشف">×</button></div>
        <div className="fc-balance-hero"><small>الرصيد الدفتري الحالي</small><strong dir="ltr">{money(selected.currentBalanceMinor)}</strong></div>
        <div className="fc-mini-metrics"><div><small>محجوز</small><strong dir="ltr">{money(selected.heldMinor)}</strong></div><div><small>متاح</small><strong dir="ltr">{money(selected.availableMinor)}</strong></div></div>
        <div className="fc-mini-metrics"><div><small>إضافات الفترة</small><strong dir="ltr">{money(selected.creditsMinor)}</strong></div><div><small>خصومات الفترة</small><strong dir="ltr">{money(selected.debitsMinor)}</strong></div></div>
        <h4>الحركات المالية</h4>
        {statementLoading && !statement ? <p className="fc-placeholder">جارٍ قراءة الكشف...</p> : null}
        {statementError ? <div className="fc-warning" role="alert">{statementError}<button type="button" onClick={() => void loadStatement(selected)}>إعادة المحاولة</button></div> : null}
        {statement && entries.length === 0 ? <p className="fc-placeholder">لا توجد حركات ضمن الفترة.</p> : null}
        <div className="fc-statement-entries">{entries.map((entry) => <div key={entry.transactionId + ":" + entry.sourceId} className="fc-statement-entry">
          <div><strong>{entry.transactionType.replaceAll("_", " ")}</strong><small dir="auto">{entry.order?.storeName || entry.sourceId || entry.sourceType}</small><small>{new Date(entry.createdAt).toLocaleString("ar-YE")}</small></div>
          <span className={entry.direction === "CREDIT" ? "is-credit" : "is-debit"} dir="ltr">{entry.direction === "CREDIT" ? "+" : "−"} {money(entry.amountMinor)}</span>
        </div>)}</div>
        {statementCursor ? <button type="button" className="fc-btn" disabled={statementLoading} onClick={() => void loadStatement(selected, statementCursor)}>{statementLoading ? "جارٍ التحميل…" : "المزيد من الحركات"}</button> : null}
        <p className="fc-note">الرصيد الحالي قد يختلف عن الرصيد الختامي للفترة. لا تُنفذ أي تسوية من هذه المعاينة.</p>
      </aside> : null}
    </div>
  </section>;
}
