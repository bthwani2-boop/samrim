package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestNotificationPaginationIsolationAndFirstReadPersistence(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated notification persistence proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open Postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured Postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify DSH schema: %v", err)
		}

		const actorID = "act_notification_field_owner"
		const foreignActorID = "act_notification_field_other"
		caseIDs := make(map[string]struct{}, 3)
		for index, phone := range []string{"+967700000281", "+967700000282", "+967700000283"} {
			idempotencyKey := "idem-notification-draft-" + string(rune('a'+index))
			result, err := postgres.CreateFieldJoiningCaseDraft(ctx, db, postgres.CreateJoiningCaseInput{
				IdempotencyKey: idempotencyKey,
				RequestHash:    "hash-notification-draft-" + string(rune('a'+index)),
				ActingActorID:  actorID,
				CorrelationID: "corr-notification-draft-" + string(rune('a'+index)),
				EvidenceKeyring: nil,
				Request:       postgres.JoiningCaseRequest{Phone: phone},
			})
			if err != nil {
				t.Fatalf("create task-owned Field draft %d: %v", index+1, err)
			}
			if result.Case.OriginatingFieldActorID != actorID || result.Case.ID == "" {
				t.Fatalf("draft producer returned wrong owner or missing case ID: %+v", result.Case)
			}
			caseIDs[result.Case.ID] = struct{}{}
		}

		firstPage, err := postgres.ListNotifications(ctx, db, actorID, "field", 2, "")
		if err != nil {
			t.Fatalf("list first Field notification page: %v", err)
		}
		if len(firstPage.Items) != 2 || firstPage.UnreadCount != 3 || firstPage.NextCursor == "" {
			t.Fatalf("first page should contain two of three unread notifications and a continuation cursor: %+v", firstPage)
		}
		secondPage, err := postgres.ListNotifications(ctx, db, actorID, "field", 2, firstPage.NextCursor)
		if err != nil {
			t.Fatalf("list second Field notification page: %v", err)
		}
		if len(secondPage.Items) != 1 || secondPage.UnreadCount != 3 || secondPage.NextCursor != "" {
			t.Fatalf("second page should contain the final item and the complete unread count: %+v", secondPage)
		}

		seen := make(map[string]struct{}, 3)
		allItems := append(append([]postgres.NotificationEvent(nil), firstPage.Items...), secondPage.Items...)
		for _, item := range allItems {
			if _, duplicate := seen[item.ID]; duplicate {
				t.Fatalf("pagination returned duplicate notification %q", item.ID)
			}
			seen[item.ID] = struct{}{}
			if item.EventType != "joining_case_created" || item.JoiningCaseID == "" || item.OrderID != "" || item.StoreID != "" {
				t.Fatalf("Field draft notification has unexpected source projection: %+v", item)
			}
			if _, expected := caseIDs[item.JoiningCaseID]; !expected {
				t.Fatalf("notification joiningCaseId %q was not produced by the canonical draft owner", item.JoiningCaseID)
			}
		}
		if len(seen) != len(caseIDs) {
			t.Fatalf("pagination returned %d unique notifications for %d canonical drafts", len(seen), len(caseIDs))
		}

		foreignPage, err := postgres.ListNotifications(ctx, db, foreignActorID, "field", 10, "")
		if err != nil || len(foreignPage.Items) != 0 || foreignPage.UnreadCount != 0 {
			t.Fatalf("foreign Field actor saw another actor's notifications: page=%+v err=%v", foreignPage, err)
		}
		wrongRolePage, err := postgres.ListNotifications(ctx, db, actorID, "partner", 10, "")
		if err != nil || len(wrongRolePage.Items) != 0 || wrongRolePage.UnreadCount != 0 {
			t.Fatalf("non-Field role saw Field notifications: page=%+v err=%v", wrongRolePage, err)
		}
		if _, err := postgres.MarkNotificationRead(ctx, db, foreignActorID, "field", allItems[0].ID); !errors.Is(err, postgres.ErrNotificationNotFound) {
			t.Fatalf("foreign actor mark-read error = %v, want not found", err)
		}

		firstReadAt, err := postgres.MarkNotificationRead(ctx, db, actorID, "field", allItems[0].ID)
		if err != nil {
			t.Fatalf("mark visible notification read: %v", err)
		}
		readPage, err := postgres.ListNotifications(ctx, db, actorID, "field", 2, "")
		if err != nil || readPage.UnreadCount != 2 {
			t.Fatalf("mark-read did not decrement the complete unread count: page=%+v err=%v", readPage, err)
		}
		replayedReadAt, err := postgres.MarkNotificationRead(ctx, db, actorID, "field", allItems[0].ID)
		if err != nil || !replayedReadAt.Equal(firstReadAt) {
			t.Fatalf("repeated mark-read changed the first read timestamp: first=%s replay=%s err=%v", firstReadAt, replayedReadAt, err)
		}
		finalPage, err := postgres.ListNotifications(ctx, db, actorID, "field", 2, "")
		if err != nil || finalPage.UnreadCount != 2 {
			t.Fatalf("repeated mark-read changed the complete unread count: page=%+v err=%v", finalPage, err)
		}
	})
}
