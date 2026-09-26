"use client";

import { useCallback, useEffect, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { partnerErrorMessage } from "./partner-error-message";

type LegalName = Readonly<{ actorId: string; version: number; givenName: string; secondName: string; thirdName: string; familyName: string; status: string; evidenceReference: string; submittedByActorId: string }>;
type PendingLegalName = Readonly<{ legalName: LegalName; canVerify: boolean }>;
const blankName = { givenName: "", secondName: "", thirdName: "", familyName: "", evidenceReference: "" };

export function ActorLegalNameWorkspace({ actorId }: Readonly<{ actorId: string }>) {
  const [pending, setPending] = useState<PendingLegalName | null>(null);
  const [name, setName] = useState(blankName);
  const [verificationEvidence, setVerificationEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const read = useCallback(async () => {
    setError("");
    try {
      const response = await identityFetch(`/api/operations/actor-legal-name?actorId=${encodeURIComponent(actorId)}`, { cache: "no-store" });
      if (response.status === 404) { setPending(null); return; }
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      setPending(await response.json() as PendingLegalName);
    } catch (cause) { setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذرت قراءة مرشح الاسم القانوني."); }
  }, [actorId]);

  useEffect(() => { void read(); }, [read]);

  async function act(action: "submit" | "verify") {
    setBusy(true); setError(""); setNotice("");
    try {
      const body = action === "submit" ? { action, actorId, ...name } : { action, actorId, version: pending?.legalName.version, evidenceReference: verificationEvidence };
      const response = await identityFetch("/api/operations/actor-legal-name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const result = await response.json() as { legalName: LegalName };
      setNotice(action === "submit" ? `سُجل الاسم كمرشح غير معتمد، الإصدار ${result.legalName.version}. يجب أن يراجعه موظف عمليات آخر.` : `تم اعتماد الاسم من Identity، الإصدار ${result.legalName.version}.`);
      if (action === "submit") setName(blankName); else setVerificationEvidence("");
      await read();
    } catch (cause) { setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذر تنفيذ مراجعة الاسم القانوني."); }
    finally { setBusy(false); }
  }

  const nameReady = [name.givenName, name.secondName, name.thirdName, name.familyName, name.evidenceReference].every((value) => value.trim().length > 0);
  return <section className="partner-detail-section" aria-labelledby="actor-legal-name-title">
    <div className="partner-detail-section-heading"><div><p className="eyebrow">Identity · اسم موثق</p><h2 id="actor-legal-name-title">الاسم الرباعي القانوني</h2></div><button type="button" className="button button-secondary" onClick={() => void read()} disabled={busy}>إعادة القراءة</button></div>
    <p className="muted">هذا السجل هو مصدر الاسم الذي تثبته المالية في وجهة المحفظة ولقطة التسوية. الاسم المقدم يبقى معلقاً حتى يراجعه موظف عمليات مستقل.</p>
    {notice ? <p className="success-inline" role="status">{notice}</p> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال الإجراء</strong><p>{error}</p></div> : null}
    {pending ? <div className="managed-status"><strong>مرشح الاسم · الإصدار {pending.legalName.version}</strong><p>{[pending.legalName.givenName, pending.legalName.secondName, pending.legalName.thirdName, pending.legalName.familyName].join(" ")}</p><p>مرجع دليل التقديم: <bdi>{pending.legalName.evidenceReference}</bdi> · مقدم من <bdi>{pending.legalName.submittedByActorId}</bdi></p>
      {pending.canVerify ? <><label className="field-label" htmlFor="legal-name-verification-evidence">مرجع دليل المراجعة المستقلة<input id="legal-name-verification-evidence" value={verificationEvidence} maxLength={512} onChange={(event) => setVerificationEvidence(event.target.value)} /></label><button type="button" className="button button-primary" disabled={busy || verificationEvidence.trim().length < 1} onClick={() => void act("verify")}>{busy ? "جارٍ الاعتماد…" : "اعتماد الاسم بعد المراجعة"}</button></> : <p>لا يمكن لمقدم الاسم اعتماده. على موظف عمليات مستقل فتح هذا الملف ومراجعته.</p>}
    </div> : <div className="partner-profile-grid">{(["givenName", "secondName", "thirdName", "familyName"] as const).map((field, index) => <label className="field-label" key={field} htmlFor={`actor-legal-${field}`}>{["الاسم الأول", "الاسم الثاني", "الاسم الثالث", "اسم العائلة"][index]}<input id={`actor-legal-${field}`} value={name[field]} maxLength={80} onChange={(event) => setName((current) => ({ ...current, [field]: event.target.value }))} disabled={busy} /></label>)}<label className="field-label" htmlFor="actor-legal-evidence">مرجع مستند الهوية الرسمي<input id="actor-legal-evidence" value={name.evidenceReference} maxLength={512} onChange={(event) => setName((current) => ({ ...current, evidenceReference: event.target.value }))} disabled={busy} /></label><button type="button" className="button button-primary" disabled={busy || !nameReady} onClick={() => void act("submit")}>{busy ? "جارٍ تسجيل المرشح…" : "إرسال للمراجعة المستقلة"}</button></div>}
  </section>;
}
