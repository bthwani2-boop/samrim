"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Flex, Grid, Input, Segmented, Table, Tag, Typography, type TableColumnsType } from "antd";
import { financeAmount } from "./finance-amount";

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
const actors: Array<{ value: ActorType; label: string }> = [
  { value: "customer", label: "العملاء" }, { value: "partner", label: "الشركاء" },
  { value: "captain", label: "الكباتن" }, { value: "field", label: "الميدانيون" },
];

export function money(minor: number): string {
  return financeAmount(minor);
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
  const selectionTrigger = useRef<HTMLElement | null>(null);

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
  const screens = Grid.useBreakpoint();
  const filtered = useMemo(() => items.filter((row) => [labelFor(row), row.actorId, row.phoneMasked ?? "", row.walletIdentifierMasked ?? ""].some((value) => value.toLocaleLowerCase("ar").includes(search.trim().toLocaleLowerCase("ar")))), [items, search]);
  const columns: TableColumnsType<WalletRow> = [
    {
      title: "صاحب المحفظة",
      key: "beneficiary",
      render: (_, row) => <Button type="link" className="fc-wallet-person-trigger" onClick={(event) => { selectionTrigger.current = event.currentTarget; setSelected(row); }}>
        <Flex vertical align="flex-start" gap={2}>
          <strong>{labelFor(row)}</strong>
          <Typography.Text type="secondary" dir="auto" className="fc-wallet-actor-id">{row.actorId}</Typography.Text>
        </Flex>
      </Button>,
    },
    { title: "الرصيد الدفتري", dataIndex: "currentBalanceMinor", align: "end", responsive: ["md"], render: (value: number) => <Typography.Text dir="ltr" style={{ fontVariantNumeric: "tabular-nums" }}>{money(value)}</Typography.Text> },
    { title: "المحجوز", dataIndex: "heldMinor", align: "end", responsive: ["md"], render: (value: number) => <Typography.Text dir="ltr" style={{ fontVariantNumeric: "tabular-nums" }}>{money(value)}</Typography.Text> },
    { title: "المتاح", dataIndex: "availableMinor", align: "end", responsive: ["md"], render: (value: number) => <Typography.Text strong dir="ltr" style={{ fontVariantNumeric: "tabular-nums" }}>{money(value)}</Typography.Text> },
    {
      title: "التفاصيل",
      key: "details",
      render: (_, row) => <Button type="link" onClick={(event) => { selectionTrigger.current = event.currentTarget; setSelected(row); }}>فتح الكشف</Button>,
    },
  ];

  const closeStatement = () => {
    setSelected(null);
    requestAnimationFrame(() => selectionTrigger.current?.focus());
  };

  return <section className="fc-wallets" aria-label="محافظ أصحاب المصلحة">
    <div className="fc-section-heading">
      <div><h2>المحافظ وأصحابها</h2><p>أرصدة فعلية من دفتر WLT · آخر 30 يومًا للحركات · لا تشمل أرصدة مزودي الدفع الخارجيين</p></div>
      {onClose ? <Button onClick={onClose}>العودة إلى القيادة</Button> : null}
    </div>
    <div className="fc-actor-types"><Segmented<ActorType> block options={actors} value={actorType} aria-label="صاحب المحفظة" onChange={(value) => { setSelected(null); setSearch(""); setActorType(value); }} /></div>
    <div className="fc-wallets-layout" data-detail={Boolean(selected)}>
      <div className="fc-register">
        <Flex align="center" gap={8} wrap>
          <Input.Search value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في المحافظ المحمّلة بالاسم أو الرقم" aria-label="البحث في المحافظ المحمّلة" allowClear style={{ flex: "1 1 220px", minWidth: 0 }} />
          <Tag className="fc-count">{items.length.toLocaleString("ar-YE")} سجل محمّل{cursor ? " · توجد صفحات أخرى" : ""}</Tag>
        </Flex>
        {loading ? <p className="fc-placeholder" role="status">جارٍ قراءة المحافظ...</p> : null}
        {error ? <Alert type="error" showIcon message={error} action={<Button type="link" onClick={() => void load(actorType)}>إعادة المحاولة</Button>} /> : null}
        {!loading && !error && filtered.length === 0 ? <p className="fc-placeholder">{search ? "لا توجد محافظ مطابقة ضمن السجلات المحمّلة." : "لا توجد محافظ مسجلة ضمن هذه الفئة في الفترة المحددة."}</p> : null}
        {filtered.length > 0 && !error ? <section aria-label="قائمة المحافظ"><Table<WalletRow>
          aria-label="قائمة المحافظ"
          rowKey="actorId"
          columns={columns}
          dataSource={filtered}
          pagination={false}
          size="small"
          loading={loading}
          scroll={screens.md ? { x: 980, y: "65dvh" } : { y: "65dvh" }}
          onRow={(row) => ({ "aria-selected": selected?.actorId === row.actorId })}
          locale={{ emptyText: "لا توجد محافظ مطابقة ضمن السجلات المحمّلة." }}
        /></section> : null}
        {cursor ? <Flex className="fc-register-footer" align="center" justify="space-between" gap={8} wrap><span>استعرض الصفحات لاستكمال القائمة قبل استخلاص الإجماليات.</span><Button disabled={loadingMore} loading={loadingMore} onClick={() => void load(actorType, cursor)}>المزيد من المحافظ</Button></Flex> : null}
      </div>
      {selected ? <aside className="fc-wallet-inspector" aria-label="كشف محفظة محددة">
        <div className="fc-inspector-header"><div><small>كشف محفظة معتمد</small><h3>{labelFor(selected)}</h3><span dir="auto">{selected.actorId}</span></div><Button type="text" size="small" onClick={closeStatement} aria-label="إغلاق الكشف">×</Button></div>
        <div className="fc-balance-hero"><small>الرصيد الدفتري الحالي</small><strong dir="ltr">{money(selected.currentBalanceMinor)}</strong></div>
        <div className="fc-mini-metrics"><div><small>محجوز</small><strong dir="ltr">{money(selected.heldMinor)}</strong></div><div><small>متاح</small><strong dir="ltr">{money(selected.availableMinor)}</strong></div></div>
        <div className="fc-mini-metrics"><div><small>إضافات الفترة</small><strong dir="ltr">{money(selected.creditsMinor)}</strong></div><div><small>خصومات الفترة</small><strong dir="ltr">{money(selected.debitsMinor)}</strong></div></div>
        <h4>الحركات المالية</h4>
        {statementLoading && !statement ? <p className="fc-placeholder">جارٍ قراءة الكشف...</p> : null}
        {statementError ? <Alert type="error" showIcon message={statementError} action={<Button type="link" onClick={() => void loadStatement(selected)}>إعادة المحاولة</Button>} /> : null}
        {statement && entries.length === 0 ? <p className="fc-placeholder">لا توجد حركات ضمن الفترة.</p> : null}
        <div className="fc-statement-entries">{entries.map((entry) => <div key={entry.transactionId + ":" + entry.sourceId} className="fc-statement-entry">
          <div><strong>{entry.transactionType.replaceAll("_", " ")}</strong><small dir="auto">{entry.order?.storeName || entry.sourceId || entry.sourceType}</small><small>{new Date(entry.createdAt).toLocaleString("ar-YE")}</small></div>
          <span className={entry.direction === "CREDIT" ? "is-credit" : "is-debit"} dir="ltr">{entry.direction === "CREDIT" ? "+" : "−"} {money(entry.amountMinor)}</span>
        </div>)}</div>
        {statementCursor ? <Button disabled={statementLoading} loading={statementLoading} onClick={() => void loadStatement(selected, statementCursor)}>المزيد من الحركات</Button> : null}
        <p className="fc-note">الرصيد الحالي قد يختلف عن الرصيد الختامي للفترة. لا تُنفذ أي تسوية من هذه المعاينة.</p>
      </aside> : null}
    </div>
  </section>;
}
