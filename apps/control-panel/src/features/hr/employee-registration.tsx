"use client";

import { useActionState, useRef, useState } from "react";
import styles from "./employees.module.css";

const fields = [
  { name: "displayName", label: "الاسم الكامل", maxLength: 120 },
  { name: "department", label: "القسم", maxLength: 80 },
  { name: "jobTitle", label: "المسمى الوظيفي", maxLength: 80 },
  { name: "startDate", label: "تاريخ بداية العمل", type: "date" },
] as const;

export default function EmployeeRegistration({
  submit,
}: Readonly<{ submit: (operationId: string, form: FormData) => Promise<string> }>) {
  const operationId = useRef<string | null>(null);
  const [message, action, pending] = useActionState((_message: string, form: FormData) => {
    operationId.current ??= window.crypto.randomUUID();
    return submit(operationId.current, form);
  }, "");
  const [draft, setDraft] = useState({ displayName: "", department: "", jobTitle: "", startDate: "" });
  return (
    <form aria-labelledby="employee-registration-heading" action={action} className={styles.registration}>
      <h2 id="employee-registration-heading">إضافة موظف</h2>
      <fieldset className={styles.fields} disabled={pending}>
        {fields.map(field => (
          <label key={field.name}>
            {field.label}
            <input name={field.name} required
              type={"type" in field ? field.type : "text"}
              maxLength={"maxLength" in field ? field.maxLength : undefined}
              value={draft[field.name]}
              onChange={event => setDraft({ ...draft, [field.name]: event.target.value })}
            />
          </label>
        ))}
        <button type="submit">{pending ? "جارٍ الحفظ…" : "حفظ سجل الموظف"}</button>
      </fieldset>
      {message ? <p role="alert">{message}</p> : null}
    </form>
  );
}
