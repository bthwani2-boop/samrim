"use client";

import { formatMoney, payoutStatusLabel, type BeneficiaryPayoutState, type PayoutRequest } from "@bthwani/dsh";
import { useEffect, useRef, useState } from "react";

import { usePageSelection } from "./use-page-selection";
import { downloadRegistryCsv } from "../partner-onboarding/registry-csv";
import { PartnerEarningsWorkspace } from "./partner-earnings-workspace";
import styles from "./beneficiary-settlement-workspace.module.css";

type ActorType = "customer" | "partner" | "captain" | "field";
type RegistryActorType = "partner" | "captain" | "field";
type BeneficiarySort = "actor_asc" | "actor_desc" | "available_asc" | "available_desc" | "held_asc" | "held_desc" | "payout_amount_asc" | "payout_amount_desc";
type RegistryResponse = Readonly<{ beneficiaries: ReadonlyArray<BeneficiaryPayoutState>; nextCursor?: string; limit: number }>;
type RegistryItem = BeneficiaryPayoutState & Readonly<{ id: string }>;
type Transfer = Readonly<{ id: string; batchId: string; payoutId: string; externalTransferReference: string; amountMinor: number; currency: "YER"; receiptDocumentId: string; executionStatus: string; statementRowId?: string | null }>;
type SettlementBatchItem = Readonly<{ payoutId: string; actorType: ActorType; actorId: string; amountMinor: number; currency: "YER"; payoutStatus: string; transfer?: Transfer | null }>;
type SettlementBatch = Readonly<{ id: string; providerKey: string; currency: "YER"; status: string; rowCount: number; totalAmountMinor: number; batchHash?: string | null; items: ReadonlyArray<SettlementBatchItem> }>;
type Evidence = Readonly<{ document: Readonly<{ id: string; filename: string; contentType: string; sha256: string; sizeBytes: number }> }>;
type SettlementExport = Readonly<{ export: Readonly<{ id: string; batchId: string; evidenceDocumentId: string; filename: string; sha256: string; rowCount: number; totalAmountMinor: number; currency: "YER" }> }>;
type PartnerPeriodSummary = Readonly<{ actorType: string; actorId: string; beneficiaryName: string; walletIdentifierMasked: string; currency: "YER"; openingBalanceMinor: number; creditsMinor: number; debitsMinor: number; closingBalanceMinor: number; currentBalanceMinor: number; heldMinor: number; availableMinor: number }>;
type PartnerPeriodTotals = Readonly<{ openingBalanceMinor: number; creditsMinor: number; debitsMinor: number; closingBalanceMinor: number; currentBalanceMinor: number; heldMinor: number; availableMinor: number }>;
type FinancialStatement = Readonly<{ actorType: string; actorId: string; currency: "YER"; periodStart: string; periodEnd: string; openingBalanceMinor: number; creditsMinor: number; debitsMinor: number; closingBalanceMinor: number; currentBalanceMinor: number; nextCursor?: string; entries: ReadonlyArray<Readonly<{ transactionId: string; transactionType: string; sourceType: string; sourceId: string; direction: "CREDIT" | "DEBIT"; amountMinor: number; currency: "YER"; createdAt: string; balanceAfterMinor: number; store?: Readonly<{ storeId: string; name: string; publicationState: string }>; order?: Readonly<{ orderId: string; storeName: string; state: string; fulfillmentMode: string; subtotalAmountMinor: number; discountMinor: number; totalAmountMinor: number; currency: "YER"; createdAt: string; lines: ReadonlyArray<Readonly<{ productName: string; variantTitle: string; quantityBaseUnits: number; unitPriceMinor: number; lineAmountMinor: number; currency: "YER" }>> }> }>> }>;

const actorLabels: Record<ActorType, string> = { customer: "سحوبات العملاء الاستثنائية", partner: "الشركاء", captain: "كباتن بثواني", field: "الميدان" };
const actorLabel: Record<ActorType, string> = { customer: "العميل", partner: "الشريك", captain: "الكابتن", field: "الميداني" };
const statusFilters = ["", "NO_REQUEST", "HELD", "PREPARED", "APPROVED", "FROZEN", "EXECUTED", "COMPLETED", "EXCEPTION", "CANCELLED"] as const;

function errorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const nested = (body as { error?: { message?: unknown } }).error;
  return typeof nested?.message === "string" ? nested.message : fallback;
}

async function responseBody<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body, fallback));
  return body as T;
}

type BeneficiarySettlementWorkspaceProps = Readonly<{ requestedBatchId?: string }>;

export function BeneficiarySettlementWorkspace({ requestedBatchId = "" }: BeneficiarySettlementWorkspaceProps) {
  const idempotencyKeys = useRef(new Map<string, string>());
  const mutationHeaders = (scope: string) => {
    let key = idempotencyKeys.current.get(scope);
    if (!key) { key = crypto.randomUUID(); idempotencyKeys.current.set(scope, key); }
    return { "Content-Type": "application/json", "Idempotency-Key": key, "X-Correlation-ID": crypto.randomUUID() };
  };
  const completeMutation = (scope: string) => idempotencyKeys.current.delete(scope);
  const [actorType, setActorType] = useState<RegistryActorType>("partner");
  const [status, setStatus] = useState<(typeof statusFilters)[number]>("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<BeneficiarySort>("actor_asc");
  const [beneficiaries, setBeneficiaries] = useState<ReadonlyArray<RegistryItem>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [batch, setBatch] = useState<SettlementBatch | null>(null);
  const [batchItems, setBatchItems] = useState<ReadonlyArray<SettlementBatchItem>>([]);
  const [batchLookup, setBatchLookup] = useState("");
  const [batches, setBatches] = useState<ReadonlyArray<SettlementBatch>>([]);
  const [batchCursor, setBatchCursor] = useState("");
  const [batchStatus, setBatchStatus] = useState("");
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [reason, setReason] = useState("");
  const [payoutEvidenceReference, setPayoutEvidenceReference] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [statementFile, setStatementFile] = useState<File | null>(null);
  const [statementProvider, setStatementProvider] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [statementId, setStatementId] = useState("");
  const [statementRowId, setStatementRowId] = useState("");
  const [rowSequence, setRowSequence] = useState("");
  const [statementReference, setStatementReference] = useState("");
  const [walletIdentifier, setWalletIdentifier] = useState("");
  const [statementAmount, setStatementAmount] = useState("");
  const [transactionAt, setTransactionAt] = useState("");
  const [ledgerFrom, setLedgerFrom] = useState("2000-01-01");
  const [ledgerTo, setLedgerTo] = useState("");
  const [statementBeneficiary, setStatementBeneficiary] = useState<RegistryItem | null>(null);
  const [financialStatement, setFinancialStatement] = useState<FinancialStatement | null>(null);
  const [statementBusy, setStatementBusy] = useState(false);
  const [printFinancialStatementWhenLoaded, setPrintFinancialStatementWhenLoaded] = useState(false);
  const [partnerPeriodRows, setPartnerPeriodRows] = useState<ReadonlyArray<PartnerPeriodSummary>>([]);
  const [partnerPeriodRange, setPartnerPeriodRange] = useState<Readonly<{ from: string; to: string }> | null>(null);
  const [partnerPeriodTotals, setPartnerPeriodTotals] = useState<PartnerPeriodTotals | null>(null);
  const filtered = beneficiaries;
  const selection = usePageSelection(beneficiaries.filter((item) => item.latestPayout?.status === "APPROVED"));
  const clearRegistryPage = () => { setBeneficiaries([]); setNextCursor(""); selection.clear(); };

  const read = async (searchOverride = search) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const query = new URLSearchParams({ actorType, limit: "50" });
      if (searchOverride.trim()) query.set("search", searchOverride.trim());
      if (status) query.set("status", status);
      query.set("sort", sort);
      const result = await responseBody<RegistryResponse>(await fetch(`/api/finance/beneficiaries?${query.toString()}`, { cache: "no-store" }), "تعذر قراءة سجل المستفيدين");
      setBeneficiaries(result.beneficiaries.map((item) => ({ ...item, id: `${item.actorType}:${item.actorId}` })));
      setNextCursor(result.nextCursor ?? "");
      selection.clear();
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة سجل المستفيدين"); }
    finally { setBusy(false); }
  };

  const readNext = async () => {
    if (!nextCursor) return;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ actorType, limit: "50", cursor: nextCursor });
      if (search.trim()) query.set("search", search.trim());
      if (status) query.set("status", status);
      query.set("sort", sort);
      const result = await responseBody<RegistryResponse>(await fetch(`/api/finance/beneficiaries?${query.toString()}`, { cache: "no-store" }), "تعذر تحميل بقية المستفيدين");
      setBeneficiaries((current) => [...current, ...result.beneficiaries.map((item) => ({ ...item, id: `${item.actorType}:${item.actorId}` }))]);
      setNextCursor(result.nextCursor ?? "");
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تحميل بقية المستفيدين"); }
    finally { setBusy(false); }
  };

  const readFinancialStatement = async (item: RegistryItem, cursor = "", append = false) => {
    const to = ledgerTo || new Date().toISOString().slice(0, 10);
    if (!ledgerTo) setLedgerTo(to);
    if (!append) setFinancialStatement(null);
    setStatementBusy(true); setError(""); setStatementBeneficiary(item);
    try {
      const query = new URLSearchParams({ from: ledgerFrom, to });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/finance/beneficiaries/${encodeURIComponent(item.actorType)}/${encodeURIComponent(item.actorId)}/financial-statement?${query.toString()}`, { cache: "no-store" });
      const result = await responseBody<{ statement: FinancialStatement }>(response, "تعذر قراءة كشف المستفيد المالي");
      setFinancialStatement((current) => append && current ? { ...result.statement, entries: [...current.entries, ...result.statement.entries] } : result.statement);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة كشف المستفيد المالي"); }
    finally { setStatementBusy(false); }
  };

  useEffect(() => {
    if (!printFinancialStatementWhenLoaded || !financialStatement || financialStatement.nextCursor) return;
    setPrintFinancialStatementWhenLoaded(false);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
  }, [financialStatement, printFinancialStatementWhenLoaded]);

  const printFinancialStatement = async () => {
    if (!statementBeneficiary || !financialStatement) return;
    if (!financialStatement.nextCursor) { window.print(); return; }
    setStatementBusy(true); setError("");
    try {
      const entries = [...financialStatement.entries];
      let cursor = financialStatement.nextCursor;
      while (cursor) {
        const query = new URLSearchParams({ from: ledgerFrom, to: ledgerTo || financialStatement.periodEnd, cursor });
        const response = await fetch(`/api/finance/beneficiaries/${encodeURIComponent(statementBeneficiary.actorType)}/${encodeURIComponent(statementBeneficiary.actorId)}/financial-statement?${query.toString()}`, { cache: "no-store" });
        const result = await responseBody<{ statement: FinancialStatement }>(response, "تعذر استكمال صفحات كشف المستفيد قبل الطباعة");
        entries.push(...result.statement.entries);
        cursor = result.statement.nextCursor ?? "";
      }
      setFinancialStatement({ ...financialStatement, entries, nextCursor: "" });
      setPrintFinancialStatementWhenLoaded(true);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تحميل الكشف كاملاً للطباعة"); }
    finally { setStatementBusy(false); }
  };

  const downloadFinancialStatement = async () => {
    if (!statementBeneficiary || !financialStatement) return;
    setStatementBusy(true); setError("");
    try {
      const entries = [...financialStatement.entries];
      let cursor = financialStatement.nextCursor ?? "";
      while (cursor) {
        const query = new URLSearchParams({ from: ledgerFrom, to: ledgerTo || financialStatement.periodEnd, cursor });
        const response = await fetch(`/api/finance/beneficiaries/${encodeURIComponent(statementBeneficiary.actorType)}/${encodeURIComponent(statementBeneficiary.actorId)}/financial-statement?${query.toString()}`, { cache: "no-store" });
        const result = await responseBody<{ statement: FinancialStatement }>(response, "تعذر استكمال صفحات كشف المستفيد");
        entries.push(...result.statement.entries); cursor = result.statement.nextCursor ?? "";
      }
      const rows = entries.flatMap((entry) => {
        const base = [entry.createdAt, entry.transactionId, entry.transactionType, entry.direction, String(entry.amountMinor), entry.currency, String(entry.balanceAfterMinor), entry.order?.orderId ?? entry.sourceId];
        if (!entry.order?.lines.length) return [[...base, entry.store?.name ?? "", "", "", "", "", ""]];
        return entry.order.lines.map((line, index) => [
          entry.createdAt, entry.transactionId, entry.transactionType,
          index === 0 ? entry.direction : "",
          index === 0 ? String(entry.amountMinor) : "",
          entry.currency,
          index === 0 ? String(entry.balanceAfterMinor) : "",
          entry.order?.orderId ?? entry.sourceId, entry.order?.storeName ?? "",
          line.productName, line.variantTitle, String(line.quantityBaseUnits), String(line.unitPriceMinor), String(line.lineAmountMinor),
        ]);
      });
      const safeActorId = statementBeneficiary.actorId.replace(/[^a-zA-Z0-9_-]/g, "_");
      downloadRegistryCsv(`financial-statement-${statementBeneficiary.actorType}-${safeActorId}.csv`, ["وقت الحركة", "معرّف القيد", "نوع الحركة", "الاتجاه", "المبلغ بالريال", "العملة", "الرصيد بعدها بالريال", "معرّف الطلب أو المصدر", "المتجر", "المنتج", "الصنف", "الكمية بوحدة الأساس", "سعر الوحدة بالريال", "إجمالي السطر بالريال"], rows);
      setNotice(`نُزّل كشف ${actorLabel[statementBeneficiary.actorType as ActorType] ?? statementBeneficiary.actorType} من قيود WLT للفترة ${financialStatement.periodStart} إلى ${financialStatement.periodEnd} مع لقطات الطلبات والمنتجات المرتبطة.`);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تنزيل كشف المستفيد"); }
    finally { setStatementBusy(false); }
  };

  const downloadPartnerPeriodRegister = async () => {
    const to = ledgerTo || new Date().toISOString().slice(0, 10);
    if (!ledgerTo) setLedgerTo(to);
    setBusy(true); setError(""); setNotice("");
    try {
      const summaries: PartnerPeriodSummary[] = [];
      let cursor = "";
      let reportTotals: PartnerPeriodTotals | null = null;
      do {
        const query = new URLSearchParams({ actorType: "partner", from: ledgerFrom, to, ...(cursor ? { cursor } : {}) });
        const response = await fetch(`/api/finance/financial-statements?${query.toString()}`, { cache: "no-store" });
        const page = await responseBody<{ summaries: typeof summaries; totals: PartnerPeriodTotals; nextCursor?: string }>(response, "تعذر تحميل سجل الشركاء للفترة");
        summaries.push(...page.summaries);
        reportTotals ??= page.totals;
        cursor = page.nextCursor ?? "";
      } while (cursor);
      setPartnerPeriodRows(summaries);
      setPartnerPeriodRange({ from: ledgerFrom, to });
      setPartnerPeriodTotals(reportTotals);
      if (!reportTotals) throw new Error("WLT لم يُرجع إجماليات التقرير الدورية");
      const rows = summaries.map((item) => [item.actorType, item.actorId, item.beneficiaryName, item.walletIdentifierMasked, item.currency, item.openingBalanceMinor, item.creditsMinor, item.debitsMinor, item.closingBalanceMinor, item.currentBalanceMinor, item.heldMinor, item.availableMinor]);
      rows.push(["إجمالي WLT المحسوب", "", "", "", "YER", reportTotals.openingBalanceMinor, reportTotals.creditsMinor, reportTotals.debitsMinor, reportTotals.closingBalanceMinor, reportTotals.currentBalanceMinor, reportTotals.heldMinor, reportTotals.availableMinor]);
      downloadRegistryCsv(`partner-financial-register-${ledgerFrom}-${to}.csv`, ["نوع المستفيد", "معرّف الشريك", "الاسم الرباعي المسجل بوجهة WLT", "رقم المحفظة المقنع", "العملة", "الرصيد الافتتاحي بالريال", "إضافات الفترة بالريال", "خصومات الفترة بالريال", "رصيد نهاية الفترة بالريال", "الرصيد الحالي بالريال", "المحجوز حالياً بالريال", "المتاح حالياً بالريال"], rows);
      setNotice(`نُزّل سجل ${summaries.length.toLocaleString("ar-YE")} ملفاً مالياً نشطاً للشركاء من مجاميع WLT للفترة ${ledgerFrom} إلى ${to}.`);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تنزيل سجل الشركاء"); }
    finally { setBusy(false); }
  };

  const createBatch = async () => {
    const chosen = selection.selected.map((item) => item.latestPayout).filter((item): item is PayoutRequest => item?.status === "APPROVED");
    if (!chosen.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const scope = `batch-create:${chosen.map((item) => item.id).sort().join(",")}`;
      const result = await responseBody<{ batch: SettlementBatch }>(await fetch("/api/finance/settlement-batches", { method: "POST", headers: mutationHeaders(scope), body: JSON.stringify({ payoutIds: chosen.map((item) => item.id) }) }), "تعذر إنشاء الدفعة");
      completeMutation(scope);
      setBatch(result.batch); setBatchItems(result.batch.items); setBatchLookup(result.batch.id); setTransfer(null); selection.clear();
      setNotice(`أنشأ WLT الدفعة ${result.batch.id} بعدد ${result.batch.rowCount} وبإجمالي محسوب ${formatMoney(result.batch.totalAmountMinor, result.batch.currency)}.`);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر إنشاء الدفعة"); }
    finally { setBusy(false); }
  };

  const batchAction = async (action: "approve" | "freeze") => {
    if (!batch || !reason.trim()) return;
    setBusy(true); setError("");
    try {
      const scope = `batch:${batch.id}:${action}`;
      const result = await responseBody<{ batch: SettlementBatch }>(await fetch(`/api/finance/settlement-batches/${encodeURIComponent(batch.id)}/${action}`, { method: "POST", headers: mutationHeaders(scope), body: JSON.stringify({ reason }) }), "تعذر تغيير حالة الدفعة");
      completeMutation(scope);
       setBatch(result.batch); setBatchItems(result.batch.items); setReason(""); setNotice(action === "freeze" ? "جُمّدت الدفعة؛ أصبحت صفوفها ومجموعها غير قابلة للتغيير." : "اعتمدت الدفعة. يلزم موظف مستقل لتجميدها.");
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تغيير حالة الدفعة"); }
    finally { setBusy(false); }
  };

  const exportBatch = async () => {
    if (!batch || !["FROZEN", "EXECUTION_IN_PROGRESS", "AWAITING_VERIFICATION", "AWAITING_RECONCILIATION", "COMPLETED"].includes(batch.status)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const scope = `batch-export:${batch.id}`;
      const result = await responseBody<SettlementExport>(await fetch(`/api/finance/settlement-batches/${encodeURIComponent(batch.id)}/export`, { method: "POST", headers: mutationHeaders(scope), body: "{}" }), "تعذر إنشاء ملف تنفيذ الدفعة");
      completeMutation(scope);
      const response = await fetch(`/api/finance/evidence/${encodeURIComponent(result.export.evidenceDocumentId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("أُنشئ سجل التصدير لكن تعذر تنزيل الملف؛ أعد فتح سجل المستند لتنزيله.");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href; anchor.download = result.export.filename; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      setNotice(`أنشأ WLT ملف تنفيذ XLSX موثقاً ببصمة ${result.export.sha256} لعدد ${result.export.rowCount} تحويلات. الملف مرتبط بالدفعة المجمدة.`);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تصدير ملف الدفعة"); }
    finally { setBusy(false); }
  };

  const payoutAction = async (payoutId: string, action: "prepare" | "approve" | "cancel") => {
    if (!reason.trim() || (action === "prepare" && !payoutEvidenceReference.trim())) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const scope = `payout:${payoutId}:${action}`;
      const response = await fetch(`/api/finance/payout-requests/${encodeURIComponent(payoutId)}/${action}`, { method: "POST", headers: mutationHeaders(scope), body: JSON.stringify({ reason: reason.trim(), ...(action === "prepare" ? { evidenceReference: payoutEvidenceReference.trim() } : {}) }) });
      const result = await responseBody<{ payout: PayoutRequest }>(response, "تعذر تنفيذ إجراء طلب التسوية");
      completeMutation(scope);
      setBeneficiaries((current) => current.map((item) => item.latestPayout?.id === result.payout.id ? { ...item, latestPayout: result.payout } : item));
      setReason(""); setPayoutEvidenceReference(""); setNotice(`حدّث WLT طلب التسوية إلى الحالة ${payoutStatusLabel(result.payout.status)}.`);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تنفيذ إجراء طلب التسوية"); }
    finally { setBusy(false); }
  };

  const upload = async (purpose: "TRANSFER_RECEIPT" | "SETTLEMENT_STATEMENT", file: File): Promise<Evidence["document"]> => {
    if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("يجب أن يكون الملف بين 1 بايت و10 ميغابايت.");
    const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
    const allowed = purpose === "TRANSFER_RECEIPT" ? ["pdf", "jpg", "jpeg", "png"] : ["pdf", "csv", "xlsx", "jpg", "jpeg", "png"];
    if (!allowed.includes(extension)) throw new Error(`نوع الملف غير مدعوم. الأنواع المقبولة: ${allowed.map((item) => `.${item}`).join("، ")}`);
    const form = new FormData(); form.set("purpose", purpose); form.set("file", file);
    const scope = `evidence:${purpose}:${file.name}:${file.size}:${file.lastModified}`;
    const response = await fetch("/api/finance/evidence", { method: "POST", headers: { "Idempotency-Key": idempotencyKeys.current.get(scope) ?? (() => { const key = crypto.randomUUID(); idempotencyKeys.current.set(scope, key); return key; })(), "X-Correlation-ID": crypto.randomUUID() }, body: form });
    return (await responseBody<Evidence>(response, "تعذر رفع مستند المالية")).document;
  };

  const recordTransfer = async (payoutId: string) => {
    if (!batch || !externalReference.trim() || !receiptFile) return;
    setBusy(true); setError("");
    try {
      const document = await upload("TRANSFER_RECEIPT", receiptFile);
       const scope = `transfer:${batch.id}:${payoutId}`;
       const result = await responseBody<{ transfer: Transfer }>(await fetch(`/api/finance/settlement-batches/${encodeURIComponent(batch.id)}/transfers`, { method: "POST", headers: mutationHeaders(scope), body: JSON.stringify({ payoutId, externalTransferReference: externalReference.trim(), receiptDocumentId: document.id }) }), "تعذر تسجيل التحويل؛ احتفظ بالإيصال وأعد المحاولة دون تكرار التحويل الخارجي.");
      completeMutation(scope); completeMutation(`evidence:TRANSFER_RECEIPT:${receiptFile.name}:${receiptFile.size}:${receiptFile.lastModified}`);
      setTransfer(result.transfer); setBatchItems((current) => current.map((item) => item.payoutId === payoutId ? { ...item, payoutStatus: "EXECUTED", transfer: result.transfer } : item)); setReceiptFile(null); setExternalReference(""); setNotice("سُجّل التحويل مع إيصال خاص مشفر. لا يعتبر التسديد مكتملاً حتى التحقق والمطابقة.");
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تسجيل التحويل"); }
    finally { setBusy(false); }
  };

  const registerStatement = async () => {
    if (!statementFile || !statementProvider.trim() || !periodStart || !periodEnd) return;
    setBusy(true); setError("");
    try {
      const document = await upload("SETTLEMENT_STATEMENT", statementFile);
      const scope = `statement:${document.id}`;
      const response = await responseBody<{ statement: { id: string; evidenceDocumentId: string } }>(await fetch("/api/finance/settlement-statements", { method: "POST", headers: mutationHeaders(scope), body: JSON.stringify({ batchId: batch?.id, providerKey: statementProvider.trim(), currency: "YER", periodStart, periodEnd, evidenceDocumentId: document.id }) }), "تعذر تسجيل كشف المحفظة");
      completeMutation(scope); completeMutation(`evidence:SETTLEMENT_STATEMENT:${statementFile.name}:${statementFile.size}:${statementFile.lastModified}`);
      setStatementId(response.statement.id); setStatementFile(null); setNotice(`رُفع الكشف مرة واحدة وسُجل للربط. رقم سجل الكشف: ${response.statement.id}.`);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تسجيل كشف المحفظة"); }
    finally { setBusy(false); }
  };

  const addStatementRow = async () => {
    if (!statementId || !rowSequence || !statementReference.trim() || !walletIdentifier.trim() || !statementAmount || !transactionAt) return;
    setBusy(true); setError("");
    try {
      const scope = `statement-row:${statementId}:${rowSequence}`;
      const response = await responseBody<{ row: { id: string } }>(await fetch(`/api/finance/settlement-statements/${encodeURIComponent(statementId)}/rows`, { method: "POST", headers: mutationHeaders(scope), body: JSON.stringify({ rowSequence: Number(rowSequence), externalTransferReference: statementReference.trim(), walletIdentifier: walletIdentifier.trim(), amountMinor: Number(statementAmount), currency: "YER", transactionAt: new Date(transactionAt).toISOString() }) }), "تعذر تسجيل صف كشف المحفظة");
      completeMutation(scope);
      setStatementRowId(response.row.id); setStatementReference(""); setWalletIdentifier(""); setStatementAmount(""); setTransactionAt(""); setNotice(`سُجل صف الكشف ${response.row.id}. راجع تطابق المرجع والمبلغ والوجهة قبل المطابقة.`);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تسجيل صف كشف المحفظة"); }
    finally { setBusy(false); }
  };

  const transferAction = async (action: "verify" | "reconcile", statementRowId = "") => {
    if (!transfer) return;
    setBusy(true); setError("");
    try {
      const scope = `transfer:${transfer.id}:${action}`;
      const result = await responseBody<{ transfer: Transfer }>(await fetch(`/api/finance/transfers/${encodeURIComponent(transfer.id)}/${action}`, { method: "POST", headers: mutationHeaders(scope), body: JSON.stringify(action === "reconcile" ? { statementRowId } : {}) }), "تعذر إتمام خطوة التحويل");
      completeMutation(scope);
      setTransfer(result.transfer); setBatchItems((current) => current.map((item) => item.payoutId === transfer.payoutId ? { ...item, payoutStatus: action === "verify" ? "EXECUTED" : "COMPLETED", transfer: result.transfer } : item)); setNotice(action === "verify" ? "تم التحقق المستقل من التحويل؛ بقيت مطابقته مع صف الكشف." : "طابق WLT صف الكشف وأكمل القيد المحاسبي وفق الحقيقة الكانونية.");
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر إتمام خطوة التحويل"); }
    finally { setBusy(false); }
  };

  const loadBatch = async (requestedId = batchLookup) => {
    if (!requestedId.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await responseBody<{ batch: SettlementBatch }>(await fetch(`/api/finance/settlement-batches/${encodeURIComponent(requestedId.trim())}`, { cache: "no-store" }), "تعذر قراءة الدفعة");
      setBatch(result.batch); setBatchItems(result.batch.items); setBatchLookup(result.batch.id); setTransfer(null);
      setNotice(`استعيدت الدفعة ${result.batch.id} من WLT، مع ${result.batch.items.length} صفوف وحالات التنفيذ الحالية.`);
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة الدفعة"); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const batchId = requestedBatchId.trim();
    if (!batchId) return;
    setBatchLookup(batchId); setBusy(true); setError(""); setNotice("");
    void (async () => {
      try {
        const result = await responseBody<{ batch: SettlementBatch }>(await fetch(`/api/finance/settlement-batches/${encodeURIComponent(batchId)}`, { cache: "no-store" }), "تعذر قراءة الدفعة");
        setBatch(result.batch); setBatchItems(result.batch.items); setTransfer(null);
        setNotice(`استعيدت الدفعة ${result.batch.id} من WLT، مع ${result.batch.items.length} صفوف وحالات التنفيذ الحالية.`);
      } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة الدفعة"); }
      finally { setBusy(false); }
    })();
  }, [requestedBatchId]);

  const readBatches = async (append = false) => {
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ limit: "25" });
      if (batchStatus) query.set("status", batchStatus);
      if (append && batchCursor) query.set("cursor", batchCursor);
      const result = await responseBody<{ batches: ReadonlyArray<SettlementBatch>; nextCursor?: string }>(await fetch(`/api/finance/settlement-batches?${query.toString()}`, { cache: "no-store" }), "تعذر قراءة دفعات التسوية");
      setBatches((current) => append ? [...current, ...result.batches] : result.batches);
      setBatchCursor(result.nextCursor ?? "");
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر قراءة دفعات التسوية"); }
    finally { setBusy(false); }
  };

  const selectBatch = (value: SettlementBatch) => {
    setBatch(value); setBatchItems(value.items); setBatchLookup(value.id); setTransfer(null);
    setStatementRowId(""); setNotice(`تم فتح دفعة ${value.id} ببياناتها المستعادة من WLT.`);
  };

  const downloadReceipts = () => {
    const headers = ["معرّف الطلب", "نوع المستفيد", "معرّف المستفيد", "المبلغ المعتمد", "العملة", "الحالة"];
    const rows = selection.selected.flatMap((item) => item.latestPayout ? [[item.latestPayout.id, actorLabel[item.actorType], item.actorId, String(item.latestPayout.resolvedAmountMinor), item.latestPayout.currency, item.latestPayout.status]] : []);
    downloadRegistryCsv("beneficiary-payout-selection.csv", headers, rows);
  };

  const requestCount = filtered.filter((item) => item.latestPayout).length;
  return <section className="access-card" aria-labelledby="beneficiary-settlement-title">
    <div className="finance-toolbar"><div><p className="eyebrow">المالية · سجل التسويات</p><h2 id="beneficiary-settlement-title">مستحقات وتسويات الشركاء والكباتن والميدان</h2></div><button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy}>{busy ? "جارٍ التحديث…" : "تحديث السجل"}</button></div>
    <p className="muted">المبالغ والوجهات تأتي من WLT. التحويل الخارجي يدوي، وكل تحويل يحتاج إيصالاً مستقلاً. يُرفع كشف المحفظة مرة للدفعة أو الفترة وتُربط به صفوف المطابقة.</p>
    <p className="muted" aria-live="polite">النتائج الحالية: {filtered.length.toLocaleString("ar-YE")} مستفيد؛ {requestCount.toLocaleString("ar-YE")} لديهم طلب تسوية؛ {selection.selected.length.toLocaleString("ar-YE")} طلبات معتمدة محددة.</p>
    <div className="finance-toolbar"><label className="field-label" htmlFor="settlement-beneficiary-type">قسم المستحقات والتسويات<select id="settlement-beneficiary-type" value={actorType} onChange={(event) => { setActorType(event.target.value as RegistryActorType); clearRegistryPage(); setFinancialStatement(null); setStatementBeneficiary(null); }}><option value="partner">الشركاء</option><option value="captain">كباتن بثواني</option><option value="field">الميدان</option></select></label><label className="field-label" htmlFor="settlement-status">حالة الطلب<select id="settlement-status" value={status} onChange={(event) => { setStatus(event.target.value as (typeof statusFilters)[number]); clearRegistryPage(); }}>{statusFilters.map((item) => <option key={item} value={item}>{item === "" ? "كل الحالات" : item === "NO_REQUEST" ? "لا يوجد طلب" : payoutStatusLabel(item as PayoutRequest["status"])}</option>)}</select></label><label className="field-label" htmlFor="settlement-sort">ترتيب السجل<select id="settlement-sort" value={sort} onChange={(event) => { setSort(event.target.value as BeneficiarySort); clearRegistryPage(); }}><option value="actor_asc">معرّف المستفيد تصاعدياً</option><option value="actor_desc">معرّف المستفيد تنازلياً</option><option value="available_desc">المتاح: الأعلى أولاً</option><option value="available_asc">المتاح: الأقل أولاً</option><option value="held_desc">المحجوز: الأعلى أولاً</option><option value="held_asc">المحجوز: الأقل أولاً</option><option value="payout_amount_desc">مبلغ آخر طلب: الأعلى أولاً</option><option value="payout_amount_asc">مبلغ آخر طلب: الأقل أولاً</option></select></label><label className="field-label" htmlFor="settlement-search">بحث بالاسم أو معرّف المستفيد أو آخر أرقام المحفظة<input id="settlement-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); clearRegistryPage(); }} placeholder="اسم المستفيد أو المعرّف أو الأرقام الظاهرة" /></label><button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy}>تطبيق الفلاتر</button>{search ? <button className="button button-quiet" type="button" onClick={() => { setSearch(""); void read(""); }} disabled={busy}>مسح البحث</button> : null}</div>
    <div className="finance-toolbar"><label className="field-label" htmlFor="beneficiary-statement-from">كشف الحساب من<input id="beneficiary-statement-from" type="date" value={ledgerFrom} onChange={(event) => { setLedgerFrom(event.target.value); setFinancialStatement(null); setPartnerPeriodRows([]); setPartnerPeriodRange(null); setPartnerPeriodTotals(null); }} /></label><label className="field-label" htmlFor="beneficiary-statement-to">إلى<input id="beneficiary-statement-to" type="date" value={ledgerTo} onChange={(event) => { setLedgerTo(event.target.value); setFinancialStatement(null); setPartnerPeriodRows([]); setPartnerPeriodRange(null); setPartnerPeriodTotals(null); }} /></label>{statementBeneficiary ? <button className="button button-quiet" type="button" onClick={() => void readFinancialStatement(statementBeneficiary)} disabled={statementBusy}>تحديث كشف المستفيد للفترة</button> : null}<span className="muted">يظهر الرصيد الافتتاحي وحركات WLT، وتفاصيل أسعار الطلب والمنتجات حين يكون مصدر القيد طلباً موثقاً في DSH.</span>{actorType === "partner" ? <button className="button button-secondary" type="button" onClick={() => void downloadPartnerPeriodRegister()} disabled={busy || statementBusy || !ledgerFrom}>تنزيل تقرير الشركاء بصيغة CSV (يفتح في Excel)</button> : null}{actorType === "partner" && partnerPeriodRows.length ? <button className="button button-quiet" type="button" onClick={() => window.print()}>طباعة التقرير الدوري</button> : null}</div>
    {actorType === "partner" && partnerPeriodRange ? <section id="partner-period-register-print" className={`access-card ${styles.periodRegister}`} aria-labelledby="partner-period-register-title"><h3 id="partner-period-register-title">سجل مستحقات الشركاء للفترة {partnerPeriodRange.from} — {partnerPeriodRange.to}</h3><p>المصدر: مجاميع WLT للشركاء ذوي الملف المالي النشط؛ المبالغ بالريال اليمني. تاريخ الفترة مبني على وقت القيد المحاسبي. الأسماء وأرقام المحافظ من أحدث وجهة مسجلة في WLT، والرقم معروض بصيغة مقنعة.</p><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th scope="col">الاسم المسجل</th><th scope="col">معرّف الشريك</th><th scope="col">المحفظة (مقنعة)</th><th scope="col">افتتاحي</th><th scope="col">إضافات</th><th scope="col">خصومات</th><th scope="col">إقفال الفترة</th><th scope="col">الرصيد الحالي</th><th scope="col">محجوز</th><th scope="col">متاح</th></tr></thead><tbody>{partnerPeriodRows.map((item) => <tr key={item.actorId}><td>{item.beneficiaryName || "غير مسجل بوجهة مالية"}</td><td><bdi>{item.actorId}</bdi></td><td><bdi>{item.walletIdentifierMasked || "—"}</bdi></td><td>{formatMoney(item.openingBalanceMinor, item.currency)}</td><td>{formatMoney(item.creditsMinor, item.currency)}</td><td>{formatMoney(item.debitsMinor, item.currency)}</td><td>{formatMoney(item.closingBalanceMinor, item.currency)}</td><td>{formatMoney(item.currentBalanceMinor, item.currency)}</td><td>{formatMoney(item.heldMinor, item.currency)}</td><td>{formatMoney(item.availableMinor, item.currency)}</td></tr>)}</tbody>{partnerPeriodTotals ? <tfoot><tr><th scope="row" colSpan={3}>إجمالي WLT</th><td>{formatMoney(partnerPeriodTotals.openingBalanceMinor, "YER")}</td><td>{formatMoney(partnerPeriodTotals.creditsMinor, "YER")}</td><td>{formatMoney(partnerPeriodTotals.debitsMinor, "YER")}</td><td>{formatMoney(partnerPeriodTotals.closingBalanceMinor, "YER")}</td><td>{formatMoney(partnerPeriodTotals.currentBalanceMinor, "YER")}</td><td>{formatMoney(partnerPeriodTotals.heldMinor, "YER")}</td><td>{formatMoney(partnerPeriodTotals.availableMinor, "YER")}</td></tr></tfoot> : null}</table></div></section> : null}
    {filtered.some((item) => item.latestPayout?.status === "HELD" || item.latestPayout?.status === "PREPARED") ? <div className="finance-toolbar"><label className="field-label" htmlFor="payout-governance-reason">سبب إجراء الطلب<input id="payout-governance-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} /></label><label className="field-label" htmlFor="payout-preparation-evidence">مرجع دليل التهيئة<input id="payout-preparation-evidence" value={payoutEvidenceReference} onChange={(event) => setPayoutEvidenceReference(event.target.value)} maxLength={512} /></label></div> : null}
    {error ? <p className="validation-error" role="alert">{error}</p> : null}{notice ? <p role="status" className="muted">{notice}</p> : null}
    <div className="catalog-selection-bar" aria-live="polite"><span>{selection.selected.length ? `تم تحديد ${selection.selected.length} طلب معتمد في النتائج المعروضة` : "حدد طلبات معتمدة لإنشاء دفعة تنفيذ"}</span>{selection.selected.length ? <><button className="button button-quiet" type="button" onClick={downloadReceipts}>تصدير CSV للتوثيق</button><button className="button button-quiet" type="button" onClick={selection.clear}>إلغاء التحديد</button><button className="button button-primary" type="button" onClick={() => void createBatch()} disabled={busy}>إنشاء دفعة</button></> : null}</div>
    <div className="finance-table-wrap"><table className="finance-table"><caption className="sr-only">سجل مستحقات وتسويات المستفيدين</caption><thead><tr><th scope="col"><input type="checkbox" aria-label="تحديد الطلبات المعتمدة الظاهرة" checked={selection.allVisibleSelected} onChange={selection.toggleAllVisible} /></th><th scope="col">المستفيد</th><th scope="col">المتاح للتسوية</th><th scope="col">المحجوز</th><th scope="col">آخر طلب ومبلغه</th><th scope="col">حالة الطلب</th><th scope="col">وجهة التسوية</th><th scope="col">الإجراء</th></tr></thead><tbody>{filtered.map((item) => { const payout = item.latestPayout; const selectable = payout?.status === "APPROVED"; return <tr key={item.id}><td><input type="checkbox" aria-label={`تحديد طلب ${payout?.id ?? "غير موجود"} للمستفيد ${item.actorId}`} checked={selection.selectedIds.has(item.id)} disabled={!selectable} onChange={() => selection.toggle(item.id)} /></td><td>{actorLabel[item.actorType]} · <bdi>{item.actorId}</bdi>{item.destination?.beneficiaryName ? <><br /><span>{item.destination.beneficiaryName}</span></> : null}<br /><button className="button button-quiet" type="button" onClick={() => void readFinancialStatement(item)} disabled={statementBusy}>فتح التاريخ وكشف الحساب</button></td><td>{formatMoney(item.eligibleAvailableMinor, item.currency)}</td><td>{formatMoney(item.heldMinor, item.currency)}</td><td>{payout ? <><bdi>{payout.id}</bdi><br />{formatMoney(payout.resolvedAmountMinor, payout.currency)}</> : "لا يوجد طلب"}</td><td>{payout ? payoutStatusLabel(payout.status) : "لا يوجد طلب"}</td><td>{item.destination ? `${item.destination.providerKey} · ${item.destination.walletIdentifierMasked} · ${item.destination.status}` : "لا توجد وجهة معتمدة"}</td><td>{payout?.status === "HELD" ? <button className="button button-quiet" type="button" onClick={() => void payoutAction(payout.id, "prepare")} disabled={busy || !reason.trim() || !payoutEvidenceReference.trim()}>تهيئة</button> : payout?.status === "PREPARED" ? <button className="button button-quiet" type="button" onClick={() => void payoutAction(payout.id, "approve")} disabled={busy || !reason.trim()}>اعتماد مستقل</button> : payout?.status === "APPROVED" ? <button className="button button-quiet" type="button" onClick={() => void payoutAction(payout.id, "cancel")} disabled={busy || !reason.trim()}>إلغاء وإطلاق الحجز</button> : "—"}</td></tr>; })}</tbody></table>{!busy && filtered.length === 0 ? <p className="muted">لا توجد سجلات مطابقة. حدّث النتائج بعد تغيير البحث أو الفئة.</p> : null}</div>
    {statementBeneficiary ? <section id="beneficiary-financial-statement-print" className={`access-card ${styles.statement}`} aria-labelledby="beneficiary-financial-statement-title"><div className="finance-toolbar"><div><p className="eyebrow">كشف WLT · تفاصيل DSH الموثقة</p><h3 id="beneficiary-financial-statement-title">{actorLabel[statementBeneficiary.actorType]} · <bdi>{statementBeneficiary.actorId}</bdi></h3></div><div className={styles.actions}><button className="button button-quiet" type="button" onClick={() => void printFinancialStatement()} disabled={statementBusy}>طباعة الكشف كاملاً</button><button className="button button-secondary" type="button" onClick={() => void downloadFinancialStatement()} disabled={statementBusy || !financialStatement}>تنزيل كشف Excel (CSV)</button><button className="button button-quiet" type="button" onClick={() => { setStatementBeneficiary(null); setFinancialStatement(null); }}>إغلاق</button></div></div>{statementBusy && !financialStatement ? <p className="muted">جارٍ قراءة القيود من WLT…</p> : financialStatement ? <><div className="finance-toolbar"><span>الفترة {financialStatement.periodStart} — {financialStatement.periodEnd}</span><span>افتتاحي: {formatMoney(financialStatement.openingBalanceMinor, financialStatement.currency)}</span><span>إجمالي الإيداعات: {formatMoney(financialStatement.creditsMinor, financialStatement.currency)}</span><span>إجمالي الخصومات: {formatMoney(financialStatement.debitsMinor, financialStatement.currency)}</span><strong>إقفال الفترة: {formatMoney(financialStatement.closingBalanceMinor, financialStatement.currency)}</strong><span>الرصيد الحالي: {formatMoney(financialStatement.currentBalanceMinor, financialStatement.currency)}</span></div><div className="finance-table-wrap"><table className="finance-table"><caption className="sr-only">تفاصيل كشف الحساب المالي</caption><thead><tr><th scope="col">التاريخ</th><th scope="col">نوع القيد والمصدر</th><th scope="col">الاتجاه والمبلغ</th><th scope="col">الرصيد بعد الحركة</th><th scope="col">تفاصيل الطلب والمنتجات</th></tr></thead><tbody>{financialStatement.entries.map((entry) => <tr key={entry.transactionId}><td>{new Date(entry.createdAt).toLocaleString("ar-YE")}</td><td><bdi>{entry.transactionType}</bdi><br /><small><bdi>{entry.sourceType} · {entry.sourceId}</bdi></small></td><td>{entry.direction === "CREDIT" ? "إضافة" : "خصم"} · {formatMoney(entry.amountMinor, entry.currency)}</td><td>{formatMoney(entry.balanceAfterMinor, entry.currency)}</td><td>{entry.order ? <details open><summary>طلب {entry.order.orderId} · {formatMoney(entry.order.totalAmountMinor, entry.order.currency)}</summary><p>{entry.order.storeName} · {entry.order.state} · {entry.order.fulfillmentMode}</p><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th scope="col">المنتج</th><th scope="col">الصنف</th><th scope="col">الكمية بوحدة الأساس</th><th scope="col">سعر الوحدة</th><th scope="col">إجمالي السطر</th></tr></thead><tbody>{entry.order.lines.map((line, index) => <tr key={`${entry.order?.orderId}-${index}`}><td>{line.productName}</td><td>{line.variantTitle}</td><td>{line.quantityBaseUnits.toLocaleString("ar-YE")}</td><td>{formatMoney(line.unitPriceMinor, line.currency)}</td><td>{formatMoney(line.lineAmountMinor, line.currency)}</td></tr>)}</tbody></table></div></details> : entry.store ? <details><summary>استحقاق مرتبط بمتجر {entry.store.name}</summary><p>{entry.store.publicationState} · <bdi>{entry.store.storeId}</bdi></p></details> : "لا توجد لقطة طلب أو متجر مرتبطة بهذا القيد"}</td></tr>)}</tbody></table>{financialStatement.nextCursor ? <button className={`button button-quiet ${styles.actions}`} type="button" onClick={() => void readFinancialStatement(statementBeneficiary, financialStatement.nextCursor, true)} disabled={statementBusy}>تحميل الحركات الأقدم</button> : null}</div></> : <p className="muted">لم يصل كشف من WLT بعد.</p>}</section> : null}
    {actorType === "partner" ? <details className="access-card"><summary>مبالغ عمولة بثواني المستحقة على الشريك</summary><p className="muted">هذا تدفق تحصيل منفصل عن صرف مستحقات الشريك: يعرض ذمم عمولة المنصة ويسجل حوالة واردة من الشريك بعد التحقق منها.</p><PartnerEarningsWorkspace /></details> : null}
    {nextCursor ? <button className="button button-secondary" type="button" onClick={() => void readNext()} disabled={busy}>{busy ? "جارٍ التحميل…" : "تحميل بقية السجلات"}</button> : null}
    <section className="access-card" aria-labelledby="settlement-batches-title"><div className="finance-toolbar"><h3 id="settlement-batches-title">دفعات التنفيذ المسجلة</h3><label className="field-label" htmlFor="settlement-batch-status">تصفية الدفعات<select id="settlement-batch-status" value={batchStatus} onChange={(event) => setBatchStatus(event.target.value)}><option value="">كل الحالات</option>{["PREPARED", "APPROVED", "FROZEN", "EXECUTION_IN_PROGRESS", "AWAITING_VERIFICATION", "AWAITING_RECONCILIATION", "COMPLETED", "EXCEPTION", "CANCELLED"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><button className="button button-secondary" type="button" onClick={() => void readBatches()} disabled={busy}>تحديث الدفعات</button></div>{batches.length ? <div className="finance-table-wrap"><table className="finance-table"><caption className="sr-only">دفعات التسوية المحفوظة لدى WLT</caption><thead><tr><th scope="col">الدفعة</th><th scope="col">الحالة</th><th scope="col">عدد التحويلات</th><th scope="col">المجموع المحسوب</th><th scope="col">الإجراء</th></tr></thead><tbody>{batches.map((item) => <tr key={item.id}><td><bdi>{item.id}</bdi></td><td>{item.status}</td><td>{item.rowCount.toLocaleString("ar-YE")}</td><td>{formatMoney(item.totalAmountMinor, item.currency)}</td><td><button className="button button-quiet" type="button" onClick={() => selectBatch(item)}>فتح الدفعة</button></td></tr>)}</tbody></table></div> : <p className="muted">لا توجد دفعات محملة. حدّث القائمة لقراءتها من WLT.</p>}{batchCursor ? <button className="button button-quiet" type="button" onClick={() => void readBatches(true)} disabled={busy}>تحميل الدفعات الأقدم</button> : null}</section>
    <div className="finance-toolbar"><label className="field-label" htmlFor="settlement-batch-lookup">فتح دفعة بمعرّفها<input id="settlement-batch-lookup" value={batchLookup} onChange={(event) => setBatchLookup(event.target.value)} maxLength={128} placeholder="أدخل معرّف الدفعة" /></label><button className="button button-secondary" type="button" onClick={() => void loadBatch()} disabled={busy || !batchLookup.trim()}>فتح الدفعة</button></div>
    {batch ? <section className="access-card" aria-labelledby="settlement-batch-title"><div className="finance-toolbar"><div><p className="eyebrow">دفعة WLT</p><h3 id="settlement-batch-title">دفعة تنفيذ: <bdi>{batch.id}</bdi></h3></div><strong>{formatMoney(batch.totalAmountMinor, batch.currency)} · {batch.rowCount.toLocaleString("ar-YE")} تحويل</strong></div><p className="muted">الحالة: {batch.status}{batch.batchHash ? ` · بصمة الدفعة ${batch.batchHash}` : ""}</p><label className="field-label" htmlFor="settlement-batch-reason">سبب اعتماد أو تجميد الدفعة<input id="settlement-batch-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} /></label>{batch.status === "PREPARED" ? <button className="button button-secondary" type="button" onClick={() => void batchAction("approve")} disabled={busy || !reason.trim()}>اعتماد الدفعة مستقلاً</button> : null}{batch.status === "APPROVED" ? <button className="button button-secondary" type="button" onClick={() => void batchAction("freeze")} disabled={busy || !reason.trim()}>تجميد الدفعة وحساب بصمتها</button> : null}{["FROZEN", "EXECUTION_IN_PROGRESS", "AWAITING_VERIFICATION", "AWAITING_RECONCILIATION", "COMPLETED"].includes(batch.status) ? <button className="button button-secondary" type="button" onClick={() => void exportBatch()} disabled={busy}>تنزيل ملف XLSX التنفيذي من WLT</button> : null}
      {batch.status === "FROZEN" || batch.status === "EXECUTION_IN_PROGRESS" || batch.status === "AWAITING_VERIFICATION" || batch.status === "AWAITING_RECONCILIATION" || batch.status === "COMPLETED" ? <div className="finance-table-wrap"><table className="finance-table"><caption className="sr-only">عمليات الدفعة المجمدة</caption><thead><tr><th scope="col">المستفيد</th><th scope="col">المبلغ المثبت</th><th scope="col">الحالة</th><th scope="col">توثيق التنفيذ</th><th scope="col">التدقيق</th></tr></thead><tbody>{batchItems.map((item) => <tr key={item.payoutId}><td>{actorLabel[item.actorType]} · <bdi>{item.actorId}</bdi></td><td>{formatMoney(item.amountMinor, item.currency)}</td><td>{payoutStatusLabel(item.payoutStatus as PayoutRequest["status"])}</td><td>{item.payoutStatus === "FROZEN" ? <div><label className="field-label" htmlFor={`transfer-reference-${item.payoutId}`}>مرجع التحويل الخارجي<input id={`transfer-reference-${item.payoutId}`} value={externalReference} onChange={(event) => setExternalReference(event.target.value)} /></label><label className="field-label" htmlFor={`transfer-receipt-${item.payoutId}`}>إيصال هذا التحويل (إلزامي)<input id={`transfer-receipt-${item.payoutId}`} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} /></label><span className="muted">PDF أو صورة · حتى 10 ميغابايت</span><button className="button button-secondary" type="button" onClick={() => void recordTransfer(item.payoutId)} disabled={busy || !externalReference.trim() || !receiptFile}>تسجيل التحويل والإيصال</button></div> : "سُجل التنفيذ أو اكتملت حالته"}</td><td>{item.transfer ? <button className="button button-quiet" type="button" onClick={() => { setTransfer(item.transfer ?? null); setStatementRowId(item.transfer?.statementRowId ?? ""); }}>فتح سجل التحويل</button> : "لا يوجد تحويل مسجل"}</td></tr>)}</tbody></table></div> : null}
    </section> : null}
    <section className="access-card" aria-labelledby="statement-upload-title"><div className="finance-toolbar"><div><p className="eyebrow">دليل كشف المحفظة</p><h3 id="statement-upload-title">رفع الكشف وربط صف المطابقة</h3></div></div><p className="muted">يُرفع الملف الأصلي مرة واحدة. تُسجل بيانات الصف المراد مطابقته بعد مراجعة الكشف، ويقارن WLT المرجع والمبلغ والعملة والوجهة قبل إتمام القيد.</p><label className="field-label" htmlFor="statement-provider">المحفظة أو المزوّد<input id="statement-provider" value={statementProvider} onChange={(event) => setStatementProvider(event.target.value)} maxLength={64} /></label><label className="field-label" htmlFor="statement-period-start">بداية الفترة<input id="statement-period-start" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label><label className="field-label" htmlFor="statement-period-end">نهاية الفترة<input id="statement-period-end" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label><label className="field-label" htmlFor="statement-file">كشف رسمي PDF أو CSV أو XLSX<input id="statement-file" type="file" accept="application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png" onChange={(event) => setStatementFile(event.target.files?.[0] ?? null)} /></label><span className="muted">حد الملف 10 ميغابايت. يبقى مشفراً وخاصاً داخل WLT.</span><button className="button button-secondary" type="button" onClick={() => void registerStatement()} disabled={busy || !statementFile || !statementProvider.trim() || !periodStart || !periodEnd}>رفع الكشف وتسجيله</button>{statementId ? <><p role="status">رقم الكشف المرتبط: <bdi>{statementId}</bdi></p><div className="finance-summary-grid"><label className="field-label" htmlFor="statement-row-sequence">رقم الصف في الملف<input id="statement-row-sequence" inputMode="numeric" value={rowSequence} onChange={(event) => setRowSequence(event.target.value.replace(/[^0-9]/g, ""))} /></label><label className="field-label" htmlFor="statement-row-reference">مرجع التحويل كما في الكشف<input id="statement-row-reference" value={statementReference} onChange={(event) => setStatementReference(event.target.value)} /></label><label className="field-label" htmlFor="statement-row-wallet">رقم محفظة المستفيد بالصيغة الدولية كما في الكشف<input id="statement-row-wallet" type="tel" inputMode="tel" autoComplete="off" placeholder="+967…" value={walletIdentifier} onChange={(event) => setWalletIdentifier(event.target.value)} /><small>صيغة E.164؛ لا تدخل رقم Actor أو رقم الدخول إلا إذا كان هو نفسه رقم المحفظة المثبت في الكشف.</small></label><label className="field-label" htmlFor="statement-row-amount">المبلغ كما في الكشف<input id="statement-row-amount" inputMode="numeric" value={statementAmount} onChange={(event) => setStatementAmount(event.target.value.replace(/[^0-9]/g, ""))} /></label><label className="field-label" htmlFor="statement-row-time">تاريخ ووقت الحركة<input id="statement-row-time" type="datetime-local" value={transactionAt} onChange={(event) => setTransactionAt(event.target.value)} /></label></div><button className="button button-secondary" type="button" onClick={() => void addStatementRow()} disabled={busy || !rowSequence || !statementReference.trim() || !walletIdentifier.trim() || !statementAmount || !transactionAt}>تسجيل صف الكشف</button></> : null}</section>
    {transfer ? <section className="access-card" aria-labelledby="transfer-check-title"><h3 id="transfer-check-title">التحقق والمطابقة للتحويل المحدد</h3><p>الحالة: {transfer.executionStatus} · مرجع <bdi>{transfer.externalTransferReference}</bdi></p><a href={`/api/finance/evidence/${encodeURIComponent(transfer.receiptDocumentId)}`}>تنزيل إيصال التحويل</a>{transfer.executionStatus === "EXECUTED" ? <button className="button button-secondary" type="button" onClick={() => void transferAction("verify")} disabled={busy}>تحقق مستقل</button> : null}{transfer.executionStatus === "VERIFIED" ? <><label className="field-label" htmlFor="transfer-statement-row-id">معرّف صف الكشف المسجل<input id="transfer-statement-row-id" value={statementRowId} onChange={(event) => setStatementRowId(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => void transferAction("reconcile", statementRowId.trim())} disabled={busy || !statementRowId.trim() || !statementId}>مطابقة الصف وإنهاء القيد</button></> : null}</section> : null}
    <section className="access-card" aria-label="تنزيل بيانات الطلبات المحددة"><p className="muted">تصدير CSV أعلاه هو نسخة توثيقية للطلبات المعروضة فقط؛ لا يغير طلبات WLT ولا يعد ملفاً تنفيذياً مجمداً.</p></section>
  </section>;
}
