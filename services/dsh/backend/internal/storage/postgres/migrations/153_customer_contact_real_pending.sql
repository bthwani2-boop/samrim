-- A claimed-but-uncontacted order is PENDING, never a fictitious NO_ANSWER.
-- Preserve every genuine decision and its audit event; only zero-attempt placeholders are migrated.
ALTER TABLE dsh.customer_order_contact_reviews
 DROP CONSTRAINT customer_order_contact_reviews_state_check;

ALTER TABLE dsh.customer_order_contact_reviews
 ADD CONSTRAINT customer_order_contact_reviews_state_check
 CHECK (state IN ('PENDING','NO_ANSWER','CONFIRMED','DENIED','WRONG_NUMBER'));

UPDATE dsh.customer_order_contact_reviews
 SET state='PENDING'
 WHERE attempt_count=0 AND state='NO_ANSWER';

ALTER TABLE dsh.customer_order_contact_reviews
 ALTER COLUMN last_attempt_at DROP NOT NULL,
 ALTER COLUMN last_attempt_at DROP DEFAULT;

UPDATE dsh.customer_order_contact_reviews
 SET last_attempt_at=NULL
 WHERE attempt_count=0;

ALTER TABLE dsh.customer_order_contact_reviews
 ADD CONSTRAINT customer_contact_pending_attempt_chk
 CHECK ((state='PENDING') = (attempt_count=0));
