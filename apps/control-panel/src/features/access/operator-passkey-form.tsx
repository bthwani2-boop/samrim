"use client";

import { Button } from "antd";
import { useEffect, useRef, useState } from "react";
import { notifyOperatorSessionChanged, withOperatorBrowserSession } from "../session/operator-browser-session";

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

export default function OperatorPasskeyForm({ recoveryOnly = false }: Readonly<{ recoveryOnly?: boolean }>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const recovering = useRef(false);

  async function restoreSession() {
    if (recovering.current) return;
    recovering.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await withOperatorBrowserSession(() => fetch("/api/auth/session", {
        method: "GET", credentials: "same-origin", cache: "no-store",
      }));
      if (response.status === 401) {
        // The session endpoint has confirmed denial. Re-evaluate the entry on the server.
        window.location.replace("/");
        return;
      }
      if (!response.ok) throw new Error("تعذّر تأكيد استعادة الجلسة لدى Identity. لا تبدأ دخولًا جديدًا قبل التحقق.");
      const session = await response.json() as { authenticated?: boolean; role?: string };
      if (session.authenticated !== true || session.role !== "operator") {
        throw new Error("الجلسة غير مخوّلة لدور المشغّل.");
      }
      // Server-rendered entry still checks every current workspace permission.
      window.location.replace("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر تأكيد استعادة الجلسة.");
    } finally {
      recovering.current = false;
      setBusy(false);
    }
  }

  const automaticRecovery = useRef(false);
  const restore = useRef(restoreSession);
  restore.current = restoreSession;
  useEffect(() => {
    if (recoveryOnly && !automaticRecovery.current) {
      automaticRecovery.current = true;
      void restore.current();
    }
  }, [recoveryOnly]);

  async function signIn() {
    if (busy) return;
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
      if (optionsResponse.status === 503) {
        throw new Error("خدمة الدخول بمفتاح المرور غير جاهزة في هذه البيئة. لا يمكن تخطي فحص Identity.");
      }
      if (!optionsResponse.ok) throw new Error("لا يمكن بدء دخول المشغّل. تحقق من عنوان الدخول المعتمد.");
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
      await withOperatorBrowserSession(async () => {
        const resultResponse = await fetch("/api/auth/passkey/authentication", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ ceremonyId: options.ceremonyId, credential: proof }),
        });
        if (resultResponse.status === 503) {
          throw new Error("لم تتمكن Identity من إكمال التحقق الآمن. الجلسة غير مفعّلة.");
        }
        if (!resultResponse.ok) throw new Error("فشل إثبات مفتاح المرور المسجّل للمشغّل.");
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
        // A new document request resolves the current server-side workspace grants.
        notifyOperatorSessionChanged();
        window.location.replace("/");
      });
    } catch (error) {
      setMessage(error instanceof DOMException && error.name === "NotAllowedError"
        ? "لم يكتمل التحقق بمفتاح المرور. حاول مرة أخرى باستخدام مفتاحك المسجّل."
        : error instanceof Error ? error.message : "تعذر إتمام التحقق.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="دخول المشغّل">
      <p>{recoveryOnly
        ? "توجد بيانات جلسة محفوظة. تحقق من صلاحيتها لدى Identity لاستعادة دخولك."
        : "استخدم مفتاح المرور المسجّل لحسابك. تظهر مساحات العمل التي مُنحت صلاحية الوصول إليها."}</p>
      <Button id={recoveryOnly ? "operator-session-restore" : "operator-passkey-sign-in"} type="primary" htmlType="button"
        loading={busy} disabled={busy} onClick={recoveryOnly ? restoreSession : signIn}>
        {recoveryOnly ? "استعادة الجلسة" : "تسجيل الدخول بمفتاح المرور"}
      </Button>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
