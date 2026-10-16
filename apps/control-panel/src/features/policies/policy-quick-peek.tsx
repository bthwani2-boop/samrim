"use client";
import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useState } from "react";
import type { OperatorPolicyChange } from "../../server/dsh/dsh-bff";
import type { PolicyCapability } from "./policy-capabilities";


function formatHistoryValue(field: string, value: string) {
  if (field !== "شرائح المسافة") return value;
  if (!value) return "نسخة تسعير سابقة";
  try {
    const bands = JSON.parse(value) as unknown;
    if (!Array.isArray(bands)) return "بيانات شرائح غير قابلة للعرض";
    const result: string[] = [];
    let start = 0;
    for (const band of bands) {
      if (!band || typeof band !== "object") return "بيانات شرائح غير قابلة للعرض";
      const entry = band as { upToMeters?: unknown; ratePerKmMinor?: unknown };
      if (!Number.isSafeInteger(entry.ratePerKmMinor)) return "بيانات شرائح غير قابلة للعرض";
      const end = entry.upToMeters === null ? "∞" : Number(entry.upToMeters) / 1000;
      result.push(`${start}–${end} كم: ${entry.ratePerKmMinor} ريال/كم`);
      if (entry.upToMeters !== null) start = Number(entry.upToMeters) / 1000;
    }
    return result.join(" · ");
  } catch {
    return "بيانات شرائح غير قابلة للعرض";
  }
}

export type PolicyListPreview = Readonly<{
  active: number | null;
  inactive: number | null;
  headline?: string;
  note?: string;
  records: ReadonlyArray<Readonly<{
    id: string;
    name: string;
    active: boolean;
    updatedAt?: string;
    version?: number;
    detail?: string;
    createdAt?: string;
    createdBy?: string;
  }>>;
}>;
export type PolicyPreviewState = Readonly<{
  kind: "loading" | "ready" | "error" | "missing" | "restricted";
  value?: PolicyListPreview;
}>;

export function PolicyQuickPeek({ policy, preview, position, containerRef, onClose }: Readonly<{
  policy: PolicyCapability;
  preview: PolicyPreviewState | undefined;
  position: CSSProperties;
  containerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}>) {
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    // Position is measured from the trigger; the stylesheet owns all fixed visual rules.
    if (typeof position.left === "number") element.style.left = `${position.left}px`;
    if (typeof position.top === "number") element.style.top = `${position.top}px`;
    if (typeof position.width === "number") element.style.width = `${position.width}px`;
  }, [position, containerRef]);
  const hasList = policy.list !== null || policy.owner === "WLT";
  const [history,setHistory]=useState<readonly OperatorPolicyChange[]>([]);
  const [historyState,setHistoryState]=useState<"loading"|"ready"|"error"|"restricted">("loading");
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{
    if(preview?.kind==="restricted"){setHistoryState("restricted");return;}
    const controller=new AbortController();
    setHistoryState("loading");setExpanded(false);
    void fetch(`/api/finance/policy-history?key=${encodeURIComponent(policy.key)}`,{cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error("history unavailable");
      const body=await response.json() as {items?:OperatorPolicyChange[]};
      if(!Array.isArray(body.items))throw new Error("history shape invalid");
      if(!controller.signal.aborted){setHistory(body.items);setHistoryState("ready");}
    }).catch(()=>{if(!controller.signal.aborted)setHistoryState("error");});
    return ()=>controller.abort();
  },[policy.key,preview?.kind]);
  return <div className="policy-quick-peek" role="dialog" aria-label={`معاينة ${policy.label}`}
    ref={containerRef} tabIndex={-1} data-testid="policy-quick-peek">
    <header className="policy-quick-peek-head">
      <strong>{policy.label}</strong>
      <button type="button" className="policy-quick-peek-close" aria-label="إغلاق المعاينة" onClick={onClose}>×</button>
    </header>
    <p className="policy-quick-peek-subtitle">{policy.summary}</p>
    {hasList ? <>
      {preview?.kind === "ready" && preview.value ? <>
        <div className="policy-quick-peek-counts">
          {preview.value.active !== null ? <span>{preview.value.active} نشطة</span> : null}
          {preview.value.inactive !== null ? <span>{preview.value.inactive} متوقفة</span> : null}
          {preview.value.headline ? <strong>{preview.value.headline}</strong> : null}
        </div>
        <ul className="policy-quick-peek-records" aria-label="عينة من السجلات">
          {preview.value.records.slice(0, 5).map((item) => <li key={item.id}>
            <span>{item.name}{item.detail ? <small> · {item.detail}</small> : null}
              {item.version ? <small> · v{item.version}</small> : null}
              {item.createdAt ? <small> · {new Date(item.createdAt).toLocaleDateString("ar-YE")}</small> : null}
            </span>
            <span className="policy-quick-peek-record-status">{item.active ? "نشطة" : "متوقفة"}</span>
          </li>)}
        </ul>
        {(preview.value.active ?? 0) + (preview.value.inactive ?? 0) > preview.value.records.length
          ? <p className="muted policy-quick-peek-hint">هذه معاينة موجزة، وليست جميع السجلات.</p> : null}
        {!preview.value.records.length ? <p className="muted policy-quick-peek-hint">لا توجد سجلات بعد.</p> : null}
        {preview.value.note ? <p className="muted policy-quick-peek-hint">{preview.value.note}</p> : null}
      </> : <p className="muted policy-quick-peek-hint" role="status">
        {preview?.kind === "error" ? "تعذرت قراءة السجلات. لا تعني هذه الحالة أن عددها صفر."
        : preview?.kind === "restricted" ? "هذه السياسة تتطلب صلاحية المالية."
        : preview?.kind === "missing" ? "لم تُعتمد سياسة سارية لهذا النوع بعد."
        : "جارٍ قراءة البيانات المعتمدة…"}
      </p>}
    </> : <p className="muted policy-quick-peek-hint">
      لا تتوفر قراءة مجمعة موثوقة لهذا النوع حتى الآن.
    </p>}
    <div className="policy-quick-peek-history">
      <strong>آخر التغييرات الموثقة</strong>
      {historyState==="loading"?<p className="muted" role="status">جارٍ قراءة السجل…</p>
       :historyState==="restricted"?<p className="muted">سجل التغييرات يتطلب الصلاحية المناسبة.</p>
       :historyState==="error"?<p className="muted" role="status">تعذرت قراءة سجل التغييرات.</p>
       :history.length===0?<p className="muted">لا توجد أحداث محفوظة لهذا النوع حتى الآن.</p>
       :<>
        <ol>
          {history.slice(0,expanded?50:2).map(change=><li key={change.id+"-"+change.scopeId}>
            <span>{change.field} · v{change.version} · {new Date(change.createdAt).toLocaleString("ar-YE")}</span>
            <small>{change.before ? formatHistoryValue(change.field,change.before)+" ← " : ""}{formatHistoryValue(change.field,change.after)}</small>
            {change.reason ? <small>{change.reason}</small> : null}
            <details><summary>بيانات التدقيق</summary><small>معرّف منفذ التغيير: <bdi dir="ltr">{change.actorId}</bdi></small></details>
          </li>)}
        </ol>
        {history.length>2?<button type="button" className="policy-quick-peek-history-toggle" onClick={()=>setExpanded(v=>!v)}>
          {expanded?"عرض الأحدث فقط":`عرض آخر ${history.length} تغييرًا`}
        </button>:null}
       </>}
    </div>
    <div className="policy-quick-peek-foot">
      <span>{policy.owner} · {policy.scope}</span>

    </div>
  </div>;
}
