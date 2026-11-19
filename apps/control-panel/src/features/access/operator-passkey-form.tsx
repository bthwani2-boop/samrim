"use client";

import { useEffect, useRef, useState } from "react";

type PasskeyOptions = {
  ceremonyId: string;
  options: {
    publicKey: {
      challenge: string;
      rpId: string;
      userVerification: "required";
      timeout?: number;
      allowCredentials?: {
        id: string;
        type: "public-key";
        transports?: AuthenticatorTransport[];
      }[];
    };
  };
};

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const suffix = "=".repeat((4 - value.length % 4) % 4);
  const bytes = atob(value.replaceAll("-", "+").replaceAll("_", "/") + suffix);
  return Uint8Array.from(bytes, (value) => value.codePointAt(0) ?? 0);
}

export default function OperatorPasskeyForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const verificationEpoch = useRef(0);

  // Recover only a current server-confirmed cookie session after a reload.
  // A slow initial read must never overwrite a later login or logout.
  useEffect(() => {
    const epoch = ++verificationEpoch.current;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET", credentials: "same-origin", cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const session = await response.json() as { authenticated?: boolean; role?: string };
        if (verificationEpoch.current === epoch && session.authenticated === true && session.role === "operator") {
          setAuthenticated(true);
        }
      } catch { /* Invalid/absent session stays signed out. */ }
    })();
    return () => controller.abort();
  }, []);

  async function signIn() {
    if (busy) return;
    verificationEpoch.current++;
    setBusy(true);
    setMessage("");
    try {
      if (!window.isSecureContext || !navigator.credentials ||
          typeof PublicKeyCredential === "undefined") {
        throw new Error("مفتاح المرور غير متاح في هذا المتصفح أو السياق الآمن.");
      }
      const optionsResponse = await fetch("/api/auth/passkey/options", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!optionsResponse.ok) throw new Error("لا يمكن بدء دخول المشغّل.");
      const options = await optionsResponse.json() as PasskeyOptions;
      const source = options.options.publicKey;
      if (source.rpId !== "localhost" || source.userVerification !== "required") {
        throw new Error("خيارات التحقق غير معتمدة.");
      }
      const { allowCredentials: encodedAllowCredentials, ...safeSource } = source;
      const publicKey: PublicKeyCredentialRequestOptions = {
        ...safeSource,
        challenge: decodeBase64Url(source.challenge),
        ...(encodedAllowCredentials ? { allowCredentials: encodedAllowCredentials.map((item) => ({
          ...item,
          id: decodeBase64Url(item.id),
        })) } : {}),
      };
      const result = await navigator.credentials.get({ publicKey });
      if (!(result instanceof PublicKeyCredential) ||
          typeof result.toJSON !== "function") {
        throw new TypeError("المصادِق لا يدعم إرسال إثبات WebAuthn المعتمد.");
      }
      const proof = result.toJSON();
      const resultResponse = await fetch("/api/auth/passkey/authentication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ ceremonyId: options.ceremonyId, credential: proof }),
      });
      if (!resultResponse.ok) throw new Error("فشل إثبات هوية المشغّل.");
      const readback = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!readback.ok) throw new Error("تعذر التحقق من استمرار الجلسة لدى Identity.");
      const session = await readback.json() as { authenticated?: boolean; role?: string };
      if (session.authenticated !== true || session.role !== "operator") {
        throw new Error("الجلسة غير مخوّلة لدور المشغّل.");
      }
      setAuthenticated(true);
      setMessage("تم التحقق من الجلسة. يُسمح فقط بالمساحات التي تؤكد Identity صلاحيتها الحالية.");
    } catch (error) {
      setAuthenticated(false);
      setMessage(error instanceof Error ? error.message : "تعذر إتمام التحقق.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    verificationEpoch.current++;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      setAuthenticated(false);
      setMessage(response.ok ? "تم إنهاء الجلسة." : "تم حذف جلسة المتصفح، لكن لم يثبت إبطالها لدى Identity.");
    } catch {
      setAuthenticated(false);
      setMessage("تعذر إثبات إبطال الجلسة لدى Identity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="دخول مشغّل اختباري">
      <p>تسجيل دخول المشغّل بمفتاح المرور — بيئة محلية معزولة فقط.</p>
      {authenticated
        ? <button type="button" disabled={busy} onClick={signOut}>تسجيل الخروج</button>
        : <button type="button" disabled={busy} onClick={signIn}>التحقق بمفتاح المرور</button>}
      {authenticated && <p><a href="/workspace">فتح مساحة العمل المصرّح بها</a></p>}
      {message && <output>{message}</output>}
    </section>
  );
}
