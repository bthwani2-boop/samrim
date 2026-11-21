"use client";

import { Button, Input } from "antd";
import { useState } from "react";

type RegistrationOptions = {
  ceremonyId: string;
  options: {
    publicKey: {
      rp: PublicKeyCredentialRpEntity;
      user: { id: string; name: string; displayName: string };
      challenge: string;
      pubKeyCredParams: PublicKeyCredentialParameters[];
      timeout?: number;
      authenticatorSelection: AuthenticatorSelectionCriteria;
      attestation?: AttestationConveyancePreference;
      excludeCredentials?: { id:string; type:"public-key"; transports?: AuthenticatorTransport[] }[];
    };
  };
};

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const encoded=value.replaceAll("-","+").replaceAll("_","/")+"=".repeat((4-value.length%4)%4);
  return Uint8Array.from(atob(encoded),letter=>letter.codePointAt(0)??0);
}

export default function OperatorBootstrapForm() {
  const [proof,setProof]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [registered,setRegistered]=useState(false);

  async function enroll() {
    if (busy || registered) return;
    setBusy(true);
    setMessage("");
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new Error("رمز التهيئة المحلي غير صالح.");
      if (!window.isSecureContext || !navigator.credentials ||
          typeof PublicKeyCredential==="undefined") {
        throw new Error("Windows Hello / WebAuthn غير متاح في هذا المتصفح.");
      }
      const reply=await fetch("/api/auth/passkey/bootstrap/options",{
        method:"POST",headers:{"Content-Type":"application/json"},
        credentials:"same-origin",cache:"no-store",body:JSON.stringify({proof}),
      });
      if (!reply.ok) throw new Error("تعذّر بدء تهيئة المالك الأول. تحقق من التفويض والبيئة المعزولة.");
      const body=await reply.json() as RegistrationOptions;
      const options=body.options.publicKey;
      if (options.rp.id!=="localhost" || options.authenticatorSelection.userVerification!=="required" ||
          options.authenticatorSelection.residentKey!=="required") {
        throw new Error("إعدادات التحقق بمفتاح المرور غير معتمدة.");
      }
      const { excludeCredentials: encodedExcludeCredentials, ...safeOptions } = options;
      const publicKey:PublicKeyCredentialCreationOptions={
        ...safeOptions,
        challenge:decodeBase64Url(options.challenge),
        user:{...options.user,id:decodeBase64Url(options.user.id)},
        ...(encodedExcludeCredentials?{
          excludeCredentials:encodedExcludeCredentials.map(item=>({...item,id:decodeBase64Url(item.id)})),
        }:{}),
      };
      const credential=await navigator.credentials.create({publicKey});
      if (!(credential instanceof PublicKeyCredential) ||
          typeof credential.toJSON!=="function") {
        throw new Error("لم يتم إنشاء اعتماد Windows Hello معتمد.");
      }
      const done=await fetch("/api/auth/passkey/bootstrap",{
        method:"POST",headers:{"Content-Type":"application/json"},
        credentials:"same-origin",cache:"no-store",
        body:JSON.stringify({proof,ceremonyId:body.ceremonyId,credential:credential.toJSON()}),
      });
      if (!done.ok) throw new Error("لم تثبت Identity إتمام تسجيل المفتاح؛ لا توجد جلسة مشغّل.");
      const result=await done.json() as {registered?:boolean};
      if(result.registered!==true) throw new Error("ردّ Identity غير مطابق.");
      setProof("");
      setRegistered(true);
      setMessage("سُجل مفتاح المرور في بيئة الاختبار. سجّل الدخول الآن بمفتاحك للتحقق من الجلسة والصلاحيات.");
    } catch(error) {
      setMessage(error instanceof DOMException && error.name==="NotAllowedError"
        ? "أُلغيت نافذة Windows Hello أو لم يكتمل التحقق."
        : error instanceof Error?error.message:"تعذر تسجيل المفتاح.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="operator-root-bootstrap-title">
      <h2 id="operator-root-bootstrap-title">تسجيل مفتاح المالك الأول — بيئة اختبار معزولة</h2>
      <p>تتطلب هذه الخطوة رمز تهيئة قصير الصلاحية صادرًا من Identity عبر إجراء إداري محلي معتمد. لا تدخل رمز تهيئة الإنتاج هنا.</p>
      <label htmlFor="operator-bootstrap-proof">رمز التهيئة المحلي</label>
      <Input.Password id="operator-bootstrap-proof" value={proof} onChange={event=>setProof(event.target.value)}
        autoComplete="off" maxLength={43} disabled={busy || registered} />
      <Button type="primary" loading={busy} disabled={busy || registered || proof.length!==43}
        htmlType="button" onClick={enroll}>
        تسجيل مفتاح المرور عبر Windows Hello
      </Button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
