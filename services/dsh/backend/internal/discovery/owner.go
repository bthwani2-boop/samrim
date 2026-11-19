package discovery

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"

	_ "github.com/lib/pq"
)

// Store, publication, city and Offer remain DSH facts. No client-side fallback or duplicate writer.
type Owner struct {
	DB     *sql.DB
	Schema string
}

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

// Migration and synthetic import are isolated developer-only operations. Do not accept a similarly
// named production/donor database even when it contains a dsh_test_* schema.
func isRefoundationDatabase(name string) bool {
	return name == "bthwani_refoundation"
}

func (o *Owner) isIsolatedTestOwner() bool {
	return o != nil && o.DB != nil && identifier.MatchString(o.Schema) &&
		strings.HasPrefix(o.Schema, "dsh_test_") && len(o.Schema) > len("dsh_test_") &&
		os.Getenv("BTHWANI_ISOLATED_TEST_MODE") == "true"
}

func requireRefoundationDatabase(ctx context.Context, tx *sql.Tx) error {
	var name string
	if err := tx.QueryRowContext(ctx, "SELECT pg_catalog.current_database()").Scan(&name); err != nil {
		return fmt.Errorf("DSH database identity unavailable: %w", err)
	}
	if !isRefoundationDatabase(name) {
		return errors.New("outside the isolated refoundation database")
	}
	return nil
}

func New(db *sql.DB, schema string) (*Owner, error) {
	if !identifier.MatchString(schema) {
		return nil, errors.New("invalid DSH schema identifier")
	}
	return &Owner{DB: db, Schema: schema}, nil
}
func OpenFromEnvironment() (*sql.DB, error) {
	user, pass, dbname := os.Getenv("REF_POSTGRES_USER"), os.Getenv("REF_POSTGRES_PASSWORD"), os.Getenv("REF_POSTGRES_DB")
	if user == "" || pass == "" || dbname == "" {
		return nil, errors.New("isolated database credentials not configured")
	}
	host := os.Getenv("DSH_DB_HOST")
	if host == "" {
		host = "postgres"
	}
	u := &url.URL{Scheme: "postgres", Host: host + ":5432", Path: "/" + dbname, User: url.UserPassword(user, pass)}
	q := url.Values{}
	q.Set("sslmode", "disable")
	q.Set("connect_timeout", "5")
	u.RawQuery = q.Encode()
	return sql.Open("postgres", u.String())
}

// A schema marker is not a SQL sandbox: arbitrary input could still alter
// other schemas or execute privileged statements. Only these exact, reviewed,
// immutable DSH migration files may reach the SQL executor. Updating a file
// requires a separate review of its statements and an explicit new digest.
func isReviewedMigrationSource(source []byte) bool {
	switch fmt.Sprintf("%x", sha256.Sum256(source)) {
	case "0faa485857413951eba34f4ff278a723bb968a84be7fa01de19249ece7ad3895", // 001_public_discovery.sql
		"f4ef4ed3b9b45bf7389c8588d69fb333e1ce3ac92b334f1f003cc17313501e90", // 002_store_orderability.sql
		"2ae3dcccc682c1e8f7917b7355f85b12311c381718fcf9afff91524e30bee773", // 003_service_city_timezone.sql
		"8e48b3cdcdc103fe698b1a9d1768be7006395e99e930f81ce37084de8e5f778e", // 004_store_availability_city_limits.sql
		"05f8566c1e8de1ee4f5922964c449652e0a005bd7e4840c651a464cdbca481fb": // 005_store_operational_policy_commands.sql
		return true
	default:
		return false
	}
}

func (o *Owner) Migrate(ctx context.Context, source []byte) error {
	if !o.isIsolatedTestOwner() {
		return errors.New("isolated DSH migration required")
	}
	// Every reviewed owner migration must explicitly identify its own test schema.
	// Without the marker, a mistakenly supplied SQL file could run in public
	// or another service's search_path even in the isolated development DB.
	if !strings.Contains(string(source), "__SCHEMA__") {
		return errors.New("DSH migration is missing its scoped schema marker")
	}
	if !isReviewedMigrationSource(source) {
		return errors.New("DSH migration content does not match a reviewed source")
	}
	sqlText := strings.ReplaceAll(string(source), "__SCHEMA__", o.Schema)
	if strings.Contains(sqlText, "__SCHEMA__") {
		return errors.New("unresolved schema marker")
	}
	tx, err := o.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// An environment toggle and dsh_test_* identifier alone do not prove the
	// target database is this Worktree's isolated PostgreSQL instance.
	if err = requireRefoundationDatabase(ctx, tx); err != nil {
		return fmt.Errorf("DSH migration denied: %w", err)
	}
	if _, err = tx.ExecContext(ctx, sqlText); err != nil {
		return fmt.Errorf("dsh public migration: %w", err)
	}
	return tx.Commit()
}

// beginScopedTx resolves all unqualified DSH table names against one validated
// schema for the lifetime of a transaction. Connection-pool reuse cannot leak
// search_path state across callers, and pg_temp comes last to prevent shadowing.
func (o *Owner) beginScopedTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	if o == nil || o.DB == nil || !identifier.MatchString(o.Schema) {
		return nil, errors.New("invalid DSH owner schema")
	}
	tx, err := o.DB.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx,
		"SELECT pg_catalog.set_config('search_path', 'pg_catalog,' || pg_catalog.quote_ident($1) || ',pg_temp', true)", o.Schema)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

func (o *Owner) revision(ctx context.Context, tx *sql.Tx) (int64, error) {
	var v int64
	err := tx.QueryRowContext(ctx, "SELECT revision FROM public_revision WHERE singleton=true").Scan(&v)
	return v, err
}

// ImportSynthetic is an explicit DSH-owner-only isolated verification operation.
// It has no public HTTP route, requires an opt-in dsh_test_* schema in the isolated database,
// and never claims a Merchant/Identity enrollment or signed WLT agreement.
func (o *Owner) ImportSynthetic(ctx context.Context) error {
	if !o.isIsolatedTestOwner() {
		return errors.New("synthetic import disabled outside isolated DSH test schema")
	}
	tx, err := o.beginScopedTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = requireRefoundationDatabase(ctx, tx); err != nil {
		return fmt.Errorf("DSH synthetic import denied: %w", err)
	}
	queries := []string{
		"INSERT INTO service_cities(id,active) VALUES ('sanaa',true),('aden',true) ON CONFLICT (id) DO UPDATE SET active=excluded.active",
		"INSERT INTO verticals VALUES ('grocery',true),('disabled-vertical',false) ON CONFLICT (id) DO UPDATE SET active=excluded.active",
	}
	for _, q := range queries {
		if _, err = tx.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	stores := []struct {
		id, owner, city, vertical, relation, name string
		published                                 bool
	}{
		{"market-sanaa", "owner-a", "sanaa", "grocery", "MARKETPLACE", "متجر أ", true},
		{"market-sanaa-paused", "owner-b", "sanaa", "grocery", "MARKETPLACE", "متجر ب", true},
		{"direct-sanaa", "owner-b", "sanaa", "grocery", "DIRECT", "متجر مباشر", true},
		{"draft-sanaa", "owner-a", "sanaa", "grocery", "MARKETPLACE", "مسودة خاصة", false},
		{"market-aden", "owner-b", "aden", "grocery", "MARKETPLACE", "متجر عدن", true},
		{"disabled-vertical-store", "owner-a", "sanaa", "disabled-vertical", "MARKETPLACE", "غير مسموح", true},
	}
	for _, s := range stores {
		_, err = tx.ExecContext(ctx, "INSERT INTO stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET owner_actor_id=excluded.owner_actor_id,city_id=excluded.city_id,vertical_id=excluded.vertical_id,relation=excluded.relation,name=excluded.name,published=excluded.published,updated_at=now()", s.id, s.owner, s.city, s.vertical, s.relation, s.name, s.published)
		if err != nil {
			return err
		}
	}
	for _, p := range []struct {
		id, name string
		active   bool
	}{{"p-flour", "دقيق", true}, {"p-water", "ماء", true}, {"p-draft", "غير منشور", true}, {"p-empty", "نفدت الكمية", true}} {
		_, err = tx.ExecContext(ctx, "INSERT INTO products(id,store_id,name,active) VALUES($1,'market-sanaa',$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active", p.id, p.name, p.active)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO variants(id,product_id,sellable,required_attributes_valid) VALUES($1,$2,true,true) ON CONFLICT(id) DO UPDATE SET sellable=true,required_attributes_valid=true", "v-"+p.id, p.id)
		if err != nil {
			return err
		}
	}
	for _, f := range []struct {
		id, product string
		price       int64
		stock       int
		pub         bool
	}{{"of-flour", "p-flour", 1200, 9, true}, {"of-water", "p-water", 150, 2, true}, {"of-draft", "p-draft", 999, 4, false}, {"of-empty", "p-empty", 300, 0, true}} {
		_, err = tx.ExecContext(ctx, "INSERT INTO offers(id,store_id,product_id,variant_id,published,available,price_yer,stock_units) VALUES($1,'market-sanaa',$2,$3,$4,true,$5,$6) ON CONFLICT(id) DO UPDATE SET published=excluded.published,price_yer=excluded.price_yer,stock_units=excluded.stock_units", f.id, f.product, "v-"+f.product, f.pub, f.price, f.stock)
		if err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE public_revision SET revision=revision+1 WHERE singleton=true"); err != nil {
		return err
	}
	return tx.Commit()
}
