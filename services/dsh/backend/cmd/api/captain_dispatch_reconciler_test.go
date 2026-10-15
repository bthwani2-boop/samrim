package main

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestCaptainAutomaticDispatchLoopRotatesCursorEvenAfterOrderError(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	cursors := []string{}
	runCaptainAutomaticDispatchLoop(ctx, time.Millisecond, func(_ context.Context, afterID string) (string, error) {
		cursors = append(cursors, afterID)
		switch len(cursors) {
		case 1:
			return "order-last-page", nil
		case 2:
			return "", errors.New("one order failed while the batch was scanned")
		case 3:
			cancel()
			return "", nil
		default:
			t.Fatal("unexpected extra reconciliation")
			return "", nil
		}
	})
	if want := []string{"", "order-last-page", ""}; !reflect.DeepEqual(cursors, want) {
		t.Fatalf("automatic dispatch cursor progression=%v want=%v", cursors, want)
	}
}
