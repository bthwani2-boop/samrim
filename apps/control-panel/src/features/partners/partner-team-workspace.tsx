"use client";
import type { StoreAccessGrant } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import type { OperatorPartnerTeamPage } from "../../server/dsh/dsh-bff";
import { useReadOnReturn } from "../shared/use-read-on-return";

const permissionLabels: Record<string,string> = {
 orders:"الطلبات",catalog:"الكتالوج",store_operations:"التشغيل",promotions:"العروض",
 finance_read:"الاطلاع المالي",payout_request:"طلب الصرف",fulfillment:"التوصيل",
};
export function partnerTeamPermissionLabel(values:ReadonlyArray<string>):string {
 return values.map(v=>permissionLabels[v]??v).join("، ")||"لا توجد صلاحيات";
}
/** Human-facing access package inferred from the canonical permission set, not a new role. */
export function partnerTeamAccessLabel(values:ReadonlyArray<string>):string {
 const keys=new Set(values);
 if(keys.size===1&&keys.has("orders"))return "موظف طلبات";
 if(keys.size===1&&keys.has("catalog"))return "موظف كتالوج";
 if(keys.size===1&&keys.has("finance_read"))return "اطلاع مالي";
 if(["orders","catalog","store_operations","promotions","fulfillment"].every(v=>keys.has(v)))return "إدارة المتجر";
 return "صلاحيات مخصصة";
}
export function partnerTeamStateLabel(state:StoreAccessGrant["state"]):string {
 switch(state){
  case "active":return "نشط";
  case "pending_acceptance":return "بانتظار قبول الدعوة";
  case "pending_role_admission":return "بانتظار الاعتماد";
  case "pending_partner_activation":return "بانتظار تفعيل الحساب";
  case "suspended":return "موقوف";
  case "revoked":return "ملغى";
  case "declined":return "مرفوض";
  case "expired":return "منتهي";
 }
}
type Counts=OperatorPartnerTeamPage["counts"];
const emptyCounts:Counts={total:0,active:0,pending:0,suspended:0};
type Props=Readonly<{ownerId:string;storeId?:string;compact?:boolean}>;
export function PartnerTeamWorkspace({ownerId,storeId="",compact=false}:Props){
 const [items,setItems]=useState<ReadonlyArray<StoreAccessGrant>>([]);
 const [counts,setCounts]=useState<Counts>(emptyCounts);
 const [cursor,setCursor]=useState("");
 const [loading,setLoading]=useState(true);
 const [loadingMore,setLoadingMore]=useState(false);
 const [error,setError]=useState("");
 const [history,setHistory]=useState(false);
 const [revision,setRevision]=useState(0);
 const reload=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{
  let active=true;
  setItems([]);setCounts(emptyCounts);setCursor("");setError("");setLoading(true);
  const query=new URLSearchParams({limit:compact?"3":"25"});
  if(storeId)query.set("storeId",storeId);
  void identityFetch("/api/partners/roster/"+encodeURIComponent(ownerId)+"/team?"+query,{cache:"no-store"})
   .then(async r=>{if(!r.ok)throw Error("تعذر تحميل عضويات الفريق. تحقق من الصلاحيات والخدمة.");return await r.json() as OperatorPartnerTeamPage;})
   .then(page=>{if(!active)return;setItems(page.items);setCounts(page.counts);setCursor(page.nextCursor??"");})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:"تعذر تحميل فريق الشريك.");})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[ownerId,storeId,compact,revision]);
 useReadOnReturn(reload,!loading&&!loadingMore);
 const loadMore=async()=>{
  if(!cursor||loadingMore)return;
  setLoadingMore(true);setError("");
  try{
   const query=new URLSearchParams({limit:"25",cursor});
   if(storeId)query.set("storeId",storeId);
   const response=await identityFetch("/api/partners/roster/"+encodeURIComponent(ownerId)+"/team?"+query,{cache:"no-store"});
   if(!response.ok)throw Error("تعذر تحميل الصفحة التالية.");
   const page=await response.json() as OperatorPartnerTeamPage;
   setItems(previous=>[...previous,...page.items.filter(item=>!previous.some(existing=>existing.id===item.id))]);
   setCounts(page.counts);setCursor(page.nextCursor??"");
  }catch(e){setError(e instanceof Error?e.message:"تعذر المتابعة.");}
  finally{setLoadingMore(false);}
 };
 const base="/partners/actors/"+encodeURIComponent(ownerId);
 const teamUrl=base+"?view=team"+(storeId?"&storeId="+encodeURIComponent(storeId):"");
 const visible=history?items:items.filter(m=>!["revoked","declined","expired"].includes(m.state));
 const groups=new Map<string,StoreAccessGrant[]>();
 for(const grant of visible){const id=grant.delegateActorId?.trim()||grant.id;const existing=groups.get(id)||[];groups.set(id,[...existing,grant]);}
 return <div className={compact?"partner-team-workspace partner-team-compact":"partner-team-workspace"} aria-label={storeId?"فريق المتجر":"فريق الشريك"}>
  {compact?null:<div className="partner-team-heading">
   <div><h2>فريق الشريك</h2><p>العضويات والدعوات والصلاحيات المرتبطة بالمتاجر.</p></div>
   {storeId?<Link className="button button-secondary" href={base+"?view=team"}>جميع متاجر الشريك</Link>:null}
  </div>}
  {loading?<p className="muted" role="status">جارٍ تحميل الفريق…</p>:null}
  {!loading&&!error||items.length>0?<div className="partner-team-metrics">
   <div><strong>{counts.active}</strong><span>عضويات فعالة</span></div>
   <div><strong>{counts.pending}</strong><span>دعوات قيد الإجراء</span></div>
   <div><strong>{counts.suspended}</strong><span>موقوفة</span></div>
  </div>:null}
  {error?<p className="managed-status managed-status-warning" role="alert">{error} <button type="button" className="button button-secondary" onClick={reload}>إعادة المحاولة</button></p>:null}
  {!loading&&!error&&counts.total===0?<p className="muted">لا توجد عضويات أو دعوات لهذا {storeId?"المتجر":"الشريك"}.</p>:null}
  {!loading? <div className="partner-team-list">
   {[...groups.entries()].map(([id,grants])=><article className="partner-team-member" key={id}>
    <div className="partner-team-member-main">
     <strong>{grants.find(g=>g.displayNameAr?.trim())?.displayNameAr?.trim()||"عضو فريق"}</strong>
     <span className="partner-team-state">{grants.length} {grants.length===1?"عضوية":"عضويات"}</span>
    </div>
    <div className="partner-team-member-stores">{grants.map(grant=><div className="partner-team-store-access" key={grant.id}>
      <div className="partner-team-member-main">
       {!storeId?<Link href={"/partners/stores/"+encodeURIComponent(grant.storeId)}>{grant.storeName||"متجر"}</Link>:<strong>{grant.storeName||"المتجر الحالي"}</strong>}
       <span className="partner-team-state" data-state={grant.state}>{partnerTeamStateLabel(grant.state)}</span>
      </div>
      <p>{partnerTeamAccessLabel(grant.permissions)} · {partnerTeamPermissionLabel(grant.permissions)}</p>
      {!compact?<details><summary>تفاصيل الصلاحيات</summary><dl>
       <div><dt>المتجر</dt><dd>{grant.storeName}</dd></div>
       <div><dt>الصلاحيات</dt><dd>{partnerTeamPermissionLabel(grant.permissions)}</dd></div>
       <div><dt>آخر تحديث</dt><dd>{new Date(grant.updatedAt).toLocaleDateString("ar-YE")}</dd></div>
      </dl></details>:null}
     </div>)}</div>
   </article>)}
  </div>:null}
  {compact?<Link className="store-profile-action-link" href={teamUrl}>عرض فريق المتجر ←</Link>:<>
   {items.some(item=>["expired","revoked","declined"].includes(item.state))?<button type="button" className="button button-secondary" onClick={()=>setHistory(v=>!v)}>{history?"إخفاء العضويات السابقة":"عرض العضويات السابقة"}</button>:null}
   {!storeId?<p className="muted">قد توجد متاجر أخرى للعضو نفسه إذا كانت هناك صفحات إضافية؛ استخدم «عرض المزيد» للاطلاع على بقية العضويات.</p>:null}
   {cursor?<button type="button" className="button button-secondary" disabled={loadingMore} onClick={()=>void loadMore()}>{loadingMore?"جارٍ التحميل…":"عرض المزيد"}</button>:null}
  </>}
 </div>;
}
