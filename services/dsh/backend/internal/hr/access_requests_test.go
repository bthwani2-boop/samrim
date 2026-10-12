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

func TestAccessRequestEmployeeSnapshotCannotChangeDuringProvisioning(t *testing.T) {
	request := AccessRequest{
		EmployeeID:   "emp_0123456789abcdef0123456789abcdef",
		EmployeeName: "أحمد سالم علي", PhoneE164: "+967777111222",
		Department: "العمليات", JobTitle: "مشرف",
	}
	employee := Employee{
		ID: request.EmployeeID, FullNameAr: request.EmployeeName,
		PhoneE164: request.PhoneE164, Department: request.Department,
		JobTitle: request.JobTitle, Status: "active",
	}
	if !AccessRequestMatchesEmployee(request, employee) {
		t.Fatal("unchanged active employee must match")
	}
	cases := []struct {
		name   string
		mutate func(*Employee)
	}{
		{"inactive", func(e *Employee) { e.Status = "inactive" }},
		{"already linked", func(e *Employee) { a := "act_other"; e.OperatorActorID = &a }},
		{"name", func(e *Employee) { e.FullNameAr = "اسم مختلف" }},
		{"phone", func(e *Employee) { e.PhoneE164 = "+967777111223" }},
		{"department", func(e *Employee) { e.Department = "المالية" }},
		{"job title", func(e *Employee) { e.JobTitle = "مدير" }},
		{"employee ID", func(e *Employee) { e.ID = "emp_other" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			current := employee
			tc.mutate(&current)
			if AccessRequestMatchesEmployee(request, current) {
				t.Fatal("mismatch accepted")
			}
		})
	}
}
