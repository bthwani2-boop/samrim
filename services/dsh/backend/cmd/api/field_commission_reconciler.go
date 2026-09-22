package main

import (
	"context"
	"log"
	"time"
)

func runFieldCommissionReconciliationLoop(ctx context.Context, interval time.Duration, reconcile func(context.Context) error) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := reconcile(ctx); err != nil {
				log.Printf("field commission reconciliation failed: %v", err)
			}
		}
	}
}
