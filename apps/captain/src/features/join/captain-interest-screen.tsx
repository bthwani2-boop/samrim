import {
  type CaptainInterestInput,
  type CaptainPhoneType,
  type CaptainVehicleType,
  DshPublicError,
  submitCaptainInterest,
  validCaptainInterest,
} from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { createRadioGroup } from "@bthwani/tamagui-config/radio-group";
import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Choice<T> = Readonly<{ value: T; label: string }>;
const vehicles: readonly Choice<CaptainVehicleType>[] = [
  { value: "MOTORCYCLE", label: "دراجة نارية" },
  { value: "ELECTRIC", label: "دراجة كهربائية" },
  { value: "BICYCLE", label: "دراجة هوائية" },
  { value: "NONE", label: "لا أمتلك دراجة" },
];
const phones: readonly Choice<CaptainPhoneType>[] = [
  { value: "SMART", label: "هاتف ذكي (Android / iPhone)" },
  { value: "BASIC", label: "هاتف عادي" },
  { value: "NONE", label: "لا أمتلك هاتفًا" },
];
const yesNo: readonly Choice<boolean>[] = [
  { value: true, label: "نعم" },
  { value: false, label: "لا" },
];
const dshOrigin = process.env.EXPO_PUBLIC_BTHWANI_ISOLATED_DSH_ORIGIN ?? "";

/** Public contact intake only; DSH owns validation, storage and the receipt. */
export default function CaptainInterestScreen() {
  const { theme } = useMobileAppearance();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [vehicle, setVehicle] = useState<CaptainVehicleType>("MOTORCYCLE");
  const [plate, setPlate] = useState<boolean | null>(null);
  const [phoneType, setPhoneType] = useState<CaptainPhoneType>("SMART");
  const [experienced, setExperienced] = useState(false);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<"received" | "unknown" | null>(null);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const terminal = useRef(false);
  useEffect(() => () => { request.current?.abort(); }, []);

  const needsPlate = vehicle === "MOTORCYCLE" || vehicle === "ELECTRIC";
  const input: CaptainInterestInput = {
    name: name.trim(),
    phone: phone.trim().replace(/[٠-٩۰-۹]/g, digit =>
      String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0))),
    city: city.trim(),
    district: district.trim(),
    vehicleType: vehicle,
    ...(needsPlate && plate !== null ? { plateRegistered: plate } : {}),
    phoneType,
    experienced,
    ...(experienced && details.trim() ? { experienceDetails: details.trim() } : {}),
  };
  const canSubmit = !busy && !receipt && Boolean(dshOrigin) && validCaptainInterest(input);
  const canEdit = () => !request.current && !terminal.current;
  const labelStyle = { color: theme.color, fontWeight: "600" as const };
  const fieldStyle = {
    borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10,
    color: theme.color, padding: 12, fontSize: 16, minHeight: 48,
  } as const;

  // One local selection renderer for every enum and boolean field. Native and
  // Web expose the same checked state, including an unanswered plate question.
  function choices<T extends string | boolean>(
    label: string, items: readonly Choice<T>[], current: T | null,
    choose: (value: T) => void, inline = false,
  ) {
    const radio = createRadioGroup({ values: items.map(item => item.value), selected: current, disabled: busy,
      web: Platform.OS === "web", canSelect: canEdit, onSelect: value => { if (value !== current) choose(value); } });
    return (
      <View style={{ gap: 5 }}>
        <Text style={labelStyle}>{label} *</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={label}
          style={{ gap: 8, flexDirection: inline ? "row" : "column" }}>
          {items.map(item => {
            const checked = item.value === current;
            return (
              <Pressable key={String(item.value)} {...radio(item.value)} accessibilityLabel={item.label}
                style={{
                  ...(inline ? { flex: 1 } : {}),
                  minHeight: 44, justifyContent: "center", padding: 12,
                  borderWidth: 1, borderRadius: 10,
                  borderColor: checked ? theme.actionBackground : theme.borderColor,
                  backgroundColor: checked ? theme.actionSoft : "transparent",
                }}>
                <Text style={{ color: theme.color, textAlign: inline ? "center" : "auto" }}>
                  {checked ? "◉  " : "○  "}{item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  function field(label: string, value: string, change: (value: string) => void,
    maxLength: number, kind: "text" | "phone" | "details" = "text") {
    return (
      <View style={{ gap: 5 }}>
        <Text style={labelStyle}>{label}{kind === "details" ? " (اختياري)" : " *"}</Text>
        <TextInput accessibilityLabel={label} style={fieldStyle} value={value}
          onChangeText={next => { if (canEdit()) change(next); }}
          maxLength={maxLength} editable={!busy}
          {...(kind === "phone" ? { keyboardType: "phone-pad" as const, autoComplete: "tel" as const, placeholder: "77XXXXXXX" } : {})}
          {...(kind === "details" ? { multiline: true } : {})} />
      </View>
    );
  }

  async function submit() {
    if (!canSubmit || !canEdit()) return;
    const active = new AbortController();
    request.current = active;
    setBusy(true);
    setMessage("");
    try {
      await submitCaptainInterest(dshOrigin, input, active.signal);
      if (!active.signal.aborted) {
        terminal.current = true;
        setReceipt("received");
      }
    } catch (reason) {
      if (active.signal.aborted) return;
      if (reason instanceof DshPublicError && reason.code === "OPERATION_RESULT_UNKNOWN") {
        terminal.current = true;
        setReceipt("unknown");
      } else {
        setMessage(reason instanceof DshPublicError && reason.status === 429
          ? "تم تجاوز عدد المحاولات المسموح. حاول لاحقًا."
          : "تعذّر إرسال البيانات. تحقق من الحقول والاتصال.");
      }
    } finally {
      if (request.current === active) {
        request.current = null;
        if (!active.signal.aborted) setBusy(false);
      }
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 15, maxWidth: 560, alignSelf: "center", width: "100%" }}>
        <Link href="/" accessibilityRole="link" style={{ color: theme.interactiveText }}>
          العودة إلى تسجيل الدخول
        </Link>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 26, fontWeight: "700" }}>
          انضم إلى كباتن بثواني
        </Text>
        {receipt ? (
          <View style={{ backgroundColor: theme.surface, padding: 18, borderRadius: 12 }}>
            <Text accessibilityRole="alert"
              testID={receipt === "received" ? "captain-interest-received" : "captain-interest-uncertain"}
              style={{ color: receipt === "received" ? theme.successText : theme.warningText, fontSize: 17 }}>
              {receipt === "received"
                ? "تم استلام بياناتك بنجاح. سيتم التواصل هاتفيًا مع الأشخاص المناسبين عند توفر الفرص."
                : "تعذّر تأكيد استلام البيانات. ربما وصلت بالفعل، ويمكنك العودة إلى تسجيل الدخول."}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            <Text style={{ color: theme.colorSecondary }}>
              سجّل بياناتك مرة واحدة. التسجيل لا يعني القبول، وسنتواصل هاتفيًا مع المناسبين فقط.
            </Text>
            {field("الاسم الكامل", name, setName, 100)}
            {field("رقم الهاتف", phone, setPhone, 13, "phone")}
            {field("المدينة", city, setCity, 80)}
            {field("الحي أو منطقة السكن", district, setDistrict, 100)}
            {choices("نوع الدراجة", vehicles, vehicle, value => {
              setVehicle(value);
              setPlate(null);
            })}
            {needsPlate ? choices("هل الدراجة مرقمة؟", yesNo, plate, setPlate, true) : null}
            {choices("نوع الهاتف المستخدم", phones, phoneType, setPhoneType)}
            {choices("هل لديك خبرة سابقة بالتوصيل؟", yesNo, experienced, value => {
              setExperienced(value);
              setDetails("");
            }, true)}
            {experienced ? field("تفاصيل الخبرة", details, setDetails, 200, "details") : null}
            <Text style={{ color: theme.colorSecondary, fontSize: 12 }}>
              يعتمد التعاون على أجر المشوار وفق سياسة بثواني. تستخدم بياناتك لغرض التواصل
              بشأن فرص الانضمام، ويُسمح بالاطلاع عليها للمسؤولين المخولين فقط.
            </Text>
            {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
            {!dshOrigin ? (
              <Text style={{ color: theme.warningText }}>استمارة التسجيل غير متاحة في هذه البيئة حاليًا.</Text>
            ) : null}
            <Pressable accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy }}
              disabled={!canSubmit} onPress={() => { void submit(); }}
              style={{ backgroundColor: theme.actionBackground, padding: 15,
                borderRadius: 12, opacity: canSubmit ? 1 : 0.5, minHeight: 48 }}>
              <Text style={{ color: theme.onAction, fontWeight: "700", textAlign: "center" }}>
                {busy ? "جارٍ الإرسال…" : "إرسال بياناتي"}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
