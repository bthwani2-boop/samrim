"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type EmployeeRegistrationDraft, type EmployeeRegistrationRecovery, type EmployeeRegistrationRecoveryPort,
  claimEmployeeRegistration, normalizeEmployeeRegistrationDraft, openEmployeeRegistrationRecovery, settleEmployeeRegistration,
} from "@bthwani/dsh";
import styles from "./employees.module.css";
import type { EmployeeRegistrationResult } from "./register-employee-action";

const fields = [
  { name: "displayName", label: "الاسم الكامل", maxLength: 120 },
  { name: "department", label: "القسم", maxLength: 80 },
  { name: "jobTitle", label: "المسمى الوظيفي", maxLength: 80 },
  { name: "startDate", label: "تاريخ بداية العمل", type: "date" },
] as const;
const emptyDraft: EmployeeRegistrationDraft = { displayName: "", department: "", jobTitle: "", startDate: "" };
const unknownResult: EmployeeRegistrationResult = {
  status: "unknown",
  message: "لم يصل تأكيد الحفظ من DSH. أعد إرسال الطلب الأصلي دون تعديل البيانات.",
};
const recoveryPort: EmployeeRegistrationRecoveryPort = {
  read: async key => window.localStorage.getItem(key),
  write: async (key,value) => { window.localStorage.setItem(key,value); },
  lock: (key,action) => {
    if (!window.navigator.locks) return Promise.reject(new Error("Cross-tab recovery lock unavailable"));
    return window.navigator.locks.request(key,action);
  },
  digest: async value => Array.from(new Uint8Array(await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    byte => byte.toString(16).padStart(2,"0")).join(""),
  randomUUID: () => window.crypto.randomUUID(),
};

export default function EmployeeRegistration({
  actorId, submit,
}: Readonly<{ actorId: string; submit: (operationId: string, form: FormData) => Promise<EmployeeRegistrationResult> }>) {
  const [draft, setDraft] = useState(emptyDraft);
  const [result, setResult] = useState<EmployeeRegistrationResult | null>(null);
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState<EmployeeRegistrationRecovery | null>(null);
  const [locked, setLocked] = useState(false);
  const currentDraft = useRef(draft);
  const currentResult = useRef(result);
  const currentRecovery = useRef(recovery);
  const busy = useRef(false);
  const terminal = useRef(false);
  const mounted = useRef(false);
  const lockedRef = useRef(false);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void openEmployeeRegistrationRecovery(recoveryPort,"company",actorId).then(value => {
      if (!active) return;
      currentRecovery.current = value;
      setRecovery(value);
    }).catch(() => {
      if (!active) return;
      const failure: EmployeeRegistrationResult = { status: "unknown", message: "تعذر استعادة هوية التسجيل. لا يمكن بدء طلب جديد." };
      currentResult.current = failure;
      setResult(failure);
    });
    return () => { active = false; mounted.current = false; };
  }, [actorId]);

  function replaceDraft(next: EmployeeRegistrationDraft) {
    currentDraft.current = next;
    setDraft(next);
  }
  function replaceResult(next: EmployeeRegistrationResult | null) {
    currentResult.current = next;
    setResult(next);
  }
  function replaceRecovery(next: EmployeeRegistrationRecovery | null) {
    currentRecovery.current = next;
    setRecovery(next);
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mounted.current || busy.current || terminal.current || !recovery ||
      recovery !== currentRecovery.current || draft !== currentDraft.current || result !== currentResult.current) return;
    busy.current = true;
    setPending(true);
    let outcome: EmployeeRegistrationResult;
    try {
      const claimed = await claimEmployeeRegistration(recoveryPort,recovery,normalizeEmployeeRegistrationDraft(draft));
      if (!mounted.current) return;
      if (claimed.status !== "claimed") {
        if (claimed.status === "changed") replaceRecovery(null);
        replaceResult({ status: "invalid", message: claimed.status === "changed"
          ? "تغيرت محاولة التسجيل في نافذة أخرى. أعد فتح الصفحة قبل المتابعة."
          : "راجع البيانات أو أعد إدخال القيم الأصلية للمحاولة السابقة." });
        return;
      }
      replaceRecovery(claimed.recovery);
      replaceDraft(normalizeEmployeeRegistrationDraft(claimed.input));
      lockedRef.current = true;
      setLocked(true);
      const form = new FormData();
      for (const field of fields) form.set(field.name, claimed.input[field.name]);
      try { outcome = await submit(claimed.input.operationId, form); }
      catch { outcome = unknownResult; }
      if (outcome.status === "invalid" && claimed.replay) outcome = unknownResult;
      // Settle only a confirmed result or the definitive rejection of a new attempt.
      const settled = await settleEmployeeRegistration(recoveryPort,claimed.recovery,outcome.status,claimed.replay);
      if (!mounted.current) return;
      replaceRecovery(settled);
      if (outcome.status === "invalid") {
        lockedRef.current = false;
        setLocked(false);
      }
      if (outcome.status === "denied" || outcome.status === "conflict" || outcome.status === "confirmed") {
        terminal.current = true;
        if (outcome.status !== "conflict") replaceDraft(emptyDraft);
      }
      replaceResult({ ...outcome });
      if (outcome.status === "confirmed") window.location.assign(`/hr/employees/${encodeURIComponent(outcome.id)}`);
    } catch {
      if (mounted.current) replaceResult({ ...unknownResult });
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  const ended = result?.status === "denied" || result?.status === "confirmed" || result?.status === "conflict";
  const replay = recovery?.attempt && !recovery.attempt.settled;
  return (
    <form aria-labelledby="employee-registration-heading" method="post" onSubmit={submitRegistration} className={styles.registration}>
      <h2 id="employee-registration-heading">إضافة موظف</h2>
      {result?.status !== "denied" && result?.status !== "confirmed" && (
        <fieldset className={styles.fields} disabled={!recovery || pending || ended}>
          {replay && <p>توجد محاولة تسجيل سابقة. أدخل بياناتها الأصلية لإعادة التأكيد.</p>}
          {fields.map(field => (
            <label key={field.name}>
              {field.label}
              <input name={field.name} required
                type={"type" in field ? field.type : "text"}
                maxLength={"maxLength" in field ? field.maxLength : undefined}
                readOnly={locked} value={draft[field.name]}
                onChange={event => {
                  if (!mounted.current || busy.current || terminal.current || lockedRef.current) return;
                  replaceDraft({ ...currentDraft.current, [field.name]: event.target.value });
                  if (currentResult.current?.status === "invalid") replaceResult(null);
                }}
              />
            </label>
          ))}
          <button type="submit">{pending ? "جارٍ الحفظ…" : replay ? "إعادة إرسال الطلب الأصلي" : "حفظ سجل الموظف"}</button>
        </fieldset>
      )}
      {result ? <p role={result.status === "confirmed" ? "status" : "alert"}>{result.message}</p> : null}
      {result?.status === "confirmed" && <a href={`/hr/employees/${encodeURIComponent(result.id)}`}>فتح سجل الموظف</a>}
    </form>
  );
}
