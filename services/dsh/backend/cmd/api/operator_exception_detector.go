package main

import (
	"context"
	"log"
	"time"
)

// Detection is advisory only: it opens an Operations case without changing
// the Order, Captain custody, payment, or customer-visible state.
func runOperatorExceptionDetectorLoop(ctx context.Context, interval time.Duration, detect func(context.Context) (int64, error)) {
	if interval <= 0 {
		interval = time.Minute
	}
	run := func() {
		attempt, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		opened, err := detect(attempt)
		if err != nil && ctx.Err() == nil {
			log.Printf("operations exception detection deferred: %v", err)
		} else if opened > 0 {
			log.Printf("operations exception detector recorded %d case updates", opened)
		}
	}
	run()
	timer := time.NewTicker(interval)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			run()
		}
	}
}
