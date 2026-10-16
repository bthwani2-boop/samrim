"use client";

import { TextArea } from "@bthwani/design-system/web";
import { useId, useState } from "react";
import type { HRAccessRequest } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { operatorWorkspacePermissions } from "../../session/operator-permissions";

type Review = Readonly<{
  requestId: string;
  actorId: string;
  requestVersion: number;
  requestedPermissions: readonly string[];
  grantedPermissions: readonly string[];
}>;
type Props = Readonly<{ request: HRAccessRequest }>;
const labelOf = (name: string) => operatorWorkspacePermissions.find(({ key }) => key === name)?.label ?? name;

export function HRPermissionReview({ request }: Props) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [reason, setReason] = useState("اعتماد الصلاحيات وفق مهام الموظف وطلب الموارد البشرية");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = "/api/access/hr-requests/" + encodeURIComponent(request.id) + "/permissions";
  async function fetchReview() {
    const response = await identityFetch(url);
    const data = await response.json() as Review & { error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || "تعذر قراءة صلاحيات Identity");
    setReview(data);
    setSelected(data.grantedPermissions.filter((key) => data.requestedPermissions.includes(key)));
    return data;
  }
  async function expand() {
    if (open) { setOpen(false); return; }
    setOpen(true); setLoading(true); setError(""); setNotice("");
    try { await fetchReview(); } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل الصلاحيات"); }
    finally { setLoading(false); }
  }
  async function apply() {
    if (!review || reason.trim().length < 8 || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await identityFetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedPermissions: selected, reason: reason.trim(), expectedVersion: review.requestVersion }),
      });
      const data = await response.json() as Review & { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message || "تعذر تطبيق قرار الصلاحيات");
      setReview(data);
      setSelected(data.grantedPermissions.filter((key) => data.requestedPermissions.includes(key)));
      setNotice("تم تطبيق القرار في Identity وتأكيد الصلاحيات الممنوحة.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ الصلاحيات"); }
    finally { setSaving(false); }
  }
  return <div className="hr-permission-review">
    <button type="button" className="button button-secondary" onClick={() => void expand()} disabled={saving}>
      {open ? "إغلاق مراجعة الصلاحيات" : "مراجعة الصلاحيات"}
    </button>
    {open ? <section className="form-section form-section--w380" aria-label="مراجعة صلاحيات الموظف">
      {loading ? <p role="status">جارٍ قراءة الصلاحيات الممنوحة…</p> : null}
      {review ? <>
        <p>طلبت HR: {review.requestedPermissions.map(labelOf).join("، ") || "بدون صلاحيات مقترحة"}.</p>
        <p>الممنوحة فعليًا: {review.grantedPermissions.map(labelOf).join("، ") || "لا توجد صلاحيات مفعّلة"}.</p>
        {review.requestedPermissions.map((name) => <label key={name} className="field-label">
          <input type="checkbox" checked={selected.includes(name)} disabled={saving}
            onChange={(event) => setSelected((prev) => event.target.checked ? [...prev, name] : prev.filter((value) => value !== name))} />
          {labelOf(name)}
        </label>)}
        <label className="field-label" htmlFor={reasonId}>سبب القرار
          <TextArea className="resize-none" id={reasonId} value={reason} maxLength={500} rows={2} disabled={saving} onChange={(event) => setReason(event.target.value)} />
        </label>
        <button type="button" className="button button-primary" disabled={saving || reason.trim().length < 8} onClick={() => void apply()}>
          {saving ? "جارٍ تطبيق القرار…" : "تطبيق الصلاحيات المحددة"}
        </button>
      </> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section> : null}
  </div>;
}
