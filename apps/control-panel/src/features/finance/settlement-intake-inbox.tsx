"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatMoney } from "@bthwani/dsh";
import { OfficialWalletDestinationManager } from "./official-wallet-destination-manager";
import { useReadOnReturn } from "../shared/use-read-on-return";

type Intake = Readonly<{
  id: string; actorType: "partner" | "captain" | "field"; actorId: string;
  resolvedAmountMinor: number; currency: "YER"; createdAt: string;
  storeAllocations: readonly Readonly<{ storeId: string; amountMinor: number }>[];
}>;
const actorLabels = { partner: "شريك", captain: "كابتن", field: "ميداني" } as const;

export function SettlementIntakeInbox({
  search = "", onCountChange, visible = true,
}: Readonly<{
  search?: string;
  visible?: boolean;
  onCountChange?: (count: number | null) => void;
}>) {
  const [items, setItems] = useState<readonly Intake[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [walletReady, setWalletReady] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<HTMLButtonElement | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const normalized = search.trim().toLocaleLowerCase("ar");
  const filtered = normalized ? items.filter((item) =>
    [item.id, item.actorId, actorLabels[item.actorType], formatMoney(item.resolvedAmountMinor, item.currency)]
      .some((value) => value.toLocaleLowerCase("ar").includes(normalized))
  ) : items;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/finance/settlement-intakes", { cache: "no-store" });
      if (!response.ok) throw new Error("تعذرت قراءة طلبات التسوية من المالية");
      const body = await response.json() as { intakes?: readonly Intake[] };
      if (!Array.isArray(body.intakes)) throw new Error("استجابة المالية غير صالحة");
      setItems(body.intakes);
      onCountChange?.(body.intakes.length);
      setSelectedId((previous) => body.intakes?.some((item) => item.id === previous) ? previous : null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل طلبات التسوية");
      onCountChange?.(null);
    } finally { setLoading(false); }
  }, [onCountChange]);

  useEffect(() => { void load(); }, [load]);
  useReadOnReturn(() => { void load(); }, !loading && busyId === null && selectedId === null);

  const closeReview = useCallback(() => {
    if (busyId !== null) return;
    setSelectedId(null); setReviewOpen(false); setWalletReady(false); setCancelOpen(false); setCancelReason("");
    originRef.current?.focus();
  }, [busyId]);
  useEffect(() => {
    if (!selected) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busyId === null) { event.preventDefault(); closeReview(); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const drawer = closeRef.current?.closest('[role="dialog"]');
      const elements = drawer?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href]');
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keydown", trapFocus);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keydown", trapFocus);
    };
  }, [selected, busyId, closeReview]);

  function openReview(item: Intake, trigger: HTMLButtonElement) {
    originRef.current = trigger;
    setSelectedId(item.id); setReviewOpen(false); setWalletReady(false); setCancelOpen(false); setCancelReason("");
  }

  async function convert(id: string) {
    setBusyId(id); setError(""); setNotice("");
    try {
      // Authorization, wallet verification, eligibility and idempotency remain
      // enforced by the owning finance service; UI review is not authorization.
      const response = await fetch("/api/finance/settlement-intakes/" + encodeURIComponent(id) + "/convert", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message || "الطلب يحتاج اعتماد وجهة الصرف أو مراجعة المستحقات أولًا");
      }
      setNotice("أُحيل الطلب إلى مسار الصرف المعتمد. تابع نتيجته والمطابقة في الدفعات.");
      setSelectedId(null); setReviewOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إحالة الطلب للصرف");
    } finally { setBusyId(null); }
  }

  async function cancelIntake(id: string) {
    const reason = cancelReason.trim();
    if (!reason || reason.length > 512) { setError("حدد سبب إلغاء الطلب."); return; }
    setBusyId(id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/finance/settlement-intakes/" + encodeURIComponent(id) + "/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error("لم يتم إلغاء الطلب. راجع حالته قبل المحاولة مجددًا.");
      setSelectedId(null); setReviewOpen(false); setCancelReason("");
      setNotice("أُلغي طلب التسوية دون خصم أو تحويل.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إلغاء الطلب"); }
    finally { setBusyId(null); }
  }

  return <>
    <section className="finance-desk-intakes" aria-label="طلبات التسوية التي تحتاج مراجعة" hidden={!visible}>
      {notice ? <p role="status" className="managed-status managed-status-info">{notice}</p> : null}
      {error ? <div role="alert" className="identity-error">{error} <button type="button" className="button button-secondary" disabled={loading || busyId !== null} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
      {loading && !items.length ? <p className="collection-state" role="status">جارٍ تحميل طلبات التسوية…</p> : null}
      {filtered.map((item) => <article className="finance-desk-item finance-desk-item-attention" key={item.id}>
        <div className="finance-desk-item-body">
          <strong>تسوية مستحقات · {actorLabels[item.actorType]}</strong>
          <span className="finance-desk-item-subtitle">بانتظار مراجعة جهة الصرف</span>
          {item.actorType === "partner" ? <small>{item.storeAllocations.length.toLocaleString("ar-YE")} متجر</small> : null}
        </div>
        <span className="finance-desk-status">تحتاج مراجعة</span>
        <div className="finance-desk-money"><bdi dir="ltr">{formatMoney(item.resolvedAmountMinor, item.currency)}</bdi></div>
        <button className="button button-primary finance-desk-review" type="button" disabled={busyId !== null}
          onClick={(event) => openReview(item, event.currentTarget)}>مراجعة الطلب</button>
      </article>)}
      {!loading && !error && !filtered.length && items.length > 0 ? <p className="finance-desk-empty-inline">لا توجد طلبات تسوية مطابقة للبحث.</p> : null}
    </section>
    {selected && visible && typeof document !== "undefined" ? createPortal(<div className="finance-review-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReview(); }}>
      <aside role="dialog" aria-modal="true" aria-labelledby="finance-review-heading" className="finance-review-panel" dir="rtl">
        <div className="finance-review-top">
          <div><h2 id="finance-review-heading">مراجعة طلب التسوية</h2><span>تسوية مستحقات · {actorLabels[selected.actorType]}</span></div>
          <button ref={closeRef} className="finance-review-close" aria-label="إغلاق مراجعة الطلب" type="button" disabled={busyId !== null} onClick={closeReview}>×</button>
        </div>
        <div className="finance-review-scroll">
          <section className="finance-review-section" aria-label="معلومات الطلب">
            <h3>معلومات المعاملة</h3>
            <dl className="finance-review-facts">
              <div><dt>المستفيد</dt><dd>{actorLabels[selected.actorType]}</dd></div>
              <div><dt>المبلغ</dt><dd><bdi dir="ltr">{formatMoney(selected.resolvedAmountMinor, selected.currency)}</bdi></dd></div>
              <div><dt>التاريخ</dt><dd>{new Date(selected.createdAt).toLocaleDateString("ar-YE")}</dd></div>
              {selected.actorType === "partner" ? <div><dt>المتاجر</dt><dd>{selected.storeAllocations.length.toLocaleString("ar-YE")}</dd></div> : null}
            </dl>
          </section>
          <section className="finance-review-section">
            <h3>مراجعة وجهة الصرف</h3>
            <p className="muted">افحص الوجهة المعتمدة وبيانات التحقق من سجلها الأصلي قبل الإحالة. لا ينفذ هذا الطلب تحويلًا مباشرًا.</p>
            {reviewOpen ? <OfficialWalletDestinationManager key={selected.id} actorType={selected.actorType} actorId={selected.actorId} initiallyExpanded onReadinessChange={setWalletReady} /> :
              <button type="button" className="button button-secondary finance-review-open-wallet" onClick={() => setReviewOpen(true)}>فتح مراجعة وجهة الصرف</button>}
          </section>
          <details className="finance-review-secondary" open={cancelOpen} onToggle={(event) => setCancelOpen(event.currentTarget.open)}>
            <summary>إجراءات أخرى</summary>
            <label>سبب إلغاء الطلب
              <textarea value={cancelReason} maxLength={512} rows={2} placeholder="سبب الإلغاء" onChange={(event) => setCancelReason(event.target.value)} />
            </label>
            <button type="button" className="button button-secondary" disabled={busyId !== null || !cancelReason.trim()}
              onClick={() => void cancelIntake(selected.id)}>تأكيد إلغاء الطلب</button>
          </details>
        </div>
        <div className="finance-review-bottom">
          {error ? <p role="alert" className="identity-error">{error}</p> : null}
          {notice ? <p role="status" className="managed-status managed-status-info">{notice}</p> : null}
          {reviewOpen && walletReady ? <button type="button" className="button button-primary" disabled={busyId !== null}
            onClick={() => void convert(selected.id)}>{busyId === selected.id ? "جارٍ التحقق…" : "التحقق والإحالة للصرف"}</button>
          : reviewOpen ? <p role="status" className="finance-review-not-ready">لا يمكن الإحالة بعد. اقرأ وجهة الصرف وأكمل التحقق والاعتماد المطلوبين في سجل المحفظة.</p>
          : <button type="button" className="button button-primary" onClick={() => setReviewOpen(true)}>مراجعة جهة الصرف</button>}
          <p>يُتحقق من الأهلية والمطابقة والصلاحية لدى المالية قبل قبول الإحالة.</p>
        </div>
      </aside>
    </div>, document.body) : null}
  </>;
}
