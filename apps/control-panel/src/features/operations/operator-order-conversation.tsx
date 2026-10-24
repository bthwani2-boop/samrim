"use client";

import type { OrderConversationResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { OperatorOrderMedia } from "./operator-order-media";

const roles = [
  { key: "client", label: "العميل" },
  { key: "partner", label: "المتجر" },
  { key: "captain", label: "الكابتن" },
] as const;
type Recipient = typeof roles[number]["key"];
const who=(role:string)=>role==="operator"?"العمليات":roles.find(item=>item.key===role)?.label??"مستخدم";

export function OperatorOrderConversation({ orderId }: Readonly<{ orderId: string }>) {
  const [conversation, setConversation] = useState<OrderConversationResponse | null>(null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<ReadonlyArray<Recipient>>([]);
  const [recipientOpen,setRecipientOpen]=useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const pending = useRef<{ body: string; recipients: string; key: string } | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const run = ++sequence.current;
    try {
      const response = await identityFetch(`/api/operations/${encodeURIComponent(orderId)}/conversation`, { cache: "no-store" });
      if (!response.ok) throw new Error("تعذر قراءة مراسلة الطلب.");
      const value = await response.json() as OrderConversationResponse;
      if (run !== sequence.current) return;
      setConversation(value);
      setError("");
    } catch {
      if (run === sequence.current) setError("تعذر قراءة مراسلة الطلب؛ لا يمكن الرد دون سجل محدث.");
    }
  }, [orderId]);

  useEffect(() => {
    setConversation(null);
    setRecipientOpen(false);
    setBody("");
    pending.current = null;
    void load();
    return () => { sequence.current += 1; };
  }, [load]);

  async function loadOlder() {
    const before = conversation?.nextCursor;
    if (!before || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const response = await identityFetch(`/api/operations/${encodeURIComponent(orderId)}/conversation?before=${encodeURIComponent(before)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("CONVERSATION_HISTORY_UNAVAILABLE");
      const page = await response.json() as OrderConversationResponse;
      setConversation(current => {
        if (!current || current.nextCursor !== before) return current;
        const existing = new Set(current.messages.map(message => message.id));
        return { ...current, messages: [...page.messages.filter(message => !existing.has(message.id)), ...current.messages], nextCursor: page.nextCursor ?? "" };
      });
    } catch { setError("تعذر تحميل الرسائل الأقدم؛ يمكنك إعادة المحاولة."); }
    finally { setLoadingOlder(false); }
  }

  async function send() {
    const message = body.trim();
    const chosen = [...recipients].sort();
    if (!conversation?.canSend || busy || !message || !chosen.length) return;
    const fingerprint = message + ":" + chosen.join(",");
    if (pending.current && pending.current.body + ":" + pending.current.recipients !== fingerprint) {
      setError("هناك محاولة إرسال لم تتأكد نتيجتها. أعد إرسالها كما هي قبل تغيير الرسالة.");
      return;
    }
    const attempt = pending.current ?? { body: message, recipients: chosen.join(","), key: crypto.randomUUID() };
    pending.current = attempt;
    setBusy(true);
    try {
      const response = await identityFetch(`/api/operations/${encodeURIComponent(orderId)}/conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
        body: JSON.stringify({ body: attempt.body, recipientRoles: attempt.recipients.split(",") }),
      });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) pending.current = null;
        throw new Error("تعذر تأكيد إرسال الرد. راجع الرسالة وحاول مجددًا.");
      }
      pending.current = null;
      setBody("");
      await load();
    } catch {
      setError("لم تُؤكد نتيجة الإرسال؛ أعد المحاولة بنفس النص والمستلمين دون إرسال رسالة جديدة.");
    } finally { setBusy(false); }
  }

  const canCaptain = conversation && ["CAPTAIN_ASSIGNED", "IN_CUSTODY", "DELIVERY_FAILED"].includes(conversation.orderState);
  const available = roles.filter(item => item.key !== "captain" || canCaptain);
  return <section aria-label="محادثة الطلب" style={{display:"grid",gap:10,minWidth:0}}>
    {error?<p role="alert" className="muted">{error}</p>:null}
    {!conversation?<p className="muted">جارٍ تحميل المحادثة…</p>:<>
      {conversation.nextCursor?<button className="button button-secondary" type="button" disabled={loadingOlder} onClick={()=>void loadOlder()}>{loadingOlder?"جارٍ التحميل…":"الرسائل السابقة"}</button>:null}
      <div role="log" aria-label="رسائل الطلب" style={{display:"grid",gap:9,alignContent:"start",minHeight:140}}>
        {!conversation.messages.length?<p className="muted" style={{textAlign:"center",padding:30}}>ابدأ المحادثة حول هذا الطلب.</p>:null}
        {conversation.messages.map(message=><div key={message.id}
          style={{justifySelf:message.mine?"start":"end",maxWidth:"86%",padding:"9px 12px",borderRadius:14,
            background:message.mine?"var(--surface-raised, #243246)":"var(--surface-muted, #18243a)",
            border:"1px solid var(--border-subtle)"}}>
          <strong style={{fontSize:11}}>{who(message.senderRole)}</strong>
          <p style={{margin:"5px 0",whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{message.body}</p>
          <OperatorOrderMedia orderId={orderId} messageId={message.id} kind={message.mediaKind} body={message.body}/>
          <small className="muted">{message.recipientRoles.map(who).join("، ")} · {new Date(message.createdAt).toLocaleString("ar-YE")}</small>
        </div>)}
      </div>
      {conversation.canSend?<div style={{position:"sticky",bottom:0,background:"var(--surface)",padding:"10px 0",display:"grid",gap:8,borderTop:"1px solid var(--border-subtle)"}}>
        <button type="button" className="button button-secondary" style={{justifySelf:"start"}}
          aria-expanded={recipientOpen} onClick={()=>setRecipientOpen(v=>!v)}>
          {"إلى: "+(recipients.length===0?"اختر المستلم":recipients.length===available.length?"الجميع":available.filter(item=>recipients.includes(item.key)).map(item=>item.label).join("، "))+" ▾"}
        </button>
        {recipientOpen?<div style={{display:"flex",gap:12,flexWrap:"wrap",border:"1px solid var(--border-subtle)",borderRadius:10,padding:10}}>
          {available.map(item=><label key={item.key} style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="checkbox" checked={recipients.includes(item.key)} disabled={busy||Boolean(pending.current)}
              onChange={()=>setRecipients(current=>current.includes(item.key)?current.filter(role=>role!==item.key):[...current,item.key])}/>
            {item.label}
          </label>)}
          <button type="button" className="button button-secondary" disabled={busy||Boolean(pending.current)}
            onClick={()=>setRecipients(available.map(item=>item.key))}>الجميع</button>
        </div>:null}
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <textarea className="input" aria-label="كتابة رسالة" placeholder="اكتب رسالة…" maxLength={2000}
            disabled={busy||Boolean(pending.current)} value={body} onChange={event=>setBody(event.target.value)}
            rows={1} style={{flex:1,resize:"vertical",minHeight:42,borderRadius:14}}/>
          <button className="button button-primary" type="button" disabled={busy||!body.trim()||!recipients.length} onClick={()=>void send()}>إرسال</button>
        </div>
      </div>:<p className="muted">المحادثة للقراءة فقط بعد انتهاء الطلب.</p>}
    </>}
  </section>;
}
