package postgres_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestMigrationV13ToV15Upgrade(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("IDENTITY_DATABASE_URL is required for the migration upgrade proof")
		return
	}

	// Connect to root postgres maintenance to create isolated test database.
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	defer rootDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	testDBName := fmt.Sprintf("id_mig_test_%d", time.Now().UnixNano())
	if _, err := rootDB.ExecContext(ctx, fmt.Sprintf("CREATE DATABASE %s", testDBName)); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	defer func() {
		_, _ = rootDB.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", testDBName))
	}()

	// Construct test DB connection URL.
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse database URL: %v", err)
	}
	parsedURL.Path = "/" + testDBName
	testURL := parsedURL.String()

	testDB, err := sql.Open("postgres", testURL)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	defer testDB.Close()

	// Locate migrations directory.
	candidates := []string{
		"../../../../database/migrations",
		"../../database/migrations",
		"../database/migrations",
		"/app/migrations",
	}
	var migDir string
	for _, c := range candidates {
		clean := filepath.Clean(c)
		if info, err := os.Stat(clean); err == nil && info.IsDir() {
			migDir = clean
			break
		}
	}
	if migDir == "" {
		t.Fatal("could not find migrations directory")
	}

	files, err := os.ReadDir(migDir)
	if err != nil {
		t.Fatalf("read migrations dir: %v", err)
	}

	// Apply migrations 1 through 13.
	for _, file := range files {
		name := file.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		var version int
		if _, err := fmt.Sscanf(name, "%03d_", &version); err != nil {
			continue
		}
		if version > 13 {
			continue
		}
		content, err := os.ReadFile(filepath.Join(migDir, name))
		if err != nil {
			t.Fatalf("read migration %s: %v", name, err)
		}
		hash := sha256.Sum256(content)
		shaHex := hex.EncodeToString(hash[:])
		if err := postgres.Migrate(ctx, testDB, version, name, shaHex, string(content)); err != nil {
			t.Fatalf("apply migration v%d: %v", version, err)
		}
	}

	// Verify schema is at v13.
	v13, err := postgres.CurrentSchemaVersion(ctx, testDB)
	if err != nil {
		t.Fatalf("read schema version at v13: %v", err)
	}
	if v13 != 13 {
		t.Fatalf("expected schema version 13, got %d", v13)
	}

	// Insert representative pre-v14 data.
	const (
		ownerActorID    = "act_owner_test_13"
		operatorActorID = "act_operator_test_13"
		testTokenID     = "tok_test_13"
	)

	// 1. Platform owner.
	if _, err := testDB.ExecContext(ctx, "INSERT INTO identity_actors(id, phone_e164, security_enabled, version) VALUES($1, $2, true, 1)", ownerActorID, "+967770001300"); err != nil {
		t.Fatalf("insert owner actor: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, "INSERT INTO identity_actor_roles(actor_id, role, enabled, activated_at, version) VALUES($1, 'platform_owner', true, clock_timestamp(), 1)", ownerActorID); err != nil {
		t.Fatalf("insert owner role: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, "INSERT INTO identity_password_credentials(actor_id, role, password_hash, version) VALUES($1, 'platform_owner', 'dummy_owner_hash', 1)", ownerActorID); err != nil {
		t.Fatalf("insert owner credential: %v", err)
	}

	// 2. Operator.
	if _, err := testDB.ExecContext(ctx, "INSERT INTO identity_actors(id, phone_e164, security_enabled, version) VALUES($1, $2, true, 1)", operatorActorID, "+967770001301"); err != nil {
		t.Fatalf("insert operator actor: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, "INSERT INTO identity_actor_roles(actor_id, role, enabled, activated_at, version) VALUES($1, 'operator', true, clock_timestamp(), 1)", operatorActorID); err != nil {
		t.Fatalf("insert operator role: %v", err)
	}

	// 3. Pre-v14 table: identity_managed_activation_codes (operator token + legacy partner code).
	if _, err := testDB.ExecContext(ctx, `
		INSERT INTO identity_managed_activation_codes(id, actor_id, role, phone_e164, code_hash, status, attempts, expires_at, created_by)
		VALUES($1, $2, 'operator', '+967770001301', 'dummy_code_hash', 'pending', 0, clock_timestamp() + interval '1 hour', 'platform-control')`,
		testTokenID, operatorActorID); err != nil {
		t.Fatalf("insert into identity_managed_activation_codes: %v", err)
	}

	const partnerActorID = "act_partner_test_13"
	if _, err := testDB.ExecContext(ctx, "INSERT INTO identity_actors(id, phone_e164, security_enabled, version) VALUES($1, '+967770001302', true, 1)", partnerActorID); err != nil {
		t.Fatalf("insert partner actor: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, "INSERT INTO identity_actor_roles(actor_id, role, enabled, activated_at, version) VALUES($1, 'partner', true, clock_timestamp(), 1)", partnerActorID); err != nil {
		t.Fatalf("insert partner role: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, `
		INSERT INTO identity_managed_activation_codes(id, actor_id, role, phone_e164, code_hash, status, attempts, expires_at, created_by)
		VALUES('tok_partner_legacy', $1, 'partner', '+967770001302', 'dummy_partner_hash', 'pending', 0, clock_timestamp() + interval '1 hour', 'platform-control')`,
		partnerActorID); err != nil {
		t.Fatalf("insert legacy partner code: %v", err)
	}

	// 4. Password attempt.
	if _, err := testDB.ExecContext(ctx, "INSERT INTO identity_password_attempts(phone_e164, role, ip_hash, succeeded, reserved) VALUES('+967770001300', 'platform_owner', '0000000000000000000000000000000000000000000000000000000000000000', false, true)"); err != nil {
		t.Fatalf("insert password attempt: %v", err)
	}

	// Apply migration 014.
	var v14Name string
	var v14Content []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "014_") {
			v14Name = file.Name()
			var err error
			v14Content, err = os.ReadFile(filepath.Join(migDir, v14Name))
			if err != nil {
				t.Fatalf("read 014: %v", err)
			}
			break
		}
	}
	if v14Name == "" {
		t.Fatal("migration 014 not found")
	}

	hash14 := sha256.Sum256(v14Content)
	shaHex14 := hex.EncodeToString(hash14[:])
	if err := postgres.Migrate(ctx, testDB, 14, v14Name, shaHex14, string(v14Content)); err != nil {
		t.Fatalf("apply migration 014 on v13 database: %v", err)
	}

	// Verify schema version is now 14.
	v14, err := postgres.CurrentSchemaVersion(ctx, testDB)
	if err != nil {
		t.Fatalf("read schema version at v14: %v", err)
	}
	if v14 != 14 {
		t.Fatalf("expected schema version 14, got %d", v14)
	}

	// Assertions for v13 -> v14 correctness.
	var tokenPhone, tokenRole, tokenStatus string
	err = testDB.QueryRowContext(ctx, "SELECT phone_e164, role, status FROM identity_operator_enrollment_tokens WHERE id=$1", testTokenID).Scan(&tokenPhone, &tokenRole, &tokenStatus)
	if err != nil {
		t.Fatalf("query renamed table identity_operator_enrollment_tokens: %v", err)
	}
	if tokenPhone != "+967770001301" || tokenRole != "operator" || tokenStatus != "pending" {
		t.Fatalf("token data corrupted during rename: got phone=%s role=%s status=%s", tokenPhone, tokenRole, tokenStatus)
	}

	var oldTable sql.NullString
	_ = testDB.QueryRowContext(ctx, "SELECT to_regclass('public.identity_managed_activation_codes')").Scan(&oldTable)
	if oldTable.Valid && oldTable.String != "" {
		t.Fatalf("old table identity_managed_activation_codes still exists after rename")
	}

	var nonOpCount int
	err = testDB.QueryRowContext(ctx, "SELECT count(*) FROM identity_operator_enrollment_tokens WHERE role <> 'operator'").Scan(&nonOpCount)
	if err != nil || nonOpCount != 0 {
		t.Fatalf("expected 0 non-operator tokens in identity_operator_enrollment_tokens, got %d (err: %v)", nonOpCount, err)
	}

	var bootstrapOwner string
	err = testDB.QueryRowContext(ctx, "SELECT platform_owner_actor_id FROM identity_bootstrap_state WHERE id=1").Scan(&bootstrapOwner)
	if err != nil {
		t.Fatalf("query identity_bootstrap_state: %v", err)
	}
	if bootstrapOwner != ownerActorID {
		t.Fatalf("expected bootstrap owner %s, got %s", ownerActorID, bootstrapOwner)
	}

	var colCount int
	err = testDB.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_name='identity_password_attempts' AND column_name='reserved_until'").Scan(&colCount)
	if err != nil || colCount != 1 {
		t.Fatalf("reserved_until column not added to identity_password_attempts: %v", err)
	}

	// Insert legacy pending challenge/delivery states before the six-digit cutover.
	const (
		legacyPendingChallengeID = "challenge_legacy_four_digit_pending"
		legacySendingChallengeID = "challenge_legacy_four_digit_sending"
	)
	for _, challenge := range []struct {
		id        string
		phone     string
		codeHash  string
		status    string
		attempts  int
		startedAt string
	}{
		{legacyPendingChallengeID, "+967770001303", strings.Repeat("a", 64), "pending", 0, "NULL"},
		{legacySendingChallengeID, "+967770001304", strings.Repeat("b", 64), "pending", 0, "NULL"},
	} {
		if _, err := testDB.ExecContext(ctx, `
			INSERT INTO identity_challenges(id, actor_id, role, purpose, phone_e164, code_hash, request_ip_hash, admissible, status, attempts, expires_at)
			VALUES($1, $2, 'partner', 'managed_activate', $3, $4, $5, false, $6, $7, clock_timestamp() + interval '1 hour')`,
			challenge.id, partnerActorID, challenge.phone, challenge.codeHash, strings.Repeat("c", 64), challenge.status, challenge.attempts); err != nil {
			t.Fatalf("insert legacy challenge %s: %v", challenge.id, err)
		}
		startedAt := challenge.startedAt
		if challenge.id == legacySendingChallengeID {
			startedAt = "clock_timestamp()"
		}
		if _, err := testDB.ExecContext(ctx, fmt.Sprintf(`
			INSERT INTO identity_challenge_deliveries(challenge_id, provider, status, attempts, started_at)
			VALUES($1, 'mailpit', $2, $3, %s)`, startedAt), challenge.id, map[string]string{legacyPendingChallengeID: "pending", legacySendingChallengeID: "sending"}[challenge.id], map[string]int{legacyPendingChallengeID: 0, legacySendingChallengeID: 1}[challenge.id]); err != nil {
			t.Fatalf("insert legacy delivery %s: %v", challenge.id, err)
		}
	}

	// Apply migration 015 and prove the four-to-six-digit cutover is fail-closed.
	var v15Name string
	var v15Content []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "015_") {
			v15Name = file.Name()
			v15Content, err = os.ReadFile(filepath.Join(migDir, v15Name))
			if err != nil {
				t.Fatalf("read 015: %v", err)
			}
			break
		}
	}
	if v15Name == "" {
		t.Fatal("migration 015 not found")
	}
	hash15 := sha256.Sum256(v15Content)
	shaHex15 := hex.EncodeToString(hash15[:])
	if err := postgres.Migrate(ctx, testDB, 15, v15Name, shaHex15, string(v15Content)); err != nil {
		t.Fatalf("apply migration 015 on v14 database: %v", err)
	}

	var v15 int
	if v15, err = postgres.CurrentSchemaVersion(ctx, testDB); err != nil {
		t.Fatalf("read schema version at v15: %v", err)
	}
	if v15 != 15 {
		t.Fatalf("expected schema version 15, got %d", v15)
	}

	for _, challengeID := range []string{legacyPendingChallengeID, legacySendingChallengeID} {
		var challengeStatus string
		if err := testDB.QueryRowContext(ctx, "SELECT status FROM identity_challenges WHERE id=$1", challengeID).Scan(&challengeStatus); err != nil {
			t.Fatalf("query cutover challenge %s: %v", challengeID, err)
		}
		if challengeStatus != "revoked" {
			t.Fatalf("legacy challenge %s was not revoked: got %s", challengeID, challengeStatus)
		}
	}
	var pendingDeliveryStatus, sendingDeliveryStatus string
	if err := testDB.QueryRowContext(ctx, "SELECT status FROM identity_challenge_deliveries WHERE challenge_id=$1", legacyPendingChallengeID).Scan(&pendingDeliveryStatus); err != nil {
		t.Fatalf("query pending cutover delivery: %v", err)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT status FROM identity_challenge_deliveries WHERE challenge_id=$1", legacySendingChallengeID).Scan(&sendingDeliveryStatus); err != nil {
		t.Fatalf("query sending cutover delivery: %v", err)
	}
	if pendingDeliveryStatus != "suppressed" || sendingDeliveryStatus != "unknown" {
		t.Fatalf("legacy delivery states were not preserved safely: pending=%s sending=%s", pendingDeliveryStatus, sendingDeliveryStatus)
	}
	var activeLegacyDeliveries int
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM identity_challenge_deliveries WHERE status IN ('pending','sending')").Scan(&activeLegacyDeliveries); err != nil || activeLegacyDeliveries != 0 {
		t.Fatalf("legacy pending delivery residue remains: count=%d err=%v", activeLegacyDeliveries, err)
	}

	// Verify zero data loss on actors, roles and credentials.
	var actorCount, roleCount, credCount int
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM identity_actors").Scan(&actorCount); err != nil || actorCount != 3 {
		t.Fatalf("actor count mismatch: got %d want 3", actorCount)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM identity_actor_roles").Scan(&roleCount); err != nil || roleCount != 3 {
		t.Fatalf("role count mismatch: got %d want 3", roleCount)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM identity_password_credentials").Scan(&credCount); err != nil || credCount != 1 {
		t.Fatalf("credential count mismatch: got %d want 1", credCount)
	}

	// Verify full postgres.Ready passes on this upgraded database.
	if err := postgres.Ready(ctx, testDB); err != nil {
		t.Fatalf("postgres.Ready failed on upgraded database: %v", err)
	}

	t.Log("Migration v13 -> v15 upgrade, data preservation and six-digit cutover test PASSED successfully!")
}
