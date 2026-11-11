-- The canonical (actor_id, version) primary-key B-tree supports MAX(version)
-- and the per-actor latest pending-name read by scanning backward.
-- Retire the duplicate nonunique descending index without changing any
-- verified identity record, legal-name version, or canonical constraint.
DROP INDEX public.identity_actor_legal_name_versions_latest_idx;
