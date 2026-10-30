package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestCaptainParallelDispatchThreeOnlyOneWins(t *testing.T) {
	rootURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if rootURL == "" {
		t.Skip("requires isolated DSH_DATABASE_URL")
	}
	rootDB, err := sql.Open("postgres", rootURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	if err := rootDB.Ping(); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, rootURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("migrate full graph: %v", err)
		}
		const orderID = "dispatch-three-order"
		const storeID = "dispatch-three-store"
		const cityID = "dispatch-three-city"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", cityID, "مدينة اختبار"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: "dispatch-three-partner", Name: "متجر اختبار", ServiceCityID: cityID})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('dispatch-three-cart','dispatch-three-client',$1,'checked_out',1)", storeID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
			VALUES($1,'dispatch-three-client',$2,'dispatch-three-cart','dispatch-three-address',1,'صنعاء',15.3694457,44.1910064,$3,'CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1800,'YER',1,'dispatch-three-payment','CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)`, orderID, storeID, cityID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET delivery_origin_latitude=15.3694457,delivery_origin_longitude=44.1910064 WHERE id=$1`, storeID); err != nil {
			t.Fatal(err)
		}
		for i := 1; i <= 5; i++ {
			actor := fmt.Sprintf("dispatch-captain-%d", i)
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_admissions(id,actor_id,full_name_ar,state,availability_state,requires_profile_review,version) VALUES($1,$2,$3,'eligible','available',false,1)`, actor+"-admission", actor, "كابتن اختبار"); err != nil {
				t.Fatalf("captain %d: %v", i, err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_presence_latest(captain_actor_id,latitude,longitude,updated_at) VALUES($1,$2,44.1910064,clock_timestamp()-CASE WHEN $3 THEN interval '16 minutes' ELSE interval '0 minutes' END)`, actor, 15.3694457+float64(i)*0.001, i == 5); err != nil {
				t.Fatalf("captain %d location: %v", i, err)
			}
		}
		nearby, cashDue, err := postgres.ListNearbyCaptainCandidates(ctx, db, orderID, "")
		if err != nil || cashDue != 1800 || len(nearby) != 4 {
			t.Fatalf("nearby candidates=%+v cash=%d err=%v", nearby, cashDue, err)
		}
		for i, c := range nearby {
			if c.ActorID != fmt.Sprintf("dispatch-captain-%d", i+1) {
				t.Fatalf("nearby ordering mismatch at %d: %+v", i, nearby)
			}
		}
		pending, err := postgres.ListReadyCaptainDispatchOrders(ctx, db, 10, "")
		if err != nil || len(pending) != 1 || pending[0] != orderID {
			t.Fatalf("automatic dispatch recovery scan=%v err=%v", pending, err)
		}
		if next, err := postgres.ListReadyCaptainDispatchOrders(ctx, db, 10, orderID); err != nil || len(next) != 0 {
			t.Fatalf("cursor must advance past scanned order: %v err=%v", next, err)
		}
		dispatchKey := "dispatch-three-first-key"
		hash := postgres.HashCaptainDispatchRequest(orderID)
		first, replayed, err := postgres.CreateCaptainDispatchOffer(ctx, db, orderID, dispatchKey, hash, "operator-test", "correlation-three", nearby[1].ActorID, nearby[2].ActorID, nearby[3].ActorID)
		if err != nil || replayed || first.State != "offered" {
			t.Fatalf("first dispatch: %+v replayed=%v error=%v", first, replayed, err)
		}
		offers := readParallelOfferIDs(t, ctx, db, orderID)
		if len(offers) != 3 {
			t.Fatalf("wanted exactly three parallel offers, got %d", len(offers))
		}
		for _, offeredID := range offers {
			var offeredActor string
			if err := db.QueryRowContext(ctx, "SELECT captain_actor_id FROM dsh.captain_dispatch_offers WHERE id=$1", offeredID).Scan(&offeredActor); err != nil {
				t.Fatal(err)
			}
			// Before acceptance, the offer may reveal only a coarse service
			// region; never the customer's saved address or exact coordinates.
			visible, err := postgres.ListCaptainOffers(ctx, db, offeredActor, 10)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, candidate := range visible {
				if candidate.ID != offeredID {
					continue
				}
				found = true
				if candidate.DeliveryAreaText != "مدينة اختبار" {
					t.Fatalf("offer exposed an exact destination instead of the service region: %q", candidate.DeliveryAreaText)
				}
			}
			if !found {
				t.Fatalf("targeted Captain must be able to read own outstanding offer")
			}
			var stillFresh bool
			if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.captain_presence_latest WHERE captain_actor_id=$1 AND updated_at>clock_timestamp()-interval '15 minutes')`, offeredActor).Scan(&stillFresh); err != nil || !stillFresh {
				t.Fatalf("offered captain must retain fresh presence until resolved: %s fresh=%v err=%v", offeredActor, stillFresh, err)
			}
			if offeredActor == nearby[0].ActorID || offeredActor == "dispatch-captain-5" {
				t.Fatalf("wallet-ineligible or stale captain received an offer: %s", offeredActor)
			}
		}
		pending, err = postgres.ListReadyCaptainDispatchOrders(ctx, db, 10, "")
		if err != nil || len(pending) != 0 {
			t.Fatalf("active offer must hide order from automatic redispatch: %v err=%v", pending, err)
		}
		// Unserviceable older ready orders must not starve later orders.
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version)
			SELECT 'dispatch-fair-cart-'||lpad(n::text,2,'0'),'dispatch-three-client',$1,'checked_out',1
			FROM generate_series(0,27) n`, storeID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
			(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,
			serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,
			total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
			SELECT 'dispatch-fair-order-'||lpad(n::text,2,'0'),'dispatch-three-client',$1,
				'dispatch-fair-cart-'||lpad(n::text,2,'0'),'dispatch-three-address',1,'صنعاء',15.3694457,44.1910064,$2,
				'CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1800,'YER',1,
				'dispatch-fair-payment-'||n,'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800
			FROM generate_series(0,27) n`, storeID, cityID); err != nil {
			t.Fatal(err)
		}
		firstPage, err := postgres.ListReadyCaptainDispatchOrders(ctx, db, 25, "")
		if err != nil || len(firstPage) != 25 {
			t.Fatalf("ready-page1 count=%d err=%v", len(firstPage), err)
		}
		secondPage, err := postgres.ListReadyCaptainDispatchOrders(ctx, db, 25, firstPage[len(firstPage)-1])
		if err != nil || len(secondPage) != 3 {
			t.Fatalf("ready-page2 count=%d err=%v", len(secondPage), err)
		}
		if firstPage[len(firstPage)-1] >= secondPage[0] {
			t.Fatalf("ready cursor repeated/skipped boundary: %s >= %s", firstPage[len(firstPage)-1], secondPage[0])
		}
		end, err := postgres.ListReadyCaptainDispatchOrders(ctx, db, 25, secondPage[len(secondPage)-1])
		if err != nil || len(end) != 0 {
			t.Fatalf("ready scan must reach end: %v err=%v", end, err)
		}
		replay, again, err := postgres.CreateCaptainDispatchOffer(ctx, db, orderID, dispatchKey, hash, "operator-test", "correlation-three")
		if err != nil || !again || replay.ID != first.ID {
			t.Fatalf("idempotency replay %+v %v %v", replay, again, err)
		}
		if _, _, err := postgres.CreateCaptainDispatchOffer(ctx, db, orderID, "dispatch-three-other-key", hash, "operator-test", "correlation-other"); err == nil {
			t.Fatal("second dispatch must not issue offers while first batch is active")
		}
		// Concurrent acceptances must not deadlock or create two winners.
		acceptCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		type result struct {
			id  string
			won bool
			err error
		}
		results := make(chan result, 3)
		actors := make(map[string]string, len(offers))
		for _, id := range offers {
			var actor string
			if err := db.QueryRowContext(ctx, "SELECT captain_actor_id FROM dsh.captain_dispatch_offers WHERE id=$1", id).Scan(&actor); err != nil {
				t.Fatal(err)
			}
			actors[id] = actor
		}
		// A prepaid delivery must not bypass merchandise custody risk limits.
		// A rejected attempt must leave the offer available for a later valid
		// acceptance without recording a winner or changing the order.
		if _, err := db.ExecContext(ctx, "UPDATE dsh.captain_goods_custody_policies SET single_order_cap_minor=1000,concurrent_cap_minor=1000,version=version+1 WHERE id='platform'"); err != nil {
			t.Fatal(err)
		}
		blockedID := offers[0]
		blockedKey := "accept-goods-limit"
		_, err = postgres.RespondToCaptainOffer(ctx, db, blockedID, actors[blockedID], "accept", 1, blockedKey, postgres.HashCaptainOfferResponse(blockedID, "accept", 1), blockedKey)
		if !errors.Is(err, postgres.ErrCaptainGoodsCustodyLimit) {
			t.Fatalf("goods over limit must fail closed: %v", err)
		}
		var stillOffered int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.captain_dispatch_offers WHERE id=$1 AND state='offered'", blockedID).Scan(&stillOffered); err != nil || stillOffered != 1 {
			t.Fatalf("rejected exposure mutated the offer: %d %v", stillOffered, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.captain_goods_custody_policies SET single_order_cap_minor=50000,concurrent_cap_minor=50000,version=version+1 WHERE id='platform'"); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		for i, id := range offers {
			wg.Add(1)
			go func(index int, offerID string) {
				defer wg.Done()
				key := fmt.Sprintf("accept-three-%d", index)
				r, err := postgres.RespondToCaptainOffer(acceptCtx, db, offerID, actors[offerID], "accept", 1, key, postgres.HashCaptainOfferResponse(offerID, "accept", 1), key)
				results <- result{id: offerID, won: err == nil && r.Assignment != nil, err: err}
			}(i, id)
		}
		wg.Wait()
		close(results)
		winners := 0
		for r := range results {
			if r.won {
				winners++
			} else if r.err == nil {
				t.Errorf("nonwinner got success without assignment offer %s", r.id)
			}
		}
		if winners != 1 {
			t.Fatalf("wanted one winner, got %d", winners)
		}
		var active, accepted, superseded, assignments, audited int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FILTER(WHERE state='offered'),COUNT(*) FILTER(WHERE state='accepted'),COUNT(*) FILTER(WHERE state='superseded') FROM dsh.captain_dispatch_offers WHERE order_id=$1`, orderID).Scan(&active, &accepted, &superseded); err != nil {
			t.Fatal(err)
		}
		if active != 0 || accepted != 1 || superseded != 2 {
			t.Fatalf("offer state mismatch active=%d accepted=%d superseded=%d", active, accepted, superseded)
		}
		for _, offerID := range offers {
			var offerState string
			if err := db.QueryRowContext(ctx, "SELECT state FROM dsh.captain_dispatch_offers WHERE id=$1", offerID).Scan(&offerState); err != nil {
				t.Fatal(err)
			}
			if offerState != "superseded" {
				continue
			}
			visible, err := postgres.ListCaptainOffers(ctx, db, actors[offerID], 10)
			if err != nil {
				t.Fatal(err)
			}
			for _, item := range visible {
				if item.ID == offerID {
					t.Fatalf("losing offer %s remains visible to its captain", offerID)
				}
			}
		}
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.captain_assignments WHERE order_id=$1 AND state='assigned'", orderID).Scan(&assignments); err != nil {
			t.Fatal(err)
		}
		if assignments != 1 {
			t.Fatalf("wanted one captain assignment got %d", assignments)
		}
		var winningPresence int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.captain_presence_latest WHERE captain_actor_id=(SELECT captain_actor_id FROM dsh.captain_assignments WHERE order_id=$1 AND state='assigned')`, orderID).Scan(&winningPresence); err != nil || winningPresence != 0 {
			t.Fatalf("assigned winner must not keep dispatch presence: count=%d err=%v", winningPresence, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.captain_audit WHERE order_id=$1 AND event_type='dispatch_offer_superseded'", orderID).Scan(&audited); err != nil {
			t.Fatal(err)
		}
		if audited != 2 {
			t.Fatalf("wanted two supersession audits got %d", audited)
		}
		var releases, distinctSources int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*),COUNT(DISTINCT source_ref) FROM dsh.commerce_financial_handoff_outbox WHERE order_id=$1 AND effect_type='CAPTAIN_COD_RELEASE'`, orderID).Scan(&releases, &distinctSources); err != nil {
			t.Fatal(err)
		}
		if releases != 2 || distinctSources != 2 {
			t.Fatalf("each loser must have one unique COD release; got rows=%d sources=%d", releases, distinctSources)
		}
		// Reassignment must cancel an entire prior batch and produce at most three new offers.
		offer, replayed, err := postgres.ReassignCaptain(ctx, db, orderID, "dispatch-three-reassign", postgres.HashCaptainReassignmentRequest(orderID), "operator-test", "correlation-reassign")
		if err != nil || replayed || offer.State != "offered" {
			t.Fatalf("reassign: %+v replayed=%v error=%v", offer, replayed, err)
		}
		newOffers := readParallelOfferIDs(t, ctx, db, orderID)
		if len(newOffers) < 1 || len(newOffers) > 3 {
			t.Fatalf("reassign active offers = %d, expected 1..3", len(newOffers))
		}
		var oldAssigned int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.captain_assignments WHERE order_id=$1 AND state='reassigned'", orderID).Scan(&oldAssigned); err != nil {
			t.Fatal(err)
		}
		if oldAssigned != 1 {
			t.Fatalf("former winner must be reassigned, got %d", oldAssigned)
		}
		if len(newOffers) != 3 {
			t.Fatalf("expected three candidates after reassignment, got %d", len(newOffers))
		}
		var rejectingActor string
		if err := db.QueryRowContext(ctx, "SELECT captain_actor_id FROM dsh.captain_dispatch_offers WHERE id=$1", newOffers[0]).Scan(&rejectingActor); err != nil {
			t.Fatal(err)
		}
		rejectionKey := "dispatch-three-second-batch-reject"
		rejected, err := postgres.RespondToCaptainOffer(ctx, db, newOffers[0], rejectingActor, "reject", 1, rejectionKey, postgres.HashCaptainOfferResponse(newOffers[0], "reject", 1), rejectionKey)
		if err != nil || rejected.Offer.State != "rejected" {
			t.Fatalf("reject one offer = %+v err=%v", rejected, err)
		}
		// Idempotency is not authorization: another Captain must never be
		// allowed to replay an offer decision, even with its exact key and facts.
		requestHash := postgres.HashCaptainOfferResponse(newOffers[0], "reject", 1)
		stolen, stolenErr := postgres.RespondToCaptainOffer(ctx, db, newOffers[0], "dispatch-captain-5", "reject", 1, rejectionKey, requestHash, rejectionKey)
		if !errors.Is(stolenErr, postgres.ErrCaptainOfferForbidden) || stolen.Offer.ID != "" || stolen.Assignment != nil {
			t.Fatalf("cross-captain reject replay leaked result: %+v err=%v", stolen, stolenErr)
		}
		legitimateReplay, replayErr := postgres.RespondToCaptainOffer(ctx, db, newOffers[0], rejectingActor, "reject", 1, rejectionKey, requestHash, rejectionKey)
		if replayErr != nil || !legitimateReplay.Replayed || legitimateReplay.Offer.ID != newOffers[0] {
			t.Fatalf("own reject replay must remain valid: %+v err=%v", legitimateReplay, replayErr)
		}
		remaining := readParallelOfferIDs(t, ctx, db, orderID)
		if len(remaining) != 2 {
			t.Fatalf("rejecting one candidate must leave two outstanding offers, got %d", len(remaining))
		}
		// An order that was eligible at offer acceptance must be checked again
		// at physical pickup: policy may have changed meanwhile.
		var finalActor string
		if err := db.QueryRowContext(ctx, "SELECT captain_actor_id FROM dsh.captain_dispatch_offers WHERE id=$1", remaining[0]).Scan(&finalActor); err != nil {
			t.Fatal(err)
		}
		key := "dispatch-three-final-accept"
		finalAccept, err := postgres.RespondToCaptainOffer(ctx, db, remaining[0], finalActor, "accept", 1, key, postgres.HashCaptainOfferResponse(remaining[0], "accept", 1), key)
		if err != nil || finalAccept.Assignment == nil {
			t.Fatalf("second batch acceptance: %+v err=%v", finalAccept, err)
		}
		acceptHash := postgres.HashCaptainOfferResponse(remaining[0], "accept", 1)
		stolenAccept, stolenErr := postgres.RespondToCaptainOffer(ctx, db, remaining[0], "dispatch-captain-5", "accept", 1, key, acceptHash, key)
		if !errors.Is(stolenErr, postgres.ErrCaptainOfferForbidden) || stolenAccept.Offer.ID != "" || stolenAccept.Assignment != nil {
			t.Fatalf("cross-captain accept replay leaked assignment: %+v err=%v", stolenAccept, stolenErr)
		}
		legitimateAccept, replayErr := postgres.RespondToCaptainOffer(ctx, db, remaining[0], finalActor, "accept", 1, key, acceptHash, key)
		if replayErr != nil || !legitimateAccept.Replayed || legitimateAccept.Assignment == nil || legitimateAccept.Assignment.ID != finalAccept.Assignment.ID {
			t.Fatalf("own accept replay must retain the assignment: %+v err=%v", legitimateAccept, replayErr)
		}
		assignmentID := finalAccept.Assignment.ID
		foreignTask, foreignTaskErr := postgres.ReadCaptainDeliveryTask(ctx, db, assignmentID, "dispatch-captain-5")
		if !errors.Is(foreignTaskErr, postgres.ErrCaptainDeliveryTaskNotFound) || foreignTask.AssignmentID != "" {
			t.Fatalf("other Captain read assigned customer destination: %+v err=%v", foreignTask, foreignTaskErr)
		}
		var handoffVersion int
		if err := db.QueryRowContext(ctx, "UPDATE dsh.captain_handoffs SET state='store_confirmed',store_confirmed_at=clock_timestamp(),version=version+1 WHERE assignment_id=$1 RETURNING version", assignmentID).Scan(&handoffVersion); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.captain_goods_custody_policies SET single_order_cap_minor=1000,concurrent_cap_minor=1000,version=version+1 WHERE id='platform'"); err != nil {
			t.Fatal(err)
		}
		pickupKey := "dispatch-three-pickup-policy"
		_, _, err = postgres.CompleteCaptainPickup(ctx, db, assignmentID, finalActor, handoffVersion, pickupKey, postgres.HashCaptainPickupRequest(assignmentID, handoffVersion), pickupKey)
		if !errors.Is(err, postgres.ErrCaptainGoodsCustodyLimit) {
			t.Fatalf("policy changed after acceptance must block physical custody: %v", err)
		}
		var assignedState string
		if err := db.QueryRowContext(ctx, "SELECT state FROM dsh.captain_assignments WHERE id=$1", assignmentID).Scan(&assignedState); err != nil || assignedState != "assigned" {
			t.Fatalf("blocked pickup changed physical custody: state=%s err=%v", assignedState, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.captain_goods_custody_policies SET single_order_cap_minor=50000,concurrent_cap_minor=50000,version=version+1 WHERE id='platform'"); err != nil {
			t.Fatal(err)
		}
		pickedUp, replayed, err := postgres.CompleteCaptainPickup(ctx, db, assignmentID, finalActor, handoffVersion, pickupKey, postgres.HashCaptainPickupRequest(assignmentID, handoffVersion), pickupKey)
		if err != nil || replayed || pickedUp.State != "in_custody" {
			t.Fatalf("covered pickup should succeed exactly once: %+v replay=%t err=%v", pickedUp, replayed, err)
		}
		pickupHash := postgres.HashCaptainPickupRequest(assignmentID, handoffVersion)
		stolenPickup, replayedByStranger, stolenPickupErr := postgres.CompleteCaptainPickup(ctx, db, assignmentID, "dispatch-captain-5", handoffVersion, pickupKey, pickupHash, pickupKey)
		if !errors.Is(stolenPickupErr, postgres.ErrCaptainOfferForbidden) || stolenPickup.ID != "" || replayedByStranger {
			t.Fatalf("cross-captain pickup replay leaked custody: %+v replay=%t err=%v", stolenPickup, replayedByStranger, stolenPickupErr)
		}
		pickupReplay, replayedByOwner, pickupReplayErr := postgres.CompleteCaptainPickup(ctx, db, assignmentID, finalActor, handoffVersion, pickupKey, pickupHash, pickupKey)
		if pickupReplayErr != nil || !replayedByOwner || pickupReplay.ID != pickedUp.ID {
			t.Fatalf("own pickup replay must retain the same assignment: %+v replay=%t err=%v", pickupReplay, replayedByOwner, pickupReplayErr)
		}
	})
}
func readParallelOfferIDs(t *testing.T, ctx context.Context, db *sql.DB, orderID string) []string {
	t.Helper()
	rows, err := db.QueryContext(ctx, "SELECT id FROM dsh.captain_dispatch_offers WHERE order_id=$1 AND state='offered' ORDER BY id", orderID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return ids
}
