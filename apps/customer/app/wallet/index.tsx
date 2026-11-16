import CapabilityUnavailableScreen from "../../src/components/capability-unavailable-screen";

export default function WalletRoute() {
  return <CapabilityUnavailableScreen title="المحفظة" message="الرصيد المالي لا يُعرض إلا من محفظة WLT للحساب الذي تحققت هويته عبر Identity." />;
}
