package postgres

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

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

func TestManagedRoleRecoveryMigrationIsRegistered(t *testing.T) {
	directory := filepath.Clean("../../../../database/migrations")
	records, err := LoadMigrationRecords(directory)
	if err != nil {
		t.Fatalf("load identity migrations: %v", err)
	}
	if len(records) != SchemaVersion {
		t.Fatalf("identity migration count = %d, want 30 including recovery, HR permissions and legal-name index retirement", len(records))
	}
	if recovery := records[27]; recovery.Version != 28 || recovery.Name != "028_operator_recovery_reservation.sql" {
		t.Fatalf("operator recovery migration = %#v, want v28 reservation", recovery)
	}
	if hrPermission := records[28]; hrPermission.Version != 29 || hrPermission.Name != "029_operator_hr_permission.sql" {
		t.Fatalf("HR permission migration = %#v, want v29 operator HR permission", hrPermission)
	}
	if retiredIndex := records[29]; retiredIndex.Version != 30 || retiredIndex.Name != "030_retire_redundant_legal_name_version_index.sql" {
		t.Fatalf("legal-name index retirement migration = %#v, want v30", retiredIndex)
	}
}

func TestLoadIdentityMigrationsRejectsParallelDirectory(t *testing.T) {
	directory := t.TempDir()
	for version := 1; version <= SchemaVersion; version++ {
		name := fmt.Sprintf("%03d_canonical.sql", version)
		if err := os.WriteFile(filepath.Join(directory, name), []byte("SELECT 1;"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := LoadMigrationRecords(directory); err != nil {
		t.Fatalf("canonical migration catalog rejected: %v", err)
	}
	if err := os.Mkdir(filepath.Join(directory, "parallel-migrations"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadMigrationRecords(directory); err == nil {
		t.Fatal("unexpected parallel migration directory was silently ignored")
	}
}
