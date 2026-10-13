package postgres

import (
	"math"
	"math/big"
	"testing"
)

func TestSharedPromotionFundingSplitIsConservedWithoutOverflow(t *testing.T) {
	for _, amount := range []int64{1, 2, 37, 99, 100, 101, 199, 999, 10000, math.MaxInt64 / 2, math.MaxInt64 - 1, math.MaxInt64} {
		for share := 1; share <= 99; share++ {
			// Independent wide-integer oracle: floor(amount * share / 100).
			exact := new(big.Int).Mul(big.NewInt(amount), big.NewInt(int64(share)))
			exact.Div(exact, big.NewInt(100))
			if !exact.IsInt64() {
				t.Fatalf("oracle unexpectedly overflowed: amount=%d share=%d", amount, share)
			}
			partner := sharedPromotionPartnerAmount(amount, share)
			if partner != exact.Int64() {
				t.Fatalf("incorrect funding split: amount=%d share=%d got=%d want=%d", amount, share, partner, exact.Int64())
			}
			platform := amount - partner
			if partner < 0 || platform < 0 || partner+platform != amount {
				t.Fatalf("funding not conserved: amount=%d share=%d partner=%d platform=%d", amount, share, partner, platform)
			}
		}
	}
}
