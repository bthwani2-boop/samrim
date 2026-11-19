import CapabilityUnavailableScreen from "../../components/capability-unavailable-screen";
import FulfillmentChoice from "./fulfillment-choice";
import PaymentSelection from "./payment-selection";
import RecipientForm from "./recipient-form";

export default function CheckoutScreen() {
  return <><FulfillmentChoice /><RecipientForm /><PaymentSelection /><CapabilityUnavailableScreen title="تأكيد الطلب"
    message="لا يمكن تأكيد أسعار السلة أو الدفع حاليًا." /></>;
}
