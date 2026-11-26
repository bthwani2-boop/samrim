package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"regexp"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

// SeedFreshSyntheticRegistration is called only inside the explicit fresh DSH
// bootstrap transaction. This is system provenance, not an Identity operator
// session or a grant of privileges. No serving route invokes this function.
func SeedFreshSyntheticRegistration(ctx context.Context, tx *sql.Tx, schema string) error {
	if tx == nil || os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		os.Getenv("DSH_BOOTSTRAP_SYNTHETIC_REGISTRATION") != "true" ||
		!regexp.MustCompile("^dsh_test_[a-z0-9_]{1,54}$").MatchString(schema) {
		return errors.New("synthetic registration bootstrap scope denied")
	}
	var database string
	if err := tx.QueryRowContext(ctx, "SELECT current_database()").Scan(&database); err != nil || !dbscope.IsDevelopmentDatabase(database) {
		return errors.New("synthetic registration bootstrap database denied")
	}
	if err := dbscope.Bind(ctx, tx, schema, "service_cities", "verticals", "stores", "store_registration_terms", "store_registration_policies", "store_registration_policy_commands", "store_registration_commands"); err != nil {
		return err
	}
	var empty bool
	if err := tx.QueryRowContext(ctx, `SELECT NOT (
		EXISTS(SELECT 1 FROM service_cities) OR EXISTS(SELECT 1 FROM verticals) OR
		EXISTS(SELECT 1 FROM stores) OR EXISTS(SELECT 1 FROM store_registration_terms) OR
		EXISTS(SELECT 1 FROM store_registration_policies) OR EXISTS(SELECT 1 FROM store_registration_policy_commands) OR
		EXISTS(SELECT 1 FROM store_registration_commands))`).Scan(&empty); err != nil || !empty {
		return errors.New("synthetic registration bootstrap requires empty owner registries")
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO service_cities(id,active,timezone_name) VALUES('sanaa',true,'Asia/Aden')"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO verticals(id,active) VALUES('grocery',true)"); err != nil {
		return err
	}
	for _, relation := range []string{"MARKETPLACE", "DIRECT"} {
		_, err := applyRegistrationPolicyTx(ctx, tx, syntheticRegistrationActor, syntheticRegistrationChange(relation))
		if err != nil {
			return err
		}
	}
	return nil
}

const syntheticRegistrationActor = "system:dev-registration-bootstrap"

func syntheticRegistrationChange(relation string) StoreRegistrationPolicyChange {
	return StoreRegistrationPolicyChange{
		CityID: "sanaa", Relation: relation, OperationID: "dev-registration-v1-" + relation,
		ExpectedVersion: 0, Enabled: true, TermsVersion: "dev-merchant-terms-v1",
		TermsText: "هذه الشروط مخصصة لاختبار تسجيل المتاجر في بيئة تطوير بثواني فقط، ولا تنشئ التزامات تجارية أو مالية فعلية. يخضع المتجر لمراجعة بياناته واعتماده قبل النشر واستقبال الطلبات.",
		Reason:    "تهيئة تسجيل المتاجر التجريبية في صنعاء بناءً على اعتماد مالك المشروع، دون تفعيل الإنتاج.",
	}
}

// SeedDevelopmentRegistration fills absent synthetic registration policies only
// on an explicitly admitted persistent development database. The existing
// owner command primitive retains immutable terms and policy history. It does
// not enroll merchants, publish Stores, or override operator decisions.
func SeedDevelopmentRegistration(ctx context.Context, db *sql.DB, schema string) error {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		return errors.New("development registration seed requires isolated mode")
	}
	if err := dbscope.VerifyDevelopmentRuntime(ctx, db, schema); err != nil {
		return err
	}
	tx, err := dbscope.Begin(ctx, db, schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted},
		"service_cities", "verticals", "store_registration_terms", "store_registration_policies", "store_registration_policy_commands")
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var admitted bool
	if err = tx.QueryRowContext(ctx, "SELECT current_database()=$1 AND current_user=$2 AND session_user=$2",
		dbscope.DevelopmentDatabase, dbscope.DevelopmentRuntimeRole).Scan(&admitted); err != nil || !admitted {
		return errors.New("development registration seed principal denied")
	}
	// Use the same per-policy transaction lock as ordinary operator commands.
	// Both seed runs take these locks in the same order before reading state.
	relations := []string{"MARKETPLACE", "DIRECT"}
	for _, relation := range relations {
		if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(84926,hashtext($1))", "sanaa:"+relation); err != nil {
			return err
		}
	}
	var activeCity, activeVertical bool
	if err = tx.QueryRowContext(ctx, "SELECT active FROM service_cities WHERE id='sanaa' FOR SHARE").Scan(&activeCity); err != nil || !activeCity {
		return errors.New("development registration requires active Sanaa reference data")
	}
	if err = tx.QueryRowContext(ctx, "SELECT active FROM verticals WHERE id='grocery' FOR SHARE").Scan(&activeVertical); err != nil || !activeVertical {
		return errors.New("development registration requires active grocery reference data")
	}
	for _, relation := range relations {
		var exists, history bool
		if err = tx.QueryRowContext(ctx, `SELECT
			EXISTS(SELECT 1 FROM store_registration_policies WHERE city_id='sanaa' AND relation=$1),
			EXISTS(SELECT 1 FROM store_registration_policy_commands WHERE city_id='sanaa' AND relation=$1)`,
			relation).Scan(&exists, &history); err != nil {
			return err
		}
		if exists {
			continue
		}
		if history {
			return errors.New("missing registration policy has retained command history")
		}
		if _, err = applyRegistrationPolicyTx(ctx, tx, syntheticRegistrationActor, syntheticRegistrationChange(relation)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
