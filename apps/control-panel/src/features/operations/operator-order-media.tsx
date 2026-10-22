"use client";
import { useState } from "react";
import { identityFetch } from "../../session/identity-fetch";

export function OperatorOrderMedia({orderId,messageId,kind}: Readonly<{orderId:string;messageId:string;kind:string|undefined}>) {
  const [dataUri,setDataUri]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  if (!kind) return null;
  async function open() {
    if (loading) return;
    setLoading(true);setError("");
    try {
      const path=`/api/operations/${encodeURIComponent(orderId)}/conversation/messages/${encodeURIComponent(messageId)}/media`;
      const response=await identityFetch(path,{cache:"no-store"});
      if (!response.ok) throw new Error("MEDIA_FORBIDDEN");
      const value=await response.json() as {mediaKind:string;contentType:string;dataBase64:string};
      if (value.mediaKind!==kind || !value.dataBase64) throw new Error("INVALID_MEDIA");
      setDataUri("data:"+value.contentType+";base64,"+value.dataBase64);
    } catch {setError("تعذر فتح المرفق. تحقق من صلاحيات الطلب.");}
    finally {setLoading(false);}
  }
  return <div style={{display:"grid",gap:6,justifyItems:"start"}}>
    <button className="button button-secondary" type="button" disabled={loading} onClick={()=>void open()}>{loading?"جارٍ القراءة…":kind==="image"?"عرض الصورة":"تشغيل الصوت"}</button>
    {dataUri && kind==="image" ? <img alt="صورة مرفقة خاصة بالطلب" src={dataUri} style={{maxWidth:240,maxHeight:200,objectFit:"contain"}}/> : null}
    {dataUri && kind==="audio" ? <audio src={dataUri} controls preload="none"/> : null}
    {error ? <span role="alert">{error}</span> : null}
  </div>;
}
