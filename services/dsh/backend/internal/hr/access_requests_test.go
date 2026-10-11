package hr

import (
	"errors"
	"testing"
)

func TestAccessRequestRequiresExistingEmployeeIdentifierAndReason(t *testing.T) {
	valid := AccessRequestInput{
		EmployeeID:           "emp_0123456789abcdef0123456789abcdef",
		Reason:               "This employee is assigned to catalog review",
		RequestedPermissions: []string{"hr", "catalog"},
	}
	canonical, err := normalizeAccessRequest(valid)
	if err != nil {
		t.Fatal(err)
	}
	if len(canonical.RequestedPermissions) != 2 || canonical.RequestedPermissions[0] != "catalog" {
		t.Fatalf("permissions not canonicalized: %#v", canonical)
	}
	cases := []AccessRequestInput{
		{EmployeeID: "act_0123456789abcdef0123456789abcdef", Reason: valid.Reason},
		{EmployeeID: valid.EmployeeID, Reason: "short"},
		{EmployeeID: valid.EmployeeID, Reason: valid.Reason, RequestedPermissions: []string{"root"}},
		{EmployeeID: valid.EmployeeID, Reason: valid.Reason, RequestedPermissions: []string{"hr", "hr"}},
	}
	for _, bad := range cases {
		if _, err = normalizeAccessRequest(bad); !errors.Is(err, ErrInvalid) {
			t.Errorf("request should be invalid: %#v err=%v", bad, err)
		}
	}
}
func TestInvalidAccessRequestNeverTouchesDatabase(t *testing.T) {
	input := AccessRequestInput{EmployeeID: "invalid", Reason: "bad"}
	if _, err := CreateAccessRequest(t.Context(), nil, input, "actor", "correlation", "idempotency"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("got %v", err)
	}
	if _, err := ReadAccessRequest(t.Context(), nil, "invalid"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("got %v", err)
	}
	if _, err := ListAccessRequests(t.Context(), nil, "", "", 25); !errors.Is(err, ErrInvalid) {
		t.Fatalf("got %v", err)
	}
	if _, err := LinkAccessRequest(t.Context(), nil, "bad", "bad", "actor", "corr", "idempotency"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("got %v", err)
	}
}
