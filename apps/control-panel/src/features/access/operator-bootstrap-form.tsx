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

export default function OperatorBootstrapForm({ mode = "initial" }: Readonly<{ mode?: "initial" | "recovery" }>) {
  const [proof,setProof]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [enrollment, setEnrollment] = useState<"ready" | "confirmed" | "unconfirmed">("ready");

  async function enroll() {
    if (busy || enrollment !== "ready") return;
    setBusy(true);
    setMessage("");
    let finishDispatched = false;
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new Error("رمز التهيئة المحلي غير صالح.");
      if (!window.isSecureContext || !navigator.credentials ||
          typeof PublicKeyCredential==="undefined") {
        throw new Error("Windows Hello / WebAuthn غير متاح في هذا المتصفح.");
      }
      const reply=await fetch(mode==="recovery" ? "/api/auth/passkey/recovery/options" : "/api/auth/passkey/bootstrap/options",{
        method:"POST",headers:{"Content-Type":"application/json"},
        credentials:"same-origin",cache:"no-store",body:JSON.stringify({proof}),
      });
      if (!reply.ok) throw new Error(mode==="recovery"
        ? "تعذّر بدء الاستعادة. يجب أن يصدر رمز استعادة لحسابك الأصلي بعد التحقق من ملكيته."
        : "تعذّر بدء تهيئة المالك الأول. تحقق من التفويض والبيئة المعزولة.");
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
      const finishBody = JSON.stringify({ proof, ceremonyId: body.ceremonyId, credential: credential.toJSON() });
      finishDispatched = true;
      const done=await fetch(mode==="recovery" ? "/api/auth/passkey/recovery" : "/api/auth/passkey/bootstrap",{
        method:"POST",headers:{"Content-Type":"application/json"},
        credentials:"same-origin",cache:"no-store",
        body: finishBody,
      });
      if (done.status === 400 || done.status === 401) {
        finishDispatched = false;
        throw new Error("رُفض طلب تسجيل المفتاح. تحقّق من الرمز أو جرّب الدخول إذا كنت قد سجّلت المفتاح سابقًا.");
      }
      if (done.status !== (mode==="recovery" ? 200 : 201)) throw new Error("لم يصل تأكيد Identity.");
      const result=await done.json() as {registered?:boolean;recovered?:boolean};
      if(mode==="recovery" ? result.recovered!==true : result.registered!==true)
        throw new Error("ردّ Identity غير مطابق.");
      setProof("");
      setEnrollment("confirmed");
      setMessage(mode==="recovery"
        ? "سُجل مفتاح مرور جديد لحساب المشغّل القائم. سجّل الدخول به للتحقق من الجلسة وصلاحيات Identity."
        : "سُجل مفتاح المرور في بيئة الاختبار. سجّل الدخول بالمفتاح نفسه للتحقق من الجلسة والصلاحيات.");
    } catch(error) {
      if (finishDispatched) {
        setProof("");
        setEnrollment("unconfirmed");
        setMessage("لم يصل تأكيد التسجيل. قد تكون Identity حفظت المفتاح. جرّب الدخول بالمفتاح نفسه ثم راجع مسؤول التهيئة إذا تعذّر الدخول.");
        return;
      }
      setMessage(error instanceof DOMException && error.name==="NotAllowedError"
        ? "أُلغيت نافذة Windows Hello أو لم يكتمل التحقق."
        : error instanceof Error?error.message:"تعذر تسجيل المفتاح.");
    } finally {
      setBusy(false);
    }
  }

  const titleId = mode === "recovery" ? "operator-passkey-recovery-title" : "operator-root-bootstrap-title";
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId}>{mode === "recovery"
        ? "استعادة مفتاح مرور المشغّل" : "تسجيل مفتاح المالك الأول — بيئة اختبار معزولة"}</h2>
      <p>{mode === "recovery"
        ? "تتطلب الاستعادة رمزًا مستقلًا من Identity بعد التحقق من ملكية الحساب الأصلي. رمز تهيئة المالك الأول الاختباري لا يصلح."
        : "تتطلب هذه الخطوة رمز تهيئة قصير الصلاحية صادرًا من Identity عبر إجراء إداري محلي معتمد. لا تدخل رمز تهيئة الإنتاج هنا."}</p>
      <label htmlFor="operator-bootstrap-proof">{mode === "recovery" ? "رمز الاستعادة المعتمد" : "رمز التهيئة المحلي"}</label>
      <Input.Password id="operator-bootstrap-proof" value={proof} onChange={event=>setProof(event.target.value)}
        autoComplete="off" maxLength={43} disabled={busy || enrollment !== "ready"} />
      <Button type="primary" loading={busy} disabled={busy || enrollment !== "ready" || proof.length!==43}
        htmlType="button" onClick={enroll}>
        {mode === "recovery" ? "تسجيل مفتاح جديد عبر Windows Hello" : "تسجيل مفتاح المرور عبر Windows Hello"}
      </Button>
      {message && <p role="status">{message}</p>}
      {enrollment === "unconfirmed" && <a href="#operator-passkey-sign-in">الانتقال إلى تسجيل الدخول</a>}
    </section>
  );
}
