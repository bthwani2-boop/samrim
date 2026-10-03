package postgres

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestCanonicalScheduleAndModesAreDeterministic(t *testing.T) {
	schedule := canonicalSchedule([]StoreScheduleWindow{
		{DayOfWeek: 3, OpensAtMinute: 600, ClosesAtMinute: 900},
		{DayOfWeek: 1, OpensAtMinute: 900, ClosesAtMinute: 1000},
		{DayOfWeek: 1, OpensAtMinute: 480, ClosesAtMinute: 720},
	})
	wantSchedule := []StoreScheduleWindow{
		{DayOfWeek: 1, OpensAtMinute: 480, ClosesAtMinute: 720},
		{DayOfWeek: 1, OpensAtMinute: 900, ClosesAtMinute: 1000},
		{DayOfWeek: 3, OpensAtMinute: 600, ClosesAtMinute: 900},
	}
	if !reflect.DeepEqual(schedule, wantSchedule) {
		t.Fatalf("canonical schedule = %#v, want %#v", schedule, wantSchedule)
	}
	modes := canonicalModes([]string{" CUSTOMER_PICKUP ", "BTHWANI_CAPTAIN", "CUSTOMER_PICKUP", "", "PARTNER_CAPTAIN"})
	wantModes := []string{"BTHWANI_CAPTAIN", "CUSTOMER_PICKUP", "PARTNER_CAPTAIN"}
	if !reflect.DeepEqual(modes, wantModes) {
		t.Fatalf("canonical modes = %#v, want %#v", modes, wantModes)
	}
}

func TestValidateStoreOperationalAvailabilityInput(t *testing.T) {
	reason := "ازدحام مؤقت"
	until := time.Date(2026, 10, 3, 14, 0, 0, 0, time.UTC)
	prep := 25
	valid := UpdateStoreOperationalAvailabilityInput{
		StoreID:                     "store-1",
		ScheduleMode:                "WEEKLY",
		WeeklySchedule:              []StoreScheduleWindow{{DayOfWeek: 6, OpensAtMinute: 8 * 60, ClosesAtMinute: 23 * 60}},
		Paused:                      true,
		PauseReason:                 &reason,
		PauseUntil:                  &until,
		PreparationMinutes:          &prep,
		UnavailableFulfillmentModes: []string{"CUSTOMER_PICKUP"},
		ExpectedVersion:             1,
		ActingActorID:               "actor-1",
		AuthoritySource:             "STORE_OWNER",
		IdempotencyKey:              "idem-key-1",
		CorrelationID:               "corr-key-1",
	}
	if err := validateStoreOperationalAvailabilityInput(valid); err != nil {
		t.Fatalf("valid Store availability rejected: %v", err)
	}

	cases := map[string]UpdateStoreOperationalAvailabilityInput{
		"weekly requires window": func() UpdateStoreOperationalAvailabilityInput {
			value := valid
			value.WeeklySchedule = nil
			return value
		}(),
		"always open forbids window": func() UpdateStoreOperationalAvailabilityInput {
			value := valid
			value.ScheduleMode = "ALWAYS_OPEN"
			return value
		}(),
		"invalid fulfillment": func() UpdateStoreOperationalAvailabilityInput {
			value := valid
			value.UnavailableFulfillmentModes = []string{"DRONE"}
			return value
		}(),
		"invalid authority": func() UpdateStoreOperationalAvailabilityInput {
			value := valid
			value.AuthoritySource = "ROLE_ONLY"
			return value
		}(),
		"unpaused forbids pause facts": func() UpdateStoreOperationalAvailabilityInput { value := valid; value.Paused = false; return value }(),
		"invalid preparation": func() UpdateStoreOperationalAvailabilityInput {
			value := valid
			tooHigh := 1441
			value.PreparationMinutes = &tooHigh
			return value
		}(),
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			if err := validateStoreOperationalAvailabilityInput(input); !errors.Is(err, ErrStoreOperationalAvailabilityInvalid) {
				t.Fatalf("error = %v, want ErrStoreOperationalAvailabilityInvalid", err)
			}
		})
	}
}

func TestScheduleContainsUsesAdenCivilTime(t *testing.T) {
	// 2026-10-03T06:30Z is 09:30 in Asia/Aden and Saturday (Go weekday 6).
	at := time.Date(2026, 10, 3, 6, 30, 0, 0, time.UTC)
	schedule := []StoreScheduleWindow{{DayOfWeek: 6, OpensAtMinute: 9 * 60, ClosesAtMinute: 10 * 60}}
	if !scheduleContains(schedule, at) {
		t.Fatal("Aden-local 09:30 should be inside Saturday 09:00-10:00 window")
	}
	if scheduleContains(schedule, at.Add(time.Hour)) {
		t.Fatal("Aden-local 10:30 should be outside Saturday 09:00-10:00 window")
	}
}

func TestAvailabilityMutationHashCanonicalizesEquivalentFacts(t *testing.T) {
	base := UpdateStoreOperationalAvailabilityInput{
		StoreID:                     " store-1 ",
		ScheduleMode:                "WEEKLY",
		WeeklySchedule:              []StoreScheduleWindow{{DayOfWeek: 2, OpensAtMinute: 600, ClosesAtMinute: 900}, {DayOfWeek: 1, OpensAtMinute: 300, ClosesAtMinute: 500}},
		UnavailableFulfillmentModes: []string{"CUSTOMER_PICKUP", "BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"},
		ExpectedVersion:             3,
		ActingActorID:               " actor-1 ",
		AuthoritySource:             "STORE_GRANT",
	}
	reordered := base
	reordered.WeeklySchedule = []StoreScheduleWindow{{DayOfWeek: 1, OpensAtMinute: 300, ClosesAtMinute: 500}, {DayOfWeek: 2, OpensAtMinute: 600, ClosesAtMinute: 900}}
	reordered.UnavailableFulfillmentModes = []string{" BTHWANI_CAPTAIN ", "CUSTOMER_PICKUP"}
	if HashStoreOperationalAvailabilityMutation(base) != HashStoreOperationalAvailabilityMutation(reordered) {
		t.Fatal("equivalent canonical Store availability facts must hash identically")
	}
}
