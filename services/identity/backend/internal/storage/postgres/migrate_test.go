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

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identityruntime "github.com/bthwani2-boop/samrim/services/identity/backend/internal/runtime"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestMigrationV13ToV23Upgrade(t *testing.T) {
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

	// Insert privileged artifacts that must be revoked rather than translated
	// into a new operator session/challenge during the persona cutover.
	if _, err := testDB.ExecContext(ctx, `
		INSERT INTO identity_challenges(id, actor_id, role, purpose, phone_e164, code_hash, request_ip_hash, admissible, status, attempts, expires_at)
		VALUES('challenge_legacy_operator', $1, 'platform_owner', 'operator_mfa', '+967770001300', repeat('d', 64), repeat('e', 64), true, 'pending', 0, clock_timestamp() + interval '1 hour')`, ownerActorID); err != nil {
		t.Fatalf("insert legacy operator challenge: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, `
		INSERT INTO identity_sessions(id, actor_id, role, access_token_hash, refresh_token_hash, device_fingerprint_hash, access_expires_at, refresh_expires_at, absolute_expires_at)
		VALUES('session_legacy_operator', $1, 'platform_owner', repeat('f', 64), repeat('g', 64), repeat('h', 64), clock_timestamp() + interval '1 hour', clock_timestamp() + interval '2 hours', clock_timestamp() + interval '3 hours')`, ownerActorID); err != nil {
		t.Fatalf("insert legacy operator session: %v", err)
	}

	// Apply migration 016 and prove the operator-only cutover is coherent.
	var previousMigrationName string
	var previousMigrationContent []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "016_") {
			previousMigrationName = file.Name()
			previousMigrationContent, err = os.ReadFile(filepath.Join(migDir, previousMigrationName))
			if err != nil {
				t.Fatalf("read 016: %v", err)
			}
			break
		}
	}
	if previousMigrationName == "" {
		t.Fatal("migration 016 not found")
	}
	previousMigrationHash := sha256.Sum256(previousMigrationContent)
	if err := postgres.Migrate(ctx, testDB, 16, previousMigrationName, hex.EncodeToString(previousMigrationHash[:]), string(previousMigrationContent)); err != nil {
		t.Fatalf("apply migration 016 on v15 database: %v", err)
	}
	if previousVersion, err := postgres.CurrentSchemaVersion(ctx, testDB); err != nil || previousVersion != 16 {
		t.Fatalf("expected schema version 16, got %d (err: %v)", previousVersion, err)
	}

	var bootstrapOperator string
	if err := testDB.QueryRowContext(ctx, "SELECT initial_operator_actor_id FROM identity_bootstrap_state WHERE id=1").Scan(&bootstrapOperator); err != nil {
		t.Fatalf("query initial operator bootstrap state: %v", err)
	}
	if bootstrapOperator != ownerActorID {
		t.Fatalf("expected initial operator %s, got %s", ownerActorID, bootstrapOperator)
	}

	var legacyRoleCount, legacyCredentialCount, legacyChallengeCount, legacySessionCount, legacyAttemptCount int
	queries := []struct {
		name  string
		query string
		out   *int
	}{
		{"legacy roles", "SELECT count(*) FROM identity_actor_roles WHERE role='platform_owner'", &legacyRoleCount},
		{"legacy credentials", "SELECT count(*) FROM identity_password_credentials WHERE role='platform_owner'", &legacyCredentialCount},
		{"legacy challenges", "SELECT count(*) FROM identity_challenges WHERE role='platform_owner'", &legacyChallengeCount},
		{"legacy sessions", "SELECT count(*) FROM identity_sessions WHERE role='platform_owner'", &legacySessionCount},
		{"legacy attempts", "SELECT count(*) FROM identity_password_attempts WHERE role='platform_owner'", &legacyAttemptCount},
	}
	for _, check := range queries {
		if err := testDB.QueryRowContext(ctx, check.query).Scan(check.out); err != nil {
			t.Fatalf("query %s: %v", check.name, err)
		}
	}
	if legacyRoleCount != 0 || legacyCredentialCount != 0 || legacyChallengeCount != 0 || legacySessionCount != 0 || legacyAttemptCount != 0 {
		t.Fatalf("legacy operator artifacts remain: roles=%d credentials=%d challenges=%d sessions=%d attempts=%d", legacyRoleCount, legacyCredentialCount, legacyChallengeCount, legacySessionCount, legacyAttemptCount)
	}
	var ownerRole, ownerPassword string
	if err := testDB.QueryRowContext(ctx, "SELECT role FROM identity_actor_roles WHERE actor_id=$1", ownerActorID).Scan(&ownerRole); err != nil {
		t.Fatalf("query canonical owner role: %v", err)
	}
	if ownerRole != "operator" {
		t.Fatalf("legacy owner was not materialized as operator: %s", ownerRole)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT password_hash FROM identity_password_credentials WHERE actor_id=$1 AND role='operator'", ownerActorID).Scan(&ownerPassword); err != nil {
		t.Fatalf("query canonical operator credential: %v", err)
	}
	if ownerPassword != "dummy_owner_hash" {
		t.Fatalf("canonical operator credential was not preserved")
	}
	var legacyIndexCount int
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='identity_actor_roles_platform_owner_uq'").Scan(&legacyIndexCount); err != nil || legacyIndexCount != 0 {
		t.Fatalf("legacy operator uniqueness index remains: count=%d err=%v", legacyIndexCount, err)
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

	// Apply migration 017 and prove the passkey/instance-binding cutover is
	// forward-only: operator password artifacts and retired proof purposes are
	// removed, while the new WebAuthn persistence boundary is present.
	var v17Name string
	var v17Content []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "017_") {
			v17Name = file.Name()
			v17Content, err = os.ReadFile(filepath.Join(migDir, v17Name))
			if err != nil {
				t.Fatalf("read 017: %v", err)
			}
			break
		}
	}
	if v17Name == "" {
		t.Fatal("migration 017 not found")
	}
	hash17 := sha256.Sum256(v17Content)
	shaHex17 := hex.EncodeToString(hash17[:])
	if err := postgres.Migrate(ctx, testDB, 17, v17Name, shaHex17, string(v17Content)); err != nil {
		t.Fatalf("apply migration 017 on previous database: %v", err)
	}
	if v17, err := postgres.CurrentSchemaVersion(ctx, testDB); err != nil || v17 != 17 {
		t.Fatalf("expected schema version 17, got %d (err: %v)", v17, err)
	}

	var operatorCredentialCount, operatorAttemptCount, retiredChallengeCount int
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM identity_password_credentials WHERE role='operator'").Scan(&operatorCredentialCount); err != nil {
		t.Fatalf("query operator credentials after v17: %v", err)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM identity_password_attempts WHERE role='operator'").Scan(&operatorAttemptCount); err != nil {
		t.Fatalf("query operator password attempts after v17: %v", err)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM identity_challenges WHERE purpose IN ('operator_mfa','managed_recover') OR (role='operator' AND purpose='managed_activate')").Scan(&retiredChallengeCount); err != nil {
		t.Fatalf("query retired proof artifacts after v17: %v", err)
	}
	if operatorCredentialCount != 0 || operatorAttemptCount != 0 || retiredChallengeCount != 0 {
		t.Fatalf("retired operator auth artifacts remain after v17: credentials=%d attempts=%d challenges=%d", operatorCredentialCount, operatorAttemptCount, retiredChallengeCount)
	}
	for _, table := range []string{"identity_webauthn_users", "identity_webauthn_credentials", "identity_webauthn_ceremonies", "identity_operator_recovery_credentials"} {
		var exists bool
		if err := testDB.QueryRowContext(ctx, "SELECT to_regclass('public."+table+"') IS NOT NULL").Scan(&exists); err != nil || !exists {
			t.Fatalf("new passkey table missing after v17: %s (err: %v)", table, err)
		}
	}
	var instanceColumnCount int
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_name='identity_sessions' AND column_name='client_instance_id_hash'").Scan(&instanceColumnCount); err != nil || instanceColumnCount != 1 {
		t.Fatalf("client_instance_id_hash column missing after v17: %v", err)
	}
	var oldInstanceColumnCount int
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_name='identity_sessions' AND column_name='device_fingerprint_hash'").Scan(&oldInstanceColumnCount); err != nil || oldInstanceColumnCount != 0 {
		t.Fatalf("retired session binding column remains after v17: %d (err: %v)", oldInstanceColumnCount, err)
	}

	// Seed one active mobile session and one operator session at the v17
	// boundary. The forward lifetime cutover must update only the mobile row;
	// access expiry and operator lifetime semantics remain untouched.
	if _, err := testDB.ExecContext(ctx, `
		INSERT INTO identity_sessions(id, actor_id, role, access_token_hash, refresh_token_hash, client_instance_id_hash, access_expires_at, refresh_expires_at, absolute_expires_at, last_used_at, version)
		VALUES
		('session_mobile_v17', $1, 'partner', repeat('1', 64), repeat('2', 64), repeat('3', 64), clock_timestamp() + interval '15 minutes', clock_timestamp() + interval '7 days', clock_timestamp() + interval '30 days', clock_timestamp(), 1),
		('session_operator_v17', $2, 'operator', repeat('4', 64), repeat('5', 64), repeat('6', 64), clock_timestamp() + interval '15 minutes', clock_timestamp() + interval '1 hour', clock_timestamp() + interval '24 hours', clock_timestamp(), 1)`, partnerActorID, ownerActorID); err != nil {
		t.Fatalf("insert v17 session fixtures: %v", err)
	}

	var operatorRefreshBefore, operatorAbsoluteBefore time.Time
	if err := testDB.QueryRowContext(ctx, "SELECT refresh_expires_at,absolute_expires_at FROM identity_sessions WHERE id='session_operator_v17'").Scan(&operatorRefreshBefore, &operatorAbsoluteBefore); err != nil {
		t.Fatalf("read operator v17 session fixture: %v", err)
	}

	// Apply migration 018 and prove the mobile lifetime cutover is precise.
	var v18Name string
	var v18Content []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "018_") {
			v18Name = file.Name()
			v18Content, err = os.ReadFile(filepath.Join(migDir, v18Name))
			if err != nil {
				t.Fatalf("read 018: %v", err)
			}
			break
		}
	}
	if v18Name == "" {
		t.Fatal("migration 018 not found")
	}
	hash18 := sha256.Sum256(v18Content)
	if err := postgres.Migrate(ctx, testDB, 18, v18Name, hex.EncodeToString(hash18[:]), string(v18Content)); err != nil {
		t.Fatalf("apply migration 018 on v17 database: %v", err)
	}
	if v18, err := postgres.CurrentSchemaVersion(ctx, testDB); err != nil || v18 != 18 {
		t.Fatalf("expected schema version 18, got %d (err: %v)", v18, err)
	}

	var mobileAccess, mobileRefresh, mobileAbsolute, mobileCreated time.Time
	if err := testDB.QueryRowContext(ctx, "SELECT access_expires_at,refresh_expires_at,absolute_expires_at,created_at FROM identity_sessions WHERE id='session_mobile_v17'").Scan(&mobileAccess, &mobileRefresh, &mobileAbsolute, &mobileCreated); err != nil {
		t.Fatalf("read mobile session after v18: %v", err)
	}
	if mobileAbsolute.Before(mobileCreated.Add(364*24*time.Hour)) || mobileAbsolute.After(mobileCreated.Add(366*24*time.Hour)) {
		t.Fatalf("mobile absolute lifetime was not cut over to 365 days: created=%s absolute=%s", mobileCreated, mobileAbsolute)
	}
	if mobileRefresh.Before(time.Now().Add(29*24*time.Hour)) || mobileRefresh.After(time.Now().Add(31*24*time.Hour)) {
		t.Fatalf("mobile refresh lifetime was not cut over to 30 days: refresh=%s", mobileRefresh)
	}
	if mobileAccess.Before(time.Now().Add(14*time.Minute)) || mobileAccess.After(time.Now().Add(16*time.Minute)) {
		t.Fatalf("mobile access expiry was unexpectedly extended: access=%s", mobileAccess)
	}
	var operatorRefreshAfter, operatorAbsoluteAfter time.Time
	if err := testDB.QueryRowContext(ctx, "SELECT refresh_expires_at,absolute_expires_at FROM identity_sessions WHERE id='session_operator_v17'").Scan(&operatorRefreshAfter, &operatorAbsoluteAfter); err != nil {
		t.Fatalf("read operator session after v18: %v", err)
	}
	if !operatorRefreshAfter.Equal(operatorRefreshBefore) || !operatorAbsoluteAfter.Equal(operatorAbsoluteBefore) {
		t.Fatalf("operator session changed during mobile cutover: before=%s/%s after=%s/%s", operatorRefreshBefore, operatorAbsoluteBefore, operatorRefreshAfter, operatorAbsoluteAfter)
	}

	// Apply migration 019 and prove durable refresh reconciliation metadata is present.
	var v19Name string
	var v19Content []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "019_") {
			v19Name = file.Name()
			v19Content, err = os.ReadFile(filepath.Join(migDir, v19Name))
			if err != nil {
				t.Fatalf("read 019: %v", err)
			}
			break
		}
	}
	if v19Name == "" {
		t.Fatal("migration 019 not found")
	}
	hash19 := sha256.Sum256(v19Content)
	if err := postgres.Migrate(ctx, testDB, 19, v19Name, hex.EncodeToString(hash19[:]), string(v19Content)); err != nil {
		t.Fatalf("apply migration 019 on v18 database: %v", err)
	}
	if version, err := postgres.CurrentSchemaVersion(ctx, testDB); err != nil || version != 19 {
		t.Fatalf("expected schema version 19, got %d (err: %v)", version, err)
	}
	var requestColumnCount, requestIndexCount int
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_name='identity_refresh_token_history' AND column_name='refresh_request_id'").Scan(&requestColumnCount); err != nil || requestColumnCount != 1 {
		t.Fatalf("refresh request id column missing after v19: %v", err)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM pg_indexes WHERE indexname='identity_refresh_token_history_request_id_uq'").Scan(&requestIndexCount); err != nil || requestIndexCount != 1 {
		t.Fatalf("refresh request id unique index missing after v19: %v", err)
	}

	// Apply migration 020 and prove only the initial Operator receives Finance access by default.
	var v20Name string
	var v20Content []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "020_") {
			v20Name = file.Name()
			v20Content, err = os.ReadFile(filepath.Join(migDir, v20Name))
			if err != nil {
				t.Fatalf("read 020: %v", err)
			}
			break
		}
	}
	if v20Name == "" {
		t.Fatal("migration 020 not found")
	}
	hash20 := sha256.Sum256(v20Content)
	if err := postgres.Migrate(ctx, testDB, 20, v20Name, hex.EncodeToString(hash20[:]), string(v20Content)); err != nil {
		t.Fatalf("apply migration 020 on v19 database: %v", err)
	}
	if version, err := postgres.CurrentSchemaVersion(ctx, testDB); err != nil || version != 20 {
		t.Fatalf("expected schema version 20, got %d (err: %v)", version, err)
	}
	var initialFinance, laterFinance bool
	if err := testDB.QueryRowContext(ctx, "SELECT enabled FROM identity_operator_permissions WHERE actor_id=$1 AND permission='finance'", ownerActorID).Scan(&initialFinance); err != nil {
		t.Fatalf("read initial Operator Finance grant: %v", err)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT enabled FROM identity_operator_permissions WHERE actor_id=$1 AND permission='finance'", operatorActorID).Scan(&laterFinance); err != nil {
		t.Fatalf("read later Operator Finance grant: %v", err)
	}
	if !initialFinance || laterFinance {
		t.Fatalf("Finance grant backfill was not least-privilege: initial=%v later=%v", initialFinance, laterFinance)
	}

	// Apply migration 021 and prove Platform Policies access is separately granted.
	var v21Name string
	var v21Content []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "021_") {
			v21Name = file.Name()
			v21Content, err = os.ReadFile(filepath.Join(migDir, v21Name))
			if err != nil {
				t.Fatalf("read 021: %v", err)
			}
			break
		}
	}
	if v21Name == "" {
		t.Fatal("migration 021 not found")
	}
	hash21 := sha256.Sum256(v21Content)
	if err := postgres.Migrate(ctx, testDB, 21, v21Name, hex.EncodeToString(hash21[:]), string(v21Content)); err != nil {
		t.Fatalf("apply migration 021 on v20 database: %v", err)
	}
	if version, err := postgres.CurrentSchemaVersion(ctx, testDB); err != nil || version != 21 {
		t.Fatalf("expected schema version 21, got %d (err: %v)", version, err)
	}
	var initialPolicies, laterPolicies bool
	if err := testDB.QueryRowContext(ctx, "SELECT enabled FROM identity_operator_permissions WHERE actor_id=$1 AND permission='platform_policies'", ownerActorID).Scan(&initialPolicies); err != nil {
		t.Fatalf("read initial Operator Platform Policies grant: %v", err)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT enabled FROM identity_operator_permissions WHERE actor_id=$1 AND permission='platform_policies'", operatorActorID).Scan(&laterPolicies); err != nil {
		t.Fatalf("read later Operator Platform Policies grant: %v", err)
	}
	if !initialPolicies || laterPolicies {
		t.Fatalf("Platform Policies grant backfill was not least-privilege: initial=%v later=%v", initialPolicies, laterPolicies)
	}

	// Apply migration 022 and prove every admitted workspace scope is persisted for Operators.
	var v22Name string
	var v22Content []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "022_") {
			v22Name = file.Name()
			v22Content, err = os.ReadFile(filepath.Join(migDir, v22Name))
			if err != nil {
				t.Fatalf("read 022: %v", err)
			}
			break
		}
	}
	if v22Name == "" {
		t.Fatal("migration 022 not found")
	}
	hash22 := sha256.Sum256(v22Content)
	if err := postgres.Migrate(ctx, testDB, 22, v22Name, hex.EncodeToString(hash22[:]), string(v22Content)); err != nil {
		t.Fatalf("apply migration 022 on v21 database: %v", err)
	}
	if version, err := postgres.CurrentSchemaVersion(ctx, testDB); err != nil || version != 22 {
		t.Fatalf("expected schema version 22, got %d (err: %v)", version, err)
	}
	var initialPermissionCount, initialEnabledPermissionCount, laterPermissionCount, laterEnabledPermissionCount int
	if err := testDB.QueryRowContext(ctx, "SELECT count(*), count(*) FILTER (WHERE enabled) FROM identity_operator_permissions WHERE actor_id=$1", ownerActorID).Scan(&initialPermissionCount, &initialEnabledPermissionCount); err != nil {
		t.Fatalf("read initial Operator workspace grants: %v", err)
	}
	if err := testDB.QueryRowContext(ctx, "SELECT count(*), count(*) FILTER (WHERE enabled) FROM identity_operator_permissions WHERE actor_id=$1", operatorActorID).Scan(&laterPermissionCount, &laterEnabledPermissionCount); err != nil {
		t.Fatalf("read later Operator workspace grants: %v", err)
	}
	if initialPermissionCount != len(domain.OperatorPermissions()) || initialEnabledPermissionCount != len(domain.OperatorPermissions()) || laterPermissionCount != len(domain.OperatorPermissions()) || laterEnabledPermissionCount != 0 {
		t.Fatalf("workspace permission backfill was not least-privilege: initial=%d/%d later=%d/%d scopes=%d", initialPermissionCount, initialEnabledPermissionCount, laterPermissionCount, laterEnabledPermissionCount, len(domain.OperatorPermissions()))
	}

	// Apply migration 023 and prove the legal-name authority is added without fabricating names for existing actors.
	var v23Name string
	var v23Content []byte
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "023_") {
			v23Name = file.Name()
			v23Content, err = os.ReadFile(filepath.Join(migDir, v23Name))
			if err != nil {
				t.Fatalf("read 023: %v", err)
			}
			break
		}
	}
	if v23Name == "" {
		t.Fatal("migration 023 not found")
	}
	hash23 := sha256.Sum256(v23Content)
	if err := postgres.Migrate(ctx, testDB, 23, v23Name, hex.EncodeToString(hash23[:]), string(v23Content)); err != nil {
		t.Fatalf("apply migration 023 on v22 database: %v", err)
	}
	if version, err := postgres.CurrentSchemaVersion(ctx, testDB); err != nil || version != 23 {
		t.Fatalf("expected schema version 23, got %d (err: %v)", version, err)
	}
	for _, relation := range []string{"identity_actor_legal_name_versions", "identity_actor_legal_names", "identity_actor_legal_name_events"} {
		var exists bool
		if err := testDB.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", "public."+relation).Scan(&exists); err != nil || !exists {
			t.Fatalf("legal-name relation missing after v23: %s err=%v", relation, err)
		}
	}
	var fabricatedNames int
	if err := testDB.QueryRowContext(ctx, "SELECT count(*) FROM identity_actor_legal_names").Scan(&fabricatedNames); err != nil || fabricatedNames != 0 {
		t.Fatalf("v23 must not fabricate verified legal names for existing actors: count=%d err=%v", fabricatedNames, err)
	}

	// Verify full postgres.Ready passes on this upgraded database.
	if err := postgres.Ready(ctx, testDB); err != nil {
		t.Fatalf("postgres.Ready failed on upgraded database: %v", err)
	}

	// Re-run the canonical runtime migrator and prove it is a no-op at v23.
	beforeSecondRun := readMigrationNoOpSnapshot(t, testDB)
	if err := identityruntime.RunMigrations(ctx, "development", testURL, migDir); err != nil {
		t.Fatalf("second canonical migration run failed: %v", err)
	}
	afterSecondRun := readMigrationNoOpSnapshot(t, testDB)
	assertMigrationNoOpSnapshotUnchanged(t, beforeSecondRun, afterSecondRun)
	if version, err := postgres.CurrentSchemaVersion(ctx, testDB); err != nil || version != 23 {
		t.Fatalf("schema version changed during second canonical migration run: version=%d err=%v", version, err)
	}

	t.Log("Migration v13 -> v23 upgrade, data preservation, passkey cutover, mobile lifetime, refresh reconciliation, Operator workspace permissions and legal-name authority test PASSED successfully!")
}

type migrationSessionSnapshot struct {
	id       string
	access   time.Time
	refresh  time.Time
	absolute time.Time
	version  int
}

type migrationHistorySnapshot struct {
	version   int
	name      string
	sha256    string
	appliedAt time.Time
}

type migrationNoOpSnapshot struct {
	sessions []migrationSessionSnapshot
	history  []migrationHistorySnapshot
}

func readMigrationNoOpSnapshot(t *testing.T, db *sql.DB) migrationNoOpSnapshot {
	t.Helper()
	snapshot := migrationNoOpSnapshot{}
	sessionRows, err := db.Query("SELECT id,access_expires_at,refresh_expires_at,absolute_expires_at,version FROM identity_sessions ORDER BY id")
	if err != nil {
		t.Fatalf("read session no-op snapshot: %v", err)
	}
	defer sessionRows.Close()
	for sessionRows.Next() {
		var row migrationSessionSnapshot
		if err := sessionRows.Scan(&row.id, &row.access, &row.refresh, &row.absolute, &row.version); err != nil {
			t.Fatalf("scan session no-op snapshot: %v", err)
		}
		snapshot.sessions = append(snapshot.sessions, row)
	}
	if err := sessionRows.Err(); err != nil {
		t.Fatalf("read session no-op snapshot rows: %v", err)
	}

	historyRows, err := db.Query("SELECT version,name,sha256,applied_at FROM identity_schema_migrations ORDER BY version")
	if err != nil {
		t.Fatalf("read migration history no-op snapshot: %v", err)
	}
	defer historyRows.Close()
	for historyRows.Next() {
		var row migrationHistorySnapshot
		if err := historyRows.Scan(&row.version, &row.name, &row.sha256, &row.appliedAt); err != nil {
			t.Fatalf("scan migration history no-op snapshot: %v", err)
		}
		snapshot.history = append(snapshot.history, row)
	}
	if err := historyRows.Err(); err != nil {
		t.Fatalf("read migration history no-op snapshot rows: %v", err)
	}
	return snapshot
}

func assertMigrationNoOpSnapshotUnchanged(t *testing.T, before, after migrationNoOpSnapshot) {
	t.Helper()
	if len(before.sessions) != len(after.sessions) || len(before.history) != len(after.history) {
		t.Fatalf("canonical second migration run changed snapshot cardinality: sessions %d/%d history %d/%d", len(before.sessions), len(after.sessions), len(before.history), len(after.history))
	}
	for index := range before.sessions {
		left, right := before.sessions[index], after.sessions[index]
		if left.id != right.id || !left.access.Equal(right.access) || !left.refresh.Equal(right.refresh) || !left.absolute.Equal(right.absolute) || left.version != right.version {
			t.Fatalf("canonical second migration run changed session snapshot at %d: before=%+v after=%+v", index, left, right)
		}
	}
	for index := range before.history {
		left, right := before.history[index], after.history[index]
		if left.version != right.version || left.name != right.name || left.sha256 != right.sha256 || !left.appliedAt.Equal(right.appliedAt) {
			t.Fatalf("canonical second migration run changed migration history at %d: before=%+v after=%+v", index, left, right)
		}
	}
}
