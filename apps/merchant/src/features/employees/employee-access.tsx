import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function EmployeeAccess() {
  return <MerchantCapabilityScreen title="صلاحيات الموظفين" message="هوية الموظف لدى Identity ومنح الوصول إلى المتجر لدى DSH." />;
}
