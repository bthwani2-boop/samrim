"use client";

import { type CatalogCategory, type CatalogProductProposal, type CommerceVertical, catalogProductProposalStateLabel } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";

type ProposalDecision = "approved" | "needs_correction" | "rejected";

function responseError(value: unknown): { code?: string; message: string } {
  if (!value || typeof value !== "object") return { message: "تعذر تنفيذ العملية." };
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return { message: "تعذر تنفيذ العملية." };
  const message = (error as { message?: unknown }).message;
  const code = (error as { code?: unknown }).code;
  const normalizedMessage = typeof message === "string" && message.trim() ? message : "تعذر تنفيذ العملية.";
  return typeof code === "string" ? { code, message: normalizedMessage } : { message: normalizedMessage };
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = responseError(body);
    throw Object.assign(new Error(error.message), { code: error.code, status: response.status });
  }
  return body as T;
}

const measurementLabels = { DISCRETE: "عددي", MEASURED: "مقاس ثابت", VARIABLE_MEASURE: "مقاس متغير" } as const;
const unitLabels = { COUNT: "قطعة", GRAM: "غرام", MILLILITER: "مل" } as const;

export function CatalogProposalReview() {
  const [proposals, setProposals] = useState<ReadonlyArray<CatalogProductProposal>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [categories, setCategories] = useState<ReadonlyArray<CatalogCategory>>([]);
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [busy, setBusy] = useState<ProposalDecision | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);

  const selected = useMemo(() => proposals.find((proposal) => proposal.id === selectedId) ?? null, [proposals, selectedId]);
  const vertical = selected ? verticals.find((item) => item.id === selected.verticalId) : undefined;
  const category = selected ? categories.find((item) => item.id === selected.categoryId) : undefined;

  const loadQueue = useCallback(async (cursor = "", append = false) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ state: "submitted", limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/catalog/proposals?${params.toString()}`, { cache: "no-store" });
      const payload = await readJson<{ proposals?: ReadonlyArray<CatalogProductProposal>; nextCursor?: string }>(response);
      const nextProposals = payload.proposals ?? [];
      setProposals((current) => append ? [...current, ...nextProposals] : nextProposals);
      setNextCursor(payload.nextCursor ?? "");
      const requestedId = new URLSearchParams(window.location.search).get("proposalId") ?? "";
      if (!append) setSelectedId((current) => {
        if (requestedId && nextProposals.some((proposal) => proposal.id === requestedId)) return requestedId;
        return current && nextProposals.some((proposal) => proposal.id === current) ? current : "";
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة طابور مقترحات المنتجات.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  useEffect(() => {
    function syncSelectionFromUrl() {
      setSelectedId(new URLSearchParams(window.location.search).get("proposalId") ?? "");
    }
    window.addEventListener("popstate", syncSelectionFromUrl);
    return () => window.removeEventListener("popstate", syncSelectionFromUrl);
  }, []);

  function selectProposal(proposalId: string) {
    const params = new URLSearchParams(window.location.search);
    if (proposalId) params.set("proposalId", proposalId);
    else params.delete("proposalId");
    const query = params.toString();
    window.history.pushState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    setSelectedId(proposalId);
    setError("");
    setNotice("");
    setConflict(false);
  }

  useEffect(() => {
    if (!selected) {
      setCategories([]);
      return;
    }
    void fetch(`/api/catalog/categories?verticalId=${encodeURIComponent(selected.verticalId)}`, { cache: "no-store" })
      .then((response) => readJson<{ categories: ReadonlyArray<CatalogCategory> }>(response))
      .then((payload) => setCategories(payload.categories))
      .catch(() => setCategories([]));
  }, [selected]);

  useEffect(() => {
    void fetch("/api/catalog/verticals", { cache: "no-store" })
      .then((response) => readJson<{ verticals: ReadonlyArray<CommerceVertical> }>(response))
      .then((payload) => setVerticals(payload.verticals))
      .catch(() => setVerticals([]));
  }, []);

  async function review(decision: ProposalDecision) {
    if (!selected || busy) return;
    if (decision === "needs_correction" && reason.trim().length < 5) {
      setError("أدخل سببًا واضحًا للتصحيح قبل إعادة المقترح.");
      return;
    }
    setBusy(decision);
    setError("");
    setNotice("");
    setConflict(false);
    try {
      const response = await fetch(`/api/catalog/proposals/${encodeURIComponent(selected.id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ state: decision, reason: reason.trim(), expectedVersion: selected.version }),
      });
      await readJson<{ proposal: CatalogProductProposal }>(response);
      setReason("");
      selectProposal("");
      setNotice("تم تسجيل القرار، ثم أُعيدت قراءة طابور المقترحات القانوني.");
      await loadQueue();
    } catch (cause) {
      if (cause && typeof cause === "object" && (cause as { status?: number }).status === 409) {
        setConflict(true);
        setNotice("تغيّر هذا المقترح قبل قرارك. أُعيد تحميل النسخة الحالية للمراجعة.");
        await loadQueue();
      } else {
        setError(cause instanceof Error ? cause.message : "تعذر تسجيل قرار المقترح.");
      }
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="central-catalog-grid" data-testid="catalog-proposal-review">
      <section className="access-card central-catalog-list" aria-labelledby="catalog-proposals-title">
        <div className="access-card-heading">
          <span className="step-chip">المقترحات</span>
          <p className="eyebrow">طابور المراجعة</p>
          <h2 id="catalog-proposals-title">المقترحات المقدمة</h2>
          <p className="muted">اختر مقترحًا لقراءة حقائقه كاملة قبل اعتماد القرار.</p>
        </div>
        {loading ? <p className="muted">جارٍ قراءة الطابور…</p> : proposals.length === 0 ? <p className="empty-inline">لا توجد مقترحات قيد المراجعة.</p> : (
          <ul className="proposal-list">
            {proposals.map((proposal) => (
              <li key={proposal.id}>
                <button type="button" className={`proposal-row${selectedId === proposal.id ? " selected" : ""}`} aria-pressed={selectedId === proposal.id} onClick={() => selectProposal(proposal.id)}>
                  <span><strong>{proposal.proposedName}</strong><small>{proposal.proposedVariantTitle}</small></span>
                  <em>{catalogProductProposalStateLabel(proposal.state)}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="button button-secondary" disabled={loading} onClick={() => void loadQueue()}>إعادة قراءة الطابور</button>
        {nextCursor ? <button type="button" className="button button-secondary" disabled={loading} onClick={() => void loadQueue(nextCursor, true)}>تحميل المزيد</button> : null}
      </section>

      <article className="access-card central-catalog-editor" aria-labelledby="catalog-proposal-detail-title">
        <div className="access-card-heading">
          <p className="eyebrow">تفاصيل القرار</p>
          <h2 id="catalog-proposal-detail-title">{selected ? selected.proposedName : "اختر مقترحًا"}</h2>
          <p className="muted">القرار محمي من التعارض تلقائيًا، وتُعاد قراءة الحالة الحالية بعد التنفيذ.</p>
        </div>
        {selected ? (
          <>
            <dl className="catalog-detail-list">
              <div><dt>الاسم المقترح</dt><dd>{selected.proposedName}</dd></div>
              <div><dt>العلامة</dt><dd>{selected.proposedBrand || "غير محددة"}</dd></div>
              <div><dt>النسخة</dt><dd>{selected.proposedVariantTitle}</dd></div>
              <div><dt>النسخة الحالية: {selected.version}</dt></div>
              <div><dt>الفئة الرئيسية</dt><dd>{vertical?.nameAr ?? "الفئة الرئيسية غير متاحة"}</dd></div>
              <div><dt>الفئة</dt><dd>{category?.nameAr ?? "الفئة غير متاحة"}</dd></div>
              <div><dt>القياس</dt><dd>{measurementLabels[selected.proposedMeasurementKind]} · {unitLabels[selected.proposedBaseUnit]}</dd></div>
              <div><dt>المعرّف</dt><dd>{selected.proposedIdentifierValue ? `${selected.proposedIdentifierType ?? "معرّف"}: ${selected.proposedIdentifierValue}` : "لا يوجد"}</dd></div>
              <div><dt>الحالة</dt><dd>{catalogProductProposalStateLabel(selected.state)}</dd></div>
              {selected.correctionReason ? <div><dt>سبب التصحيح السابق</dt><dd>{selected.correctionReason}</dd></div> : null}
            </dl>
            <label className="field-label" htmlFor="proposal-correction-reason">ملاحظة القرار أو سبب التصحيح<textarea className="resize-none" id="proposal-correction-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={Boolean(busy)} /></label>
            <div className="review-actions">
              <button type="button" className="button button-primary" disabled={Boolean(busy) || conflict} onClick={() => void review("approved")}>{busy === "approved" ? "جارٍ الاعتماد…" : "اعتماد"}</button>
              <button type="button" className="button button-secondary" disabled={Boolean(busy) || conflict} onClick={() => void review("needs_correction")}>{busy === "needs_correction" ? "جارٍ الإعادة…" : "إعادة للتصحيح"}</button>
              <button type="button" className="button button-secondary" disabled={Boolean(busy) || conflict} onClick={() => void review("rejected")}>{busy === "rejected" ? "جارٍ الرفض…" : "رفض"}</button>
            </div>
          </>
        ) : <p className="muted">لا توجد تفاصيل لعرضها. اختر عنصرًا من الطابور بعد نجاح القراءة.</p>}
        {notice ? <p className="success-inline" role="status">{notice}</p> : null}
        {error ? <p className="identity-error" role="alert">{error}</p> : null}
      </article>
    </div>
  );
}
