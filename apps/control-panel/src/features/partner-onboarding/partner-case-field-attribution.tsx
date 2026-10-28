"use client";

import { useState } from "react";
import { useSession } from "../../session/session-provider";
import { stablePartnerMutationHeaders } from "../partners/partner-request";
import { partnerErrorMessage } from "../partners/partner-error-message";

type EligibleField=Readonly<{actorId:string;name:string;phone:string}>;
type FieldPageItem=Readonly<{kind?:string;account?:{actorId?:string;phoneE164?:string;enabled?:boolean;securityEnabled?:boolean;activatedAt?:string|null;admission?:{state?:string;fullNameAr?:string;allServiceCities?:boolean;serviceCityIds?:string[]}|null}}>;

export function PartnerCaseFieldAttribution({caseId,serviceCityId,version,onUpdated}:Readonly<{caseId:string;serviceCityId:string;version:number;onUpdated:()=>void}>){
  const {state}=useSession();
  const operatorId=state.kind==="authenticated"?state.identity.subject:"";
  const [query,setQuery]=useState("");
  const [fields,setFields]=useState<readonly EligibleField[]>([]);
  const [selected,setSelected]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [searching,setSearching]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  async function search(){
    if(searching || query.trim().length<2 || !operatorId)return;
    setSearching(true);setError("");setFields([]);setSelected("");
    try{
      const qs=new URLSearchParams({scope:"workbench",limit:"25",q:query.trim(),enabled:"true",serviceCityId});
      const response=await fetch(`/api/fields?${qs.toString()}`,{cache:"no-store"});
      if(!response.ok)throw new Error(await partnerErrorMessage(response));
      const body=await response.json() as {items?:FieldPageItem[]};
      if(!Array.isArray(body.items))throw new Error("تعذرت قراءة سجل الميدانيين.");
      const list=body.items.filter((x):x is FieldPageItem&{account:NonNullable<FieldPageItem["account"]>}=>x?.kind==="account"&&!!x.account)
        .filter(x=>x.account.enabled===true&&x.account.securityEnabled===true&&!!x.account.activatedAt&&x.account.admission?.state==="eligible"&&
          (x.account.admission.allServiceCities===true||x.account.admission.serviceCityIds?.includes(serviceCityId)===true))
        .filter(x=>typeof x.account.actorId==="string"&&x.account.actorId.length>0)
        .map(x=>({actorId:x.account.actorId as string,name:x.account.admission?.fullNameAr||"ميداني",phone:x.account.phoneE164||""}));
      setFields(list);
      if(!list.length)setNotice("لا يوجد ميداني مؤهل مطابق. عدّل البحث أو راجع سجل الميدانيين.");
      else setNotice("");
    }catch(e){setError(e instanceof Error?e.message:"تعذر البحث عن الميدانيين.");}
    finally{setSearching(false)}
  }
  async function attribute(){
    if(busy||!operatorId||!selected||Array.from(reason.trim()).length<8||Array.from(reason.trim()).length>400)return;
    setBusy(true);setNotice("");setError("");
    try{
      const headers=await stablePartnerMutationHeaders(`case-attribution:${operatorId}:${caseId}:${selected}:${version}`);
      const response=await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/acquisition-attribution`,{
        method:"POST",headers,body:JSON.stringify({fieldActorId:selected,reason:reason.trim(),expectedVersion:version})
      });
      if(!response.ok)throw new Error(await partnerErrorMessage(response));
      const result=await response.json() as {case?:{id?:string;origin?:string;originatingFieldActorId?:string;version?:number}};
      if(result.case?.id!==caseId || result.case.origin!=="control_panel" || result.case.originatingFieldActorId!==selected || result.case.version!==version+1){
        throw new Error("يجب إعادة قراءة الملف للتحقق من إسناد الميداني.");
      }
      setNotice("حُفظ إسناد الاستقطاب في ملف الشريك مع بقاء مسؤولية التسجيل لدى قسم الشركاء.");
      onUpdated();
    }catch(e){
      onUpdated();
      setError(e instanceof Error?e.message:"لم تتأكد نتيجة الإسناد. اقرأ الملف قبل أي محاولة جديدة.");
    }finally{setBusy(false)}
  }
  return <details className="partner-case-attachments">
    <summary>إسناد الاستقطاب لميداني (اختياري)</summary>
    <p>هذا الإسناد يحفظ مصدر استقطاب المتجر ولا يمنح الميداني صلاحية إدارته. يمكن إثباته مرة واحدة فقط قبل اعتماد المتجر، بعد التحقق من الزيارة أو رابط الدعوة.</p>
    <div className="action-row">
      <label className="field-label" htmlFor="case-attribution-search">بحث باسم الميداني أو هاتفه
        <input id="case-attribution-search" type="search" value={query} onChange={e=>setQuery(e.target.value)} minLength={2} maxLength={128} disabled={busy||searching} />
      </label>
      <button className="button button-secondary" type="button" disabled={busy||searching||query.trim().length<2} onClick={()=>void search()}>{searching?"جارٍ البحث…":"بحث"}</button>
    </div>
    {fields.length>0?<label className="field-label" htmlFor="case-attribution-field">الميداني المؤهل
      <select id="case-attribution-field" value={selected} onChange={e=>setSelected(e.target.value)} disabled={busy}>
        <option value="">اختر الميداني</option>
        {fields.map(field=><option key={field.actorId} value={field.actorId}>{field.name} — {field.phone}</option>)}
      </select>
    </label>:null}
    {selected?<label className="field-label" htmlFor="case-attribution-reason">دليل الاستقطاب وسبب الإسناد
      <textarea id="case-attribution-reason" rows={2} maxLength={400} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy} placeholder="مثال: زيارة ميدانية موثقة ورابط الدعوة المُسلَّم لصاحب المتجر" />
    </label>:null}
    {selected?<button type="button" className="button button-primary" disabled={busy||Array.from(reason.trim()).length<8} onClick={()=>void attribute()}>{busy?"جارٍ تسجيل الإسناد…":"حفظ إسناد الاستقطاب"}</button>:null}
    {notice?<p role="status">{notice}</p>:null}
    {error?<p className="identity-error" role="alert">{error}</p>:null}
  </details>;
}
