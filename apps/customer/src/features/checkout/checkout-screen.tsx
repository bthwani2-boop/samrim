import CapabilityUnavailableScreen from "../../components/capability-unavailable-screen";
import FulfillmentChoice from "./fulfillment-choice";
import PaymentSelection from "./payment-selection";
import RecipientForm from "./recipient-form";

export default function CheckoutScreen() {
  return <><FulfillmentChoice /><RecipientForm /><PaymentSelection /><CapabilityUnavailableScreen title="تأكيد الطلب" message="إنشاء الطلب والدفع محجوبان حتى تكتمل عروض الأسعار المؤكدة من DSH وتفويض المدفوعات من WLT."  /></>;
}
