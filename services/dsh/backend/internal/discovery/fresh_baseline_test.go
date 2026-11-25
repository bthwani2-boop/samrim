package discovery

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

func TestFreshBaselineDeniedWithoutIsolatedOwnerOrCanonicalDirectory(t *testing.T) {
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused dbname=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, tc := range []struct{ schema, enabled string }{
		{"public", "true"},
		{"dsh", "true"},
		{"identity_test_fake", "true"},
		{"dsh_test_", "true"},
		{"dsh_test_new", "false"},
	} {
		t.Run(tc.schema+"_"+tc.enabled, func(t *testing.T) {
			t.Setenv("BTHWANI_ISOLATED_TEST_MODE", tc.enabled)
			owner, err := New(db, tc.schema)
			if err != nil {
				t.Fatal(err)
			}
			if err := owner.BootstrapFresh(context.Background(), filepath.Join("database", "schema")); err == nil ||
				!strings.Contains(err.Error(), "requires an isolated owner") {
				t.Fatalf("unsafe fresh bootstrap was not rejected before SQL execution: %v", err)
			}
		})
	}
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	owner, err := New(db, "dsh_test_good")
	if err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{"database/migrations", "database/other", "schema", "."} {
		if err := owner.BootstrapFresh(context.Background(), dir); err == nil ||
			!strings.Contains(err.Error(), "owner database/schema") {
			t.Fatalf("unsafe source directory %s was accepted: %v", dir, err)
		}
	}
}

func TestFreshBaselineRejectsModifiedSourceBeforeDatabase(t *testing.T) {
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused dbname=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	owner, err := New(db, fmt.Sprintf("dsh_test_failed_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join("..", "..", "..", "database", "schema")
	fixture := filepath.Join(t.TempDir(), "services", "dsh", "database", "schema")
	if err := os.MkdirAll(fixture, 0o700); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(source)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(source, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if entry.Name() == "60_employees.sql" {
			data = append(data, []byte("\nSELECT missing_column FROM nonexistent_dsh_table;\n")...)
		}
		if err := os.WriteFile(filepath.Join(fixture, entry.Name()), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	if err := owner.BootstrapFresh(ctx, fixture); err == nil ||
		!strings.Contains(err.Error(), "unreviewed DSH baseline bytes") {
		t.Fatalf("modified source was not rejected before database access: %v", err)
	}
}

func TestOwnerBootstrapFreshRollsBackIncompleteSchema(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("only in explicitly isolated PostgreSQL owner integration")
	}
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	owner, err := New(db, fmt.Sprintf("dsh_test_failed_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	files := []freshBaselineSource{
		{name: "first.sql", sql: "CREATE SCHEMA " + owner.Schema},
		{name: "failing.sql", sql: "SELECT missing_column FROM nonexistent_dsh_table"},
	}
	if err := owner.applyFreshBaseline(ctx, files); err == nil || !strings.Contains(err.Error(), "failing.sql") {
		t.Fatalf("expected failure inside bootstrap transaction: %v", err)
	}
	var exists bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1)", owner.Schema).Scan(&exists); err != nil || exists {
		t.Fatalf("incomplete bootstrap left a partial schema: exists=%t err=%v", exists, err)
	}
}

func TestOwnerBootstrapFreshInstallsRealDSHAndRefusesReapply(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("only in explicitly isolated PostgreSQL owner integration")
	}
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	owner, err := New(db, fmt.Sprintf("dsh_test_fresh_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	path := filepath.Join("..", "..", "..", "database", "schema")
	if err := owner.BootstrapFresh(ctx, path); err != nil {
		t.Fatalf("fresh owner baseline: %v", err)
	}
	if err := owner.ImportSynthetic(ctx); err != nil {
		t.Fatalf("DSH-owned synthetic import after fresh baseline: %v", err)
	}
	var count int
	var revision int64
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+owner.Schema+".stores").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT revision FROM "+owner.Schema+".public_revision WHERE singleton").Scan(&revision); err != nil {
		t.Fatal(err)
	}
	if count != 6 || revision != 1 {
		t.Fatalf("unexpected durable owner result after fresh bootstrap: stores=%d revision=%d", count, revision)
	}
	if err := owner.BootstrapFresh(ctx, path); err == nil ||
		!strings.Contains(err.Error(), "refuses an existing schema") {
		t.Fatalf("fresh bootstrap must never overwrite existing data: %v", err)
	}
	var retained int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+owner.Schema+".stores").Scan(&retained); err != nil ||
		retained != 6 {
		t.Fatalf("denied reapply changed retained Store rows: count=%d err=%v", retained, err)
	}
	// Include the new proof in the existing mandatory owner-backed CI test.
	t.Run("synthetic-registration-once", verifyFreshSyntheticRegistration)
}

func verifyFreshSyntheticRegistration(t *testing.T) {
	t.Setenv("DSH_BOOTSTRAP_SYNTHETIC_REGISTRATION", "true")
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	owner, err := New(db, fmt.Sprintf("dsh_test_seed_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	dir := filepath.Join("..", "..", "..", "database", "schema")
	if err = owner.BootstrapFresh(ctx, dir); err != nil {
		t.Fatal(err)
	}
	var policies, terms, audit, stores int
	check := func() {
		t.Helper()
		q := "SELECT (SELECT count(*) FROM " + owner.Schema + ".store_registration_policies WHERE city_id='sanaa' AND enabled AND version=1 AND terms_version='dev-merchant-terms-v1'),(SELECT count(*) FROM " + owner.Schema + ".store_registration_terms),(SELECT count(*) FROM " + owner.Schema + ".store_registration_policy_commands WHERE actor_id='system:dev-registration-bootstrap'),(SELECT count(*) FROM " + owner.Schema + ".stores)"
		if err = db.QueryRowContext(ctx, q).Scan(&policies, &terms, &audit, &stores); err != nil {
			t.Fatal(err)
		}
		if policies != 2 || terms != 1 || audit != 2 || stores != 0 {
			t.Fatalf("wrong fresh registration data: %d %d %d %d", policies, terms, audit, stores)
		}
	}
	check()
	grants, err := storeavailability.NewPostgresStoreGrants(db, owner.Schema)
	if err != nil {
		t.Fatal(err)
	}
	registrar, err := storeavailability.NewMerchantStoreRegistrar(seedTestIdentity{}, grants)
	if err != nil {
		t.Fatal(err)
	}
	options, err := registrar.Options(ctx, "synthetic-test")
	if err != nil || len(options.Choices) != 2 || len(options.Verticals) != 1 || options.Verticals[0] != "grocery" {
		t.Fatalf("owner options: %+v %v", options, err)
	}
	lat, lon := 15.35, 44.2
	for _, choice := range options.Choices {
		input := storeavailability.MerchantRegistrationRequest{OperationID: "registration-proof-" + choice.Relation, Name: "Synthetic " + choice.Relation, CityID: choice.CityID, VerticalID: "grocery", Relation: choice.Relation, Latitude: &lat, Longitude: &lon, PolicyVersion: choice.PolicyVersion, TermsVersion: choice.TermsVersion, AcceptedTerms: true}
		result, err := registrar.Register(ctx, "synthetic-test", input)
		if err != nil || result.Store.Published || result.Store.Relation != choice.Relation {
			t.Fatalf("register %s: %+v %v", choice.Relation, result, err)
		}
		replay, err := registrar.Register(ctx, "synthetic-test", input)
		if err != nil || !replay.Replay || replay.Store.ID != result.Store.ID {
			t.Fatalf("replay: %+v %v", replay, err)
		}
	}
	owned, err := grants.ListOwnedMerchantStores(ctx, "merchant-seed-proof")
	if err != nil || len(owned) != 2 {
		t.Fatalf("durable owned stores: %+v %v", owned, err)
	}
	other, err := grants.ListOwnedMerchantStores(ctx, "other-merchant")
	if err != nil || len(other) != 0 {
		t.Fatalf("cross-actor rows: %+v %v", other, err)
	}
	policy, err := registrar.ReadRegistrationPolicy(ctx, "sanaa", "DIRECT")
	if err != nil {
		t.Fatal(err)
	}
	_, err = registrar.ApplyRegistrationPolicy(ctx, "operator-seed-proof", storeavailability.StoreRegistrationPolicyChange{CityID: "sanaa", Relation: "DIRECT", OperationID: "disable-direct-proof", ExpectedVersion: 1, Enabled: false, TermsVersion: policy.TermsVersion, TermsText: policy.TermsText, Reason: "test disables registration"})
	if err != nil {
		t.Fatal(err)
	}
	if err = owner.BootstrapFresh(ctx, dir); err == nil || !strings.Contains(err.Error(), "refuses an existing schema") {
		t.Fatalf("unsafe reapply: %v", err)
	}
	policy, err = registrar.ReadRegistrationPolicy(ctx, "sanaa", "DIRECT")
	if err != nil || policy.Enabled || policy.Version != 2 {
		t.Fatalf("operator decision overwritten: %+v %v", policy, err)
	}
	options, err = registrar.Options(ctx, "synthetic-test")
	if err != nil || len(options.Choices) != 1 || options.Choices[0].Relation != "MARKETPLACE" {
		t.Fatalf("disabled relation leaked: %+v %v", options, err)
	}
}

type seedTestIdentity struct{}

func (seedTestIdentity) ResolveCurrentSession(_ context.Context, token string) (storeavailability.VerifiedActor, error) {
	if token != "synthetic-test" {
		return storeavailability.VerifiedActor{}, errors.New("unauthorized test token")
	}
	return storeavailability.VerifiedActor{Subject: "merchant-seed-proof", Role: storeavailability.MerchantRole}, nil
}
func (seedTestIdentity) RequireOperatorPermission(context.Context, string, string, string) error {
	return storeavailability.ErrForbidden
}

func TestOwnerBackedPersistentSyntheticRegistrationSeed(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || os.Getenv("DSH_TEST_SEED_BOUNDARY") != "true" {
		t.Skip("only in the explicit disposable DSH boundary fixture")
	}
	if os.Getenv("REF_POSTGRES_DB") != "bthwani_refoundation" || os.Getenv("REF_POSTGRES_USER") != "bthwani_ci" || os.Getenv("DSH_DB_HOST") != "127.0.0.1" {
		t.Fatal("refusing a non-CI seed fixture")
	}
	t.Setenv("REF_POSTGRES_DB", "bthwani_dsh_dev")
	t.Setenv("DSH_BOOTSTRAP_SYNTHETIC_REGISTRATION", "false")
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(t.Context(), 40*time.Second)
	defer cancel()
	owner, err := New(db, fmt.Sprintf("dsh_test_registration_seed_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	if err = owner.BootstrapFresh(ctx, filepath.Join("..", "..", "..", "database", "schema")); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		"INSERT INTO " + owner.Schema + ".service_cities(id,active,timezone_name) VALUES('sanaa',true,'Asia/Aden')",
		"INSERT INTO " + owner.Schema + ".verticals(id,active) VALUES('grocery',true)",
		"INSERT INTO " + owner.Schema + ".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES('retained-store','retained-merchant','sanaa','grocery','DIRECT','Retained store',true)",
		"GRANT USAGE ON SCHEMA " + owner.Schema + " TO bthwani_dsh_runtime",
		"GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA " + owner.Schema + " TO bthwani_dsh_runtime",
	} {
		if _, err = db.ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	grants, err := storeavailability.NewPostgresStoreGrants(db, owner.Schema)
	if err != nil {
		t.Fatal(err)
	}
	registrar, err := storeavailability.NewMerchantStoreRegistrar(seedTestIdentity{}, grants)
	if err != nil {
		t.Fatal(err)
	}
	_, err = registrar.ApplyRegistrationPolicy(ctx, "operator-retained-proof", storeavailability.StoreRegistrationPolicyChange{
		CityID: "sanaa", Relation: "DIRECT", OperationID: "retained-disabled-direct",
		ExpectedVersion: 0, Enabled: false, TermsVersion: "retained-terms-v1",
		TermsText: "Retained operator terms", Reason: "Retained disabled decision",
	})
	if err != nil {
		t.Fatal(err)
	}
	runSeed := func(schema, user, database, isolated string) error {
		cmd := exec.CommandContext(ctx, "/agent02/bin/dsh", "-mode", "isolated-seed", "-seed-profile", "development-registration")
		cmd.Env = append(os.Environ(), "REF_POSTGRES_USER="+user, "REF_POSTGRES_DB="+database,
			"DSH_DB_SCHEMA="+schema, "BTHWANI_ISOLATED_TEST_MODE="+isolated)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("seed command: %w: %s", err, output)
		}
		if !strings.Contains(string(output), "DSH_ISOLATED_OWNER_IMPORT_PASS") {
			return errors.New("seed did not report success")
		}
		return nil
	}
	// Real CLI and two dedicated-runtime connections race for the same missing
	// policy. Both complete without overwriting the existing disabled policy.
	results := make(chan error, 2)
	for range 2 {
		go func() { results <- runSeed(owner.Schema, "bthwani_dsh_runtime", "bthwani_dsh_dev", "true") }()
	}
	for range 2 {
		if err = <-results; err != nil {
			t.Fatal(err)
		}
	}
	if err = runSeed(owner.Schema, "bthwani_dsh_runtime", "bthwani_dsh_dev", "true"); err != nil {
		t.Fatalf("repeat: %v", err)
	}
	for _, tc := range []struct{ user, database, isolated string }{
		{"bthwani_ci", "bthwani_dsh_dev", "true"},
		{"bthwani_dsh_runtime", "bthwani_dsh_dev", "false"},
		{"bthwani_ci", "bthwani_refoundation", "true"},
	} {
		if err = runSeed(owner.Schema, tc.user, tc.database, tc.isolated); err == nil {
			t.Fatalf("unsafe seed accepted: %+v", tc)
		}
	}
	direct, err := registrar.ReadRegistrationPolicy(ctx, "sanaa", "DIRECT")
	if err != nil || direct.Version != 1 || direct.Enabled || direct.TermsVersion != "retained-terms-v1" || direct.TermsText != "Retained operator terms" || direct.ChangedByActor != "operator-retained-proof" {
		t.Fatalf("operator policy changed: %+v %v", direct, err)
	}
	market, err := registrar.ReadRegistrationPolicy(ctx, "sanaa", "MARKETPLACE")
	if err != nil || market.Version != 1 || !market.Enabled || market.TermsVersion != "dev-merchant-terms-v1" {
		t.Fatalf("missing policy not seeded: %+v %v", market, err)
	}
	q := "SELECT (SELECT count(*) FROM " + owner.Schema + ".store_registration_policies),(SELECT count(*) FROM " + owner.Schema + ".store_registration_terms),(SELECT count(*) FROM " + owner.Schema + ".store_registration_policy_commands),(SELECT count(*) FROM " + owner.Schema + ".stores WHERE id='retained-store' AND owner_actor_id='retained-merchant' AND name='Retained store' AND published),(SELECT count(*) FROM " + owner.Schema + ".stores),(SELECT count(*) FROM " + owner.Schema + ".store_registration_commands)"
	var policies, terms, audit, retained, stores, registrations int
	if err = db.QueryRowContext(ctx, q).Scan(&policies, &terms, &audit, &retained, &stores, &registrations); err != nil {
		t.Fatal(err)
	}
	if policies != 2 || terms != 2 || audit != 2 || retained != 1 || stores != 1 || registrations != 0 {
		t.Fatalf("durable missing-only result: policies=%d terms=%d audit=%d retained=%d stores=%d registrations=%d", policies, terms, audit, retained, stores, registrations)
	}
	// A missing row with existing policy-command history is corruption, not a
	// first-time seed. Never recreate it or add a new command.
	if _, err = db.ExecContext(ctx, "DELETE FROM "+owner.Schema+".store_registration_policies WHERE relation='MARKETPLACE' AND city_id='sanaa'"); err != nil {
		t.Fatal(err)
	}
	if err = runSeed(owner.Schema, "bthwani_dsh_runtime", "bthwani_dsh_dev", "true"); err == nil {
		t.Fatal("seed recreated a policy with existing history")
	}
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+owner.Schema+".store_registration_policies").Scan(&policies); err != nil || policies != 1 {
		t.Fatalf("inconsistent policy was recreated: %d %v", policies, err)
	}
	t.Run("all-missing", func(t *testing.T) {
		empty, err := New(db, fmt.Sprintf("dsh_test_registration_empty_%x", time.Now().UnixNano()))
		if err != nil {
			t.Fatal(err)
		}
		if err = empty.BootstrapFresh(ctx, filepath.Join("..", "..", "..", "database", "schema")); err != nil {
			t.Fatal(err)
		}
		execSQL := func(query string) {
			t.Helper()
			if _, err := db.ExecContext(ctx, query); err != nil {
				t.Fatal(err)
			}
		}
		schema := empty.Schema
		execSQL("GRANT USAGE ON SCHEMA " + schema + " TO bthwani_dsh_runtime")
		execSQL("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA " + schema + " TO bthwani_dsh_runtime")
		execSQL("INSERT INTO " + schema + ".service_cities(id,active,timezone_name) VALUES('sanaa',true,'Asia/Aden')")
		execSQL("INSERT INTO " + schema + ".verticals(id,active) VALUES('grocery',false)")
		check := func(wantPolicies, wantTerms, wantAudit int) {
			t.Helper()
			var policies, terms, audit int
			q := "SELECT (SELECT count(*) FROM " + schema + ".store_registration_policies WHERE enabled AND version=1),(SELECT count(*) FROM " + schema + ".store_registration_terms),(SELECT count(*) FROM " + schema + ".store_registration_policy_commands)"
			if err := db.QueryRowContext(ctx, q).Scan(&policies, &terms, &audit); err != nil || policies != wantPolicies || terms != wantTerms || audit != wantAudit {
				t.Fatalf("all-missing seed readback: %d:%d:%d, err=%v", policies, terms, audit, err)
			}
		}
		seed := func() error { return runSeed(schema, "bthwani_dsh_runtime", "bthwani_dsh_dev", "true") }
		if err := seed(); err == nil {
			t.Fatal("inactive reference data admitted")
		}
		check(0, 0, 0)
		execSQL("UPDATE " + schema + ".verticals SET active=true WHERE id='grocery'")
		for range 2 {
			if err := seed(); err != nil {
				t.Fatal(err)
			}
			check(2, 1, 2)
		}
	})
	t.Log("PERSISTENT_SYNTHETIC_REGISTRATION_SEED_PASS")
}
