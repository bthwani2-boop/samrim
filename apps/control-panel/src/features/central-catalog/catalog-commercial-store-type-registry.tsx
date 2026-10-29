"use client";

import type { CommerceVertical, CommercialStoreType } from "@bthwani/dsh";
import { Button, Checkbox, Form, Input } from "antd";
import { useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";

type TypeListResponse = Readonly<{ storeTypes: ReadonlyArray<CommercialStoreType> }>;
type StoreTypeFormValues = Readonly<{ nameAr: string; nameEn: string; reason: string; active: boolean }>;

function message(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "تعذر تنفيذ العملية.";
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "تعذر تنفيذ العملية.";
  const text = (error as { message?: unknown }).message;
  return typeof text === "string" && text.trim() ? text : "تعذر تنفيذ العملية.";
}

async function readType(verticalId: string, typeId: string): Promise<CommercialStoreType> {
  const query = new URLSearchParams({ verticalId, includeInactive: "true" });
  const response = await fetch(`/api/catalog/commercial-store-types?${query}`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as TypeListResponse | { error?: unknown } | null;
  if (!response.ok || !body || !("storeTypes" in body) || !Array.isArray(body.storeTypes)) {
    throw new Error(message(body));
  }
  const item = body.storeTypes.find((entry) => entry.id === typeId);
  if (!item) throw new Error("تعذر العثور على نوع المتجر ضمن المجال المحدد.");
  return item;
}

export function CatalogCommercialStoreTypeRegistry({ verticals, verticalId, initialId, onSaved, onClose }: Readonly<{
  verticals: ReadonlyArray<CommerceVertical>;
  verticalId: string;
  initialId?: string | undefined;
  onSaved?: () => Promise<void>;
  onClose?: () => void;
}>) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [form] = Form.useForm<StoreTypeFormValues>();
  const [selected, setSelected] = useState<CommercialStoreType | null>(null);
  const [loading, setLoading] = useState(Boolean(initialId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(!initialId);
  const [readAttempt, setReadAttempt] = useState(0);
  const vertical = verticals.find((item) => item.id === verticalId);

  useEffect(() => {
    let current = true;
    setError("");
    setSelected(null);
    setReady(!initialId);
    // Retrying an interrupted edit read must not leave an obsolete draft visible.
    if (readAttempt > 0) form.resetFields();
    if (!initialId) {
      setLoading(false);
      form.setFieldsValue({ nameAr: "", nameEn: "", active: true, reason: "" });
      return () => { current = false; };
    }
    setLoading(true);
    void readType(verticalId, initialId).then((item) => {
      if (!current) return;
      setSelected(item);
      form.setFieldsValue({ nameAr: item.nameAr, nameEn: item.nameEn, active: item.active, reason: "" });
      setReady(true);
    }).catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : "تعذرت قراءة نوع المتجر.");
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [form, initialId, readAttempt, verticalId]);

  async function save(values: StoreTypeFormValues) {
    if (!canEdit || !verticalId || !vertical?.active) return;
    const cleanAr = values.nameAr.trim();
    const cleanEn = values.nameEn.trim();
    const cleanReason = values.reason.trim();
    if (cleanAr.length < 2 || cleanAr.length > 160 || cleanEn.length < 2 || cleanEn.length > 160 || cleanReason.length < 5 || cleanReason.length > 500) {
      setError("أدخل الاسمين العربي والإنجليزي وسببًا موثقًا من 5 إلى 500 حرف.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(selected ? `/api/catalog/commercial-store-types/${encodeURIComponent(selected.id)}` : "/api/catalog/commercial-store-types", {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(selected
          ? { nameAr: cleanAr, nameEn: cleanEn, active: values.active, expectedVersion: selected.version, reason: cleanReason }
          : { verticalId, nameAr: cleanAr, nameEn: cleanEn, active: values.active, reason: cleanReason }),
      });
      const payload = await response.json().catch(() => null) as { storeType?: CommercialStoreType; error?: unknown } | null;
      if (!response.ok || !payload?.storeType) throw new Error(message(payload));
      await onSaved?.();
      onClose?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ نوع المتجر.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="catalog-taxonomy-section" aria-labelledby="commercial-store-type-title">
    <h3 id="commercial-store-type-title">{selected ? "تعديل نوع المتجر" : "إنشاء نوع متجر"}</h3>
    {verticalId && !vertical?.active ? <p className="managed-status managed-status-warning" role="status">المجال متوقف؛ لا يمكن إنشاء نوع متجر أو تعديله فيه.</p> : null}
    {loading ? <div><p role="status">جارٍ قراءة نوع المتجر…</p><Button disabled={busy} onClick={() => onClose?.()}>إلغاء</Button></div> : null}
    {error ? <div>
      <p className="identity-error" role="alert">{error}</p>
      {initialId ? <><Button type="link" disabled={loading} onClick={() => setReadAttempt((attempt) => attempt + 1)}>إعادة المحاولة</Button><Button disabled={busy} onClick={() => onClose?.()}>إلغاء</Button></> : null}
    </div> : null}
    {ready ? <Form form={form} layout="vertical" className="access-form" onFinish={(values: StoreTypeFormValues) => void save(values)}>
      <Form.Item label="الاسم العربي" name="nameAr" rules={[{ required: true, whitespace: true, message: "أدخل الاسم العربي." }, { min: 2, max: 160, whitespace: true, message: "يجب أن يتراوح الاسم بين حرفين و160 حرفًا." }]}>
        <Input autoComplete="off" maxLength={160} disabled={busy || !canEdit || !vertical?.active} placeholder="ملحمة" />
      </Form.Item>
      <Form.Item label="الاسم الإنجليزي" name="nameEn" rules={[{ required: true, whitespace: true, message: "أدخل الاسم الإنجليزي." }, { min: 2, max: 160, whitespace: true, message: "يجب أن يتراوح الاسم بين حرفين و160 حرفًا." }]}>
        <Input autoComplete="off" maxLength={160} dir="auto" disabled={busy || !canEdit || !vertical?.active} placeholder="Butcher" />
      </Form.Item>
      <Form.Item name="active" valuePropName="checked">
        <Checkbox disabled={busy || !canEdit || !vertical?.active}>نشط للاستخدام في ملفات الانضمام والسياسات</Checkbox>
      </Form.Item>
      <Form.Item label="سبب التغيير" name="reason" rules={[{ required: true, whitespace: true, min: 5, max: 500, message: "أدخل سببًا من 5 إلى 500 حرف." }]}>
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={500} disabled={busy || !canEdit} />
      </Form.Item>
      <div className="catalog-registry-actions unified-taxonomy-save-actions">
        <Button type="primary" htmlType="submit" loading={busy} disabled={!canEdit || !vertical?.active}>
          {selected ? "حفظ نوع المتجر" : "إنشاء نوع المتجر"}
        </Button>
        <Button disabled={busy} onClick={() => onClose?.()}>إلغاء</Button>
      </div>
    </Form> : null}
  </section>;
}