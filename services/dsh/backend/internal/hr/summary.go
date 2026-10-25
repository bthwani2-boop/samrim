package hr

import (
	"context"
	"database/sql"
)

// Summary is computed by PostgreSQL over the full employee directory, never a page.
type Summary struct {
	Total       int64             `json:"total"`
	Active      int64             `json:"active"`
	Inactive    int64             `json:"inactive"`
	Linked      int64             `json:"linked"`
	Departments []DepartmentCount `json:"departments"`
}

type DepartmentCount struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// ReadSummary uses one statement/snapshot for company totals and department distribution.
func ReadSummary(ctx context.Context, db *sql.DB) (Summary, error) {
	if db == nil {
		return Summary{}, ErrInvalid
	}
	rows, err := db.QueryContext(ctx, `
		SELECT department, COUNT(*)::bigint,
			COUNT(*) FILTER (WHERE status = 'active')::bigint,
			COUNT(*) FILTER (WHERE status = 'inactive')::bigint,
			COUNT(*) FILTER (WHERE operator_actor_id IS NOT NULL)::bigint
		FROM dsh.hr_employees
		GROUP BY ROLLUP (department)
		ORDER BY GROUPING(department) DESC, COUNT(*) DESC, department ASC`)
	if err != nil {
		return Summary{}, err
	}
	defer rows.Close()
	summary := Summary{Departments: make([]DepartmentCount, 0)}
	for rows.Next() {
		var department sql.NullString
		var total, active, inactive, linked int64
		if err := rows.Scan(&department, &total, &active, &inactive, &linked); err != nil {
			return Summary{}, err
		}
		if !department.Valid {
			summary.Total, summary.Active, summary.Inactive, summary.Linked = total, active, inactive, linked
			continue
		}
		if len(summary.Departments) < 7 {
			summary.Departments = append(summary.Departments, DepartmentCount{Name: department.String, Count: total})
		}
	}
	return summary, rows.Err()
}
