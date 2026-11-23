import { type MerchantCatalogDraftChange, type MerchantCatalogDraftEditChange, type MerchantCatalogOffer, validMerchantCatalogDraft, validMerchantCatalogDraftEdit } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { submitMerchantCatalogDraft, submitMerchantCatalogDraftEdit } from "./catalog-transport";

// An uncertain write retains the ORIGINAL payload and operationId. Never
// construct a fresh id until the previous outcome has been confirmed.
const digits = (value: string) => value.replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) & 15));
const digest = (value: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

type DraftAttempt = Readonly<{
  operationId: string;
  fingerprint: string;
  expectedVersion: number | null;
}>;

async function readAttempt(key: string, editing: boolean): Promise<DraftAttempt | null> {
  const raw = Platform.OS === "web"
    ? window.localStorage.getItem(key)
    : await SecureStore.getItemAsync(key, secureOptions);
  if (raw === null) return null;
  const record: DraftAttempt | null = JSON.parse(raw);
  if (!record || Object.keys(record).length !== 3 ||
    typeof record.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record.fingerprint) ||
    typeof record.operationId !== "string" || !/^[A-Za-z0-9._-]{8,128}$/.test(record.operationId) ||
    (editing
      ? typeof record.expectedVersion !== "number" || !Number.isSafeInteger(record.expectedVersion) ||
        record.expectedVersion < 1 || record.expectedVersion >= Number.MAX_SAFE_INTEGER
      : record.expectedVersion !== null)) {
    throw new Error("Invalid draft recovery metadata");
  }
  return record;
}

async function writeAttempt(key: string, record: DraftAttempt | null) {
  if (Platform.OS === "web") {
    if (record) window.localStorage.setItem(key, JSON.stringify(record));
    else window.localStorage.removeItem(key);
  } else if (record) {
    await SecureStore.setItemAsync(key, JSON.stringify(record), secureOptions);
  } else {
    await SecureStore.deleteItemAsync(key, secureOptions);
  }
}

// Serialize claims and acknowledgments across mounted forms. On Web, use
// the same lock across tabs when the browser provides Web Locks.
let storageQueue = Promise.resolve();
function withAttemptLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (Platform.OS === "web" && window.navigator?.locks) {
    return window.navigator.locks.request(key, action);
  }
  const result = storageQueue.then(action);
  storageQueue = result.then(() => undefined, () => undefined);
  return result;
}

function clearAttempt(key: string, editing: boolean, operationId: string) {
  return withAttemptLock(key, async () => {
    const stored = await readAttempt(key, editing);
    if (stored?.operationId === operationId) await writeAttempt(key, null);
  });
}

export default function MerchantCatalogDraftForm({ actorId, storeId, onCreated, draft }: Readonly<{
  actorId: string; storeId: string; onCreated: () => void;
  draft?: MerchantCatalogOffer;
}>) {
  const { theme } = useMobileAppearance();
  const [name, setName] = useState(draft?.name ?? "");
  const [price, setPrice] = useState(draft?.priceYer ?? "");
  const [quantity, setQuantity] = useState(draft ? String(draft.stockUnits) : "0");
  const [pending, setPending] = useState<MerchantCatalogDraftChange | MerchantCatalogDraftEditChange | null>(null);
  const [recovery, setRecovery] = useState<{ key: string; attempt: DraftAttempt | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState("");
  const session = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing actor/Store must abort a pending owner mutation.
  useEffect(() => {
    session.current?.abort();
    inFlight.current = false;
    setName(draft?.name ?? "");
    setPrice(draft?.priceYer ?? "");
    setQuantity(draft ? String(draft.stockUnits) : "0");
    setPending(null);
    setRecovery(null);
    setSaving(false);
    setNeedsRefresh(false);
    setMessage("");
    const controller = new AbortController();
    session.current = controller;
    void (async () => {
      try {
        const key = "bthwani.merchant.catalog-attempt." +
          await digest(JSON.stringify([actorId, storeId, draft?.id ?? null]));
        const attempt = await readAttempt(key, Boolean(draft));
        if (controller.signal.aborted) return;
        setRecovery({ key, attempt });
        if (attempt) setMessage("توجد محاولة سابقة غير مؤكدة. أدخل القيم نفسها لإعادة التأكيد لدى DSH.");
      } catch {
        if (!controller.signal.aborted) setMessage("تعذّر قراءة سجل الاسترداد. أعد فتح النموذج للمحاولة.");
      }
    })();
    return () => { controller.abort(); };
  }, [actorId, storeId, draft?.id, draft?.draftVersion]);
  const rawStock = digits(quantity).trim();
  const normalizedPrice = digits(price).trim();
  const parsedStock = /^[0-9]{1,10}$/.test(rawStock) ? Number(rawStock) : -1;
  const proposed: MerchantCatalogDraftChange = {
    operationId: "preview-draft-0001", name: name.trim(),
    priceYer: normalizedPrice, stockUnits: parsedStock,
  };
  const proposedEdit = draft ? { ...proposed, expectedVersion: draft.draftVersion } : null;
  const valid = proposedEdit ? validMerchantCatalogDraftEdit(proposedEdit) : validMerchantCatalogDraft(proposed);
  async function submit() {
    if (!actorId || !storeId || !recovery || needsRefresh || inFlight.current || session.current?.signal.aborted ||
      (!pending && !valid)) return;
    if (draft && (draft.storeId !== storeId || draft.published || draft.available ||
      draft.productActive || draft.variantSellable || draft.requiredAttributesValid)) return;
    const controller = session.current;
    if (!controller) return;
    const values = pending ?? proposed;
    const { key } = recovery;
    const editing = Boolean(draft);
    inFlight.current = true;
    setSaving(true);
    setMessage("");
    let dispatchedId: string | undefined;
    try {
      const claim = await withAttemptLock(key, async () => {
        const stored = await readAttempt(key, editing);
        const expectedVersion = stored?.expectedVersion ?? proposedEdit?.expectedVersion ?? null;
        const fingerprint = await digest(JSON.stringify([values.name, values.priceYer, values.stockUnits, expectedVersion]));
        if (controller.signal.aborted) return null;
        // If another tab already cleared our restored attempt, refresh the
        // catalogue instead of issuing a new ID for the same uncertain write.
        if (recovery.attempt && stored?.operationId !== recovery.attempt.operationId) {
          return { attempt: stored, matches: false };
        }
        if (stored) return { attempt: stored, matches: stored.fingerprint === fingerprint };
        const attempt = { operationId: randomUUID(), fingerprint, expectedVersion };
        await writeAttempt(key, attempt);
        return { attempt, matches: true };
      });
      if (controller.signal.aborted || !claim) return;
      const { attempt, matches } = claim;
      setRecovery({ key, attempt });
      if (!attempt || !matches) {
        setPending(null);
        setMessage(attempt
          ? "تختلف القيم عن المحاولة السابقة. أدخل القيم نفسها لإعادة التأكيد لدى DSH."
          : "تغيّرت محاولة الاسترداد. حدّث الكتالوج قبل المتابعة.");
        if (!attempt) onCreated();
        return;
      }
      const change: MerchantCatalogDraftChange = {
        operationId: attempt.operationId, name: values.name,
        priceYer: values.priceYer, stockUnits: values.stockUnits,
      };
      const edit = attempt.expectedVersion === null ? null : { ...change, expectedVersion: attempt.expectedVersion };
      setPending(edit ?? change);
      dispatchedId = attempt.operationId;
      if (draft && edit) {
        await submitMerchantCatalogDraftEdit(storeId, draft.id, actorId, edit, controller.signal);
      } else {
        await submitMerchantCatalogDraft(storeId, actorId, change, controller.signal);
      }
      await clearAttempt(key, editing, attempt.operationId);
      if (controller.signal.aborted) return;
      setRecovery({ key, attempt: null });
      setPending(null);
      setName("");
      setPrice("");
      setQuantity("0");
      setMessage(draft ? "حُفظ تعديل المسودة لدى DSH، وبقيت غير منشورة." : "حُفظت مسودة غير منشورة لدى DSH. يلزم استكمال الأهلية قبل البيع.");
      onCreated();
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      if (!dispatchedId) {
        setMessage("تعذّر حفظ محاولة الاسترداد. أعد المحاولة.");
      } else if (editing && status === 409 && error && typeof error === "object" &&
        "code" in error && error.code === "CATALOG_DRAFT_VERSION_CONFLICT") {
        // DSH looks up the operation before testing the version. This code
        // confirms there is no committed edit for the submitted operation.
        try {
          await clearAttempt(key, editing, dispatchedId);
          if (controller.signal.aborted) return;
          setRecovery({ key, attempt: null });
          setPending(null);
          setNeedsRefresh(true);
          setMessage("تغيّرت المسودة لدى DSH. حدّث بياناتها قبل إجراء تعديل آخر.");
        } catch {
          if (!controller.signal.aborted) setMessage("تعذّر تحديث سجل الاسترداد. أعد التأكيد بالمفتاح نفسه.");
        }
      } else if (status === 400 || status === 409) {
        // A conflict is not a successful create; new requests must first
        // reconcile the original operation with its owner.
        setMessage("رفضت DSH هذه العملية أو تعارض معرّفها. تحقّق من سجل المنتجات قبل أي محاولة جديدة.");
      } else if (status === 401 || status === 403) {
        setMessage("انتهت الجلسة أو صلاحية المتجر. لا يمكن تأكيد هذه العملية بهذا الحساب.");
      } else {
        setMessage("نتيجة الكتابة غير مؤكدة. أعد المحاولة بمفتاح العملية نفسه؛ لن يُنشأ معرّف جديد.");
      }
    } finally {
      if (!controller.signal.aborted) {
        inFlight.current = false;
        setSaving(false);
      }
    }
  }
  const recovering = Boolean(recovery?.attempt);
  const editable = !!recovery && !pending && !saving && !needsRefresh;
  const actionLabel = needsRefresh ? "تحديث مسودة الكتالوج" : recovering ? "إعادة تأكيد المسودة" :
    draft ? "حفظ تعديل المسودة" : "حفظ مسودة المنتج";
  const input = { color: theme.color, borderWidth: 1, borderColor: theme.borderColor,
    borderRadius: 10, paddingHorizontal: 12, minHeight: 44, backgroundColor: theme.surface };
  return <View testID={draft ? "merchant-edit-catalog-draft" : "merchant-create-catalog-draft"} style={{ gap: 10,
    padding: 15, borderWidth: 1, borderRadius: 12, borderColor: theme.borderColor }}>
    <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 19, fontWeight: "700" }}>
      {draft ? "تعديل مسودة المنتج" : "إضافة منتج كمسودة"}
    </Text>
    <Text style={{ color: theme.colorSecondary }}>
      المسودة محفوظة في DSH فقط؛ لا تظهر للعميل ولا تقبل الطلبات حتى تُستكمل شروط النشر.
    </Text>
    <Text style={{ color: theme.color }}>اسم المنتج</Text>
    <TextInput accessibilityLabel="اسم المنتج" style={input} value={pending?.name ?? name}
      maxLength={160} onChangeText={setName} editable={editable}
      placeholder="مثال: قهوة يمنية" placeholderTextColor={theme.colorSecondary} />
    <Text style={{ color: theme.color }}>السعر بالريال اليمني</Text>
    <TextInput accessibilityLabel="السعر بالريال اليمني" style={input} value={pending?.priceYer ?? price}
      keyboardType="numeric" onChangeText={setPrice} editable={editable}
      placeholder="1500" placeholderTextColor={theme.colorSecondary} />
    <Text style={{ color: theme.color }}>عدد الوحدات</Text>
    <TextInput accessibilityLabel="عدد الوحدات" style={input}
      value={pending ? String(pending.stockUnits) : quantity}
      keyboardType="number-pad" onChangeText={setQuantity} editable={editable} />
    <Pressable accessibilityRole="button" accessibilityLabel={actionLabel}
      disabled={!recovery || saving || (!needsRefresh && !pending && !valid)}
      onPress={needsRefresh ? onCreated : () => void submit()}
      style={{ borderRadius: 10, minHeight: 48, justifyContent: "center",
        paddingHorizontal: 16, backgroundColor: theme.actionBackground, opacity: saving ? 0.6 : 1 }}>
      <Text style={{ color: theme.onAction, fontWeight: "700", textAlign: "center" }}>
        {saving ? "جارٍ التأكيد لدى DSH..." : actionLabel}
      </Text>
    </Pressable>
    {message ? <Text accessibilityRole="alert" style={{
      color: saving || !recovery || recovering || needsRefresh ? theme.warningText : theme.colorSecondary,
    }}>{message}</Text> : null}
  </View>;
}
