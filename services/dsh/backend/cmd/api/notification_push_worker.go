package main

import (
	"context"
	"log"
	"time"
)

// Disabled by default until Firebase credentials are installed in EAS and
// DSH_EXPO_PUSH_ENABLED=true is explicitly set on the backend.
func runNotificationPushLoop(ctx context.Context, interval time.Duration,
	dispatch func(context.Context) (int, error)) {
	if interval < time.Second {
		interval = 6 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			attempt, cancel := context.WithTimeout(ctx, 20*time.Second)
			_, err := dispatch(attempt)
			cancel()
			if err != nil && ctx.Err() == nil {
				log.Printf("order push batch deferred: %v", err)
			}
		}
	}
}
