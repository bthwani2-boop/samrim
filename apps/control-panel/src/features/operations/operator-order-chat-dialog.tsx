"use client";
import { useEffect, useRef, useState } from "react";
import { OperatorOrderConversation } from "./operator-order-conversation";
import { identityFetch } from "../../session/identity-fetch";

type Props=Readonly<{orderId:string;reference:string;status:string;summary:string;total:string}>;
export function OperatorOrderChatDialog({orderId,reference,status,summary,total}:Props){
 const [open,setOpen]=useState(false);
 const [unreadCount,setUnreadCount]=useState(0);
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  let live=true;
  setUnreadCount(0);
  if(open)return()=>{live=false;};
  const read=async()=>{
    try{
      const response=await identityFetch(`/api/operations/${encodeURIComponent(orderId)}/conversation`,{cache:"no-store"});
      if(!response.ok)return;
      const value=await response.json() as {unreadCount?:number};
      if(live&&Number.isSafeInteger(value.unreadCount)&&Number(value.unreadCount)>=0)setUnreadCount(Number(value.unreadCount));
    }catch{/* No badge when the private read fails. */}
  };
  void read();
  const poll=setInterval(()=>void read(),20000);
  return()=>{live=false;clearInterval(poll);};
 },[open,orderId]);
 useEffect(()=>{
  const node=ref.current;
  if(open&&node&&!node.open)node.showModal();
  return()=>{if(node?.open)node.close();};
 },[open]);
 return <>
  <button type="button" className="button button-secondary" aria-label={"محادثة الطلب "+reference}
    onClick={()=>setOpen(true)}>💬 محادثة الطلب {unreadCount>0?<span aria-label={unreadCount+" رسائل غير مقروءة"} style={{borderRadius:12,padding:"2px 6px",background:"var(--action,#e96831)",color:"#fff",fontSize:11}}>{unreadCount>99?"99+":unreadCount}</span>:null}</button>
  {open?<dialog ref={ref} aria-label={"محادثة الطلب "+reference} onClose={()=>setOpen(false)}
    onCancel={event=>{event.preventDefault();setOpen(false);}}
    style={{border:"1px solid var(--border-subtle)",borderRadius:18,padding:0,width:"min(620px, 96vw)",
      maxHeight:"90vh",background:"var(--surface)",color:"var(--text)",boxShadow:"0 20px 80px #0008"}}>
    <div style={{display:"grid",gridTemplateRows:"auto auto minmax(0, 1fr)",maxHeight:"90vh",minHeight:"min(65vh, 580px)",direction:"rtl"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:14,borderBottom:"1px solid var(--border-subtle)"}}>
        <div style={{minWidth:0}}>
          <strong>محادثة الطلب #{reference}</strong>
          <div className="muted" style={{fontSize:12,marginTop:3}}>{status}</div>
        </div>
        <button type="button" className="button button-secondary" onClick={()=>setOpen(false)}>إغلاق</button>
      </div>
      <div style={{margin:12,padding:10,border:"1px solid var(--border-subtle)",borderRadius:12,display:"grid",gap:7}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><span>{summary}</span><strong>{total}</strong></div>
        <button type="button" style={{width:"fit-content",background:"none",border:0,color:"var(--interactive-text)",cursor:"pointer",fontWeight:700}}
          onClick={()=>setOpen(false)}>عرض تفاصيل الطلب ←</button>
      </div>
      <div style={{overflowY:"auto",padding:"0 12px 24px"}}><OperatorOrderConversation orderId={orderId}/></div>
    </div>
  </dialog>:null}
 </>;
}
