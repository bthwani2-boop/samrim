package postgres

import "testing"

func TestMigrationChecksumV29HistoricalCompatibility(t *testing.T) {
	latest := MigrationRecord{Version: 29, Name: "029_operator_hr_permission.sql", SHA256: "new-schema-hash"}
	for _, tc := range []struct {
		name, recordedName, digest string
		accepted                   bool
	}{
		{name: "latest", recordedName: latest.Name, digest: latest.SHA256, accepted: true},
		{name: "known previously applied", recordedName: latest.Name, digest: historicalV29HRPermissionSHA256, accepted: true},
		{name: "unknown checksum", recordedName: latest.Name, digest: "unknown", accepted: false},
		{name: "different name", recordedName: "029_other.sql", digest: historicalV29HRPermissionSHA256, accepted: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := migrationChecksumMatches(latest, tc.recordedName, tc.digest); got != tc.accepted {
				t.Fatalf("migration alias result = %v want %v", got, tc.accepted)
			}
		})
	}
	for _, version := range []int{28, 30} {
		other := MigrationRecord{Version: version, Name: latest.Name, SHA256: latest.SHA256}
		if migrationChecksumMatches(other, other.Name, historicalV29HRPermissionSHA256) {
			t.Fatalf("historical alias accepted for unrelated version %d", version)
		}
	}
}
