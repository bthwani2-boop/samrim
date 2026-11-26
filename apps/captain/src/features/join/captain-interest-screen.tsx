import { type CaptainInterestInput, type CaptainPhoneType,
  type CaptainVehicleType, DshPublicError, submitCaptainInterest, validCaptainInterest } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const vehicleOptions: ReadonlyArray<{value: CaptainVehicleType; label: string}> = [
  { value: "MOTORCYCLE", label: "دراجة نارية" },
  { value: "ELECTRIC", label: "دراجة كهربائية" },
  { value: "BICYCLE", label: "دراجة هوائية" },
  { value: "NONE", label: "لا أمتلك دراجة" },
];
const phoneOptions: ReadonlyArray<{value: CaptainPhoneType; label: string}> = [
  { value: "SMART", label: "هاتف ذكي (Android / iPhone)" },
  { value: "BASIC", label: "هاتف عادي" },
  { value: "NONE", label: "لا أمتلك هاتفًا" },
];
const dshOrigin = process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN ?? "";

export default function CaptainInterestScreen() {
  const { theme } = useMobileAppearance();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [vehicleType, setVehicleType] = useState<CaptainVehicleType>("MOTORCYCLE");
  const [plateRegistered, setPlateRegistered] = useState<boolean | null>(null);
  const [phoneType, setPhoneType] = useState<CaptainPhoneType>("SMART");
  const [experienced, setExperienced] = useState(false);
  const [experienceDetails, setExperienceDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<"received" | "unknown" | null>(null);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const terminal = useRef(false);
  useEffect(() => () => { controller.current?.abort(); }, []);

  const vehicleNeedsPlate = vehicleType === "MOTORCYCLE" || vehicleType === "ELECTRIC";
  const contactPhone = phone.trim().replace(/[٠-٩۰-۹]/g, digit =>
    String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)));
  const input: CaptainInterestInput = {
    name: name.trim(), phone: contactPhone, city: city.trim(), district: district.trim(),
    vehicleType, ...(vehicleNeedsPlate && plateRegistered !== null ? { plateRegistered } : {}),
    phoneType, experienced,
    ...(experienced && experienceDetails.trim() ? { experienceDetails: experienceDetails.trim() } : {}),
  };
  const canSubmit = validCaptainInterest(input) && !busy && receipt === null && !!dshOrigin;
  const fieldStyle = {
    borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10,
    color: theme.color, padding: 12, fontSize: 16, minHeight: 48,
  } as const;
  const labelStyle = { color: theme.color, fontWeight: "600" as const };
  const options = <T extends string>(values: ReadonlyArray<{value: T; label: string}>,
    selected: T, choose: (v: T) => void) => (
    <View style={{ gap: 8 }}>
      {values.map(item => (
        <Pressable key={item.value} accessibilityRole="radio"
          accessibilityState={{ selected: item.value === selected, disabled: busy }}
          disabled={busy}
          onPress={() => { if (!controller.current && item.value !== selected) choose(item.value); }}
          style={{ borderWidth: 1, borderColor: item.value === selected ? theme.actionBackground : theme.borderColor,
            borderRadius: 10, padding: 12, minHeight: 44 }}>
          <Text style={{ color: theme.color }}>{item.value === selected ? "◉  " : "○  "}{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  async function submit() {
    if (!canSubmit || controller.current || terminal.current) return;
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setMessage("");
    try {
      await submitCaptainInterest(dshOrigin, input, next.signal);
      if (!next.signal.aborted) {
        terminal.current = true;
        setReceipt("received");
      }
    } catch (reason) {
      if (next.signal.aborted) return;
      if (reason instanceof DshPublicError && reason.code === "OPERATION_RESULT_UNKNOWN") {
        terminal.current = true;
        setReceipt("unknown");
      } else if (reason instanceof DshPublicError && reason.status === 429) {
        setMessage("تم تجاوز عدد المحاولات المسموح. حاول لاحقًا.");
      } else {
        setMessage("تعذّر إرسال البيانات. تحقق من الحقول والاتصال.");
      }
    } finally {
      if (controller.current === next) {
        controller.current = null;
        setBusy(false);
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
            <View style={{ gap: 5 }}>
              <Text style={labelStyle}>الاسم الكامل *</Text>
              <TextInput accessibilityLabel="الاسم الكامل" style={fieldStyle} value={name}
                onChangeText={setName} maxLength={100} editable={!busy} />
            </View>
            <View style={{ gap: 5 }}>
              <Text style={labelStyle}>رقم الهاتف *</Text>
              <TextInput accessibilityLabel="رقم الهاتف" style={fieldStyle} value={phone}
                onChangeText={setPhone} maxLength={13} keyboardType="phone-pad"
                autoComplete="tel" editable={!busy} placeholder="77XXXXXXX" />
            </View>
            <View style={{ gap: 5 }}>
              <Text style={labelStyle}>المدينة *</Text>
              <TextInput accessibilityLabel="المدينة" style={fieldStyle} value={city}
                onChangeText={setCity} maxLength={80} editable={!busy} />
            </View>
            <View style={{ gap: 5 }}>
              <Text style={labelStyle}>الحي أو منطقة السكن *</Text>
              <TextInput accessibilityLabel="الحي أو منطقة السكن" style={fieldStyle} value={district}
                onChangeText={setDistrict} maxLength={100} editable={!busy} />
            </View>
            <View style={{ gap: 5 }}>
              <Text style={labelStyle}>نوع الدراجة *</Text>
              {options(vehicleOptions, vehicleType, value => {
                setVehicleType(value);
                setPlateRegistered(null);
              })}
            </View>
            {vehicleNeedsPlate ? (
              <View style={{ gap: 5 }}>
                <Text style={labelStyle}>هل الدراجة مرقمة؟ *</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {([{label:"نعم",value:true},{label:"لا",value:false}] as const).map(item =>
                    <Pressable key={item.label} accessibilityRole="radio"
                      accessibilityState={{ selected: plateRegistered === item.value, disabled: busy }}
                      disabled={busy}
                      onPress={() => { if (!controller.current) setPlateRegistered(item.value); }}
                      style={{ flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 10,
                        borderColor: plateRegistered === item.value ? theme.actionBackground : theme.borderColor,
                        justifyContent: "center", padding: 8 }}>
                      <Text style={{ color: theme.color, textAlign: "center" }}>{item.label}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ) : null}
            <View style={{ gap: 5 }}>
              <Text style={labelStyle}>نوع الهاتف المستخدم *</Text>
              {options(phoneOptions, phoneType, setPhoneType)}
            </View>
            <View style={{ gap: 5 }}>
              <Text style={labelStyle}>هل لديك خبرة سابقة بالتوصيل؟ *</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([{label:"نعم",value:true},{label:"لا",value:false}] as const).map(item =>
                  <Pressable key={item.label} accessibilityRole="radio"
                    accessibilityState={{ selected: experienced === item.value, disabled: busy }}
                    disabled={busy}
                    onPress={() => { if (!controller.current && item.value !== experienced) { setExperienced(item.value); setExperienceDetails(""); } }}
                    style={{ flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 10,
                      borderColor: experienced === item.value ? theme.actionBackground : theme.borderColor,
                      justifyContent: "center", padding: 8 }}>
                    <Text style={{ color: theme.color, textAlign: "center" }}>{item.label}</Text>
                  </Pressable>)}
              </View>
            </View>
            {experienced ? (
              <View style={{ gap: 5 }}>
                <Text style={labelStyle}>تفاصيل الخبرة (اختياري)</Text>
                <TextInput accessibilityLabel="تفاصيل الخبرة" style={fieldStyle}
                  value={experienceDetails} onChangeText={setExperienceDetails}
                  editable={!busy} maxLength={200} multiline />
              </View>
            ) : null}
            <Text style={{ color: theme.colorSecondary, fontSize: 12 }}>
              يعتمد التعاون على أجر المشوار وفق سياسة بثواني. تستخدم بياناتك لغرض التواصل
              بشأن فرص الانضمام، ويُسمح بالاطلاع عليها للمسؤولين المخولين فقط.
            </Text>
            {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
            {!dshOrigin ? <Text style={{ color: theme.warningText }}>
              استمارة التسجيل غير متاحة في هذه البيئة حاليًا.
            </Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSubmit }}
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
