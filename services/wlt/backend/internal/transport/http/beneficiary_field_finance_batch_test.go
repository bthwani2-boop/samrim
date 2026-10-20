package http

import (
	"strings"
	"testing"
)

func TestNormalizeFieldPayoutBatchActorIDsIsBoundedAndDeduplicated(t *testing.T) {
	got, valid := normalizeFieldPayoutBatchActorIDs([]string{" field-1 ", "field-1", "field-2"})
	if !valid || len(got) != 2 || got[0] != "field-1" || got[1] != "field-2" {
		t.Fatalf("normalized ids=%v valid=%v", got, valid)
	}
	for _, invalid := range [][]string{{""}, {strings.Repeat("x", 129)}, make([]string, 101)} {
		if _, valid := normalizeFieldPayoutBatchActorIDs(invalid); valid {
			t.Fatalf("invalid batch accepted: count=%d", len(invalid))
		}
	}
}
