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

	_ "github.com/lib/pq"
)

// Store, publication, city and Offer remain DSH facts. No client-side fallback or duplicate writer.
type Owner struct {
	DB     *sql.DB
	Schema string
}

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

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
func (o *Owner) Migrate(ctx context.Context, source []byte) error {
	sqlText := strings.ReplaceAll(string(source), "__SCHEMA__", o.Schema)
	if strings.Contains(sqlText, "__SCHEMA__") {
		return errors.New("unresolved schema marker")
	}
	tx, err := o.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, sqlText); err != nil {
		return fmt.Errorf("dsh public migration: %w", err)
	}
	return tx.Commit()
}
func (o *Owner) revision(ctx context.Context, tx *sql.Tx) (int64, error) {
	var v int64
	err := tx.QueryRowContext(ctx, "SELECT revision FROM "+o.Schema+".public_revision WHERE singleton=true").Scan(&v)
	return v, err
}

// ImportSynthetic is an explicit DSH-owner-only isolated verification operation.
// It has no public HTTP route, cannot run outside an opt-in dsh_test_* schema,
// and never claims a Merchant/Identity enrollment or signed WLT agreement.
func (o *Owner) ImportSynthetic(ctx context.Context) error {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || !strings.HasPrefix(o.Schema, "dsh_test_") {
		return errors.New("synthetic import disabled outside isolated DSH test schema")
	}
	tx, err := o.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	queries := []string{
		"INSERT INTO " + o.Schema + ".service_cities VALUES ('sanaa',true),('aden',true) ON CONFLICT (id) DO UPDATE SET active=excluded.active",
		"INSERT INTO " + o.Schema + ".verticals VALUES ('grocery',true),('disabled-vertical',false) ON CONFLICT (id) DO UPDATE SET active=excluded.active",
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
		_, err = tx.ExecContext(ctx, "INSERT INTO "+o.Schema+".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET owner_actor_id=excluded.owner_actor_id,city_id=excluded.city_id,vertical_id=excluded.vertical_id,relation=excluded.relation,name=excluded.name,published=excluded.published,updated_at=now()", s.id, s.owner, s.city, s.vertical, s.relation, s.name, s.published)
		if err != nil {
			return err
		}
	}
	for _, p := range []struct {
		id, name string
		active   bool
	}{{"p-flour", "دقيق", true}, {"p-water", "ماء", true}, {"p-draft", "غير منشور", true}, {"p-empty", "نفدت الكمية", true}} {
		_, err = tx.ExecContext(ctx, "INSERT INTO "+o.Schema+".products(id,store_id,name,active) VALUES($1,'market-sanaa',$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active", p.id, p.name, p.active)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO "+o.Schema+".variants(id,product_id,sellable,required_attributes_valid) VALUES($1,$2,true,true) ON CONFLICT(id) DO UPDATE SET sellable=true,required_attributes_valid=true", "v-"+p.id, p.id)
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
		_, err = tx.ExecContext(ctx, "INSERT INTO "+o.Schema+".offers(id,store_id,product_id,variant_id,published,available,price_yer,stock_units) VALUES($1,'market-sanaa',$2,$3,$4,true,$5,$6) ON CONFLICT(id) DO UPDATE SET published=excluded.published,price_yer=excluded.price_yer,stock_units=excluded.stock_units", f.id, f.product, "v-"+f.product, f.pub, f.price, f.stock)
		if err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE "+o.Schema+".public_revision SET revision=revision+1 WHERE singleton=true"); err != nil {
		return err
	}
	return tx.Commit()
}
