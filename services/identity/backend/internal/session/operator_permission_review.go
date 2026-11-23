package session

import (
	"context"
	"errors"
	"net/http"
	"time"
)

type OperatorPermissionRevision struct {
	Permission string `json:"permission"`
	State      string `json:"state"`
	Version    int64  `json:"version"`
}

type OperatorPermissionReview struct {
	TargetActorID string                       `json:"targetActorId"`
	Permissions   []OperatorPermissionRevision `json:"permissions"`
}

// ReviewOperatorPermissions gives the current original Operator a consistent
// read of an active Operator's scope revisions, including their own.
func (r *PostgresReader) ReviewOperatorPermissions(
	ctx context.Context, authorization, target string,
) (OperatorPermissionReview, error) {
	if !operatorAdminID.MatchString(target) {
		return OperatorPermissionReview{}, ErrOperatorAdminInvalid
	}
	digest, err := bearerDigest(authorization)
	if err != nil {
		return OperatorPermissionReview{}, err
	}
	tx, err := r.beginRead(ctx)
	if err != nil {
		return OperatorPermissionReview{}, err
	}
	defer tx.Rollback()

	principal, err := lookupPrincipal(ctx, tx, digest)
	if err != nil {
		return OperatorPermissionReview{}, err
	}
	if principal.Role != "operator" {
		return OperatorPermissionReview{}, ErrOperatorAdminForbidden
	}
	var original bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS (
        SELECT 1 FROM operator_bootstrap WHERE singleton AND actor_id=$1)`,
		principal.ActorID).Scan(&original)
	if err != nil {
		return OperatorPermissionReview{}, err
	}
	if !original {
		return OperatorPermissionReview{}, ErrOperatorAdminForbidden
	}

	var active bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS (
        SELECT 1 FROM actors a JOIN actor_roles ar ON ar.actor_id=a.id
        WHERE a.id=$1 AND a.status='ACTIVE' AND ar.role='operator' AND ar.status='ACTIVE')`,
		target).Scan(&active)
	if err != nil {
		return OperatorPermissionReview{}, err
	}
	if !active {
		return OperatorPermissionReview{}, ErrOperatorAdminTargetNotFound
	}

	rows, err := tx.QueryContext(ctx, `SELECT permission,state,version
        FROM operator_permissions WHERE actor_id=$1 ORDER BY permission`, target)
	if err != nil {
		return OperatorPermissionReview{}, err
	}
	defer rows.Close()
	result := OperatorPermissionReview{TargetActorID: target, Permissions: []OperatorPermissionRevision{}}
	for rows.Next() {
		var entry OperatorPermissionRevision
		if err := rows.Scan(&entry.Permission, &entry.State, &entry.Version); err != nil {
			return OperatorPermissionReview{}, err
		}
		if !isOperatorPermission(entry.Permission) ||
			(entry.State != "ACTIVE" && entry.State != "REVOKED") || entry.Version < 1 {
			return OperatorPermissionReview{}, errors.New("unexpected Operator permission revision")
		}
		result.Permissions = append(result.Permissions, entry)
	}
	if err := rows.Err(); err != nil {
		return OperatorPermissionReview{}, err
	}
	if err := tx.Commit(); err != nil {
		return OperatorPermissionReview{}, err
	}
	return result, nil
}

func NewOperatorPermissionReviewHandler(owner *PostgresReader) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
			return
		}
		if r.ContentLength != 0 || len(r.TransferEncoding) != 0 || r.URL.RawQuery != "" || r.URL.ForceQuery {
			respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
			return
		}
		authorizations := r.Header.Values("Authorization")
		if len(authorizations) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
			respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		result, err := owner.ReviewOperatorPermissions(ctx, authorizations[0], r.PathValue("actorId"))
		switch {
		case errors.Is(err, ErrOperatorAdminInvalid):
			respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		case errors.Is(err, ErrUnauthorized):
			w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
			respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		case errors.Is(err, ErrOperatorAdminForbidden):
			respond(w, http.StatusForbidden, map[string]string{"error": "FORBIDDEN"})
		case errors.Is(err, ErrOperatorAdminTargetNotFound):
			respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		case err != nil:
			respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		default:
			respond(w, http.StatusOK, result)
		}
	})
}
