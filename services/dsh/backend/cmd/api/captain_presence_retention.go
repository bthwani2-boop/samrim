package main

import (
	"context"
	"log"
	"time"
)

// Enforce physical expiry even when no Captain has opened the app recently.
// Dispatch may continue using only the latest unexpired foreground fix.
func runCaptainPresenceRetentionLoop(ctx context.Context, interval time.Duration, prune func(context.Context) error) {
	if interval <= 0 {
		interval = time.Minute
	}
	run := func() {
		attempt, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		if err := prune(attempt); err != nil && ctx.Err() == nil {
			log.Printf("captain presence retention deferred: %v", err)
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
