package postgres_test

import (
	"context"
	"database/sql"
	"testing"
)

type canonicalStoreFixture struct {
	ID                string
	PartnerActorID    string
	Name              string
	ServiceCityID     string
	PrimaryVerticalID string
	PublicationState  string
}

func insertCanonicalStoreFixture(t *testing.T, ctx context.Context, db *sql.DB, fixture canonicalStoreFixture) {
	t.Helper()
	verticalID := fixture.PrimaryVerticalID
	if verticalID == "" {
		verticalID = fixture.ID + "-vertical"
	}
	var verticalExists bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.commerce_verticals WHERE id=$1)", verticalID).Scan(&verticalExists); err != nil {
		t.Fatalf("read Commerce Vertical fixture %s: %v", verticalID, err)
	}
	if !verticalExists {
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,$2,$3)", verticalID, "مجال اختبار", "Test Vertical "+fixture.ID); err != nil {
			t.Fatalf("insert Commerce Vertical fixture %s: %v", verticalID, err)
		}
	}
	storeTypeID := fixture.ID + "-type"
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES($1,$2,$3,$4)", storeTypeID, verticalID, "نوع متجر اختبار", "Test Store Type "+fixture.ID); err != nil {
		t.Fatalf("insert commercial Store Type fixture %s: %v", storeTypeID, err)
	}
	publicationState := fixture.PublicationState
	if publicationState == "" {
		publicationState = "unpublished"
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.stores(
		id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,publication_changed_at
	) VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7,CASE WHEN $7='unpublished' THEN NULL ELSE clock_timestamp() END)`,
		fixture.ID, fixture.PartnerActorID, fixture.Name, fixture.ServiceCityID, verticalID, storeTypeID, publicationState); err != nil {
		t.Fatalf("insert canonical Store fixture %s: %v", fixture.ID, err)
	}
}
