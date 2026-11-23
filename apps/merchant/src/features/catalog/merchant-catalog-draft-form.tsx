import { type MerchantCatalogDraftChange, validMerchantCatalogDraft } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { submitMerchantCatalogDraft } from "../access/admission-transport";

// An uncertain write retains the ORIGINAL payload and operationId. Never
// construct a fresh id until the previous outcome has been confirmed.
const digits = (value: string) => value.replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) & 15));
export default function MerchantCatalogDraftForm({ actorId, storeId, onCreated }: Readonly<{
  actorId: string; storeId: string; onCreated: () => void;
}>) {
  const { theme } = useMobileAppearance();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [pending, setPending] = useState<MerchantCatalogDraftChange | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const session = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing actor/Store must abort a pending owner mutation.
  useEffect(() => {
    session.current?.abort();
    inFlight.current = false;
    setName("");
    setPrice("");
    setQuantity("0");
    setPending(null);
    setSaving(false);
    setMessage("");
    const controller = new AbortController();
    session.current = controller;
    return () => { controller.abort(); };
  }, [actorId, storeId]);
  const rawStock = digits(quantity).trim();
  const normalizedPrice = digits(price).trim();
  const parsedStock = /^[0-9]{1,10}$/.test(rawStock) ? Number(rawStock) : -1;
  const proposed: MerchantCatalogDraftChange = {
    operationId: "preview-draft-0001", name: name.trim(),
    priceYer: normalizedPrice, stockUnits: parsedStock,
  };
  const valid = validMerchantCatalogDraft(proposed);
  async function submit() {
    if (!actorId || !storeId || inFlight.current || session.current?.signal.aborted ||
      (!pending && !valid)) return;
    const controller = session.current;
    if (!controller) return;
    const change = pending ?? { ...proposed, operationId: randomUUID() };
    inFlight.current = true;
    setSaving(true);
    setPending(change);
    setMessage("");
    try {
      await submitMerchantCatalogDraft(storeId, actorId, change, controller.signal);
      if (controller.signal.aborted) return;
      setPending(null);
      setName("");
      setPrice("");
      setQuantity("0");
      setMessage("حُفظت مسودة غير منشورة لدى DSH. يلزم استكمال الأهلية قبل البيع.");
      onCreated();
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      if (status === 400 || status === 409) {
        // A conflict is not a successful create; new requests must first
        // reconcile the original operation with its owner.
        setMessage("رفضت DSH هذه العملية أو تعارض معرّفها. تحقّق من سجل المنتجات قبل أي محاولة جديدة.");
      } else if (status === 401 || status === 403) {
        setMessage("انتهت الجلسة أو صلاحية المتجر. لا يمكن تأكيد هذه العملية بهذا الحساب.");
      } else {
        setMessage("نتيجة الإنشاء غير مؤكدة. أعد المحاولة بالعملية نفسها؛ لن يُنشأ معرّف جديد.");
      }
    } finally {
      if (!controller.signal.aborted) {
        inFlight.current = false;
        setSaving(false);
      }
    }
  }
  const input = { color: theme.color, borderWidth: 1, borderColor: theme.borderColor,
    borderRadius: 10, paddingHorizontal: 12, minHeight: 44, backgroundColor: theme.surface };
  return <View testID="merchant-create-catalog-draft" style={{ gap: 10,
    padding: 15, borderWidth: 1, borderRadius: 12, borderColor: theme.borderColor }}>
    <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 19, fontWeight: "700" }}>
      إضافة منتج كمسودة
    </Text>
    <Text style={{ color: theme.colorSecondary }}>
      المسودة محفوظة في DSH فقط؛ لا تظهر للعميل ولا تقبل الطلبات حتى تُستكمل شروط النشر.
    </Text>
    <Text style={{ color: theme.color }}>اسم المنتج</Text>
    <TextInput accessibilityLabel="اسم المنتج" style={input} value={pending?.name ?? name}
      maxLength={160} onChangeText={setName} editable={!pending && !saving}
      placeholder="مثال: قهوة يمنية" placeholderTextColor={theme.colorSecondary} />
    <Text style={{ color: theme.color }}>السعر بالريال اليمني</Text>
    <TextInput accessibilityLabel="السعر بالريال اليمني" style={input} value={pending?.priceYer ?? price}
      keyboardType="numeric" onChangeText={setPrice} editable={!pending && !saving}
      placeholder="1500" placeholderTextColor={theme.colorSecondary} />
    <Text style={{ color: theme.color }}>عدد الوحدات</Text>
    <TextInput accessibilityLabel="عدد الوحدات" style={input}
      value={pending ? String(pending.stockUnits) : quantity}
      keyboardType="number-pad" onChangeText={setQuantity} editable={!pending && !saving} />
    <Pressable accessibilityRole="button" accessibilityLabel={pending ? "إعادة تأكيد إنشاء المسودة" : "حفظ مسودة المنتج"}
      disabled={saving || (!pending && !valid)} onPress={() => void submit()}
      style={{ borderRadius: 10, minHeight: 48, justifyContent: "center",
        paddingHorizontal: 16, backgroundColor: theme.actionBackground, opacity: saving ? 0.6 : 1 }}>
      <Text style={{ color: theme.onAction, fontWeight: "700", textAlign: "center" }}>
        {saving ? "جارٍ التأكيد لدى DSH..." : pending ? "إعادة التأكيد بنفس العملية" : "حفظ مسودة غير منشورة"}
      </Text>
    </Pressable>
    {message ? <Text accessibilityRole="alert" style={{
      color: pending ? theme.warningText : theme.successText,
    }}>{message}</Text> : null}
  </View>;
}
