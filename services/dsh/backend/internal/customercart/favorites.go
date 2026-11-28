package customercart

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"time"
)

const favoritePageLimit = 20

type favoriteState struct {
	ActorID  string `json:"actorId"`
	StoreID  string `json:"storeId"`
	Favorite bool   `json:"favorite"`
}
type favoritePage struct {
	ActorID    string   `json:"actorId"`
	StoreIDs   []string `json:"storeIds"`
	NextCursor string   `json:"nextCursor,omitempty"`
}

func decodeFavorite(w http.ResponseWriter, r *http.Request) (bool, bool) {
	var input struct {
		Favorite *bool `json:"favorite"`
	}
	if !decodeCustomerCommand(w, r, 256, &input) || input.Favorite == nil {
		return false, false
	}
	return *input.Favorite, true
}

// The existing isolated Customer transport verifies the purchasing actor.
// Favorites never make a Store public or grant checkout access.
func (h *Handler) favorites(w http.ResponseWriter, r *http.Request) {
	store := r.PathValue("storeID")
	write := r.Method == http.MethodPut
	list := store == ""
	var after string
	if list && !write {
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(query) > 1 || (len(query) > 0 && (len(query["after"]) != 1 || !resourceRule.MatchString(query.Get("after")))) {
			fail(w, 400, "INVALID_REQUEST")
			return
		}
		after = query.Get("after")
	} else if !resourceRule.MatchString(store) || r.URL.RawQuery != "" {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	if r.URL.ForceQuery || (!write && (r.ContentLength != 0 || len(r.TransferEncoding) > 0)) {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	var desired bool
	if write {
		var ok bool
		desired, ok = decodeFavorite(w, r)
		if !ok {
			fail(w, 400, "INVALID_REQUEST")
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	token := tokenOf(r)
	actor, status := h.actor(ctx, token)
	if status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	tx, err := h.begin(ctx, write, "customer_favorite_stores", "stores", "service_cities", "verticals")
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()

	var result any
	switch {
	case list:
		page := favoritePage{ActorID: actor, StoreIDs: []string{}}
		rows, e := tx.QueryContext(ctx, "SELECT f.store_id FROM customer_favorite_stores f JOIN stores s ON s.id=f.store_id JOIN service_cities c ON c.id=s.city_id JOIN verticals v ON v.id=s.vertical_id WHERE f.actor_id=$1 AND f.store_id COLLATE \"C\">$2 AND s.published AND c.active AND v.active ORDER BY f.store_id COLLATE \"C\" LIMIT $3", actor, after, favoritePageLimit+1)
		if e != nil {
			fail(w, 503, "OWNER_UNAVAILABLE")
			return
		}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				break
			}
			page.StoreIDs = append(page.StoreIDs, id)
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			fail(w, 503, "OWNER_UNAVAILABLE")
			return
		}
		if len(page.StoreIDs) > favoritePageLimit {
			page.StoreIDs = page.StoreIDs[:favoritePageLimit]
			page.NextCursor = page.StoreIDs[favoritePageLimit-1]
		}
		result = page
	case write:
		if desired {
			// Keep eligibility rows stable until the mutation commits; withdrawal
			// after commit is still enforced on every read of the favorite set.
			var id string
			err = tx.QueryRowContext(ctx, `SELECT s.id FROM stores s JOIN service_cities c ON c.id=s.city_id JOIN verticals v ON v.id=s.vertical_id
				WHERE s.id=$1 AND s.published AND c.active AND v.active FOR SHARE OF s,c,v`, store).Scan(&id)
			if errors.Is(err, sql.ErrNoRows) {
				fail(w, 404, "STORE_UNAVAILABLE")
				return
			}
			if err == nil {
				_, err = tx.ExecContext(ctx, "INSERT INTO customer_favorite_stores(actor_id,store_id) VALUES ($1,$2) ON CONFLICT (actor_id,store_id) DO NOTHING", actor, store)
			}
		} else {
			_, err = tx.ExecContext(ctx, "DELETE FROM customer_favorite_stores WHERE actor_id=$1 AND store_id=$2", actor, store)
		}
		if err != nil {
			fail(w, 503, "OWNER_UNAVAILABLE")
			return
		}
		result = favoriteState{actor, store, desired}
	default:
		var favorite bool
		err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM customer_favorite_stores f JOIN stores s ON s.id=f.store_id JOIN service_cities c ON c.id=s.city_id JOIN verticals v ON v.id=s.vertical_id WHERE f.actor_id=$1 AND f.store_id=$2 AND s.published AND c.active AND v.active)", actor, store).Scan(&favorite)
		if err != nil {
			fail(w, 503, "OWNER_UNAVAILABLE")
			return
		}
		result = favoriteState{actor, store, favorite}
	}
	if status = h.stillCurrent(ctx, token, actor); status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if status = h.stillCurrent(ctx, token, actor); status != 200 {
		if write {
			fail(w, 503, "OPERATION_RESULT_UNKNOWN")
		} else {
			fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		}
		return
	}
	reply(w, result)
}
