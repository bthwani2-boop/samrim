"use client";

import { identityErrorMessage } from "@bthwani/identity";

export type RequestFailure = Readonly<{ status: number; message: string }>;

export async function identityFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function responseMessage(response: Response, context: "general" | "login" | "recovery" = "general"): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
  const code = typeof body?.error?.code === "string" ? body.error.code : "";
  switch (code) {
    case "RECOVERY_UNSUPPORTED": return "استرداد موظف لوحة التحكم يتم من أدوات إدارة المشغل المخصصة.";
    case "NOT_FOUND": return "لم يتم العثور على سجل الدور المطلوب.";
    case "DSH_UNAVAILABLE": return "خدمة إدارة الأدوار غير متاحة. تحقق من تشغيل الحاويات ثم أعد المحاولة.";
    case "DSH_CONFIG_ERROR": return "إعدادات خدمة إدارة الأدوار غير مكتملة. أعد تشغيل لوحة التحكم المحلية ثم حاول مرة أخرى.";
    default: return identityErrorMessage({ kind: "http", status: response.status, code, message: "" }, context);
  }
}

export function isRequestFailure(value: unknown): value is RequestFailure {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { status?: unknown }).status === "number" &&
    typeof (value as { message?: unknown }).message === "string",
  );
}
