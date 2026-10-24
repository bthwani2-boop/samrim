"use client";

import { useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { audioMessageCaptionUrl } from "./operator-order-audio-caption";

export function OperatorOrderMedia({
  orderId, messageId, kind, body,
}: Readonly<{ orderId: string; messageId: string; kind: string | undefined; body: string }>) {
  const [dataUri, setDataUri] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const captions = kind === "audio" ? audioMessageCaptionUrl(body) : null;
  if (!kind) return null;

  async function open() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const path = `/api/operations/${encodeURIComponent(orderId)}/conversation/messages/${encodeURIComponent(messageId)}/media`;
      const response = await identityFetch(path, { cache: "no-store" });
      if (!response.ok) throw new Error("MEDIA_FORBIDDEN");
      const value = await response.json() as { mediaKind: string; contentType: string; dataBase64: string };
      if (value.mediaKind !== kind || !value.dataBase64) throw new Error("INVALID_MEDIA");
      setDataUri("data:" + value.contentType + ";base64," + value.dataBase64);
    } catch {
      setError("تعذر فتح المرفق. تحقق من صلاحيات الطلب.");
    } finally {
      setLoading(false);
    }
  }

  return <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
    <button className="button button-secondary" type="button" disabled={loading} onClick={() => void open()}>
      {loading ? "جارٍ القراءة…" : kind === "image" ? "عرض الصورة" : "تشغيل الصوت"}
    </button>
    {dataUri && kind === "image"
      ? <img alt="صورة مرفقة خاصة بالطلب" src={dataUri} style={{ maxWidth: 240, maxHeight: 200, objectFit: "contain" }} />
      : null}
    {dataUri && kind === "video" ? <video src={dataUri} controls preload="none"
      aria-label="فيديو خاص بمحادثة الطلب" style={{maxWidth:260,maxHeight:220,borderRadius:10}}><track kind="captions" src={captions ?? undefined} srcLang="ar" label="التفريغ النصي المرفق" default /></video>:null}
    {dataUri && kind === "audio" ? <>
      <audio aria-label="تشغيل التسجيل الصوتي الخاص بالطلب" src={dataUri} controls preload="none">
        <track kind="captions" label="النص المرفق من المرسل" src={captions ?? undefined} srcLang="ar" default />
      </audio>
      {!captions ? <p className="muted" role="status">التسجيل لا يحتوي على تفريغ نصي. اطلب من المرسل كتابة محتواه داخل المحادثة.</p> : null}
    </> : null}
    {error ? <span role="alert">{error}</span> : null}
  </div>;
}
