import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import type { CatalogImportCommitResponse, CatalogImportItem, CatalogImportPreviewResponse, CatalogImportRunResponse } from "./generated/dsh-types";
import type { DshCatalogImportFileInput } from "./mobile";
import { createDshMobileClient } from "./mobile";

type StoreCatalogImportScope = Readonly<{ kind: "FIELD"; joiningCaseID: string }> | Readonly<{ kind: "PARTNER"; storeID: string }>;
type StoreCatalogImportResult = CatalogImportPreviewResponse | CatalogImportRunResponse | CatalogImportCommitResponse;
type ImportAttempt = Readonly<{ previewKey: string; previewCorrelation: string; commitKey: string; commitCorrelation: string }>;

export type MobileStoreCatalogImportWorkspaceProps = Readonly<{
  client: ReturnType<typeof createDshMobileClient>;
  scope: StoreCatalogImportScope;
  getAccessToken: () => Promise<string>;
  pickFile: () => Promise<DshCatalogImportFileInput | null>;
  createUUID: () => string;
  onCommitted?: () => void | Promise<void>;
}>;

function classificationLabel(item: CatalogImportItem): string {
  switch (item.classification) {
    case "READY": return "جاهز للتطبيق";
    case "NEEDS_REVIEW": return "باركود غير معروف · للمراجعة";
    case "DUPLICATE_INPUT": return "مكرر في الملف";
    case "DUPLICATE_EXISTING": return "مطابق لسجل موجود";
    case "CONFLICT_EXISTING": return "تعارض يحتاج مراجعة";
    case "INVALID_INPUT": return "بيانات غير صالحة";
    case "IMPORTED": return "تم التطبيق";
    case "REPLAYED": return "إعادة آمنة";
    case "FAILED": return "تعذر التطبيق";
    default: return "غير مصنف";
  }
}

function isCommitAllowed(result: StoreCatalogImportResult): boolean {
  return result.run.state === "previewed" && result.run.acceptedCount > 0;
}

function importStateLabel(state: CatalogImportRunResponse["run"]["state"]): string {
  if (state === "previewed") return "جاهزة للمراجعة";
  if (state === "committed") return "تم اعتمادها";
  return "تحتاج إلى تعديل";
}

export function MobileStoreCatalogImportWorkspace({ client, scope, getAccessToken, pickFile, createUUID, onCommitted }: MobileStoreCatalogImportWorkspaceProps) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 10, padding: 14 },
    title: { color: theme.color, fontSize: 17, fontWeight: "700" },
    text: { color: theme.color, fontSize: 14, lineHeight: 20 },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19 },
    error: { color: theme.danger, fontSize: 14 },
    status: { borderColor: theme.borderColor, borderTopWidth: StyleSheet.hairlineWidth, gap: 8, paddingTop: 10 },
    item: { borderColor: theme.borderColor, borderTopWidth: StyleSheet.hairlineWidth, gap: 3, paddingTop: 8 },
  }), [theme]);
  const [file, setFile] = useState<DshCatalogImportFileInput | null>(null);
  const [result, setResult] = useState<StoreCatalogImportResult | null>(null);
  const [attempt, setAttempt] = useState<ImportAttempt | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | "read" | "pick" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function chooseFile() {
    if (busy) return;
    setBusy("pick");
    setError("");
    try {
      const selected = await pickFile();
      if (!selected) return;
      setFile(selected);
      setResult(null);
      setNotice("");
      setAttempt({ previewKey: createUUID(), previewCorrelation: createUUID(), commitKey: createUUID(), commitCorrelation: createUUID() });
    } catch {
      setError("تعذر اختيار ملف الكتالوج.");
    } finally {
      setBusy("");
    }
  }

  async function preview() {
    if (!file || !attempt || busy) return;
    const currentAttempt = result?.run.state === "rejected"
      ? { previewKey: createUUID(), previewCorrelation: createUUID(), commitKey: createUUID(), commitCorrelation: createUUID() }
      : attempt;
    if (currentAttempt !== attempt) setAttempt(currentAttempt);
    setResult(null);
    setBusy("preview");
    setError("");
    setNotice("");
    try {
      const token = await getAccessToken();
      const previewResult = scope.kind === "FIELD"
        ? await client.previewFieldStoreCatalogImport(token, scope.joiningCaseID, file, currentAttempt.previewKey, currentAttempt.previewCorrelation)
        : await client.previewPartnerStoreCatalogImport(token, scope.storeID, file, currentAttempt.previewKey, currentAttempt.previewCorrelation);
      setResult(previewResult);
      setNotice("أُنشئت المعاينة من الملف. الصفوف المجهولة محفوظة للمراجعة ولن تنشئ منتجات تلقائيًا.");
    } catch {
      setError("تعذر إنشاء المعاينة. أعد المحاولة من الزر نفسه.");
    } finally {
      setBusy("");
    }
  }

  async function readBack(runID: string) {
    setBusy("read");
    setError("");
    try {
      setResult(await readCurrentRun(runID));
    } catch {
      setError("تعذرت إعادة قراءة حالة الاستيراد.");
    } finally {
      setBusy("");
    }
  }

  async function readCurrentRun(runID: string) {
    const token = await getAccessToken();
    return scope.kind === "FIELD"
      ? await client.readFieldStoreCatalogImport(token, scope.joiningCaseID, runID)
      : await client.readPartnerStoreCatalogImport(token, scope.storeID, runID);
  }

  async function commit() {
    if (!result || !attempt || !isCommitAllowed(result) || busy) return;
    setBusy("commit");
    setError("");
    setNotice("");
    try {
      const token = await getAccessToken();
      const committed = scope.kind === "FIELD"
        ? await client.commitFieldStoreCatalogImport(token, scope.joiningCaseID, result.run.id, attempt.commitKey, attempt.commitCorrelation)
        : await client.commitPartnerStoreCatalogImport(token, scope.storeID, result.run.id, attempt.commitKey, attempt.commitCorrelation);
      setResult(committed);
      if (committed.run.state === "committed") {
        await onCommitted?.();
        setNotice("تم اعتماد الصفوف الصالحة. بقيت الصفوف التي تحتاج إلى مراجعة دون تغيير.");
      } else {
        setNotice("لم تُعتمد هذه المعاينة. أعد قراءتها ثم أنشئ معاينة جديدة.");
      }
    } catch {
      try {
        const current = await readCurrentRun(result.run.id);
        setResult(current);
        if (current.run.state === "committed") await onCommitted?.();
      } catch {
        // Keep the original commit error; the existing result remains available for a manual read.
      }
      setError("تعذر تأكيد الاعتماد. أُعيدت قراءة الحالة الممكنة؛ كرر الاعتماد إذا بقيت المعاينة جاهزة أو أعد معاينة الملف عند ظهور تعارض.");
    } finally {
      setBusy("");
    }
  }

  return <View style={styles.card}>
    <Text style={styles.title}>استيراد أسعار المتجر</Text>
    <Text style={styles.muted}>اختر ملفًا جدوليًا يحتوي باركودًا وسعرًا بالريال اليمني. الحد 5000 صف و20 ميغابايت. تُراجع المعاينة قبل الحفظ.</Text>
    <BthwaniButton busy={busy === "pick"} disabled={Boolean(busy)} label={file ? "اختيار ملف آخر" : "اختيار ملف الأسعار"} onPress={() => void chooseFile()} variant="secondary" />
    {file ? <Text style={styles.text}>{file.name}</Text> : null}
    {file && !result ? <BthwaniButton busy={busy === "preview"} disabled={Boolean(busy) || !attempt} label="معاينة الأسعار" onPress={() => void preview()} /> : null}
    {result ? <View style={styles.status}>
      <Text style={styles.text}>حالة المعاينة: {importStateLabel(result.run.state)} · جاهز: {result.run.acceptedCount} · يحتاج مراجعة: {result.run.conflictCount}</Text>
      <Text style={styles.muted}>تبقى الباركودات غير المعروفة للمراجعة؛ لا تُنشأ منها منتجات تلقائيًا.</Text>
      {result.items.map((item) => <View key={`${item.rowNumber}-${item.stableKey}`} style={styles.item}>
        <Text style={styles.text}>السطر {item.rowNumber} · {classificationLabel(item)}</Text>
        {item.errorMessage ? <Text style={styles.muted}>راجع بيانات هذا الصف.</Text> : null}
      </View>)}
      {isCommitAllowed(result) ? <BthwaniButton busy={busy === "commit"} disabled={Boolean(busy)} label="اعتماد الصفوف الصالحة" onPress={() => void commit()} /> : null}
      {result.run.state === "rejected" ? <>
        <Text style={styles.muted}>تغيرت بعض البيانات منذ إعداد المعاينة. راجع الملف وأعد معاينته قبل الاعتماد.</Text>
        <BthwaniButton busy={busy === "preview"} disabled={Boolean(busy)} label="إعادة معاينة الأسعار" onPress={() => void preview()} />
      </> : null}
      {result.run.state === "committed" ? <BthwaniButton busy={busy === "read"} disabled={Boolean(busy)} label="إعادة قراءة النتيجة" onPress={() => void readBack(result.run.id)} variant="secondary" /> : null}
    </View> : null}
    {busy && busy !== "pick" ? <ActivityIndicator color={theme.actionBackground} /> : null}
    {notice ? <Text accessibilityRole="summary" style={styles.text}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}
