package hr

import (
	"errors"
	"testing"
)

func validEmployee() CreateInput {
	return CreateInput{
		FullNameAr: "أحمد عبدالله", PhoneE164: "+967777000100",
		Department: "العمليات", JobTitle: "مسؤول عمليات",
		StartDate: "2026-10-01", WorkLocation: "صنعاء",
	}
}
func TestEmployeeInputIsEmploymentNotOperatorRole(t *testing.T) {
	input := validEmployee()
	normalized, err := normalize(input)
	if err != nil {
		t.Fatalf("valid HR employee: %v", err)
	}
	if normalized.FullNameAr != input.FullNameAr || normalized.PhoneE164 != input.PhoneE164 {
		t.Fatalf("employee facts changed: %+v", normalized)
	}
	input.PhoneE164 = ""
	if _, err := normalize(input); err != nil {
		t.Fatalf("non-login employee phone must remain optional: %v", err)
	}
}
func TestInvalidEmployeeInputsFailClosed(t *testing.T) {
	cases := []struct {
		name   string
		modify func(*CreateInput)
	}{
		{"name", func(i *CreateInput) { i.FullNameAr = "x" }},
		{"phone", func(i *CreateInput) { i.PhoneE164 = "0777000000" }},
		{"department", func(i *CreateInput) { i.Department = " " }},
		{"title", func(i *CreateInput) { i.JobTitle = "" }},
		{"start", func(i *CreateInput) { i.StartDate = "2026-02-30" }},
		{"location", func(i *CreateInput) { i.WorkLocation = "" }},
		{"manager", func(i *CreateInput) { i.ManagerEmployeeID = "x" + string(make([]byte, 129)) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := validEmployee()
			tc.modify(&input)
			if _, err := normalize(input); !errors.Is(err, ErrInvalid) {
				t.Fatalf("got %v; want invalid", err)
			}
		})
	}
}
func TestEmployeeReadAndListRejectInvalidRequests(t *testing.T) {
	if _, err := Read(t.Context(), nil, "bad"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("read err %v", err)
	}
	if _, err := List(t.Context(), nil, "", "", 25); !errors.Is(err, ErrInvalid) {
		t.Fatalf("list err %v", err)
	}
	if _, err := Create(t.Context(), nil, validEmployee(), "", "", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("create err %v", err)
	}
}
