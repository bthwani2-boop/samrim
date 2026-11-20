package main

import (
	"testing"
)

func TestWalletRuntimeRequiresIsolatedReader(t *testing.T) {
	const dsn = "postgres://bthwani_wlt_reader:synthetic-only@127.0.0.1:5432/bthwani_wlt_test?sslmode=disable"
	for _, test := range []struct {
		name, mode, address, database string
		want                          bool
	}{
		{"isolated", "true", "127.0.0.1:23203", dsn, true},
		{"no opt-in", "", "127.0.0.1:23203", dsn, false},
		{"wildcard", "true", "0.0.0.0:23203", dsn, false},
		{"non-reader", "true", "127.0.0.1:23203", "postgres://postgres@127.0.0.1:5432/bthwani_wlt_test?sslmode=disable", false},
		{"other database", "true", "127.0.0.1:23203", "postgres://bthwani_wlt_reader@127.0.0.1:5432/samrim?sslmode=disable", false},
		{"query override", "true", "127.0.0.1:23203", dsn + "&host=other", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := validIsolation(test.mode, test.address, test.database); got != test.want {
				t.Errorf("isolation=%t want=%t", got, test.want)
			}
		})
	}
}
