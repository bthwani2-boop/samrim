package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestCatalogAttributeLifecycleV107UpgradePreservesExistingOptions(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the isolated catalog attribute migration proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open DSH test PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("connect DSH test PostgreSQL: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := applyMigrationPrefix(ctx, db, records, migrationSQL, 106); err != nil {
			t.Fatalf("create upgrade source at canonical DSH v106: %v", err)
		}
		suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
		verticalID := "attribute-v107-vertical-" + suffix
		attributeID := "attribute-v107-existing-" + suffix
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_verticals(id,name_ar,name_en,active)
			VALUES($1,'مجال محفوظ','Preserved Vertical',true)`, verticalID); err != nil {
			t.Fatalf("insert v106 commerce vertical: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_attribute_definitions(id,vertical_id,code,name_ar,value_kind,active)
			VALUES($1,$2,'legacy_color','لون محفوظ','ENUM',true)`, attributeID, verticalID); err != nil {
			t.Fatalf("insert v106 enum attribute: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_attribute_enum_options(attribute_id,option_value,active,ordinal)
			VALUES($1,'أزرق',false,7)`, attributeID); err != nil {
			t.Fatalf("insert v106 inactive enum option: %v", err)
		}

		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("upgrade canonical DSH schema from v106: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify upgraded catalog attribute schema: %v", err)
		}
		var version int
		var updatedAt time.Time
		if err := db.QueryRowContext(ctx, `SELECT version,updated_at FROM dsh.catalog_attribute_enum_options
			WHERE attribute_id=$1 AND option_value='أزرق'`, attributeID).Scan(&version, &updatedAt); err != nil {
			t.Fatalf("read preserved v106 enum option after upgrade: %v", err)
		}
		if version != 1 || updatedAt.IsZero() {
			t.Fatalf("v106 enum option lifecycle defaults version=%d updatedAt=%v", version, updatedAt)
		}
		options, err := postgres.ListCatalogAttributeEnumOptions(ctx, db, attributeID, false)
		if err != nil || len(options) != 1 || options[0].OptionValue != "أزرق" || options[0].Active || options[0].Ordinal != 7 || options[0].Version != 1 {
			t.Fatalf("v106 option readback after upgrade=%+v error=%v", options, err)
		}

		definition := postgres.CatalogAttributeDefinitionInput{ID: "attribute-v107-new-" + suffix, VerticalID: verticalID, Code: "material", NameAr: "المادة", ValueKind: "ENUM", Active: true}
		definitionReason := "Verify migrated attribute audit"
		if _, _, err := postgres.CreateCatalogAttributeDefinition(ctx, db, definition, "idem-v107-definition-"+suffix, postgres.HashCatalogAttributeDefinitionRequest(definition, definitionReason), closureAudit("corr-v107-definition-"+suffix, definitionReason)); err != nil {
			t.Fatalf("write new attribute audit event after v107: %v", err)
		}
		option := postgres.CatalogAttributeEnumOptionInput{AttributeID: definition.ID, OptionValue: "قطن", Active: true, Ordinal: 0}
		optionReason := "Verify migrated option audit"
		if _, _, err := postgres.CreateCatalogAttributeEnumOption(ctx, db, option, "idem-v107-option-"+suffix, postgres.HashCatalogAttributeEnumOptionRequest(option, optionReason), closureAudit("corr-v107-option-"+suffix, optionReason)); err != nil {
			t.Fatalf("write new enum option audit event after v107: %v", err)
		}
		var auditCount int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.catalog_registry_audit_events
			WHERE entity_type IN ('attribute_definition','attribute_enum_option') AND correlation_id IN ($1,$2)`, "corr-v107-definition-"+suffix, "corr-v107-option-"+suffix).Scan(&auditCount); err != nil || auditCount != 2 {
			t.Fatalf("new attribute lifecycle audit rows=%d error=%v, want definition and option history", auditCount, err)
		}
	})
}
