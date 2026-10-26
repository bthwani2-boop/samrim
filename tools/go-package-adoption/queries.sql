-- name: GetDemoOrder :one
SELECT id, actor_id, total_minor FROM demo_orders WHERE id = $1;
