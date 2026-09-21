package main

import (
	"context"
	"log"
	"time"
)

func runFinancialHandoffReconciliationLoop(ctx context.Context, interval time.Duration, reconcile func(context.Context) error) {
	run := func() {
		if err := reconcile(ctx); err != nil {
			log.Printf("financial handoff reconciliation failed: %v", err)
		}
	}
	run()
	ticker:=time.NewTicker(interval)
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
