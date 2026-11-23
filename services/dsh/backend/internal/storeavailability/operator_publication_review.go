package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// These are observed DSH facts, not an approval or an assertion of financial,
// legal, operational or checkout readiness. No publication mutation is exposed.
type PublicationReviewItem struct {
	ID                        string `json:"id"`
	Name                      string `json:"name"`
	VerticalID                string `json:"verticalId"`
	CityActive                bool   `json:"cityActive"`
	VerticalActive            bool   `json:"verticalActive"`
	LocationRecorded          bool   `json:"locationRecorded"`
	RegistrationTermsRecorded bool   `json:"registrationTermsRecorded"`
	WeeklyHoursRecorded       bool   `json:"weeklyHoursRecorded"`
	CatalogRecorded           bool   `json:"catalogRecorded"`
}

type PublicationReviewPage struct {
	CityID     string                  `json:"cityId"`
	Relation   string                  `json:"relation"`
	Items      []PublicationReviewItem `json:"items"`
	NextCursor string                  `json:"nextCursor,omitempty"`
}

const publicationReviewLimit = 20

func publicationReviewCursor(raw string) (string, bool) {
	q, err := url.ParseQuery(raw)
	if err != nil {
		return "", false
	}
	if len(q) == 0 {
		return "", true
	}
	v, ok := q["after"]
	if !ok || len(q) != 1 || len(v) != 1 || !registrationPublicID.MatchString(v[0]) {
		return "", false
	}
	return v[0], true
}

func (g *PostgresStoreGrants) readPublicationReview(ctx context.Context, cityID, relation, after string) (PublicationReviewPage, error) {
	if !registrationPublicID.MatchString(cityID) || !validRegistrationRelation(relation) ||
		(after != "" && !registrationPublicID.MatchString(after)) {
		return PublicationReviewPage{}, ErrInvalidChange
	}
	if g == nil || g.db == nil {
		return PublicationReviewPage{}, ErrStoreOwnerUnavailable
	}
	tx, err := beginScopedStoreTx(ctx, g.db, g.schema, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return PublicationReviewPage{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `
SELECT s.id,s.name,s.vertical_id,c.active,v.active,
       s.latitude IS NOT NULL AND s.longitude IS NOT NULL,
       EXISTS (SELECT 1 FROM store_registration_commands r
          JOIN store_registration_terms t ON t.version=r.terms_version
          WHERE r.store_id=s.id AND r.actor_id=s.owner_actor_id),
       EXISTS (SELECT 1 FROM store_operational_weekly_hours h WHERE h.store_id=s.id),
       EXISTS (SELECT 1 FROM offers o WHERE o.store_id=s.id)
FROM stores s JOIN service_cities c ON c.id=s.city_id JOIN verticals v ON v.id=s.vertical_id
WHERE s.city_id=$1 AND s.relation=$2 AND NOT s.published AND s.id COLLATE "C" > $3 COLLATE "C"
ORDER BY s.id COLLATE "C" LIMIT $4`, cityID, relation, after, publicationReviewLimit+1)
	if err != nil {
		return PublicationReviewPage{}, ErrStoreOwnerUnavailable
	}
	defer rows.Close()
	page := PublicationReviewPage{CityID: cityID, Relation: relation, Items: make([]PublicationReviewItem, 0, publicationReviewLimit)}
	for rows.Next() {
		var item PublicationReviewItem
		if err = rows.Scan(&item.ID, &item.Name, &item.VerticalID, &item.CityActive, &item.VerticalActive,
			&item.LocationRecorded, &item.RegistrationTermsRecorded, &item.WeeklyHoursRecorded, &item.CatalogRecorded); err != nil {
			return PublicationReviewPage{}, ErrStoreOwnerUnavailable
		}
		if len(page.Items) == publicationReviewLimit {
			page.NextCursor = page.Items[len(page.Items)-1].ID
			break
		}
		page.Items = append(page.Items, item)
	}
	if rows.Err() != nil || rows.Close() != nil {
		return PublicationReviewPage{}, ErrStoreOwnerUnavailable
	}
	if err = tx.Commit(); err != nil {
		return PublicationReviewPage{}, ErrStoreOwnerUnavailable
	}
	return page, nil
}

func verifyPublicationReviewer(ctx context.Context, identity IdentitySessions, token string) (string, error) {
	if identity == nil || token == "" {
		return "", ErrUnauthorized
	}
	a, err := identity.ResolveCurrentSession(ctx, token)
	if errors.Is(err, ErrIdentityUnavailable) {
		return "", ErrIdentityUnavailable
	}
	if err != nil || a.Subject == "" || strings.TrimSpace(a.Subject) != a.Subject {
		return "", ErrUnauthorized
	}
	if a.Role != OperatorRole {
		return "", ErrForbidden
	}
	if err = identity.RequireOperatorPermission(ctx, token, a.Subject, "merchant"); err != nil {
		return "", err
	}
	return a.Subject, nil
}

func NewOperatorPublicationReviewHandler(identity IdentitySessions, grants *PostgresStoreGrants) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeFailure(w, ErrUnauthorized)
			return
		}
		after, ok := publicationReviewCursor(r.URL.RawQuery)
		if !ok || !registrationPublicID.MatchString(r.PathValue("cityID")) || !validRegistrationRelation(r.PathValue("relation")) {
			writeFailure(w, ErrInvalidChange)
			return
		}
		actor, err := verifyPublicationReviewer(r.Context(), identity, token)
		if err != nil {
			writeFailure(w, err)
			return
		}
		page, err := grants.readPublicationReview(r.Context(), r.PathValue("cityID"), r.PathValue("relation"), after)
		if err != nil {
			writeFailure(w, err)
			return
		}
		current, err := verifyPublicationReviewer(r.Context(), identity, token)
		if err != nil {
			writeFailure(w, err)
			return
		}
		if current != actor {
			writeFailure(w, ErrForbidden)
			return
		}
		writeJSON(w, http.StatusOK, page)
	})
}
