import CaptainCapabilityScreen from "../../components/captain-capability-screen";
/** Display no made-up balances while WLT has no authenticated Captain wallet contract. */
export default function WalletScreen() {
  return <CaptainCapabilityScreen title="محفظة الكابتن" message="الأرصدة والتحصيل والمستحقات من WLT فقط. لا تتوفر بعد واجهة موثقة لعرضها للكابتن." />;
}
