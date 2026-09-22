package domain

import (
	"errors"
	"testing"
)

func TestCreateValidationIsCODAndYEROnly(t *testing.T) {
	if err := ValidateCreate("order_1", "actor_client", CurrencyYER, MethodCashOnDelivery, 1500); err != nil {
		t.Fatalf("valid COD intent rejected: %v", err)
	}
	if err := ValidateCreate("order_1", "actor_client", "USD", MethodCashOnDelivery, 1500); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("non-YER intent accepted: %v", err)
	}
}

func TestCollectRequiresExactAmountAndCollector(t *testing.T) {
	if err := ValidateCollect("actor_captain", "cash_1", 1500, 1500); err != nil {
		t.Fatalf("valid collection rejected: %v", err)
	}
	if err := ValidateCollect("actor_captain", "cash_1", 1499, 1500); !errors.Is(err, ErrAmountMismatch) {
		t.Fatalf("mismatched collection accepted: %v", err)
	}
}

func TestCODTransitionsAreNarrow(t *testing.T) {
	if !CanCollect(StateRequiresCollect) || !CanCancel(StateRequiresCollect) {
		t.Fatal("pending collection should allow collect and cancel")
	}
	if CanCollect(StateCollected) || CanCancel(StateCancelled) {
		t.Fatal("terminal states should not allow repeated mutation")
	}
}
