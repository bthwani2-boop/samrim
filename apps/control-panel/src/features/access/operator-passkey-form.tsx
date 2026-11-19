"use client";

import { Button } from "antd";
import { useState } from "react";

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
      // A new document request resolves the current server-side workspace grants.
      window.location.replace("/");
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
      <p>استخدم مفتاح المرور المسجّل لحسابك. تظهر مساحات العمل التي مُنحت صلاحية الوصول إليها.</p>
      <Button type="primary" htmlType="button" loading={busy} disabled={busy} onClick={signIn}>
        تسجيل الدخول بمفتاح المرور
      </Button>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
