-- Bounded, oldest-first Partner role-admission queue. Excludes already resolved grants.
CREATE INDEX store_access_operator_pending_page_idx
  ON dsh.store_access_grants (created_at, id)
  WHERE state = 'pending_role_admission' AND accepted_at IS NOT NULL;
