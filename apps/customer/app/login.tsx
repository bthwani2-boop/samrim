import CapabilityUnavailableScreen from "../src/components/capability-unavailable-screen";

export default function LoginRoute() {
  return <CapabilityUnavailableScreen title="تسجيل الدخول" message="تسجيل الدخول ينتظر عميل جلسات Identity المعتمد. لا نجمع كلمات مرور أو رموز تحقق داخل واجهة غير متصلة." />;
}
