package postgres

import (
    "context"
    "strings"
    "testing"
)

func TestOperatorAnalyticsPeriodRejectsInvalidDayCountBeforeDatabase(t *testing.T) {
    for _, days := range []int{-1, 0, 1, 8, 29, 31, 90} {
        _, err := ReadOperatorAnalyticsPeriod(context.Background(), nil, days)
        if err == nil || !strings.Contains(err.Error(), "period must be 7 or 30") {
            t.Errorf("days=%d, err=%v, want period validation error", days, err)
        }
    }
    for _, days := range []int{7, 30} {
        _, err := ReadOperatorAnalyticsPeriod(context.Background(), nil, days)
        if err == nil || !strings.Contains(err.Error(), "database unavailable") {
            t.Errorf("days=%d, err=%v, want database error after valid days", days, err)
        }
    }
}
