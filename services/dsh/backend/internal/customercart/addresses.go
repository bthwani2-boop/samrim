package customercart

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Address is a private DSH record, not an Identity account or a serviceability decision.
type Address struct {
	ID        string  `json:"id"`
	CityID    string  `json:"cityId"`
	Label     string  `json:"label"`
	Details   string  `json:"details"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Version   int64   `json:"version"`
}
type AddressChange struct {
	CityID          string   `json:"cityId"`
	Label           string   `json:"label"`
	Details         string   `json:"details"`
	Latitude        *float64 `json:"latitude"`
	Longitude       *float64 `json:"longitude"`
	ExpectedVersion *int64   `json:"expectedVersion"`
}
type AddressPage struct {
	ActorID    string    `json:"actorId"`
	Items      []Address `json:"items"`
	NextCursor string    `json:"nextCursor,omitempty"`
}
type AddressResult struct {
	ActorID string  `json:"actorId"`
	Address Address `json:"address"`
	Replay  bool    `json:"replay"`
}

type addressRead struct {
	ActorID string  `json:"actorId"`
	Address Address `json:"address"`
}

var addressIDRule = regexp.MustCompile("^addr-[a-f0-9]{32}$")

const addressPageLimit = 20

func validAddressText(s string, max int) bool {
	n := utf8.RuneCountInString(s)
	return utf8.ValidString(s) && n >= 1 && n <= max && !strings.ContainsFunc(s, unicode.IsControl)
}
func validAddressChange(v *AddressChange) bool {
	v.Label, v.Details = strings.TrimSpace(v.Label), strings.TrimSpace(v.Details)
	return resourceRule.MatchString(v.CityID) && validAddressText(v.Label, 80) && validAddressText(v.Details, 300) &&
		v.Latitude != nil && v.Longitude != nil && !math.IsNaN(*v.Latitude) && !math.IsNaN(*v.Longitude) &&
		math.Abs(*v.Latitude) <= 90 && math.Abs(*v.Longitude) <= 180 &&
		v.ExpectedVersion != nil && *v.ExpectedVersion >= 0 && *v.ExpectedVersion < maxJSONSafeInteger
}

// All address fields are required by the owner. The shared command boundary
// rejects ambiguous names and malformed Unicode before domain validation.
func decodeAddressChange(w http.ResponseWriter, r *http.Request) (AddressChange, bool) {
	var v AddressChange
	if !decodeCustomerCommand(w, r, 4096, &v) || !validAddressChange(&v) {
		return AddressChange{}, false
	}
	return v, true
}

func scanAddress(row interface{ Scan(...any) error }) (Address, error) {
	var a Address
	err := row.Scan(&a.ID, &a.CityID, &a.Label, &a.Details, &a.Latitude, &a.Longitude, &a.Version)
	return a, err
}

func (h *Handler) listAddresses(w http.ResponseWriter, r *http.Request) {
	params, err := url.ParseQuery(r.URL.RawQuery)
	after := params.Get("after")
	if err != nil || r.URL.ForceQuery || r.ContentLength != 0 || len(r.TransferEncoding) != 0 ||
		(len(params) != 0 && (len(params) != 1 || len(params["after"]) != 1 || !addressIDRule.MatchString(after))) {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	token := tokenOf(r)
	actor, status := h.actor(ctx, token)
	if status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	tx, err := h.begin(ctx, false, "customer_addresses")
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT id,city_id,label,details,latitude,longitude,version FROM customer_addresses WHERE actor_id=$1 AND id COLLATE \"C\" > $2 ORDER BY id COLLATE \"C\" LIMIT $3", actor, after, addressPageLimit+1)
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	defer rows.Close()
	result := AddressPage{ActorID: actor, Items: []Address{}}
	for rows.Next() {
		a, e := scanAddress(rows)
		if e != nil {
			fail(w, 503, "OWNER_UNAVAILABLE")
			return
		}
		if len(result.Items) == addressPageLimit {
			result.NextCursor = result.Items[len(result.Items)-1].ID
			break
		}
		result.Items = append(result.Items, a)
	}
	if rows.Err() != nil || rows.Close() != nil || tx.Commit() != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if status = h.stillCurrent(ctx, token, actor); status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	reply(w, result)
}

func (h *Handler) getAddress(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("addressID")
	if !addressIDRule.MatchString(id) || r.URL.RawQuery != "" || r.URL.ForceQuery ||
		r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	token := tokenOf(r)
	actor, status := h.actor(ctx, token)
	if status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	tx, err := h.begin(ctx, false, "customer_addresses")
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()
	address, err := scanAddress(tx.QueryRowContext(ctx, "SELECT id,city_id,label,details,latitude,longitude,version FROM customer_addresses WHERE actor_id=$1 AND id=$2", actor, id))
	missing := errors.Is(err, sql.ErrNoRows)
	if (err != nil && !missing) || tx.Commit() != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if status = h.stillCurrent(ctx, token, actor); status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	if missing {
		fail(w, 404, "ADDRESS_NOT_FOUND")
		return
	}
	reply(w, addressRead{ActorID: actor, Address: address})
}

func (h *Handler) saveAddress(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("addressID")
	if !addressIDRule.MatchString(id) || r.URL.RawQuery != "" || r.URL.ForceQuery ||
		r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	token := tokenOf(r)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	actor, status := h.actor(ctx, token)
	if status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	change, ok := decodeAddressChange(w, r)
	if !ok {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	result, status := h.writeAddress(ctx, actor, token, id, change)
	if status != 200 {
		code := "OPERATION_RESULT_UNKNOWN"
		switch status {
		case 400:
			code = "INVALID_REQUEST"
		case 409:
			code = "ADDRESS_VERSION_CONFLICT"
		case 404:
			code = "CITY_UNAVAILABLE"
		case 401, 403:
			code = "UNAUTHORIZED"
		}
		fail(w, status, code)
		return
	}
	reply(w, result)
}

func (h *Handler) writeAddress(ctx context.Context, actor, token, id string, c AddressChange) (AddressResult, int) {
	tx, err := h.begin(ctx, true, "customer_addresses", "service_cities")
	if err != nil {
		return AddressResult{}, 503
	}
	defer tx.Rollback()
	// Serialize creation of the same actor/address as well as edits; never lock or access another actor's row.
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(84933,hashtext($1))", actor+":"+id); err != nil {
		return AddressResult{}, 503
	}
	old, err := scanAddress(tx.QueryRowContext(ctx, "SELECT id,city_id,label,details,latitude,longitude,version FROM customer_addresses WHERE actor_id=$1 AND id=$2 FOR UPDATE", actor, id))
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return AddressResult{}, 503
	}
	proposed := Address{ID: id, CityID: c.CityID, Label: c.Label, Details: c.Details, Latitude: *c.Latitude, Longitude: *c.Longitude, Version: *c.ExpectedVersion + 1}
	// Exact replay of the same resource/version is readback, not another mutation. A later edit is a conflict.
	replay := exists && old == proposed
	if !replay {
		if (!exists && *c.ExpectedVersion != 0) || (exists && old.Version != *c.ExpectedVersion) {
			return AddressResult{}, 409
		}
		var active bool
		if err = tx.QueryRowContext(ctx, "SELECT active FROM service_cities WHERE id=$1 FOR SHARE", c.CityID).Scan(&active); errors.Is(err, sql.ErrNoRows) || err == nil && !active {
			return AddressResult{}, 404
		}
		if err != nil {
			return AddressResult{}, 503
		}
		if exists {
			_, err = tx.ExecContext(ctx, "UPDATE customer_addresses SET city_id=$3,label=$4,details=$5,latitude=$6,longitude=$7,version=$8,updated_at=transaction_timestamp() WHERE actor_id=$1 AND id=$2 AND version=$9", actor, id, c.CityID, c.Label, c.Details, *c.Latitude, *c.Longitude, proposed.Version, *c.ExpectedVersion)
		} else {
			_, err = tx.ExecContext(ctx, "INSERT INTO customer_addresses(actor_id,id,city_id,label,details,latitude,longitude,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", actor, id, c.CityID, c.Label, c.Details, *c.Latitude, *c.Longitude, proposed.Version)
		}
		if err != nil {
			return AddressResult{}, 503
		}
	}
	if status := h.stillCurrent(ctx, token, actor); status != 200 {
		return AddressResult{}, status
	}
	if err = tx.Commit(); err != nil {
		return AddressResult{}, 503
	}
	if status := h.stillCurrent(ctx, token, actor); status != 200 {
		return AddressResult{}, 503
	}
	return AddressResult{ActorID: actor, Address: proposed, Replay: replay}, 200
}
