package main

import (
	"context"
	"log"
	"time"
)

// Periodic recovery also finds orders created before a captain became eligible,
// funded, or location-current. No offers are created without DSH/WLT preflight.
func runCaptainAutomaticDispatchLoop(ctx context.Context, interval time.Duration, reconcile func(context.Context, string) (string, error)) {
	cursor := ""
	run := func() {
		next, err := reconcile(ctx, cursor)
		if ctx.Err() == nil {
			cursor = next
		}
		if err != nil && ctx.Err() == nil {
			log.Printf("automatic captain dispatch deferred: %v", err)
		}
	}
	run()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
