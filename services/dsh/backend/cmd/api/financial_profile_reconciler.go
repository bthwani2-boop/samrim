package main

import (
	"context"
	"log"
	"time"
)

func runFinancialProfileReconciliationLoop(ctx context.Context, interval time.Duration, reconcile func(context.Context) error) {
	if interval <= 0 {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			attemptContext, cancel := context.WithTimeout(ctx, 15*time.Second)
			err := reconcile(attemptContext)
			cancel()
			if err != nil {
				log.Printf("partner financial profile reconciliation retry deferred: %v", err)
			}
		}
	}
}
