"use client";

import type {
  OperatorStoreRegistrationChange, OperatorStoreRegistrationPolicy,
  OperatorStoreRegistrationPolicyHistoryPage,
  StoreRegistrationRelation,
} from "@bthwani/dsh";
import { Alert, Button, Card, Checkbox, Form, Input, Radio, Space, Typography } from "antd";
import { useState } from "react";
import {
  matchesPendingPolicy,
  type RegistrationOverview,
  readRegistrationHistory,
  readRegistrationOverview,
  readStoreRegistrationPolicy,
  reconcileRegistrationPolicy,
} from "./store-registration-command";

const validCity = /^[a-z0-9-]{1,64}$/;

export default function StoreRegistrationPolicyEditor({ actorId }: Readonly<{ actorId: string }>) {
  const [city, setCity] = useState("");
  const [relation, setRelation] = useState<StoreRegistrationRelation>("MARKETPLACE");
  const [policy, setPolicy] = useState<OperatorStoreRegistrationPolicy | null>(null);
  const [overview, setOverview] = useState<RegistrationOverview | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [history, setHistory] = useState<OperatorStoreRegistrationPolicyHistoryPage | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [termsVersion, setTermsVersion] = useState("");
  const [termsText, setTermsText] = useState("");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState<OperatorStoreRegistrationChange | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [needsRead, setNeedsRead] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const endpoint = validCity.test(city)
    ? `/api/policies/cities/${city}/store-registration/${relation}`
    : null;
  const locked = busy || overviewBusy || historyBusy || pending !== null;
  const canWrite = !!endpoint && !needsRead && !busy && !overviewBusy && !historyBusy && policy !== null &&
    /^[a-z0-9._-]{3,80}$/.test(termsVersion) &&
    termsText.trim().length >= 1 && [...termsText].length <= 4000 &&
    reason.trim().length >= 1 && [...reason].length <= 300 &&
    (!enabled || reviewed);

  function resetScope() {
    setHistory(null);
    setHistoryError("");
    setOverview(null);
    setPolicy(null);
    setPending(null);
    setUnknown(false);
    setNeedsRead(true);
    setTermsVersion("");
    setTermsText("");
    setReason("");
    setEnabled(false);
    setReviewed(false);
    setMessage("");
    setError("");
  }
  async function refresh() {
    if (!endpoint || busy || overviewBusy || historyBusy) return;
    setBusy(true);
    setMessage("");
    setError("");
    setOverview(null);
    setHistory(null);
    setHistoryError("");
    try {
      const current = await readStoreRegistrationPolicy(endpoint, city, relation, actorId);
      setPolicy(current);
      setNeedsRead(false);
      if (pending) {
        if (matchesPendingPolicy(current, actorId, pending)) {
          setPending(null);
          setUnknown(false);
          setEnabled(current.enabled);
          setTermsVersion(current.termsVersion ?? "");
          setTermsText(current.termsText ?? "");
          setReviewed(false);
          setReason("");
          setMessage("تم تأكيد عملية التعديل من قراءة DSH المستقلة.");
        } else if (current.version > pending.expectedVersion + 1) {
          setPending(null);
          setUnknown(false);
          setNeedsRead(true);
          setError("تقدمت السياسة إلى إصدار أحدث؛ أعد القراءة قبل إنشاء عملية جديدة.");
        } else {
          setUnknown(true);
          setError("لا تثبت القراءة تنفيذ العملية. أعد إرسال العملية نفسها بمعرّفها المحفوظ.");
        }
      } else {
        setEnabled(current.enabled);
        setTermsVersion(current.termsVersion ?? "");
        setTermsText(current.termsText ?? "");
        setReviewed(false);
        setReason("");
        setMessage(current.version === 0 ?
          "لا توجد سياسة مسجلة؛ التسجيل مغلق، ويمكن إنشاء سياسة أولى بإصدار متوقع 0." :
          "تمت قراءة سياسة قبول المتاجر الحالية من DSH.");
      }
    } catch (cause) {
      setNeedsRead(true);
      setPolicy(null);
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة السياسة من DSH.");
    } finally {
      setBusy(false);
    }
  }
  async function checkBothModels() {
    if (!validCity.test(city) || locked) return;
    setOverviewBusy(true);
    setOverview(null);
    setError("");
    try {
      setOverview(await readRegistrationOverview(city, actorId));
    } catch {
      setError("تعذر قراءة حالتي تسجيل المتاجر من DSH. لم تُفترض أي حالة إتاحة.");
    } finally {
      setOverviewBusy(false);
    }
  }

  async function viewHistory(older = false) {
    if (!endpoint || locked || (older && !history?.nextBeforeVersion)) return;
    const cursor = older ? history?.nextBeforeVersion : undefined;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const page = await readRegistrationHistory(endpoint, city, relation, actorId, cursor);
      setHistory(older && history ? {
        entries: [...history.entries, ...page.entries],
        ...(page.nextBeforeVersion ? { nextBeforeVersion: page.nextBeforeVersion } : {}),
      } : page);
    } catch {
      setHistoryError("تعذرت قراءة سجل السياسات من DSH؛ لم تُعرض سجلات تقديرية.");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function save() {
    if (!endpoint || busy || (!pending && !canWrite)) return;
    const change: OperatorStoreRegistrationChange = pending ?? {
      operationId: crypto.randomUUID(),
      expectedVersion: policy?.version ?? 0,
      enabled,
      termsVersion,
      termsText,
      reason,
    };
    setPending(change);
    setBusy(true);
    setMessage("");
    setError("");
    setOverview(null);
    setHistory(null);
    setHistoryError("");
    const result = await reconcileRegistrationPolicy(endpoint, city, relation, actorId, change);
    setBusy(false);
    if (result.status === "confirmed") {
      setPending(null);
      setUnknown(false);
      setPolicy(result.current);
      setEnabled(result.current.enabled);
      setTermsVersion(result.current.termsVersion ?? "");
      setTermsText(result.current.termsText ?? "");
      setReason("");
      setReviewed(false);
      setNeedsRead(false);
      setMessage(result.superseded ? "نجحت العملية، ثم عدّل مشغّل آخر السياسة." :
        result.replay ? "أكد DSH استعادة نتيجة العملية السابقة دون تكرار." :
          "تم حفظ سياسة قبول المتاجر والتحقق من قراءتها لدى DSH.");
      return;
    }
    if (result.status === "unknown") {
      setUnknown(true);
      setError("نتيجة التعديل غير مؤكدة. حافظنا على معرّف العملية ونصها؛ اقرأ DSH أو أعد المحاولة نفسها.");
      return;
    }
    setPending(null);
    setUnknown(false);
    if (result.status === "conflict" || result.status === "denied") {
      setNeedsRead(true);
      setPolicy(null);
      setError(result.status === "conflict" ?
        "تغيّر الإصدار أو استخدم معرّف العملية لطلب آخر. اقرأ سياسة DSH قبل إعادة المحاولة." :
        "رفض Identity الصلاحية أو جلسة المشغّل؛ لن نكرر العملية دون تحقق جديد.");
    } else {
      setError("رفض DSH البيانات. راجع الشروط والإصدار والسبب قبل الإرسال مجددًا.");
    }
  }

  return (
    <main style={{ maxWidth: 900, marginInline: "auto", paddingBlock: 24 }} dir="rtl">
      <Typography.Title level={1}>سياسة قبول المتاجر الجديدة</Typography.Title>
      <Typography.Paragraph>
        يملك DSH قبول المتاجر الجديدة لكل مدينة وطريقة عمل. هذه السياسة لا تنشر متجرًا،
        ولا تمنح دور التاجر في Identity، ولا تفعّل الطلبات أو أي تسوية لدى WLT.
        لا يستطيع تغييرها إلا مشغّل مفوّض بصلاحية <code>platform_policies</code>.
      </Typography.Paragraph>
      <Alert type="info" showIcon style={{ marginBlockEnd: 16 }}
        message="نموذجان، سياسة قبول مستقلة لكل منهما"
        description="المباشر: ظهور صفحة المتجر عبر الرابط بعد النشر. السوق: أهلية الظهور في سوق بثواني بعد المراجعة. فتح التسجيل لا يوافق تلقائيًا على نشر المتجر أو اتفاقية WLT؛ العمولة والاشتراك والتحصيل والتوصيل ليست مشتقة من النموذج." />
      <Card title="تحديد المدينة وطريقة عمل المتجر" style={{ marginBlockEnd: 16 }}>
        <Form layout="vertical" onFinish={() => void refresh()}>
          <Form.Item label="معرّف المدينة في DSH">
            <Input aria-label="معرّف مدينة قبول المتاجر" value={city} maxLength={64}
              disabled={locked} placeholder="مثال: sanaa" onChange={event => {
                setCity(event.target.value);
                resetScope();
              }} />
          </Form.Item>
          <Form.Item label="طريقة العمل">
            <Radio.Group value={relation} disabled={locked} onChange={event => {
              setRelation(event.target.value as StoreRegistrationRelation);
              resetScope();
            }}>
              <Radio value="MARKETPLACE">داخل سوق بثواني</Radio>
              <Radio value="DIRECT">متجر مباشر</Radio>
            </Radio.Group>
          </Form.Item>
          <Button htmlType="submit" disabled={!endpoint || busy || overviewBusy} loading={busy}>قراءة السياسة من DSH</Button>
        </Form>
        <Button style={{ marginBlockStart: 12 }} disabled={!validCity.test(city) || locked}
          loading={overviewBusy} onClick={() => void checkBothModels()}>
          عرض حالة قبول المباشر والسوق معًا
        </Button>
        {overview && (
          <section aria-label="حالة قبول النموذجين لدى DSH" style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10, marginBlockStart: 12,
          }}>
            {(["DIRECT", "MARKETPLACE"] as const).map(model => {
              const entry = overview[model];
              return (
                <Card size="small" key={model} title={model === "DIRECT" ? "المباشر" : "سوق بثواني"}>
                  {entry.status === "unavailable" ? (
                    <Typography.Text type="warning">تعذرت القراءة؛ الإتاحة غير مؤكدة.</Typography.Text>
                  ) : entry.policy.version === 0 ? (
                    <Typography.Text>غير مُهيأ؛ التسجيل غير متاح.</Typography.Text>
                  ) : (
                    <>
                      <Typography.Paragraph>
                        {entry.policy.enabled ? "التسجيل متاح" : "التسجيل مغلق"}
                      </Typography.Paragraph>
                      <Typography.Text type="secondary">
                        السياسة {entry.policy.version} — الشروط {entry.policy.termsVersion}
                      </Typography.Text>
                    </>
                  )}
                </Card>
              );
            })}
          </section>
        )}
        {policy && (
          <section aria-label="السياسة الفعلية لدى DSH" style={{ marginBlockStart: 14 }}>
            <Typography.Paragraph>
              المدينة: {policy.cityId} — النموذج: {policy.relation === "DIRECT" ? "المباشر" : "السوق"} —
              الإصدار: <strong>{policy.version}</strong> —
              الحالة: {policy.enabled ? "قبول التسجيل متاح" : "قبول التسجيل مغلق"}
            </Typography.Paragraph>
            {policy.version > 0 ? (
              <>
                <Typography.Paragraph>إصدار الشروط: {policy.termsVersion}</Typography.Paragraph>
                <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>{policy.termsText}</Typography.Paragraph>
                <Typography.Paragraph>
                  آخر تعديل: {policy.changedByActor} — {policy.updatedAt}
                </Typography.Paragraph>
                <Typography.Paragraph>سبب التعديل: {policy.changeReason}</Typography.Paragraph>
              </>
            ) : (
              <Typography.Paragraph>
                لا توجد سياسة مسجلة لهذا النموذج في المدينة؛ التسجيل غير متاح حتى اعتماد السياسة.
              </Typography.Paragraph>
            )}
          </section>
        )}
      </Card>
      <Card title="سجل قرارات قبول المتاجر — DSH" style={{ marginBlockEnd: 16 }}>
        <Typography.Paragraph>
          سجل قراءة فقط للتغييرات المحفوظة في DSH. لا تُختلق إصدارات أقدم من بدء سجل الأوامر
          غير القابل للتعديل، ولا يغيّر العرض الحقوق أو تسجيل المتاجر.
        </Typography.Paragraph>
        <Button disabled={!endpoint || locked} loading={historyBusy}
          onClick={() => void viewHistory(false)}>
          عرض سجل هذا النموذج والمدينة
        </Button>
        {history && (
          <section aria-label="سجل سياسات التسجيل" style={{ marginBlockStart: 12 }}>
            {history.entries.length === 0 ? (
              <Typography.Paragraph>لا توجد أوامر تغيير محفوظة لهذا النموذج.</Typography.Paragraph>
            ) : history.entries.map(entry => (
              <Card key={entry.version} size="small" style={{ marginBlockEnd: 8 }}>
                <Typography.Text strong>الإصدار {entry.version} — {entry.enabled ? "السماح بالتسجيل" : "إغلاق التسجيل"}</Typography.Text>
                <Typography.Paragraph style={{ marginBlockEnd: 0 }}>
                  الشروط: {entry.termsVersion} — المشغّل: {entry.changedByActor}
                </Typography.Paragraph>
                <Typography.Paragraph style={{ marginBlockEnd: 0 }}>السبب: {entry.changeReason}</Typography.Paragraph>
                <Typography.Text type="secondary">التاريخ: {entry.updatedAt}</Typography.Text>
              </Card>
            ))}
            {history.nextBeforeVersion && (
              <Button disabled={locked} loading={historyBusy}
                onClick={() => void viewHistory(true)}>
                عرض الإصدارات الأقدم
              </Button>
            )}
          </section>
        )}
        {historyError && <Alert type="error" showIcon role="alert" message={historyError}
          style={{ marginBlockStart: 12 }} />}
      </Card>
      <Card title="تحديث سياسة التسجيل">
        <Form layout="vertical" onFinish={() => void save()}>
          <Form.Item label="حالة قبول متاجر جديدة">
            <Checkbox checked={enabled} disabled={locked || needsRead || !policy} onChange={event => {
              setEnabled(event.target.checked);
              setReviewed(false);
            }}>
              السماح بإنشاء متاجر جديدة لهذه المدينة وطريقة العمل فقط
            </Checkbox>
          </Form.Item>
          <Form.Item label="إصدار الشروط القانونية المعتمد">
            <Input aria-label="إصدار شروط قبول المتاجر" value={termsVersion} maxLength={80}
              disabled={locked || needsRead} onChange={event => setTermsVersion(event.target.value)}
              placeholder="مثال: merchant-terms-v1" />
          </Form.Item>
          <Form.Item label="نص الشروط الذي سيقرأه التاجر قبل الموافقة">
            <Input.TextArea aria-label="نص شروط تسجيل المتجر" value={termsText} rows={5}
              maxLength={4000} disabled={locked || needsRead}
              onChange={event => setTermsText(event.target.value)} />
          </Form.Item>
          <Form.Item label="سبب القرار (سجل تدقيق DSH)">
            <Input.TextArea aria-label="سبب قرار قبول المتاجر" value={reason} maxLength={300}
              rows={2} disabled={locked || needsRead}
              onChange={event => setReason(event.target.value)} />
          </Form.Item>
          {enabled && (
            <Checkbox checked={reviewed} disabled={locked || needsRead} onChange={event => setReviewed(event.target.checked)}>
              أؤكد مراجعة الشروط والمدينة وطريقة العمل قبل السماح بانضمام متاجر جديدة.
            </Checkbox>
          )}
          <Space wrap style={{ marginBlockStart: 16 }}>
            <Button type="primary" htmlType="submit" loading={busy}
              disabled={busy || (!pending && !canWrite)}>
              {unknown ? "إعادة العملية نفسها دون تكرار" : "حفظ سياسة قبول المتاجر في DSH"}
            </Button>
            {pending && <Button disabled={busy} onClick={() => void refresh()}>التحقق من نتيجة العملية لدى DSH</Button>}
          </Space>
          {pending && (
            <Typography.Paragraph style={{ marginBlockStart: 12 }}>
              معرّف العملية المحفوظ: <code>{pending.operationId}</code>. لا يتم إنشاء معرّف جديد حتى تتضح نتيجتها.
            </Typography.Paragraph>
          )}
        </Form>
      </Card>
      {message && <Alert type="success" showIcon role="status" message={message} style={{ marginBlockStart: 12 }} />}
      {error && <Alert type="error" showIcon role="alert" message={error} style={{ marginBlockStart: 12 }} />}
    </main>
  );
}
