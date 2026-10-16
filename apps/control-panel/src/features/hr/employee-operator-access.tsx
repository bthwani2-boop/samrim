"use client";

import { TextArea } from "@bthwani/design-system/web";
import { useState } from "react";
import type { HREmployee } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";

type Role = Readonly<{ enabled: boolean; roleVersion: number; activatedAt?: string; actorId: string }>;
type Readback = Readonly<{ employee: HREmployee; role: Role; error?: { message?: string } }>;

export function EmployeeOperatorAccess({ employee }: Readonly<{ employee: HREmployee }>) {
  const { state } = useSession();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = state.kind === "authenticated" && state.identity.canManageOperatorPermissions;
  if (!employee.operatorActorId || !canManage) return null;
  const url = "/api/hr/employees/" + encodeURIComponent(employee.id) + "/operator-access";
  async function refresh() {
    const response = await identityFetch(url);
    const result = await response.json() as Readback;
    if (!response.ok) throw new Error(result.error?.message || "تعذر قراءة حالة وصول الموظف");
    if (result.employee.id !== employee.id || result.role.actorId !== employee.operatorActorId) throw new Error("بيانات الوصول غير متطابقة");
    setRole(result.role);
  }
  async function toggle() {
    if (!role || saving || reason.trim().length < 8) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const action = role.enabled ? "disable" : "enable";
      const response = await identityFetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedVersion: role.roleVersion, reason: reason.trim() }),
      });
      const result = await response.json() as Readback;
      if (!response.ok) {
        await refresh();
        throw new Error(result.error?.message || "تعذر تغيير صلاحية تشغيل الموظف");
      }
      setRole(result.role);
      setReason("");
      setNotice(result.role.enabled ? "أعيد منح وصول التشغيل. لا تُستعاد الجلسات السابقة تلقائيًا." : "أوقف وصول التشغيل وأبطلت جلساته النشطة. يظل سجل الموظف في الموارد البشرية.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تطبيق القرار"); }
    finally { setSaving(false); }
  }
  return <section className="form-section form-section--w480" aria-label="صلاحية تشغيل الموظف">
    <div className="form-actions">
      <button type="button" className="button button-secondary" disabled={saving} onClick={() => {
        if (expanded) { setExpanded(false); return; }
        setExpanded(true); setLoading(true); setError(""); setNotice("");
        void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "تعذر قراءة حالة الوصول")).finally(() => setLoading(false));
      }}>{expanded ? "إغلاق إدارة الوصول" : "إدارة صلاحية تشغيل الموظف"}</button>
    </div>
    {expanded ? <>
      {loading ? <p role="status">جارٍ التحقق من Identity…</p> : null}
      {role ? <>
        <p>الحالة في Identity: <strong>{role.enabled ? "وصول التشغيل مفعّل" : "وصول التشغيل موقوف"}</strong>.</p>
        <p className="muted">إيقاف التشغيل لا ينهي خدمة الموظف ولا يحذف ملفه أو حسابه. إعادة التفعيل لا تُعيد الجلسات القديمة.</p>
        <label className="field-label" htmlFor="employee-operator-access-reason">سبب قرار صلاحية التشغيل
          <TextArea className="resize-none" id="employee-operator-access-reason" rows={2} maxLength={500} value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} />
        </label>
        <button type="button" className="button button-secondary" disabled={saving || reason.trim().length < 8} onClick={() => void toggle()}>
          {saving ? "جارٍ التنفيذ…" : role.enabled ? "إيقاف وصول التشغيل وإبطال الجلسات" : "إعادة تفعيل وصول التشغيل"}
        </button>
      </> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </> : null}
  </section>;
}
