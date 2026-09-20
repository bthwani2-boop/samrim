package main

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunMediaReconciliationLoopRetriesUntilStopped(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var calls atomic.Int32
	done := make(chan struct{})
	go func() {
		runMediaReconciliationLoop(ctx, time.Millisecond, func(context.Context) error {
			if calls.Add(1) == 2 {
				cancel()
			}
			return nil
		})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("media reconciliation loop did not stop after cancellation")
	}
	if got := calls.Load(); got < 2 {
		t.Fatalf("media reconciliation attempts = %d, want at least 2", got)
	}
}
