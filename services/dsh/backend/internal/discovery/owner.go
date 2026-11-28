package discovery

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	_ "github.com/lib/pq"
)

// Store, publication, city and Offer remain DSH facts. No client-side fallback or duplicate writer.
type Owner struct {
	DB     *sql.DB
	Schema string
}

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

// Fresh bootstrap and synthetic import are isolated developer-only operations. Do not accept a similarly
// named production/donor database even when it contains a dsh_test_* schema.
func isRefoundationDatabase(name string) bool {
	return dbscope.IsDevelopmentDatabase(name)
}

func isRegressionFixtureDatabase(name string) bool {
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

func (o *Owner) revision(ctx context.Context, tx *sql.Tx) (int64, error) {
	var v int64
	err := tx.QueryRowContext(ctx, "SELECT revision FROM public_revision WHERE singleton=true").Scan(&v)
	return v, err
}

// ImportSynthetic is an explicit DSH-owner-only isolated verification operation.
// It has no public HTTP route, requires an opt-in dsh_test_* schema in the isolated database,
// and never claims a Merchant/Identity enrollment or signed WLT agreement.
func (o *Owner) ImportSynthetic(ctx context.Context) error {
	if o != nil && strings.HasPrefix(o.Schema, "dsh_test_demo_") {
		return errors.New("regression import refuses dedicated demo schema")
	}
	if !o.isIsolatedTestOwner() {
		return errors.New("synthetic import disabled outside isolated DSH test schema")
	}
	tx, err := dbscope.Begin(ctx, o.DB, o.Schema, nil, "public_revision", "service_cities", "verticals", "stores", "products", "variants", "offers")
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Regression fixtures overwrite their own facts; the dedicated serving
	// database is persistent development data, not a regression fixture.
	var database string
	if err = tx.QueryRowContext(ctx, "SELECT pg_catalog.current_database()").Scan(&database); err != nil {
		return fmt.Errorf("DSH synthetic import database identity unavailable: %w", err)
	}
	if !isRegressionFixtureDatabase(database) {
		return errors.New("DSH synthetic import denied: outside the isolated refoundation database")
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
	// The public-only schema predates the availability migration. Once it is
	// installed, fill missing fixture timezones without replacing existing values.
	var hasCityTimezone bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM pg_catalog.pg_attribute
		WHERE attrelid=pg_catalog.to_regclass('service_cities')
		  AND attname='timezone_name' AND NOT attisdropped
	)`).Scan(&hasCityTimezone); err != nil {
		return err
	}
	if hasCityTimezone {
		if _, err = tx.ExecContext(ctx, `UPDATE service_cities SET timezone_name='Asia/Aden'
			WHERE id IN ('sanaa','aden') AND timezone_name IS NULL`); err != nil {
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

// ImportSyntheticDemo extends the isolated seed entrypoint with a one-shot,
// disposable browsing fixture. Published flags are synthetic projection test
// facts only: they do not represent Identity enrollment or WLT agreements.
func (o *Owner) ImportSyntheticDemo(ctx context.Context) error {
	if !o.isIsolatedTestOwner() || !strings.HasPrefix(o.Schema, "dsh_test_demo_") || len(o.Schema) <= len("dsh_test_demo_") {
		return errors.New("demo import requires a dedicated isolated dsh_test_demo_* schema")
	}
	tx, err := dbscope.Begin(ctx, o.DB, o.Schema, nil, "public_revision", "service_cities", "verticals", "stores", "products", "variants", "offers")
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = requireRefoundationDatabase(ctx, tx); err != nil {
		return err
	}
	// Serialize fixture creation and prevent concurrent writes to its source facts.
	if _, err = tx.ExecContext(ctx, `LOCK TABLE service_cities, verticals, stores, products, variants, offers IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	var rev int64
	var nonempty bool
	if err = tx.QueryRowContext(ctx, `SELECT revision FROM public_revision WHERE singleton FOR UPDATE`).Scan(&rev); err != nil {
		return err
	}
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM service_cities) OR EXISTS(SELECT 1 FROM verticals) OR EXISTS(SELECT 1 FROM stores) OR EXISTS(SELECT 1 FROM products) OR EXISTS(SELECT 1 FROM variants) OR EXISTS(SELECT 1 FROM offers)`).Scan(&nonempty); err != nil {
		return err
	}
	if rev != 0 || nonempty {
		return errors.New("demo import requires an empty demo schema")
	}
	// One transaction, no upsert and no overwrite. Keep ordering unavailable.
	queries := []string{
		`INSERT INTO service_cities(id,active,timezone_name) VALUES ('sanaa',true,'Asia/Aden'),('aden',true,'Asia/Aden')`,
		`INSERT INTO verticals(id,active) VALUES ('grocery',true),('restaurant',true),('pharmacy',true)`,
		`INSERT INTO stores(id,owner_actor_id,city_id,vertical_id,relation,name,published)
		 SELECT 'demo-store-'||lpad(n::text,2,'0'), 'synthetic-demo-merchant-'||lpad(n::text,2,'0'),
		 CASE WHEN n BETWEEN 26 AND 28 THEN 'aden' ELSE 'sanaa' END,
		 CASE n%3 WHEN 1 THEN 'grocery' WHEN 2 THEN 'restaurant' ELSE 'pharmacy' END,
		 CASE WHEN n=29 THEN 'DIRECT' ELSE 'MARKETPLACE' END,
		 CASE n%3 WHEN 1 THEN 'متجر مقاضي تجريبي ' WHEN 2 THEN 'مطعم تجريبي ' ELSE 'صيدلية تجريبية ' END || lpad(n::text,2,'0'), n<>30
		 FROM generate_series(1,30) n`,
		`INSERT INTO products(id,store_id,name,active)
		 SELECT s.id||'-p-'||lpad(p::text,2,'0'),s.id,
		 CASE s.vertical_id WHEN 'grocery' THEN (ARRAY['دقيق','أرز','ماء','سكر','زيت'])[1+(p-1)%5]
		 WHEN 'restaurant' THEN (ARRAY['وجبة','ساندويتش','عصير','سلطة','حلوى'])[1+(p-1)%5]
		 ELSE (ARRAY['ضمادات','صابون','معجون أسنان','مناديل','شاش'])[1+(p-1)%5] END || ' ' || lpad(p::text,2,'0'), true
		 FROM stores s CROSS JOIN LATERAL generate_series(1,CASE WHEN s.id='demo-store-01' THEN 25 WHEN s.id BETWEEN 'demo-store-02' AND 'demo-store-12' THEN 17 ELSE 16 END) p`,
		`INSERT INTO variants(id,product_id,sellable,required_attributes_valid)
		 SELECT id||'-v',id,true,true FROM products`,
		`INSERT INTO offers(id,store_id,product_id,variant_id,published,available,price_yer,stock_units)
		 SELECT p.id||'-o',p.store_id,p.id,v.id,
		 right(p.id,2)<>'02',true,100+50*right(p.id,2)::integer,
		 CASE WHEN right(p.id,2)='03' THEN 0 ELSE 10+right(p.id,2)::integer END
		 FROM products p JOIN variants v ON v.product_id=p.id`,
		`UPDATE public_revision SET revision=revision+1 WHERE singleton`,
	}
	for _, query := range queries {
		if _, err = tx.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	return tx.Commit()
}
