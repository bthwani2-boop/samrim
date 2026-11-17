import CapabilityUnavailableScreen from "../../components/capability-unavailable-screen";
import AccountPreferences from "./account-preferences";
import StoreInvitations from "./store-invitations";

export default function AccountScreen() {
  return <><AccountPreferences /><StoreInvitations /><CapabilityUnavailableScreen title="حسابي" message="بيانات الحساب وتسجيل الخروج يتطلبان جلسة Identity موثّقة ومحمية."  /></>;
}
