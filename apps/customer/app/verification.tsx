import CapabilityUnavailableScreen from "../src/components/capability-unavailable-screen";

export default function VerificationRoute() {
  return <CapabilityUnavailableScreen title="التحقق من الهوية" message="رموز التحقق لا تُقبل محليًا؛ يجب التحقق منها لدى Identity قبل إنشاء جلسة أو استعادة حساب." />;
}
