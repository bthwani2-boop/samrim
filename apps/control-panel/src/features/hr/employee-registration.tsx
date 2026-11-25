"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import styles from "./employees.module.css";
import type { EmployeeRegistrationResult } from "./register-employee-action";

const fields = [
  { name: "displayName", label: "الاسم الكامل", maxLength: 120 },
  { name: "department", label: "القسم", maxLength: 80 },
  { name: "jobTitle", label: "المسمى الوظيفي", maxLength: 80 },
  { name: "startDate", label: "تاريخ بداية العمل", type: "date" },
] as const;
const emptyDraft = { displayName: "", department: "", jobTitle: "", startDate: "" };
const unknownResult: EmployeeRegistrationResult = {
  status: "unknown",
  message: "لم يصل تأكيد الحفظ من DSH. أعد إرسال الطلب الأصلي دون تعديل البيانات أو مغادرة الصفحة.",
};

export default function EmployeeRegistration({
  submit,
}: Readonly<{ submit: (operationId: string, form: FormData) => Promise<EmployeeRegistrationResult> }>) {
  const [draft, setDraft] = useState(emptyDraft);
  const [result, setResult] = useState<EmployeeRegistrationResult | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const currentDraft = useRef(draft);
  const currentResult = useRef(result);
  const attempt = useRef<{ operationId: string; fields: typeof emptyDraft } | null>(null);
  const busy = useRef(false);
  const terminal = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    setReady(true);
    return () => { mounted.current = false; };
  }, []);

  function replaceDraft(next: typeof emptyDraft) {
    currentDraft.current = next;
    setDraft(next);
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mounted.current || busy.current || terminal.current ||
      draft !== currentDraft.current || result !== currentResult.current) return;
    const retry = attempt.current !== null;
    const snapshot = attempt.current ?? {
      operationId: window.crypto.randomUUID(),
      fields: {
        displayName: draft.displayName.trim(), department: draft.department.trim(),
        jobTitle: draft.jobTitle.trim(), startDate: draft.startDate.trim(),
      },
    };
    attempt.current = snapshot;
    busy.current = true;
    replaceDraft(snapshot.fields);
    setPending(true);
    const form = new FormData();
    for (const field of fields) form.set(field.name, snapshot.fields[field.name]);
    let outcome: EmployeeRegistrationResult;
    try {
      outcome = await submit(snapshot.operationId, form);
    } catch {
      outcome = unknownResult;
    }
    if (!mounted.current) return;
    // A later validation failure cannot establish whether an earlier uncertain write committed.
    if (outcome.status === "invalid") {
      if (retry) outcome = unknownResult;
      else attempt.current = null;
    }
    if (outcome.status === "denied" || outcome.status === "conflict" || outcome.status === "confirmed") {
      terminal.current = true;
      if (outcome.status !== "conflict") {
        attempt.current = null;
        replaceDraft(emptyDraft);
      }
    }
    const settled = { ...outcome };
    currentResult.current = settled;
    setResult(settled);
    busy.current = false;
    setPending(false);
    if (outcome.status === "confirmed") window.location.assign(`/hr/employees/${encodeURIComponent(outcome.id)}`);
  }

  const locked = result?.status === "unknown" || result?.status === "conflict";
  const ended = result?.status === "denied" || result?.status === "confirmed" || result?.status === "conflict";
  return (
    <form aria-labelledby="employee-registration-heading" method="post" onSubmit={submitRegistration} className={styles.registration}>
      <h2 id="employee-registration-heading">إضافة موظف</h2>
      {result?.status !== "denied" && result?.status !== "confirmed" && (
        <fieldset className={styles.fields} disabled={!ready || pending || ended}>
          {fields.map(field => (
            <label key={field.name}>
              {field.label}
              <input name={field.name} required
                type={"type" in field ? field.type : "text"}
                maxLength={"maxLength" in field ? field.maxLength : undefined}
                readOnly={locked} value={draft[field.name]}
                onChange={event => {
                  if (!mounted.current || busy.current || terminal.current || attempt.current) return;
                  replaceDraft({ ...currentDraft.current, [field.name]: event.target.value });
                }}
              />
            </label>
          ))}
          <button type="submit">{pending ? "جارٍ الحفظ…" : locked ? "إعادة إرسال الطلب الأصلي" : "حفظ سجل الموظف"}</button>
        </fieldset>
      )}
      {result ? <p role={result.status === "confirmed" ? "status" : "alert"}>{result.message}</p> : null}
      {result?.status === "confirmed" && <a href={`/hr/employees/${encodeURIComponent(result.id)}`}>فتح سجل الموظف</a>}
    </form>
  );
}
