import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function EmployeesScreen() {
  return <MerchantCapabilityScreen title="الموظفون" message="بيانات الموظفين ومنح المتجر لدى DSH دون تجاوز نطاق التاجر." />;
}
