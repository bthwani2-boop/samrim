import { Link } from "expo-router";
import CapabilityUnavailableScreen from "../../components/capability-unavailable-screen";
import AccountPreferences from "./account-preferences";
import StoreInvitations from "./store-invitations";

export default function AccountScreen() {
  return <><AccountPreferences /><StoreInvitations /><Link href="/login">تسجيل الدخول أو التحقق من حساب العميل</Link><CapabilityUnavailableScreen title="حسابي" message="عرض بيانات الحساب والطلبات يتطلب تكاملًا مستقلًا مع صلاحيات Identity والمالكين." /></>;
}
