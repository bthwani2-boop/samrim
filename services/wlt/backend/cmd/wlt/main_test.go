package main

import (
	"io"
	"strings"
	"testing"
)

func TestSandboxCommandRejectsNonIsolatedDatabaseBeforeReadingSession(t *testing.T) {
	const dsn = "postgres://bthwani_wlt_sandbox:fixture@127.0.0.1:5432/bthwani_wlt_test?sslmode=disable"
	for _, tc := range []struct{ mode, database string }{
		{"", dsn},
		{"true", strings.Replace(dsn, "127.0.0.1", "192.0.2.1", 1)},
		{"true", strings.Replace(dsn, "bthwani_wlt_test", "bthwani_wlt_restore", 1)},
		{"true", strings.Replace(dsn, "bthwani_wlt_sandbox", "bthwani_wlt_reader", 1)},
	} {
		err := runSandboxFunding(t.Context(), "post-sandbox-funding", []string{"fixture-reference", "9"}, strings.NewReader(""), io.Discard,
			func(name string) string {
				return map[string]string{"BTHWANI_ISOLATED_TEST_MODE": tc.mode, "WLT_SANDBOX_DATABASE_URL": tc.database}[name]
			})
		if err == nil || !strings.Contains(err.Error(), "dedicated isolated loopback database role") {
			t.Fatalf("sandbox did not reject the isolation configuration: %v", err)
		}
	}
}

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
