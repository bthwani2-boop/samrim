"use client";

import { isOperatorCaptainInterest, type OperatorCaptainInterest } from "@bthwani/dsh";
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

type CandidatePage = { items: OperatorCaptainInterest[]; nextCursor?: string };
const vehicleLabels: Record<string, string> = {
  MOTORCYCLE: "دراجة نارية", ELECTRIC: "دراجة كهربائية",
  BICYCLE: "دراجة هوائية", NONE: "بدون دراجة",
};
const phoneLabels: Record<string, string> = {
  SMART: "هاتف ذكي", BASIC: "هاتف عادي", NONE: "بدون هاتف",
};
const vehicleOptions = Object.entries(vehicleLabels).map(([value, label]) => ({ value, label }));
const validPage = (value: unknown): value is CandidatePage => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every(key => key === "items" || key === "nextCursor") &&
    Array.isArray(v.items) && v.items.length <= 20 &&
    v.items.every(isOperatorCaptainInterest) &&
    new Set(v.items.map(item => item.id)).size === v.items.length &&
    (v.nextCursor === undefined || typeof v.nextCursor === "string" && /^[1-9][0-9]*$/.test(v.nextCursor));
};

export default function CaptainInterestWorkspace() {
  const [city, setCity] = useState("");
  const [chosenCity, setChosenCity] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [contacted, setContacted] = useState("");
  const [cursor, setCursor] = useState("");
  const [page, setPage] = useState<CandidatePage | null>(null);
  const [binding, setBinding] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [error, setError] = useState("");
  const mutationController = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    setCursor("");
    setPage(null);
    setBinding("");
    setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === "visible" && mutationController.current === null) refresh();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [refresh]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly refetches the current page.
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    setPage(null);
    setBinding("");
    const params = new URLSearchParams({ limit: "20" });
    if (chosenCity.trim()) params.set("city", chosenCity.trim());
    if (vehicle) params.set("vehicle", vehicle);
    if (contacted) params.set("contacted", contacted);
    if (cursor) params.set("before", cursor);
    void fetch(`/api/captains/interest?${params}`, {
      method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
    }).then(async response => {
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw new Error("لا تملك جلسة تشغيل وصلاحية العمليات المطلوبة.");
        throw new Error("تعذّر تحميل التسجيلات من خدمة بثواني.");
      }
      const operator = response.headers.get("X-BThwani-Operator");
      const value: unknown = await response.json();
      if (!validPage(value) || !operator || !/^[A-Za-z0-9_-]{1,256}$/.test(operator)) {
        throw new Error("استجابة تسجيلات غير صالحة.");
      }
      if (!controller.signal.aborted) {
        setPage(value);
        setBinding(operator);
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "تعذّرت القراءة.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => { controller.abort(); mutationController.current?.abort(); };
  }, [chosenCity, vehicle, contacted, cursor, revision]);

  async function contactCandidate(id: number) {
    if (!binding || updating !== null) return;
    const controller = new AbortController();
    mutationController.current?.abort();
    mutationController.current = controller;
    setUpdating(id);
    setError("");
    try {
      const response = await fetch(`/api/captains/interest/${id}/contact`, {
        method: "PATCH", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-BThwani-Operator": binding },
        body: JSON.stringify({ contacted: true }),
      });
      if (!response.ok) throw new Error(response.status === 403
        ? "انتهت صلاحية وصول المشغّل لهذه البيانات." : "تعذّر تأكيد وضع علامة تم الاتصال.");
      const updated: unknown = await response.json();
      if (response.headers.get("X-BThwani-Operator") !== binding ||
        !isOperatorCaptainInterest(updated) || updated.id !== id || !updated.contacted) {
        throw new Error("لم يتم تأكيد تحديث التسجيل من مالك البيانات.");
      }
      if (!controller.signal.aborted) refresh();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "تعذّر الحفظ.");
    } finally {
      if (mutationController.current === controller) {
        mutationController.current = null;
        setUpdating(null);
      }
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 1220, marginInline: "auto" }} aria-labelledby="captain-interest-heading">
      <Typography.Title level={2} id="captain-interest-heading">تسجيلات الراغبين بالانضمام ككباتن</Typography.Title>
      <Typography.Paragraph>
        بيانات اتصال داخلية فقط. لا تُنشئ حساب كابتن ولا يتلقى المتقدم تحديثات.
        اختر من تريد التواصل معه هاتفيًا.
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input aria-label="المدينة" placeholder="ابحث بالمدينة" value={city}
          onChange={event => setCity(event.target.value)} maxLength={80} style={{ width: 175 }}
          onPressEnter={() => { setChosenCity(city.trim()); setCursor(""); }} />
        <Select aria-label="نوع الدراجة" style={{ minWidth: 170 }} value={vehicle}
          options={[{ value: "", label: "كل الدراجات" }, ...vehicleOptions]}
          onChange={value => { setVehicle(value); setCursor(""); }} />
        <Select aria-label="حالة الاتصال" style={{ minWidth: 160 }} value={contacted}
          options={[{ value: "", label: "كل التسجيلات" },
            { value: "false", label: "لم يتم الاتصال" },
            { value: "true", label: "تم الاتصال" }]}
          onChange={value => { setContacted(value); setCursor(""); }} />
        <Button onClick={() => { setChosenCity(city.trim()); setCursor(""); }}>بحث</Button>
        <a href="/captains">الكباتن المعتمدون</a>
      </Space>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }}
        action={<Button onClick={refresh} disabled={loading || updating !== null}>إعادة المحاولة</Button>} />}
      <Card title="استمارات التسجيل">
        <Table<OperatorCaptainInterest> rowKey="id" loading={loading}
          dataSource={page?.items ?? []} pagination={false} size="middle"
          locale={{ emptyText: "لا توجد تسجيلات مطابقة." }}
          scroll={{ x: 960 }}
          columns={[
            { title: "الاسم", dataIndex: "name", key: "name" },
            { title: "الهاتف", dataIndex: "phone", key: "phone",
              render: (phone: string) => <Typography.Text copyable={{ text: phone }}>{phone}</Typography.Text> },
            { title: "المدينة", dataIndex: "city", key: "city" },
            { title: "الحي", dataIndex: "district", key: "district" },
            { title: "الدراجة", dataIndex: "vehicleType", key: "vehicleType",
              render: (value: string) => vehicleLabels[value] ?? value },
            { title: "ترقيم", key: "plateRegistered",
              render: (_, row) => row.plateRegistered === undefined ? "لا ينطبق" :
                row.plateRegistered ? "نعم" : "لا" },
            { title: "الهاتف المستخدم", dataIndex: "phoneType", key: "phoneType",
              render: (value: string) => phoneLabels[value] ?? value },
            { title: "خبرة", key: "experienced",
              render: (_, row) => row.experienced
                ? <Typography.Text title={row.experienceDetails ?? ""}>نعم</Typography.Text> : "لا" },
            { title: "الاتصال", key: "contacted",
              render: (_, row) => row.contacted ? <Tag color="default">تم الاتصال</Tag> :
                <Button disabled={loading || !binding || updating !== null}
                  loading={updating === row.id}
                  onClick={() => { void contactCandidate(row.id); }}>تم الاتصال</Button> },
          ]} />
        {page?.nextCursor && <Button style={{ marginTop: 16 }} disabled={loading}
          onClick={() => setCursor(page.nextCursor ?? "")}>الصفحة التالية</Button>}
      </Card>
    </main>
  );
}
