"use client";
import { useRef, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";

type Attempt = Readonly<{body:string;mediaKind:"image"|"audio"|"video";mediaContentType:string;mediaBase64:string;recipients:string[];key:string}>;
const imageMimes=new Set(["image/jpeg","image/png","image/webp"]);
const audioMimes=new Set(["audio/mp4","audio/m4a","audio/3gpp","audio/webm","audio/aac"]);
const videoMimes=new Set(["video/mp4","video/webm"]);
async function toBase64(file:File):Promise<string>{
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      if(typeof reader.result!=="string")return reject(new Error("MEDIA_READ_FAILED"));
      const start=reader.result.indexOf(",");
      if(start<0)return reject(new Error("MEDIA_READ_FAILED"));
      resolve(reader.result.slice(start+1));
    };
    reader.onerror=()=>reject(new Error("MEDIA_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}
export function OperatorOrderChatAttachments({orderId,recipients,onSent,disabled=false}:Readonly<{
  orderId:string;recipients:ReadonlyArray<string>;onSent:()=>void;disabled?:boolean;
}>){
  const imageInput=useRef<HTMLInputElement>(null);
  const audioInput=useRef<HTMLInputElement>(null);
  const videoInput=useRef<HTMLInputElement>(null);
  const pending=useRef<Attempt|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(false);
  async function submit(attempt:Attempt){
    setBusy(true);setError("");
    try{
      const response=await identityFetch(`/api/operations/${encodeURIComponent(orderId)}/conversation`,{
        method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":attempt.key},
        body:JSON.stringify({body:attempt.body,recipientRoles:attempt.recipients,
          mediaKind:attempt.mediaKind,mediaContentType:attempt.mediaContentType,mediaBase64:attempt.mediaBase64}),
      });
      if(!response.ok){
        if(response.status>=400&&response.status<500)pending.current=null;
        throw new Error("SEND_FAILED");
      }
      pending.current=null;setRetry(false);onSent();
    }catch{
      setRetry(Boolean(pending.current));
      setError(pending.current?"تعذر تأكيد الإرسال. يمكنك إعادة المحاولة دون تكرار المرفق.":"تعذر إرسال المرفق. تحقق من النوع والحجم والصلاحيات.");
    }finally{setBusy(false);}
  }
  async function selected(file:File|undefined,kind:"image"|"audio"|"video"){
    if(!file||disabled||busy||pending.current)return;
    if(!recipients.length){setError("حدد المستلمين قبل إرسال المرفق.");return;}
    const mimes=kind==="image"?imageMimes:kind==="video"?videoMimes:audioMimes;
    const sizeLimit=kind==="image"?3*1024*1024:kind==="video"?6*1024*1024:1536*1024;
    if(!mimes.has(file.type)||file.size<12||file.size>sizeLimit){
      setError("نوع المرفق أو حجمه غير مدعوم. الصور حتى 3MB، والصوت حتى 1.5MB، والفيديو حتى 6MB.");return;
    }
    setBusy(true);
    try{
      const attempt:Attempt={
        body:kind==="image"?"صورة من العمليات":kind==="video"?"فيديو من العمليات":"رسالة صوتية من العمليات",
        mediaKind:kind,mediaContentType:file.type,mediaBase64:await toBase64(file),
        recipients:[...recipients].sort(),key:crypto.randomUUID(),
      };
      pending.current=attempt;
      await submit(attempt);
    }catch{setError("تعذر قراءة المرفق.");setBusy(false);}
  }
  return <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8}}>
    <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}}
      onChange={event=>{void selected(event.currentTarget.files?.[0],"image");event.currentTarget.value="";}}/>
    <input ref={audioInput} type="file" accept="audio/mp4,audio/m4a,audio/3gpp,audio/webm,audio/aac" style={{display:"none"}}
      onChange={event=>{void selected(event.currentTarget.files?.[0],"audio");event.currentTarget.value="";}}/>
    <button type="button" className="button button-secondary" disabled={disabled||busy||Boolean(pending.current)}
      onClick={()=>imageInput.current?.click()}>صورة / كاميرا</button>
    <input ref={videoInput} type="file" accept="video/mp4,video/webm" style={{display:"none"}}
      onChange={event=>{void selected(event.currentTarget.files?.[0],"video");event.currentTarget.value="";}}/>
    <button type="button" className="button button-secondary" disabled={disabled||busy||Boolean(pending.current)}
      onClick={()=>audioInput.current?.click()}>مقطع صوتي</button>
    <button type="button" className="button button-secondary" disabled={disabled||busy||Boolean(pending.current)}
      onClick={()=>videoInput.current?.click()}>فيديو قصير</button>
    {retry?<button type="button" className="button button-secondary" disabled={busy} onClick={()=>{if(pending.current)void submit(pending.current);}}>إعادة الإرسال</button>:null}
    {error?<span role="alert" style={{fontSize:12}}>{error}</span>:null}
  </div>;
}
