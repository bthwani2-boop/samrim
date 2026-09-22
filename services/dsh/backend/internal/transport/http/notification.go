package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	notificationdomain "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/notification"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type NotificationServer struct{ service *notificationdomain.Service }

func NewNotification(identityClient *identityintegration.Client, db *sql.DB) (*NotificationServer, error) {
	service, err := notificationdomain.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return &NotificationServer{service: service}, nil
}

func (s *NotificationServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/notifications", s.list)
	mux.HandleFunc("POST /dsh/notifications/{notificationId}/read", s.markRead)
}

func (s *NotificationServer) list(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "user session is required")
		return
	}
	limit := 50
	if value := strings.TrimSpace(r.URL.Query().Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	result, err := s.service.List(r.Context(), token, limit)
	if err != nil {
		writeNotificationError(w, err)
		return
	}
	items := make([]contract.Notification, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, contract.Notification{ID: item.ID, Kind: contract.NotificationKind(item.Kind), Title: item.Title, Body: item.Body, OrderID: item.OrderID, CreatedAt: item.CreatedAt, ReadAt: item.ReadAt})
	}
	writeJSON(w, http.StatusOK, contract.NotificationListResponse{Notifications: items, UnreadCount: result.UnreadCount})
}

func (s *NotificationServer) markRead(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "user session is required")
		return
	}
	notificationID := strings.TrimSpace(r.PathValue("notificationId"))
	if notificationID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "notificationId is required")
		return
	}
	readAt, err := s.service.MarkRead(r.Context(), token, notificationID)
	if err != nil {
		writeNotificationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.NotificationReadResponse{NotificationID: notificationID, ReadAt: readAt})
}

func writeNotificationError(w http.ResponseWriter, err error) {
	var identityErr *identityclient.Error
	if errors.As(err, &identityErr) {
		writeIdentityError(w, err)
		return
	}
	switch {
	case errors.Is(err, notificationdomain.ErrSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active client, partner, captain, or field session is required")
	case errors.Is(err, postgres.ErrNotificationNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "notification was not found")
	default:
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "notification storage is unavailable")
	}
}
