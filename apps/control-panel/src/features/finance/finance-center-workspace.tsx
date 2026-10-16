"use client";

import { type CashCustodyRegistryResponse, type CustomerWithdrawalIntakeListResponse, formatMoney, type PartnerCommissionReceivableRegistryResponse, type SettlementBatch } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { useReadOnReturn } from "../shared/use-read-on-return";

type PreviewRecord = Readonly<{ id: string; title: string; amount?: string; nextAction: string; href: string }>;
type Preview = Readonly<{ records: readonly PreviewRecord[]; error?: string }>;

// Each preview is a separate, bounded owner query. Its length is never a global count.
const queues = [
  { key: "custody", title: "العهد النقدية", description: "أقدم التحصيلات؛ التوريد والمطابقة في سجل العهد.", url: "/api/finance/cash-custody?limit=3&sort=collected_asc", href: "/finance/cash-custody?sort=collected_asc" },
  { key: "receivables", title: "ذمم عمولة المنصة", description: "مبالغ مستحقة للمنصة على الشركاء؛ تُحصّل بعد التحقق من التوريد.", url: "/api/finance/partner-commission-receivables?limit=3&sort=actor_asc", href: "/finance/partner-commission-receivables" },
  { key: "payouts", title: "دفعات بانتظار الاعتماد", description: "دفعات مهيأة للصرف؛ الاعتماد والتنفيذ والمطابقة في مساحة التسويات.", url: "/api/finance/settlement-batches?limit=3&status=PREPARED", href: "/finance/beneficiary-settlement/partners?view=batches&batchStatus=PREPARED" },
  { key: "withdrawals", title: "طلبات سحب العملاء الجديدة", description: "طلبات استثنائية مسجلة؛ تبدأ المراجعة بالتحقق من وجهة الصرف.", url: "/api/finance/customer-withdrawal-intakes?limit=3&status=REQUESTED&sort=requested_asc", href: "/finance/customer-withdrawals?status=REQUESTED&sort=requested_asc" },
] as const;
type QueueKey = typeof queues[number]["key"];

function previewRecords(key: QueueKey, body: unknown): readonly PreviewRecord[] {
  if (!body || typeof body !== "object") throw new Error("invalid preview");
  const collection = key === "payouts" ? "batches" : key === "withdrawals" ? "intakes" : "items";
  if (!Array.isArray((body as Record<string, unknown>)[collection])) throw new Error("invalid preview");
  if (key === "custody") return (body as Omit<CashCustodyRegistryResponse, "items"> & { items: readonly (CashCustodyRegistryResponse["items"][number] & { captainName?: string })[] }).items.slice(0, 3).map((item) => ({
    id: item.paymentIntentId, title: item.captainName || "كابتن بثواني", amount: formatMoney(item.amountMinor, item.currency),
    nextAction: item.remittanceState === "SUBMITTED" ? "توريد بانتظار مطابقة الإيصال" : "بانتظار إرسال الكابتن",
    href: `/finance/cash-custody?sort=collected_asc&search=${encodeURIComponent(item.externalReference)}`,
  }));
  if (key === "receivables") return (body as PartnerCommissionReceivableRegistryResponse).items.slice(0, 3).map((item) => ({
    id: item.partnerActorId, title: item.businessName || "شريك بثواني", amount: formatMoney(item.outstandingCommissionReceivableMinor, item.currency),
    nextAction: "مراجعة الذمة وتسجيل التوريد المتحقق منه", href: `/finance/partner-commission-receivables?partnerActorId=${encodeURIComponent(item.partnerActorId)}`,
  }));
  if (key === "payouts") return (body as { batches: readonly SettlementBatch[] }).batches.slice(0, 3).map((item) => ({
    id: item.id, title: `دفعة من ${item.rowCount.toLocaleString("ar-YE")} تحويل`, amount: formatMoney(item.totalAmountMinor, item.currency),
    nextAction: "مراجعة اعتماد الدفعة", href: `/finance/beneficiary-settlement/partners?view=batches&batchStatus=PREPARED&batchId=${encodeURIComponent(item.id)}`,
  }));
  return (body as CustomerWithdrawalIntakeListResponse).intakes.slice(0, 3).map((item) => ({
    id: item.id, title: item.beneficiaryName || "عميل بثواني", nextAction: "مراجعة الطلب ووجهة الصرف",
    href: `/finance/customer-withdrawals?status=REQUESTED&sort=requested_asc&intakeId=${encodeURIComponent(item.id)}`,
  }));
}

export function FinanceCenterWorkspace() {
  const { state } = useSession();
  const actorKey = state.kind === "authenticated" && state.identity.role === "operator" && state.identity.permissions?.includes("finance") ? state.identity.subject : null;
  const [result, setResult] = useState<Readonly<{ actor: string; queues: Partial<Record<QueueKey, Preview>> }> | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const visible = actorKey && result?.actor === actorKey ? result.queues : null;

  const read = useCallback(async () => {
    const request = ++sequence.current;
    if (!actorKey) { setResult(null); return; }
    setLoading(true);
    const previews = await Promise.all(queues.map(async (queue) => {
      try {
        const response = await fetch(queue.url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
        if (!response.ok) throw new Error("preview read failed");
        return [queue.key, { records: previewRecords(queue.key, await response.json()) }] as const;
      } catch {
        return [queue.key, { records: [], error: "تعذرت قراءة المعاينة. افتح السجل أو أعد المحاولة." }] as const;
      }
    }));
    if (request !== sequence.current) return;
    setResult({ actor: actorKey, queues: Object.fromEntries(previews) });
    setLoading(false);
  }, [actorKey]);
  useEffect(() => { void read(); return () => { sequence.current += 1; }; }, [read]);
  useReadOnReturn(read, Boolean(actorKey) && !loading);

  if (state.kind !== "authenticated") return null;
  if (!actorKey) return <section className="state-content workspace-restricted" role="alert"><h1>صلاحية المالية غير متاحة</h1><p>تحتاج إلى صلاحية المالية لفتح السجلات المالية.</p></section>;

  return <section className="workspace-page finance-center" aria-labelledby="finance-center-title">
    <PageHeader id="finance-center-title" title="المالية" status={loading && visible ? <span role="status">جارٍ تحديث المعاينات…</span> : null}
      actions={visible && Object.values(visible).some((preview) => preview.error) ? <button className="button button-secondary" type="button" onClick={() => void read()} disabled={loading}>إعادة المحاولة</button> : null} />
    <p className="muted">معاينات مستقلة حتى ثلاثة سجلات لكل قائمة؛ الأعداد والمبالغ المعروضة تخص هذه السجلات فقط.</p>
    <div className="home-queue-list">{queues.map((queue) => {
      const preview = visible?.[queue.key];
      return <section key={queue.key} className="home-queue" aria-labelledby={`finance-${queue.key}-title`} aria-busy={loading}>
        <div className="home-queue-heading"><h2 id={`finance-${queue.key}-title`}>{queue.title}</h2><Link href={queue.href}>فتح السجل</Link></div>
        <p className="muted">{queue.description}</p>
        {!preview ? <p role="status">جارٍ قراءة المعاينة…</p> : preview.error ? <p className="home-queue-error" role="alert">{preview.error}</p> : preview.records.length === 0 ? <p className="empty-inline">لا سجلات في هذه المعاينة.</p> : <ul className="home-list">{preview.records.map((record) => <li key={record.id}>
          <Link className="home-record-link" href={record.href}><span className="home-record-copy"><strong>{record.title}</strong><small>{record.nextAction}</small></span>{record.amount ? <bdi className="home-record-meta">{record.amount}</bdi> : null}</Link>
        </li>)}</ul>}
      </section>;
    })}</div>
  </section>;
}
