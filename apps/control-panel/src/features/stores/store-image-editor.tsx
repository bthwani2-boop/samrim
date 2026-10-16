"use client";
import { isMediaProvenanceInputValid, type MediaProvenanceInput, type StoreImagesResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { partnerErrorMessage } from "../partners/partner-error-message";
import { StoreLogo } from "./store-logo";

const emptyProvenance: MediaProvenanceInput={creator:"",sourceDescription:"",sourceUri:"",rightsStatement:"",rightsUri:"",rightsAttested:false};
export function StoreImageEditor({storeId,name,onSaved,initialRole="primary",lockedRole=false}: {storeId:string;name:string;onSaved:()=>void;initialRole?:"primary"|"cover";lockedRole?:boolean}) {
 const [current,setCurrent]=useState<StoreImagesResponse|null>(null);
 const [role,setRole]=useState<"primary"|"cover">(initialRole);
 const [file,setFile]=useState<File|null>(null);
 const [preview,setPreview]=useState("");
 const [provenance,setProvenance]=useState(emptyProvenance);
 const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState("");
 const endpoint=`/api/stores/${encodeURIComponent(storeId)}/images`;
 const read=useCallback(async()=>{ const response=await fetch(endpoint,{cache:"no-store"}); if(!response.ok) throw new Error(await partnerErrorMessage(response)); return response.json() as Promise<StoreImagesResponse>; },[endpoint]);
 useEffect(()=>{ let active=true; void read().then(next=>{if(active)setCurrent(next);}).catch(()=>{if(active)setError("تعذرت قراءة صور المتجر. أعد المحاولة.");});return()=>{active=false;};},[read]);
 useEffect(()=>{ if(!file){setPreview("");return;}const uri=URL.createObjectURL(file);setPreview(uri);return()=>URL.revokeObjectURL(uri);},[file]);
 async function save() {
  if(!file||!current||busy) return;
  if(!isMediaProvenanceInputValid(provenance)){setError("أكمل منشئ الصورة ومصدرها وحق استخدامها وأكّد التصريح.");return;}
  setBusy(true);setError("");setNotice("");
  const selected=file;
  try {
   const digest=await crypto.subtle.digest("SHA-256",await selected.arrayBuffer());
   const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
   const matches=(next:StoreImagesResponse)=>{const asset=role==="cover"?next.storeCoverImage:next.storeProfileImage;return next.storeId===storeId&&asset?.contentSha256===hash&&asset.provenance?.creator===provenance.creator.trim()&&asset.provenance?.sourceDescription===provenance.sourceDescription.trim()&&asset.provenance?.rightsStatement===provenance.rightsStatement.trim()&&(asset.provenance?.sourceUri??"")===(provenance.sourceUri??"").trim()&&(asset.provenance?.rightsUri??"")===(provenance.rightsUri??"").trim()&&Boolean(asset.provenance?.attestedAt);};
   const identityHash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${storeId}:${current.version}:${role}:${hash}:${JSON.stringify(provenance)}`));
   const identity=Array.from(new Uint8Array(identityHash),b=>b.toString(16).padStart(2,"0")).join("");
   const form=new FormData();form.append("file",selected);form.append("role",role);for(const [key,value]of Object.entries(provenance))form.append(key,String(value));
   let failure="";
   try {const response=await fetch(endpoint,{method:"POST",headers:{"Idempotency-Key":`store_image_${identity}`,"X-Correlation-ID":`store_image_corr_${identity}`,"X-Expected-Version":String(current.version)},body:form});if(!response.ok)failure=await partnerErrorMessage(response);} catch {failure="تعذر الاتصال أثناء حفظ الصورة.";}
   const latest=await read();setCurrent(latest);
   if(!matches(latest))throw new Error(failure||"تعذر تأكيد حفظ الصورة. أعد المحاولة بالصورة نفسها.");
   setFile(null);setProvenance(emptyProvenance);setNotice("حُفظت الصورة وأُكدت من سجل المتجر.");
   onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:"تعذر حفظ الصورة. أعد المحاولة.");}finally{setBusy(false);}
 }
 const selectedAsset=role==="cover"?current?.storeCoverImage:current?.storeProfileImage;
 const label=role==="cover"?"الغلاف":"الشعار";
 return <section className="store-detail-section" aria-labelledby="store-images-title">
  <h2 id="store-images-title">صور واجهة المتجر</h2>
  {lockedRole ? null : <fieldset className="button-row store-image-role"><legend>نوع الصورة</legend>{(["primary","cover"] as const).map(value=><button key={value} type="button" className={`button ${role===value?"button-primary":"button-secondary"}`} disabled={busy} aria-pressed={role===value} onClick={()=>{setRole(value);setFile(null);setProvenance(emptyProvenance);setError("");setNotice("");}}>{value==="cover"?"الغلاف":"الشعار"}</button>)}</fieldset>}
  {selectedAsset?(role==="cover"?<img src={selectedAsset.uri} alt={`غلاف المتجر ${name}`} className="store-cover-preview"/>:<StoreLogo name={name} uri={selectedAsset.uri} imageLabel={label} allowPreview={false}/>):<p className="muted">{current?`لم يُرفق ${label} بعد.`:"جارٍ قراءة صور المتجر…"}</p>}
  {preview?(role==="cover"?<img src={preview} alt={`معاينة غلاف المتجر ${name}`} className="store-cover-preview"/>:<StoreLogo name={name} uri={preview} imageLabel={`معاينة ${label} الجديد`} allowPreview={false}/>):null}
  <form noValidate onSubmit={event=>{event.preventDefault();void save();}}>
   <fieldset disabled={busy||!current}><legend>إضافة أو استبدال {label}</legend>
    <label>الصورة (JPG أو PNG، حتى 10 ميغابايت)<input key={role} type="file" accept="image/jpeg,image/png" onChange={event=>{const next=event.target.files?.[0];if(!next)return;if(next.size<1||next.size>10*1024*1024||!["image/jpeg","image/png"].includes(next.type)){setError("اختر JPG أو PNG لا يتجاوز 10 ميغابايت.");return;}setFile(next);setError("");setNotice("");}}/></label>
    {file?<>{([ ["creator","منشئ الصورة"],["sourceDescription","مصدر الصورة"],["sourceUri","رابط المصدر (اختياري)"],["rightsStatement","حق استخدام الصورة"],["rightsUri","رابط الترخيص (اختياري)"]] as const).map(([key,title])=><label key={key}>{title}<input type={key.endsWith("Uri")?"url":"text"} value={provenance[key]??""} onChange={event=>setProvenance(previous=>({...previous,[key]:event.target.value}))}/></label>)}<label><input type="checkbox" checked={provenance.rightsAttested} onChange={event=>setProvenance(previous=>({...previous,rightsAttested:event.target.checked}))}/>أؤكد صحة بيانات المصدر وحق الاستخدام.</label><div className="button-row"><button className="button button-primary" type="submit" disabled={!isMediaProvenanceInputValid(provenance)}>{busy?"جارٍ الحفظ…":`حفظ ${label}`}</button><button type="button" className="button button-secondary" onClick={()=>{setFile(null);setProvenance(emptyProvenance);setError("");}}>إلغاء التغيير</button></div></>:null}
   </fieldset>
  </form>
  {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  <button className="button button-secondary" type="button" disabled={busy} onClick={()=>void read().then(next=>{setCurrent(next);setError("");}).catch(()=>setError("تعذرت قراءة الصور. أعد المحاولة."))}>إعادة قراءة الصور</button>
 </section>;
}
