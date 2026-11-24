"use client";

import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Select, Space, Typography } from "antd";
import Link from "next/link";
import { useState } from "react";
import {
  type CityPolicy, type CityPolicyChange, parseCityPolicy, reconcileCityPolicy,
} from "./city-policy-command";
import CityPolicyHistory from "./city-policy-history";
import type { PolicyCityDirectory } from "./policy-city-directory";
import { readRegistrationOverview, type RegistrationOverview } from "./store-registration-command";

const validCity = /^[a-z0-9-]{1,64}$/;

export default function PoliciesWorkspace({ actorId, directory }: Readonly<{
  actorId: string;
  directory: PolicyCityDirectory;
}>) {
  const [city, setCity] = useState("");
  const [policy, setPolicy] = useState<CityPolicy | null>(null);
  const [admission, setAdmission] = useState<RegistrationOverview | null>(null);
  const [maxPause, setMaxPause] = useState<number | null>(null);
  const [maxPreparation, setMaxPreparation] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [provision, setProvision] = useState(false);
  const [pending, setPending] = useState<CityPolicyChange | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [requiresRead, setRequiresRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const endpoint = validCity.test(city) ? `/api/policies/cities/${city}` : null;
  const readyForChange = !requiresRead && endpoint && (policy !== null || provision) &&
    maxPause !== null && Number.isSafeInteger(maxPause) && maxPause >= 0 && maxPause <= 31536000 &&
    maxPreparation !== null && Number.isSafeInteger(maxPreparation) &&
    maxPreparation >= 0 && maxPreparation <= 1440 &&
    reason.trim().length >= 1 && [...reason].length <= 300;

  function resetCommand() {
    setPending(null);
    setUncertain(false);
    setMessage("");
    setErrorMessage("");
  }

  function selectCity(value: string) {
    if (busy || uncertain || pending) return;
    setCity(value);
    setPolicy(null);
    setAdmission(null);
    setRequiresRead(false);
    setMaxPause(null);
    setMaxPreparation(null);
    setReason("");
    setProvision(false);
    resetCommand();
  }

  async function readCurrent() {
    if (!endpoint || busy) return;
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    setAdmission(null);
    try {
      // Independent owner reads: a failed relation or availability policy must
      // never become an implicit admission, closure or default configuration.
      const [response, overview] = await Promise.allSettled([
        fetch(endpoint, {
          method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
          headers: { "X-BThwani-Operator": encodeURIComponent(actorId) },
        }),
        readRegistrationOverview(city, actorId),
      ]);
      if (response.status === "fulfilled" && (response.value.status === 401 || response.value.status === 403)) {
        setRequiresRead(true);
        throw new Error("Identity لا يثبت صلاحية إدارة السياسات الحالية.");
      }
      if (overview.status === "fulfilled") setAdmission(overview.value);
      if (response.status === "rejected") throw response.reason;
      const responseValue = response.value;
      if (!responseValue.ok) {
        throw new Error("تعذر قراءة سياسة إتاحة المتاجر من DSH. لا توجد قيم افتراضية مفترضة؛ لا تعتبر 503 دليلًا على غياب السياسة.");
      }
      const current = parseCityPolicy(await responseValue.json(), city);
      if (!current) throw new Error("أعاد DSH بيانات سياسة غير معتمدة.");
      setPolicy(current);
      setRequiresRead(false);
      setProvision(false);
      if (!uncertain) {
        setMaxPause(current.maxPauseSeconds);
        setMaxPreparation(current.maxPreparationMinutes);
      }
      setMessage("تمت قراءة السياسة الحالية.");
    } catch (error) {
      setPolicy(null);
      setProvision(false);
      setErrorMessage(error instanceof Error ? error.message : "تعذر قراءة السياسة.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!endpoint || busy) return;
    let change = pending;
    if (!change) {
      if (!readyForChange || maxPause === null || maxPreparation === null) return;
      change = {
        operationId: crypto.randomUUID(),
        expectedVersion: policy?.version ?? 0,
        maxPauseSeconds: maxPause,
        maxPreparationMinutes: maxPreparation,
        reason,
      };
    }
    setPending(change);
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    const result = await reconcileCityPolicy(endpoint, city, actorId, change);
    setBusy(false);

    if (result.status === "confirmed") {
      setPolicy(result.current);
      setMaxPause(result.current.maxPauseSeconds);
      setMaxPreparation(result.current.maxPreparationMinutes);
      setReason("");
      setPending(null);
      setUncertain(false);
      setProvision(false);
      setRequiresRead(false);
      setMessage(result.superseded
        ? "تم تأكيد العملية. يعرض النموذج إصدارًا أحدث قرأه من DSH."
        : result.replay ? "تم تأكيد العملية السابقة دون تكرار التعديل."
          : "تم اعتماد السياسة والتحقق من الإصدار والقيم الحالية.");
      return;
    }
    if (result.status === "conflict") {
      setPending(null);
      setUncertain(false);
      setPolicy(null);
      setProvision(false);
      setRequiresRead(true);
      setErrorMessage("تعارض إصدار السياسة أو معرّف العملية. اقرأ السياسة الحالية قبل التعديل.");
      return;
    }
    if (result.status === "unknown" || uncertain) {
      if (result.status === "denied") {
        setAdmission(null);
        setPolicy(null);
      }
      setUncertain(true);
      setErrorMessage(result.status === "denied"
        ? "تعذّر التحقق من الصلاحية لاسترداد العملية. احتفظ بمعرّفها حتى استعادة الصلاحية."
        : "نتيجة التعديل غير مؤكدة. أعد إرسال الأمر بنفس المعرّف للتحقق منه.");
      return;
    }
    setPending(null);
    if (result.status === "denied") {
      setAdmission(null);
      setPolicy(null);
      setProvision(false);
      setRequiresRead(true);
    }
    setErrorMessage(result.status === "denied"
      ? "لم تؤكد Identity صلاحية تعديل السياسة."
      : "رفض DSH أمر السياسة. راجع المدخلات قبل المحاولة.");
  }

  return (
    <main style={{ maxWidth: 900, marginInline: "auto", paddingBlock: 24 }}>
      <Typography.Title level={1}>السياسات</Typography.Title>
      <Typography.Paragraph>
        مركز إدارة السياسات التشغيلية والتجارية. تعرض هذه الصفحة نطاقات السياسات المتاحة للتحرير
        والنطاقات التي لم تكتمل بعد؛ ولا يغيّر مجرد عرضها أي طلب أو اتفاقية مالية.
      </Typography.Paragraph>
      <section aria-label="مجالات السياسات وحالة توفرها" style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 12, marginBlockEnd: 22,
      }}>
        <Card title="الانضمام والمتاجر" extra={<Typography.Text type="success">محرّر متاح</Typography.Text>}>
          <Typography.Paragraph>
            قبول المتاجر المباشرة ومتاجر السوق مستقل لكل مدينة ونموذج، مع شروط وإصدار
            وتسجيل من غيّر السياسة. الإتاحة لا تعني النشر أو إبرام اتفاق مالي.
          </Typography.Paragraph>
          <Link href="/policies/store-registration">إدارة قبول المتاجر: المباشر والسوق</Link>
          <Typography.Paragraph style={{ marginBlockStart: 8 }}>
            <Link href="/merchants/joining">مراجعة حقائق المتاجر غير المنشورة (صلاحية إدارة التجار)</Link>
          </Typography.Paragraph>
        </Card>
        <Card title="التشغيل والأهلية" extra={<Typography.Text type="success">محرّر متاح</Typography.Text>}>
          <Typography.Paragraph>
            سياسة توقف المتاجر ووقت التحضير حسب المدينة، دون منح المتجر صلاحية نشر جديدة.
          </Typography.Paragraph>
          <Link href="#city-availability-policy">إدارة سياسة إتاحة المتاجر أدناه</Link>
        </Card>
        <Card title="الطلبات والتوصيل" extra={<Typography.Text type="warning">غير مكتمل</Typography.Text>}>
          <Typography.Paragraph>
            أزمنة مراحل الطلبات لم تُوصل بعد إلى مالك تنفيذي. رسوم التوصيل
            وطريقة الإسناد ليستا جزءًا من سياسة تسجيل المتجر.
          </Typography.Paragraph>
          <Link href="/policies/stage-sla">حالة توفر سياسات أزمنة مراحل الطلبات</Link>
        </Card>
        <Card title="المالية والاتفاقيات" extra={<Typography.Text type="warning">غير متاح للتحرير</Typography.Text>}>
          <Typography.Paragraph>
            العمولة والاشتراك والتحصيل والتسويات يملكها WLT، ولا يحددها
            اختيار DIRECT أو MARKETPLACE. لم تُوصل هنا واجهة تحرير مالية معتمدة؛
            لا يمكن إنشاء اتفاق أو تغيير مستحقات من إعداد قبول المتاجر.
          </Typography.Paragraph>
        </Card>
        <Card title="نطاق التغطية والخدمة" extra={<Typography.Text type="warning">غير متاح للتحرير</Typography.Text>}>
          <Typography.Paragraph>
            نطاق المدينة ومسافة الخدمة وأهلية طرق التوصيل يملكها DSH. لا تتوفر هنا
            عقود تعديل هذه السياسات؛ لا يمكن توسيع نطاق الخدمة من واجهة قبول المتاجر.
          </Typography.Paragraph>
        </Card>
        <Card title="السريان وسجل التغييرات">
          <Typography.Paragraph>
            راجع الإصدار والمشغّل والسبب وتاريخ التحديث في شاشة السياسة نفسها.
            لا توجد في هذه الصفحة واجهة لتعديل الأثر المالي أو استرجاع تاريخ محذوف.
          </Typography.Paragraph>
        </Card>
      </section>
      <section id="city-availability-policy" aria-label="سياسة إتاحة المتاجر حسب المدينة">
      <Card title="قراءة سياسة المدينة" style={{ marginBlockEnd: 16 }}>
        <Form layout="vertical" onFinish={() => void readCurrent()}>
          <Form.Item label="المدينة">
            <Select aria-label="اختيار المدينة" showSearch optionFilterProp="label"
              value={city || null} options={[...directory.cities]}
              disabled={busy || uncertain || !!pending || directory.cities.length === 0}
              placeholder="اختر مدينة الخدمة" onChange={value => selectCity(value ?? "")} />
          </Form.Item>
          {directory.status === "unavailable" && <Alert type="warning" showIcon
            message="تعذر تحميل المدن من الخدمة المالكة. أعد تحميل الصفحة أو اقرأ مدينة معروفة." />}
          {directory.status === "current" && directory.cities.length === 0 && <Alert type="info"
            message="لا توجد مدن خدمة نشطة حاليًا." />}
          <details style={{ marginBlockEnd: 12 }}>
            <summary>قراءة مدينة معروفة أو مراجعة سجل تاريخي</summary>
            <Input aria-label="معرّف المدينة" value={city} maxLength={64}
              disabled={busy || uncertain || !!pending} onChange={event => selectCity(event.target.value)} />
          </details>
          <Button htmlType="submit" disabled={!endpoint || busy} loading={busy}>قراءة سياسات المدينة الحالية</Button>
        </Form>
        {admission && (
          <section aria-label="قبول المتاجر حسب النموذج" style={{ marginBlockStart: 16 }}>
            <Typography.Title level={4}>قبول المتاجر الجديدة — DSH</Typography.Title>
            {(["MARKETPLACE", "DIRECT"] as const).map(relation => {
              const entry = admission[relation];
              return <Typography.Paragraph key={relation}>
                <strong>{relation === "MARKETPLACE" ? "متاجر السوق" : "المتاجر المباشرة"}:</strong>{" "}
                {entry.status === "unavailable" ? "تعذر التحقق من المالك" :
                  entry.policy.version === 0 ? "غير مهيأة — القبول غير متاح" :
                  (entry.policy.enabled ? "القبول متاح" : "القبول مغلق") + " — الإصدار " + entry.policy.version}
              </Typography.Paragraph>;
            })}
            <Link href="/policies/store-registration">إدارة سياسة القبول وسجلها</Link>
          </section>
        )}
        {policy && (
          <section aria-label="السياسة الحالية" style={{ marginBlockStart: 16 }}>
            <Typography.Paragraph>الإصدار: <strong>{policy.version}</strong> — المدينة: {policy.cityId}</Typography.Paragraph>
            <Typography.Paragraph>أقصى مدة إيقاف: {policy.maxPauseSeconds} ثانية؛ أقصى تحضير: {policy.maxPreparationMinutes} دقيقة.</Typography.Paragraph>
            <Typography.Paragraph>آخر تعديل بواسطة: {policy.changedByActor} — {policy.updatedAt}</Typography.Paragraph>
            <Typography.Paragraph>سبب التعديل الأخير: {policy.changeReason}</Typography.Paragraph>
          </section>
        )}
      </Card>
      {endpoint && !busy && !uncertain && <CityPolicyHistory key={actorId + ":" + city + ":" + (policy?.version ?? 0)}
        actorId={actorId} city={city} endpoint={endpoint} />}
      <Card title="تغيير سياسة إتاحة المتاجر" style={{ marginBlockEnd: 16 }}>
        <Alert type="info" showIcon message="أثر القرار" style={{ marginBlockEnd: 12 }}
          description="يحدد القرار حدود التشغيل للمدينة المحددة؛ لا يغير العقود أو الطلبات السابقة ولا ينشر المتاجر." />
        {policy && maxPause !== null && maxPreparation !== null && <section aria-label="مقارنة القيم الحالية والمقترحة">
          <Typography.Paragraph>الإيقاف: {policy.maxPauseSeconds} ← {maxPause} ثانية</Typography.Paragraph>
          <Typography.Paragraph>التحضير: {policy.maxPreparationMinutes} ← {maxPreparation} دقيقة</Typography.Paragraph>
        </section>}
        {!policy && (
          <Checkbox checked={provision} disabled={busy || uncertain || requiresRead} onChange={event => {
            setProvision(event.target.checked);
            resetCommand();
          }}>
            تهيئة أول إصدار لمدينة نشطة عمدًا (expectedVersion=0). لا تعني حالة 503 غياب سياسة.
          </Checkbox>
        )}
        <Form layout="vertical" style={{ marginBlockStart: 16 }} onFinish={() => void apply()}>
          <Form.Item label="الحد الأعلى لإيقاف المتجر بالثواني">
            <InputNumber aria-label="حد الإيقاف بالثواني" style={{ width: "100%" }}
              min={0} max={31536000} precision={0} value={maxPause}
              disabled={busy || uncertain || (!policy && !provision)}
              onChange={value => { setMaxPause(value); resetCommand(); }} />
          </Form.Item>
          <Form.Item label="الحد الأعلى لوقت التحضير بالدقائق">
            <InputNumber aria-label="حد التحضير بالدقائق" style={{ width: "100%" }}
              min={0} max={1440} precision={0} value={maxPreparation}
              disabled={busy || uncertain || (!policy && !provision)}
              onChange={value => { setMaxPreparation(value); resetCommand(); }} />
          </Form.Item>
          <Form.Item label="سبب التغيير (يُسجّل عند المالك)">
            <Input.TextArea aria-label="سبب تغيير السياسة" value={reason} maxLength={300}
              disabled={busy || uncertain || (!policy && !provision)} rows={3}
              onChange={event => { setReason(event.target.value); resetCommand(); }} />
          </Form.Item>
          <Space wrap>
            <Button type="primary" htmlType="submit" loading={busy}
              disabled={busy || (!pending && !readyForChange)}>
              {uncertain ? "إعادة إرسال نفس العملية" : "اعتماد سياسة المدينة في DSH"}
            </Button>
            {uncertain && <Button type="default" disabled={busy} onClick={() => void readCurrent()}>
              قراءة الحالة لدى المالك
            </Button>}
          </Space>
        </Form>
        {pending && <Typography.Paragraph style={{ marginBlockStart: 12 }}>
          معرّف العملية الثابت للمصالحة: <code>{pending.operationId}</code>
          {uncertain ? " — احتفظ به؛ لا تغير الأمر إلى أن تتضح النتيجة." : null}
        </Typography.Paragraph>}
      </Card>
      </section>
      {message && <Alert type="success" showIcon message={message} role="status" />}
      {errorMessage && <Alert type="error" showIcon message={errorMessage} role="alert" />}
    </main>
  );
}
