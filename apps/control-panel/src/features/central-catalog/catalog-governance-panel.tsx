"use client";

import { catalogProductProposalStateLabel, type CatalogImportPreviewResponse, type CatalogProductProposal } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { responseMessage } from "../access/identity-error-message";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function CatalogGovernancePanel() {
  const [proposals, setProposals] = useState<ReadonlyArray<CatalogProductProposal>>([]);
  const [selected, setSelected] = useState<CatalogProductProposal | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [rowsJson, setRowsJson] = useState("");
  const [importPreview, setImportPreview] = useState<CatalogImportPreviewResponse | null>(null);

  const loadProposals = useCallback(async () => {
    setQueueLoading(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/proposals?state=submitted&limit=50", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = await response.json() as { proposals?: ReadonlyArray<CatalogProductProposal> };
      setProposals(body.proposals ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة طابور مقترحات المنتجات.");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => { void loadProposals(); }, [loadProposals]);

  async function review(state: "approved" | "rejected" | "needs_correction") {
    if (!selected) return;
    if (state === "needs_correction" && reason.trim().length < 5) {
      setError("أدخل سبب التصحيح قبل إعادة المقترح.");
      return;
    }
    setBusy("review");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/catalog/proposals/" + encodeURIComponent(selected.id) + "/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ state, reason: reason.trim(), expectedVersion: selected.version }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setSelected(null);
      setReason("");
      setNotice("تم تسجيل قرار المقترح ثم إعادة قراءة الطابور القانوني.");
      await loadProposals();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تسجيل قرار المقترح.");
    } finally {
      setBusy("");
    }
  }

  async function previewImport() {
    setBusy("preview");
    setError("");
    setNotice("");
    try {
      const parsed = JSON.parse(rowsJson) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("أدخل مصفوفة JSON تحتوي على صف استيراد واحد على الأقل.");
      const runId = crypto.randomUUID();
      const sourceSha256 = await sha256(rowsJson);
      const response = await fetch("/api/catalog/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ runId, sourceSha256, rows: parsed }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setImportPreview(await response.json() as CatalogImportPreviewResponse);
      setNotice("تم إنشاء معاينة الاستيراد. لم يُكتب أي منتج بعد.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء معاينة الاستيراد.");
    } finally {
      setBusy("");
    }
  }

  async function commitImport() {
    if (!importPreview) return;
    setBusy("commit");
    setError("");
    try {
      const response = await fetch("/api/catalog/imports/" + encodeURIComponent(importPreview.run.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setImportPreview(await response.json() as CatalogImportPreviewResponse);
      setNotice("تم الالتزام الصريح بالاستيراد ثم إعادة قراءة نتيجته الكانونية.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر الالتزام بالاستيراد.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="catalog-governance-grid">
      <section className="access-card" aria-labelledby="catalog-proposals-title">
        <div className="access-card-heading"><span className="step-chip">المقترحات</span><p className="eyebrow">مراجعة منتجات الشركاء</p><h2 id="catalog-proposals-title">طابور المقترحات</h2><p className="muted">تظهر المقترحات المقدمة فقط. القرار يمر عبر نسخة المقترح ويعود بقراءة DSH.</p></div>
        {queueLoading ? <p className="muted">جارٍ قراءة الطابور…</p> : proposals.length === 0 ? <p className="empty-inline">لا توجد مقترحات قيد المراجعة.</p> : <ul className="proposal-list">{proposals.map((proposal) => <li key={proposal.id}><button type="button" className={"proposal-row" + (selected?.id === proposal.id ? " selected" : "")} onClick={() => setSelected(proposal)}><span><strong>{proposal.proposedName}</strong><small>{proposal.proposedVariantTitle}</small></span><em>{catalogProductProposalStateLabel(proposal.state)}</em></button></li>)}</ul>}
        {selected ? <div className="review-panel"><strong>{selected.proposedName}</strong><label className="field-label" htmlFor="proposal-correction-reason">سبب التصحيح عند الحاجة<textarea id="proposal-correction-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={Boolean(busy)} /></label><div className="review-actions"><button type="button" className="button button-primary" onClick={() => void review("approved")} disabled={Boolean(busy)}>اعتماد</button><button type="button" className="button button-secondary" onClick={() => void review("needs_correction")} disabled={Boolean(busy)}>إعادة للتصحيح</button><button type="button" className="button button-secondary" onClick={() => void review("rejected")} disabled={Boolean(busy)}>رفض</button></div></div> : null}
      </section>
      <section className="access-card" aria-labelledby="catalog-import-title">
        <div className="access-card-heading"><span className="step-chip">الاستيراد</span><p className="eyebrow">معاينة ثم التزام</p><h2 id="catalog-import-title">استيراد الكتالوج</h2><p className="muted">ألصق مصفوفة الصفوف القانونية. تنشئ المعاينة بصمة للمصدر وتصنف التعارضات قبل أي كتابة.</p></div>
        <label className="field-label" htmlFor="catalog-import-rows">صفوف JSON<textarea id="catalog-import-rows" className="import-textarea" value={rowsJson} onChange={(event) => setRowsJson(event.target.value)} placeholder="[{&quot;rowNumber&quot;:1,...}]" disabled={Boolean(busy)} /></label>
        <button type="button" className="button button-primary" onClick={() => void previewImport()} disabled={Boolean(busy) || !rowsJson.trim()}>{busy === "preview" ? "جارٍ إنشاء المعاينة…" : "معاينة الاستيراد"}</button>
        {importPreview ? <div className="managed-status managed-status-info" role="status"><strong>الحالة: {importPreview.run.state === "previewed" ? "معاينة جاهزة" : importPreview.run.state === "committed" ? "تم الالتزام" : "مرفوض"}</strong><p>المقبول: {importPreview.run.acceptedCount} · التعارضات: {importPreview.run.conflictCount}</p><p>العناصر المصنفة: {importPreview.items.length}</p>{importPreview.run.state === "previewed" ? <button type="button" className="button button-secondary" onClick={() => void commitImport()} disabled={Boolean(busy)}>{busy === "commit" ? "جارٍ الالتزام…" : "التزام الاستيراد بعد المراجعة"}</button> : null}</div> : null}
      </section>
      {notice ? <p className="success-inline catalog-governance-notice" role="status">{notice}</p> : null}
      {error ? <p className="identity-error catalog-governance-error" role="alert">{error}</p> : null}
    </div>
  );
}
