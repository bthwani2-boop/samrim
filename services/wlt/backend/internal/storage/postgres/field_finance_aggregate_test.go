package postgres

import (
	"context"
	"errors"
	"testing"
)

func TestReadFieldFinanceAggregateRequiresDatabase(t *testing.T) {
	if _, err := ReadFieldFinanceAggregate(context.Background(), nil); !errors.Is(err, ErrPayoutInvalidInput) {
		t.Fatalf("got %v, want ErrPayoutInvalidInput", err)
	}
}
