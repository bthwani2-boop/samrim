package notification

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var ErrSessionForbidden = errors.New("an active notification session is required")

type View struct {
	ID        string
	Kind      string
	Title     string
	Body      string
	OrderID   string
	CreatedAt time.Time
	ReadAt    *time.Time
}

type ListResult struct {
	Items       []View
	UnreadCount int
}

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("notification configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) List(ctx context.Context, accessToken string, limit int) (ListResult, error) {
	identity, role, err := s.requireSession(ctx, accessToken)
	if err != nil {
		return ListResult{}, err
	}
	result, err := postgres.ListNotifications(ctx, s.db, identity.Subject, role, limit)
	if err != nil {
		return ListResult{}, err
	}
	items := make([]View, 0, len(result.Items))
	for _, event := range result.Items {
		view := present(event, role)
		if view.Kind == "" {
			continue
		}
		items = append(items, view)
	}
	return ListResult{Items: items, UnreadCount: result.UnreadCount}, nil
}

func (s *Service) MarkRead(ctx context.Context, accessToken, notificationID string) (time.Time, error) {
	identity, role, err := s.requireSession(ctx, accessToken)
	if err != nil {
		return time.Time{}, err
	}
	return postgres.MarkNotificationRead(ctx, s.db, identity.Subject, role, notificationID)
}

func (s *Service) requireSession(ctx context.Context, accessToken string) (stringIdentity, string, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return stringIdentity{}, "", err
	}
	role := string(identity.Role)
	if identity.Subject == "" || (role == "client" && identity.Surface == "app-client") || (role == "partner" && identity.Surface == "app-partner") || (role == "captain" && identity.Surface == "app-captain") {
		if identity.Subject != "" {
			return stringIdentity{Subject: identity.Subject}, role, nil
		}
	}
	return stringIdentity{}, "", ErrSessionForbidden
}

type stringIdentity struct{ Subject string }

func present(event postgres.NotificationEvent, role string) View {
	kind, title, body := message(event.EventType, role, event.OrderID)
	return View{ID: event.ID, Kind: kind, Title: title, Body: body, OrderID: event.OrderID, CreatedAt: event.CreatedAt, ReadAt: event.ReadAt}
}

func message(eventType, role, orderID string) (string, string, string) {
	orderRef := strings.TrimSpace(orderID)
	if orderRef == "" {
		orderRef = "الطلب"
	}
	switch eventType {
	case "order_created":
		if role == "partner" {
			return "ORDER_CREATED", "وصل طلب جديد", fmt.Sprintf("وصل طلب جديد رقم %s إلى متجرك.", orderRef)
		}
		return "ORDER_CREATED", "تم إنشاء الطلب", fmt.Sprintf("تم إنشاء طلبك رقم %s بنجاح.", orderRef)
	case "order_partner_accepted":
		return "ORDER_ACCEPTED", "تم قبول الطلب", fmt.Sprintf("تم قبول الطلب رقم %s من المتجر.", orderRef)
	case "order_preparing":
		return "ORDER_PREPARING", "بدأ تجهيز الطلب", fmt.Sprintf("بدأ المتجر تجهيز الطلب رقم %s.", orderRef)
	case "order_ready_for_dispatch":
		return "ORDER_READY", "الطلب جاهز للتوصيل", fmt.Sprintf("الطلب رقم %s جاهز لاستلام الكابتن.", orderRef)
	case "order_rejected":
		return "ORDER_REJECTED", "تعذر قبول الطلب", fmt.Sprintf("تعذر قبول الطلب رقم %s.", orderRef)
	case "dispatch_offer_created":
		return "CAPTAIN_OFFER", "طلب توصيل جديد", fmt.Sprintf("لديك عرض توصيل جديد للطلب رقم %s.", orderRef)
	case "dispatch_offer_accepted":
		if role == "captain" {
			return "CAPTAIN_ASSIGNED", "تم قبول عرض التوصيل", fmt.Sprintf("تم إسناد الطلب رقم %s إليك.", orderRef)
		}
		return "CAPTAIN_ASSIGNED", "تم تعيين الكابتن", fmt.Sprintf("تم تعيين كابتن لتوصيل الطلب رقم %s.", orderRef)
	case "dispatch_offer_rejected", "dispatch_offer_expired", "captain_offer_superseded_by_access":
		return "CAPTAIN_OFFER", "تحديث عرض التوصيل", fmt.Sprintf("تحدّث عرض توصيل الطلب رقم %s.", orderRef)
	case "captain_assignment_reassigned":
		if role == "captain" {
			return "CAPTAIN_OFFER", "طلب توصيل جديد", fmt.Sprintf("لديك عرض توصيل جديد للطلب رقم %s.", orderRef)
		}
		return "REASSIGNED", "إعادة إسناد التوصيل", fmt.Sprintf("تمت إعادة إسناد توصيل الطلب رقم %s.", orderRef)
	case "store_handoff_confirmed":
		return "HANDOFF_CONFIRMED", "تم تأكيد الاستلام من المتجر", fmt.Sprintf("تم تأكيد استلام الطلب رقم %s من المتجر.", orderRef)
	case "captain_pickup_completed":
		return "PICKED_UP", "تم استلام الطلب", fmt.Sprintf("استلم الكابتن الطلب رقم %s وبدأ التوصيل.", orderRef)
	case "delivery_failed":
		return "DELIVERY_FAILED", "تعذر إتمام التوصيل", fmt.Sprintf("تعذر إتمام توصيل الطلب رقم %s ويحتاج إلى متابعة.", orderRef)
	case "delivery_recovered":
		return "DELIVERY_RECOVERED", "استؤنفت محاولة التوصيل", fmt.Sprintf("استؤنفت محاولة توصيل الطلب رقم %s.", orderRef)
	case "delivery_completed":
		return "DELIVERED", "تم تسليم الطلب", fmt.Sprintf("تم تسليم الطلب رقم %s بنجاح.", orderRef)
	default:
		return "ORDER_STATUS", "تحديث على الطلب", fmt.Sprintf("يوجد تحديث جديد على الطلب رقم %s.", orderRef)
	}
}
