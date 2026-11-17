import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function ProductsScreen() {
  return <MerchantCapabilityScreen title="المنتجات" message="يُحمّل كتالوج المتجر المصرح له من DSH قبل عرضه أو تعديله." />;
}
