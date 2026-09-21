package postgres
import"testing"
func validCustomerPaymentAllocation()CustomerPaymentAllocationInput{return CustomerPaymentAllocationInput{OrderID:"o",Currency:"YER",SubtotalMinor:4200,CashAmountMinor:4200,CustomerPayableMinor:4200,PolicyVersion:"v2"}}
func TestCustomerPaymentAllocation(t *testing.T){i:=validCustomerPaymentAllocation();if validateCustomerPaymentAllocation(i)!=nil{t.Fatal("valid rejected")};i.InternalBalanceAmountMinor=1200;i.CashAmountMinor=3000;if validateCustomerPaymentAllocation(i)!=nil{t.Fatal("mixed rejected")};i.CashAmountMinor=2999;if validateCustomerPaymentAllocation(i)!=ErrCustomerPaymentAllocationInvalidInput{t.Fatal("invalid accepted")}}
