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
const who = (role: string) => role === "operator" ? "عمليات بثواني" : roles.find(item => item.key === role)?.label ?? "المشارك";

export function OperatorOrderConversation({ orderId }: Readonly<{ orderId: string }>) {
  const [conversation, setConversation] = useState<OrderConversationResponse | null>(null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<ReadonlyArray<Recipient>>(["client"]);
  const [replying, setReplying] = useState(false);
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
    setReplying(false);
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
    if (!conversation?.canSend || !replying || busy || !message || !chosen.length) return;
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
  return <section className="order-detail-panel" aria-labelledby="ops-conversation-title">
    <h2 id="ops-conversation-title">مراسلة الطلب</h2>
    <p className="muted">يمكن للعمليات المخولة قراءة كامل سجل الطلب. الرد غير مفعل إلا بعد اختياره.</p>
    {error ? <p role="alert" className="muted">{error}</p> : null}
    {!conversation ? <p className="muted">جارٍ قراءة السجل…</p> : <>
      {conversation.nextCursor ? <button className="button button-secondary" type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "جارٍ التحميل…" : "الرسائل الأقدم"}</button> : null}
      {!conversation.messages.length ? <p className="muted">لا توجد رسائل.</p> : <div style={{ display: "grid", gap: 8 }}>
        {conversation.messages.map(message => <div key={message.id} style={{ border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 10 }}>
          <strong>{who(message.senderRole)}</strong>
          <p style={{ margin: "6px 0" }}>{message.body}</p><OperatorOrderMedia orderId={orderId} messageId={message.id} kind={message.mediaKind} body={message.body} />
          <small className="muted">إلى: {message.recipientRoles.map(who).join("، ")} · {new Date(message.createdAt).toLocaleString("ar-YE")}</small>
        </div>)}
      </div>}
      {!conversation.canSend ? <p className="muted">انتهى الطلب، والمراسلة للقراءة فقط.</p> :
        !replying ? <button type="button" className="button button-secondary" onClick={() => setReplying(true)}>الرد باسم عمليات بثواني</button> :
        <div style={{ display: "grid", gap: 10 }}>
          <p className="muted">إرسال الرد إلى:</p>
          <div className="action-row">{available.map(item => <label key={item.key}>
            <input type="checkbox" checked={recipients.includes(item.key)} disabled={busy || Boolean(pending.current)}
              onChange={() => setRecipients(current => current.includes(item.key) ? current.filter(role => role !== item.key) : [...current, item.key])} />
            {item.label}
          </label>)}</div>
          <textarea aria-label="رد عمليات بثواني" className="input" maxLength={2000} rows={3} disabled={busy || Boolean(pending.current)} value={body} onChange={event => setBody(event.target.value)} />
          <div className="action-row">
            <button className="button button-primary" disabled={busy || !body.trim() || !recipients.length} type="button" onClick={() => void send()}>إرسال الرد</button>
            <button className="button button-secondary" disabled={busy || Boolean(pending.current)} type="button" onClick={() => setReplying(false)}>إلغاء الرد</button>
          </div>
        </div>}
    </>}
  </section>;
}
