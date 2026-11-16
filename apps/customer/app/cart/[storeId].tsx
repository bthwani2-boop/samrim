import CapabilityUnavailableScreen from "../../src/components/capability-unavailable-screen";

export default function StoreCartRoute() {
  return <CapabilityUnavailableScreen title="سلة المتجر" message="السلة مرتبطة بمتجر واحد وعميل موثّق؛ لا يمكن تأكيد أصناف أو أسعار دون عقد DSH للسلة." />;
}
