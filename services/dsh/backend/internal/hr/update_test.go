package hr

import (
	"errors"
	"testing"
)

func TestEmployeeUpdateRejectsStaleOrInvalidInputsWithoutDatabaseWrites(t *testing.T) {
	input := UpdateInput{
		CreateInput:     validEmployee(),
		ExpectedVersion: 1,
	}
	id := "emp_00000000000000000000000000000000"
	for _, tc := range []struct {
		name  string
		id    string
		input UpdateInput
	}{
		{"invalid employee id", "bad", input},
		{"missing version", id, UpdateInput{CreateInput: validEmployee()}},
		{"self manager", id, UpdateInput{CreateInput: func() CreateInput { i := validEmployee(); i.ManagerEmployeeID = id; return i }(), ExpectedVersion: 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Update(t.Context(), nil, tc.id, tc.input, "act_root", "corr-valid", "idem-valid")
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("want invalid, got %v", err)
			}
		})
	}
}
