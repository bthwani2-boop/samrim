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
		_, err := applyRegistrationPolicyTx(ctx, tx, "system:dev-registration-bootstrap", StoreRegistrationPolicyChange{
			CityID: "sanaa", Relation: relation, OperationID: "dev-registration-v1-" + relation,
			ExpectedVersion: 0, Enabled: true, TermsVersion: "dev-merchant-terms-v1",
			TermsText: "هذه الشروط مخصصة لاختبار تسجيل المتاجر في بيئة تطوير بثواني فقط، ولا تنشئ التزامات تجارية أو مالية فعلية. يخضع المتجر لمراجعة بياناته واعتماده قبل النشر واستقبال الطلبات.",
			Reason:    "تهيئة تسجيل المتاجر التجريبية في صنعاء بناءً على اعتماد مالك المشروع، دون تفعيل الإنتاج.",
		})
		if err != nil {
			return err
		}
	}
	return nil
}
