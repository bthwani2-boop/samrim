-- Canonical Partner/Store cutover: DSH stores the Identity partner actor ID
-- directly and removes the redundant partner-organization projection.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM dsh.partner_bootstrap_idempotency i
        JOIN dsh.partner_organizations po ON po.id = i.partner_organization_id
        WHERE i.owner_actor_id IS DISTINCT FROM po.owner_actor_id
    ) THEN
        RAISE EXCEPTION 'DSH cutover refused: bootstrap owner and organization owner diverge';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM dsh.partner_bootstrap_audit a
        JOIN dsh.partner_organizations po ON po.id = a.partner_organization_id
        WHERE a.owner_actor_id IS DISTINCT FROM po.owner_actor_id
    ) THEN
        RAISE EXCEPTION 'DSH cutover refused: audit owner and organization owner diverge';
    END IF;
END $$;

ALTER TABLE dsh.stores ADD COLUMN IF NOT EXISTS partner_actor_id text;
UPDATE dsh.stores s
SET partner_actor_id = po.owner_actor_id
FROM dsh.partner_organizations po
WHERE s.partner_organization_id = po.id
  AND s.partner_actor_id IS NULL;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM dsh.stores WHERE partner_actor_id IS NULL) THEN
        RAISE EXCEPTION 'DSH cutover refused: Store has no canonical partner actor';
    END IF;
END $$;
ALTER TABLE dsh.stores DROP CONSTRAINT IF EXISTS stores_partner_organization_id_fkey;
ALTER TABLE dsh.stores DROP COLUMN IF EXISTS partner_organization_id;
ALTER TABLE dsh.stores ALTER COLUMN partner_actor_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS stores_partner_actor_idx
    ON dsh.stores(partner_actor_id, created_at ASC);

ALTER TABLE dsh.partner_bootstrap_idempotency ADD COLUMN IF NOT EXISTS partner_actor_id text;
UPDATE dsh.partner_bootstrap_idempotency
SET partner_actor_id = owner_actor_id
WHERE partner_actor_id IS NULL;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM dsh.partner_bootstrap_idempotency WHERE partner_actor_id IS NULL) THEN
        RAISE EXCEPTION 'DSH cutover refused: bootstrap record has no canonical partner actor';
    END IF;
END $$;
ALTER TABLE dsh.partner_bootstrap_idempotency DROP CONSTRAINT IF EXISTS partner_bootstrap_idempotency_partner_organization_id_fkey;
ALTER TABLE dsh.partner_bootstrap_idempotency DROP COLUMN IF EXISTS owner_actor_id;
ALTER TABLE dsh.partner_bootstrap_idempotency DROP COLUMN IF EXISTS partner_organization_id;
ALTER TABLE dsh.partner_bootstrap_idempotency ALTER COLUMN partner_actor_id SET NOT NULL;

ALTER TABLE dsh.partner_bootstrap_audit ADD COLUMN IF NOT EXISTS partner_actor_id text;
UPDATE dsh.partner_bootstrap_audit
SET partner_actor_id = owner_actor_id
WHERE partner_actor_id IS NULL;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM dsh.partner_bootstrap_audit WHERE partner_actor_id IS NULL) THEN
        RAISE EXCEPTION 'DSH cutover refused: audit record has no canonical partner actor';
    END IF;
END $$;
ALTER TABLE dsh.partner_bootstrap_audit DROP CONSTRAINT IF EXISTS partner_bootstrap_audit_partner_organization_id_fkey;
ALTER TABLE dsh.partner_bootstrap_audit DROP COLUMN IF EXISTS owner_actor_id;
ALTER TABLE dsh.partner_bootstrap_audit DROP COLUMN IF EXISTS partner_organization_id;
ALTER TABLE dsh.partner_bootstrap_audit ALTER COLUMN partner_actor_id SET NOT NULL;
DROP INDEX IF EXISTS dsh.partner_bootstrap_audit_owner_idx;
CREATE INDEX IF NOT EXISTS partner_bootstrap_audit_partner_idx
    ON dsh.partner_bootstrap_audit(partner_actor_id, created_at DESC);

DROP TABLE dsh.partner_organizations;
