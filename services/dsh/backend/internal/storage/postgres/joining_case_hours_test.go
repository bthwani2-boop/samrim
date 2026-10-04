package postgres

import "testing"

func TestValidateStoreWorkingHoursRejectsInvalidIntervals(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{name: "next-day close cannot exceed one day", value: `{"intervals":[{"dayOfWeek":1,"opensAt":"09:00","closesAt":"09:01","closesNextDay":true}]}`},
		{name: "same-day close must follow open", value: `{"intervals":[{"dayOfWeek":1,"opensAt":"17:00","closesAt":"09:00","closesNextDay":false}]}`},
		{name: "invalid day", value: `{"intervals":[{"dayOfWeek":8,"opensAt":"09:00","closesAt":"17:00","closesNextDay":false}]}`},
		{name: "invalid time", value: `{"intervals":[{"dayOfWeek":1,"opensAt":"24:00","closesAt":"17:00","closesNextDay":false}]}`},
		{name: "overlap across week boundary", value: `{"intervals":[{"dayOfWeek":7,"opensAt":"23:00","closesAt":"01:00","closesNextDay":true},{"dayOfWeek":1,"opensAt":"00:30","closesAt":"02:00","closesNextDay":false}]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if ValidateStoreWorkingHours([]byte(test.value)) {
				t.Fatal("invalid working-hours schedule accepted")
			}
		})
	}
}

func TestValidateStoreWorkingHoursAcceptsOneDayOvernightInterval(t *testing.T) {
	value := []byte(`{"intervals":[{"dayOfWeek":1,"opensAt":"21:00","closesAt":"08:00","closesNextDay":true}]}`)
	if !ValidateStoreWorkingHours(value) {
		t.Fatal("valid overnight working-hours schedule rejected")
	}
}

func TestValidateStoreWorkingHoursAllowsExactlyOneDay(t *testing.T) {
	value := []byte(`{"intervals":[{"dayOfWeek":1,"opensAt":"09:00","closesAt":"09:00","closesNextDay":true}]}`)
	if !ValidateStoreWorkingHours(value) {
		t.Fatal("valid 24-hour working-hours schedule rejected")
	}
}
