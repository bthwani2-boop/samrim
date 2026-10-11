package storepublication

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestPublishedStorePagesSkipIneligibleWithoutHidingLaterStores(t *testing.T) {
	// The first two published Stores lost eligibility. Customers must still see
	// the next authorized Stores without a spurious empty first page.
	records := []postgres.PublicStoreRecord{
		{ID: "hidden-1", Name: "متجر سابق غير مؤهل"},
		{ID: "hidden-2", Name: "متجر باتفاقية غير نشطة"},
		{ID: "visible-1", Name: "ركن البن اليمني"},
		{ID: "hidden-3", Name: "متجر متوقف"},
		{ID: "visible-2", Name: "بيت القهوة الصنعانية"},
		{ID: "visible-3", Name: "سوق الحبوب"},
	}
	calls := 0
	fetch := func(_ context.Context, input postgres.PublicStoreListQuery) (postgres.PublicStorePage, error) {
		calls++
		start := 0
		if input.Cursor != "" {
			var err error
			start, err = strconv.Atoi(input.Cursor)
			if err != nil {
				return postgres.PublicStorePage{}, err
			}
		}
		end := start + input.Limit
		if end > len(records) {
			end = len(records)
		}
		page := postgres.PublicStorePage{Stores: records[start:end], Limit: input.Limit}
		if end < len(records) {
			page.NextCursor = strconv.Itoa(end)
		}
		return page, nil
	}
	eligible := func(_ context.Context, page postgres.PublicStorePage) (postgres.PublicStorePage, error) {
		visible := []postgres.PublicStoreRecord{}
		for _, store := range page.Stores {
			if strings.HasPrefix(store.ID, "visible-") {
				visible = append(visible, store)
			}
		}
		page.Stores = visible
		return page, nil
	}
	first, err := collectEligiblePublishedStores(context.Background(), postgres.PublicStoreListQuery{Limit: 2}, fetch, eligible)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := []string{first.Stores[0].Name, first.Stores[1].Name}, []string{"ركن البن اليمني", "بيت القهوة الصنعانية"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("first customer page: got %v, want %v", got, want)
	}
	if first.Limit != 2 || first.NextCursor != "5" {
		t.Fatalf("first customer page limit/cursor incorrect: %+v", first)
	}
	second, err := collectEligiblePublishedStores(context.Background(), postgres.PublicStoreListQuery{Limit: 2, Cursor: first.NextCursor}, fetch, eligible)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Stores) != 1 || second.Stores[0].ID != "visible-3" || second.NextCursor != "" {
		t.Fatalf("second customer page lost or duplicated a Store: %+v", second)
	}
	if calls < 4 {
		t.Fatalf("did not scan ineligible published Stores: calls=%d", calls)
	}
}

func TestPublishedStorePagesAllIneligibleReturnHonestEmptyPage(t *testing.T) {
	calls := 0
	fetch := func(_ context.Context, input postgres.PublicStoreListQuery) (postgres.PublicStorePage, error) {
		calls++
		if input.Cursor == "" {
			return postgres.PublicStorePage{Stores: []postgres.PublicStoreRecord{{ID: "blocked-1"}}, NextCursor: "end"}, nil
		}
		return postgres.PublicStorePage{Stores: []postgres.PublicStoreRecord{{ID: "blocked-2"}}}, nil
	}
	filter := func(_ context.Context, page postgres.PublicStorePage) (postgres.PublicStorePage, error) {
		page.Stores = []postgres.PublicStoreRecord{}
		return page, nil
	}
	page, err := collectEligiblePublishedStores(context.Background(), postgres.PublicStoreListQuery{Limit: 1}, fetch, filter)
	if err != nil || len(page.Stores) != 0 || page.NextCursor != "" || calls != 2 {
		t.Fatalf("ineligible customer page: page=%+v err=%v calls=%d", page, err, calls)
	}
}

func TestPublishedStorePageFailsClosedOnEligibilityOrCursorError(t *testing.T) {
	blocked := errors.New("WLT unavailable")
	fetch := func(_ context.Context, _ postgres.PublicStoreListQuery) (postgres.PublicStorePage, error) {
		return postgres.PublicStorePage{Stores: []postgres.PublicStoreRecord{{ID: "store-1"}}, NextCursor: "same"}, nil
	}
	_, err := collectEligiblePublishedStores(context.Background(), postgres.PublicStoreListQuery{},
		fetch, func(_ context.Context, _ postgres.PublicStorePage) (postgres.PublicStorePage, error) {
			return postgres.PublicStorePage{}, blocked
		})
	if !errors.Is(err, blocked) {
		t.Fatalf("eligibility failure must not appear as empty success: %v", err)
	}
	_, err = collectEligiblePublishedStores(context.Background(), postgres.PublicStoreListQuery{Cursor: "same"},
		fetch, func(_ context.Context, page postgres.PublicStorePage) (postgres.PublicStorePage, error) {
			page.Stores = nil
			return page, nil
		})
	if err == nil || !strings.Contains(fmt.Sprint(err), "did not advance") {
		t.Fatalf("repeated cursor must stop rather than spin: %v", err)
	}
}

func TestPublishedStoreScanningIsBoundedAndKeepsContinuation(t *testing.T) {
	records := make([]postgres.PublicStoreRecord, 201)
	for i := 0; i < 200; i++ {
		records[i] = postgres.PublicStoreRecord{ID: fmt.Sprintf("blocked-%03d", i)}
	}
	records[200] = postgres.PublicStoreRecord{ID: "visible-after-budget", Name: "متجر مؤهل بعد الميزانية"}
	calls := 0
	fetch := func(_ context.Context, query postgres.PublicStoreListQuery) (postgres.PublicStorePage, error) {
		calls++
		start := 0
		if query.Cursor != "" {
			var err error
			start, err = strconv.Atoi(query.Cursor)
			if err != nil {
				return postgres.PublicStorePage{}, err
			}
		}
		end := min(start+query.Limit, len(records))
		page := postgres.PublicStorePage{Stores: records[start:end]}
		if end < len(records) {
			page.NextCursor = strconv.Itoa(end)
		}
		return page, nil
	}
	filter := func(_ context.Context, page postgres.PublicStorePage) (postgres.PublicStorePage, error) {
		visible := []postgres.PublicStoreRecord{}
		for _, record := range page.Stores {
			if strings.HasPrefix(record.ID, "visible-") {
				visible = append(visible, record)
			}
		}
		page.Stores = visible
		return page, nil
	}
	first, err := collectEligiblePublishedStores(context.Background(), postgres.PublicStoreListQuery{Limit: 25}, fetch, filter)
	if err != nil || len(first.Stores) != 0 || first.NextCursor != "200" || calls != 8 {
		t.Fatalf("unbounded raw scan or missing continuation: page=%+v calls=%d err=%v", first, calls, err)
	}
	second, err := collectEligiblePublishedStores(context.Background(), postgres.PublicStoreListQuery{Limit: 25, Cursor: first.NextCursor}, fetch, filter)
	if err != nil || len(second.Stores) != 1 || second.Stores[0].ID != "visible-after-budget" || second.NextCursor != "" {
		t.Fatalf("continuation lost a later eligible store: %+v err=%v", second, err)
	}
	calls = 0
	one, err := collectEligiblePublishedStores(context.Background(), postgres.PublicStoreListQuery{Limit: 1}, fetch, filter)
	if err != nil || len(one.Stores) != 0 || one.NextCursor != "20" || calls != 20 {
		t.Fatalf("batch budget did not bound repeated identity/WLT reads: %+v calls=%d err=%v", one, calls, err)
	}
}

func TestPublishedStorePageRejectsStalledCursorWhenPageIsFull(t *testing.T) {
	// A stale cursor must never escape to the client, even when a batch happens
	// to fill the requested page. Otherwise the next request repeats this page.
	fetch := func(_ context.Context, query postgres.PublicStoreListQuery) (postgres.PublicStorePage, error) {
		return postgres.PublicStorePage{
			Stores:     []postgres.PublicStoreRecord{{ID: "visible-one"}},
			NextCursor: query.Cursor,
		}, nil
	}
	eligible := func(_ context.Context, page postgres.PublicStorePage) (postgres.PublicStorePage, error) {
		return page, nil
	}
	_, err := collectEligiblePublishedStores(context.Background(), postgres.PublicStoreListQuery{Limit: 1, Cursor: "stale"}, fetch, eligible)
	if err == nil || !strings.Contains(err.Error(), "did not advance") {
		t.Fatalf("filled page with a stalled cursor must fail closed: %v", err)
	}
}
