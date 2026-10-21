ALTER TABLE dsh.store_captain_memberships ADD COLUMN invited_captain_actor_id TEXT;
ALTER TABLE dsh.store_captain_memberships ADD COLUMN display_name_ar TEXT NOT NULL DEFAULT '';
ALTER TABLE dsh.store_captain_memberships ADD CONSTRAINT store_captain_display_name_length_ck CHECK (char_length(display_name_ar) <= 80);
CREATE INDEX store_captain_invitation_recipient_idx ON dsh.store_captain_memberships(invited_captain_actor_id, state, expires_at) WHERE invited_captain_actor_id IS NOT NULL;
